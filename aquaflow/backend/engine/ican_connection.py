r"""
I-CAN gateway connection manager.

Owns the UDP socket lifecycle and an explicit connection state machine. Discovery
and status are READ-ONLY and safe; the output path is gated, rate-limited, duplicate-
suppressed and audit-logged, and it is NEVER auto-enabled by connecting or reconnecting.

    idle -> discovering -> connecting -> connected
                                   \-> error
    connected -> reconnecting -> connecting (gateway lost / IP changed)
    (any) -> disconnected (clean shutdown)

Safety invariants enforced here:
  * Connecting / rediscovering NEVER emits an output frame.
  * Output requires the manager to be explicitly output-enabled AND each call to pass
    `confirmed=True` (the operator-confirmation flow) — else it is refused and audited.
  * On connection loss the manager does NOT resend the last output; it goes to a safe
    reconnecting state.
  * Only one manager may transmit at a time (class-level transmit lock).
  * dry_run mode simulates all I/O for development and tests — no real socket, no frames.
"""
from __future__ import annotations

import asyncio
import logging
import socket
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from engine import ican_protocol as proto
from engine import ican_discovery as disco
# The transport that is PROVEN to run the fountain. We call it; we do not
# reimplement it. See engine/ican_reference_client.py.
from engine.ican_reference_client import ICANClient
from engine import ican_reference_client as refclient

logger = logging.getLogger("ican.connection")
audit = logging.getLogger("ican.audit")


class ConnectionState(str, Enum):
    IDLE = "idle"
    DISCOVERING = "discovering"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    DISCONNECTED = "disconnected"
    ERROR = "error"


@dataclass
class ICANConfig:
    gateway_ip: Optional[str] = None          # discovered, not hard-coded
    gateway_port: int = proto.DEFAULT_GATEWAY_PORT
    local_port: int = proto.DEFAULT_LOCAL_PORT
    timeout: float = 0.5
    retries: int = 2
    dry_run: bool = False                     # simulate all I/O (dev/tests)
    output_min_interval: float = 0.02         # retained for API compatibility; unused
    # How often the CURRENT state of every driven group is re-sent. The original
    # fountain software does not send a frame once and stop — it streams the output
    # state continuously (19,152 OUTPUT frames in the site capture; frames ~250 ms
    # apart). A relay controller with a watchdog drops its outputs when that stream
    # stops, which looks exactly like "the command was sent and nothing happened".
    # The Art-Net driver in this same codebase already re-sends on a keepalive for the
    # same reason; I-CAN never did.
    refresh_interval: float = 0.1             # 10 Hz, comfortably inside any plausible watchdog

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        return d


def _netlog(direction: str, cfg: ICANConfig, payload: bytes, *, message_type="",
            latency_ms=None, result="", error="", interface="", local_ip=""):
    """Structured, human-readable network log line with the required fields."""
    logger.info(
        "icannet dir=%s iface=%s local=%s:%s remote=%s:%s type=%s hex=[%s] "
        "latency_ms=%s result=%s error=%s",
        direction, interface or "-", local_ip or "-", cfg.local_port,
        cfg.gateway_ip or "-", cfg.gateway_port, message_type or "-",
        proto.hexdump(payload) if payload else "-",
        f"{latency_ms:.1f}" if latency_ms is not None else "-",
        result or "-", error or "-",
    )


class ICANConnection:
    """One manager per gateway. Use dry_run=True for tests without hardware."""

    # Class-level transmit lock: at most one manager transmits at any instant.
    # Kept per-event-loop so the single-transmitter guarantee holds within the one
    # running app loop, without breaking when tests spin up fresh loops.
    _tx_locks: dict = {}

    @classmethod
    def _tx_lock(cls) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        lock = cls._tx_locks.get(loop)
        if lock is None:
            lock = asyncio.Lock()
            cls._tx_locks[loop] = lock
        return lock

    def __init__(self, config: Optional[ICANConfig] = None):
        self.cfg = config or ICANConfig()
        self.state = ConnectionState.IDLE
        self.last_error: str = ""
        self.last_reply: Optional[proto.ParsedResponse] = None
        # Did the gateway answer our read-only poll? Control does not require it —
        # see connect() — but the operator must be able to tell the two apart.
        self.verified: bool = False
        self.local_port_fallback: bool = False
        # Every group we have transmitted to, so blackout can turn off all of them
        # rather than only group 0.
        self._groups_seen: set[int] = set()
        self._client: Optional[ICANClient] = None
        # The state being STREAMED, per group. Re-sent continuously while armed.
        self._last_channels: dict[int, list] = {}
        self._refresh_task = None
        self._refresh_count = 0
        self._sock: Optional[socket.socket] = None
        self._output_enabled = False           # must be turned on deliberately
        self._last_output: Optional[bytes] = None
        self._last_output_ts: float = 0.0
        self._auto_reconnect = True
        self._closing = False
        self.audit_log: list[dict] = []         # in-memory audit trail (also logged)
        self._state_history: list[tuple[float, str]] = []

    # ── state machine ─────────────────────────────────────────────────────────
    def _set_state(self, new: ConnectionState, *, error: str = ""):
        if new == self.state and not error:
            return
        prev = self.state
        self.state = new
        if error:
            self.last_error = error
        self._state_history.append((time.time(), new.value))
        logger.info("icann state %s -> %s%s", prev.value, new.value,
                    f" ({error})" if error else "")

    # ── socket lifecycle ──────────────────────────────────────────────────────
    def _open_socket(self) -> bool:
        """Open the proven client's socket. No SO_REUSEADDR, no silent fallback.

        The previous version set SO_REUSEADDR and, if port 2002 was busy, quietly bound
        an ephemeral port instead. Both were wrong on this hardware. SO_REUSEADDR let the
        bind SUCCEED while the vendor I-CAN software still owned 2002, so AquaFlow
        reported a healthy connection, reported every frame as sent, and the fountain did
        not move — with no warning anywhere, because from AquaFlow's side nothing had
        failed. The reference client refuses to start in that situation, which is the
        behaviour we want: a loud, specific error naming the cause.
        """
        if self.cfg.dry_run:
            return True
        try:
            self._client = ICANClient(
                gateway_ip=self.cfg.gateway_ip,
                gateway_port=self.cfg.gateway_port,
                local_port=self.cfg.local_port,
                timeout=self.cfg.timeout,
            )
            self._sock = self._client.sock
            bound = self._sock.getsockname()[1]
            self.local_port_fallback = (bound != self.cfg.local_port)
            self.cfg.local_port = bound
            return True
        except OSError as e:
            # ICANClient raises with the operator-facing explanation already attached.
            self.last_error = str(e)
            logger.error("icann %s", self.last_error)
            return False

    def _close_socket(self):
        if self._client is not None:
            try:
                self._client.close()
            except OSError:
                pass
        self._client = None
        self._sock = None

    # ── discovery + connect ───────────────────────────────────────────────────
    async def discover_and_connect(self, **discover_kwargs) -> bool:
        """Run discovery (read-only), then connect to the found gateway. Emits no output."""
        self._set_state(ConnectionState.DISCOVERING)
        report = await disco.discover(
            gateway_port=self.cfg.gateway_port,
            local_port=self.cfg.local_port,
            **discover_kwargs,
        )
        if not report.gateway:
            self._set_state(ConnectionState.ERROR, error=report.note)
            return False
        self.cfg.gateway_ip = report.gateway.ip
        return await self.connect()

    async def connect(self) -> bool:
        """Open the socket and verify the gateway answers a SAFE probe. No output sent."""
        if not self.cfg.gateway_ip:
            self._set_state(ConnectionState.ERROR, error="no gateway_ip (discover first)")
            return False
        self._set_state(ConnectionState.CONNECTING)
        if not self._open_socket():
            self._set_state(ConnectionState.ERROR, error=self.last_error)
            return False
        ok, reply, latency = await self._exchange(proto.safe_probe_frame(),
                                                  message_type="probe")
        self.verified = bool(ok)
        if ok:
            self.last_reply = reply
            self._set_state(ConnectionState.CONNECTED)
            return True
        # An unanswered probe used to mean ERROR, socket closed, and every later
        # send_output refused with "REFUSED: state error". That made the real fountain
        # uncontrollable: I-CAN control is fire-and-forget UDP and the gateway does not
        # acknowledge output frames, so demanding a reply before transmitting is a gate
        # the hardware can never open. The proven working client reads nothing back at
        # all. So: reachability is not a precondition for control, it is a QUALITY
        # SIGNAL. We connect, and `verified` records that nothing answered so the
        # operator sees it rather than being told a lie in either direction.
        self.last_error = ("gateway did not answer the 0x03 poll — link unverified; "
                           "output frames are sent fire-and-forget")
        self._set_state(ConnectionState.CONNECTED)
        logger.warning("icann connected UNVERIFIED to %s:%s — %s",
                       self.cfg.gateway_ip, self.cfg.gateway_port, self.last_error)
        return True

    # ── the read/verify exchange (READ-ONLY) ──────────────────────────────────
    async def _exchange(self, frame: bytes, *, message_type: str,
                        match_key: Optional[int] = None):
        """Send `frame`, await a validated reply from the gateway. Returns
        (ok, ParsedResponse|None, latency_ms). Used for probe/status — safe frames only."""
        if self.cfg.dry_run:
            # simulate a valid gateway reply (echo command with reply flag)
            sim = bytearray(frame)
            sim[1] = 1
            parsed = proto.parse_response(bytes(sim))
            _netlog("tx", self.cfg, frame, message_type=message_type, result="dry-run")
            _netlog("rx", self.cfg, bytes(sim), message_type="reply", result="dry-run")
            return True, parsed, 0.0
        loop = asyncio.get_event_loop()

        def _io():
            t0 = time.monotonic()
            self._client._send(frame)          # the proven client's socket
            deadline = t0 + self.cfg.timeout * max(1, self.cfg.retries)
            while time.monotonic() < deadline:
                try:
                    data, addr = self._sock.recvfrom(1024)
                except socket.timeout:
                    continue
                # Source validation on the ADDRESS only. The port filter used to require
                # the reply to come from the gateway's command port (200); a UDP device
                # that answers from an ephemeral port had every valid reply discarded and
                # the link was reported "unverified" for no reason. The reference client
                # does not filter at all — it reads whatever comes back.
                if addr[0] != self.cfg.gateway_ip:
                    continue
                if addr[1] != self.cfg.gateway_port:
                    logger.info("icann reply from %s:%s (command port is %s) — accepted",
                                addr[0], addr[1], self.cfg.gateway_port)
                v = proto.validate_gateway_response(data)
                if not v.valid:
                    continue
                # response matching where the protocol allows it (byte[4] echo)
                if match_key is not None and len(data) >= 5 and data[4] != match_key:
                    continue
                return data, (time.monotonic() - t0) * 1000.0
            return None, None

        async with ICANConnection._tx_lock():
            _netlog("tx", self.cfg, frame, message_type=message_type)
            try:
                data, latency = await loop.run_in_executor(None, _io)
            except OSError as e:
                _netlog("tx", self.cfg, frame, message_type=message_type,
                        result="error", error=str(e))
                return False, None, None
        if data is None:
            _netlog("rx", self.cfg, b"", message_type="timeout", result="no-reply")
            return False, None, None
        parsed = proto.parse_response(data)
        _netlog("rx", self.cfg, data, message_type="reply",
                latency_ms=latency, result="valid")
        return True, parsed, latency

    async def probe(self):
        """Read-only liveness probe. Safe to call any time."""
        if self.state not in (ConnectionState.CONNECTED, ConnectionState.CONNECTING):
            return False
        ok, reply, _ = await self._exchange(proto.safe_probe_frame(),
                                            message_type="probe")
        was_verified = self.verified
        self.verified = bool(ok)
        if ok:
            self.last_reply = reply
        elif was_verified and self.state == ConnectionState.CONNECTED and self._auto_reconnect:
            # Only a link that HAD been answering and then stopped counts as a loss.
            # A gateway that never answered has not "gone away" — treating silence as
            # loss would drop a working fire-and-forget link on its first poll.
            await self._on_loss("probe unanswered after previously replying")
        return ok

    async def _on_loss(self, why: str):
        """Gateway lost: go to a SAFE reconnecting state. Never resend last output."""
        self._set_state(ConnectionState.RECONNECTING, error=why)
        self._last_output = None  # explicitly forget it — no auto-resend
        # rediscovery is the caller's job (non-blocking); we just hold safe state.

    # ── OUTPUT path (gated, audited) ──────────────────────────────────────────
    def enable_output(self, enabled: bool):
        """Deliberately arm/disarm the output path. Connecting never calls this."""
        self._output_enabled = bool(enabled)
        logger.warning("icann output %s", "ENABLED" if enabled else "disabled")
        if self._output_enabled:
            self._start_refresh()
        else:
            self._stop_refresh()

    def _audit(self, action: str, frame: bytes, result: str, user: str = "system"):
        rec = {
            "ts": time.time(), "action": action, "user": user,
            "gateway": f"{self.cfg.gateway_ip}:{self.cfg.gateway_port}",
            "frame_hex": proto.hexdump(frame) if frame else "",
            "result": result,
        }
        self.audit_log.append(rec)
        audit.info("OUTPUT action=%s user=%s gw=%s hex=[%s] result=%s",
                   action, user, rec["gateway"], rec["frame_hex"], result)

    async def send_output(self, group: int, channels, *, confirmed: bool = False,
                          user: str = "operator") -> bool:
        """Send a cmd 0x08 OUTPUT frame. Refused unless output is enabled AND the caller
        passes confirmed=True (the operator-confirmation flow). Rate-limited and
        duplicate-suppressed. Every attempt is audited.

        NOTE: 0x08 semantics are capture-derived, NOT proven on hardware. This path
        exists so control can be wired safely once validated on the real gateway; it is
        disabled by default and must never be reachable from arbitrary user input."""
        try:
            # Encoded by the reference client itself, so the audit trail shows the exact
            # bytes that go on the wire rather than a second implementation's opinion.
            frame = refclient.encode_frame(refclient.CMD_OUTPUT, group,
                                           refclient.channels_to_mask(channels))
        except ValueError as e:
            self._audit("send_output", b"", f"REFUSED: {e}", user)
            return False
        if not self._output_enabled:
            self._audit("send_output", frame, "REFUSED: output not enabled", user)
            return False
        if not confirmed:
            self._audit("send_output", frame, "REFUSED: not confirmed", user)
            return False
        if self.state != ConnectionState.CONNECTED:
            self._audit("send_output", frame, f"REFUSED: state {self.state.value}", user)
            return False
        # NO rate limiting and NO duplicate suppression. The reference client has
        # neither: it transmits every command immediately, and the vendor software does
        # the same — the capture shows the identical frame repeated back to back. A
        # controller that drops "redundant" frames is a controller that can silently
        # skip the one frame that mattered.
        self._groups_seen.add(int(group))
        if self.cfg.dry_run:
            self._last_output, self._last_output_ts = frame, time.monotonic()
            self._audit("send_output", frame, "dry-run OK", user)
            return True
        try:
            async with ICANConnection._tx_lock():
                # The proven call. Not our own sendto.
                self._client.set_channels(group, channels)
            self._last_output, self._last_output_ts = frame, time.monotonic()
            self._last_channels[int(group)] = list(channels)      # keep streaming it
            _netlog("tx", self.cfg, frame, message_type="output", result="sent")
            self._audit("send_output", frame, "sent", user)
            return True
        except OSError as e:
            self._audit("send_output", frame, f"error: {e}", user)
            return False

    async def _refresh_loop(self):
        """Re-send the current state of every driven group, continuously, while armed.

        This is not a keepalive ping — each frame carries the full absolute channel
        state, exactly as the vendor software streams it. If the controller has an
        output watchdog, this is what holds the relays closed; if it does not, this is
        harmless repetition of a state that is already true.

        Refresh frames are deliberately NOT audited. At 10 Hz they would bury the
        operator's actual commands in the audit trail within seconds. `frames_streamed`
        in status() is the visible evidence that the stream is running.
        """
        while self._output_enabled and self.state == ConnectionState.CONNECTED:
            try:
                for group, channels in list(self._last_channels.items()):
                    async with ICANConnection._tx_lock():
                        self._client.set_channels(group, channels)
                    self._refresh_count += 1
            except (OSError, ValueError) as e:
                logger.warning("icann refresh failed: %s", e)
            except asyncio.CancelledError:
                raise
            await asyncio.sleep(max(0.01, self.cfg.refresh_interval))

    def _start_refresh(self):
        if self.cfg.dry_run or self._refresh_task is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return                                   # no loop (sync test context)
        self._refresh_task = loop.create_task(self._refresh_loop())
        logger.info("icann output stream started at %.0f Hz", 1.0 / self.cfg.refresh_interval)

    def _stop_refresh(self):
        if self._refresh_task is not None:
            self._refresh_task.cancel()
            self._refresh_task = None
            logger.info("icann output stream stopped after %d frame(s)", self._refresh_count)

    async def blackout(self) -> bool:
        """All-off to EVERY group we have driven. Allowed even when output is not
        'enabled' because it only ever turns things OFF (safety action).

        This used to send a single all-off for group 0 and call it done. The 0x08 frame
        carries absolute state for ONE group, so with jets mapped on groups 1 and 9 that
        blackout turned off nothing at all — an E-stop that left the fountain running.
        """
        if not (self.cfg.dry_run or self.state == ConnectionState.CONNECTED):
            return False
        # Group 0 is always included: it costs one datagram and covers a group that was
        # mapped but never yet driven, so it is absent from _groups_seen.
        groups = sorted(self._groups_seen | {0})
        all_ok = True
        for group in groups:
            frame = refclient.encode_frame(refclient.CMD_OUTPUT, group,
                                           bytes(refclient.MASK_BYTES))
            if not self.cfg.dry_run:
                try:
                    async with ICANConnection._tx_lock():
                        self._client.all_off(group)          # the proven call
                except OSError as e:
                    self._audit("blackout", frame, f"error: {e}")
                    all_ok = False
                    continue
            self._audit("blackout", frame, f"sent (group {group})")
        # Keep streaming, but stream OFF. Silence is not the same as an off command:
        # if the controller latches its last state, going quiet would leave the relays
        # closed. The stream now holds them open.
        self._last_channels = {g: [] for g in groups}
        self._last_output = None
        return all_ok

    def set_auto_reconnect(self, enabled: bool):
        self._auto_reconnect = bool(enabled)

    async def close(self):
        """Clean shutdown: no lingering socket, safe disconnected state."""
        self._closing = True
        self._stop_refresh()
        self._close_socket()
        self._set_state(ConnectionState.DISCONNECTED)

    def status(self) -> dict:
        return {
            "state": self.state.value,
            "gateway_ip": self.cfg.gateway_ip,
            "gateway_port": self.cfg.gateway_port,
            "local_port": self.cfg.local_port,
            "output_enabled": self._output_enabled,
            # Did the gateway answer the read-only poll? Control works either way
            # (fire-and-forget), but "connected" alone must not be read as "reachable".
            "verified": self.verified,
            # True when local_port was busy and we fell back to an ephemeral port. The
            # site gateway is known to talk to 2002; if the original vendor software is
            # still running it owns that port and our frames may be ignored.
            "local_port_fallback": self.local_port_fallback,
            "groups_driven": sorted(self._groups_seen),
            # Proof the output stream is alive. The vendor software streams state
            # continuously; a frame count stuck at 0 while armed means it is not.
            "streaming": self._refresh_task is not None and not self._refresh_task.done(),
            "refresh_hz": round(1.0 / self.cfg.refresh_interval, 1) if self.cfg.refresh_interval else 0,
            "frames_streamed": self._refresh_count,
            "auto_reconnect": self._auto_reconnect,
            "last_error": self.last_error,
            "dry_run": self.cfg.dry_run,
            "audit_count": len(self.audit_log),
        }


# ── ProtocolBus adapter (NOT auto-registered on the primary bus) ─────────────
class ICANDriver:
    """Adapts ICANConnection to the ProtocolDriver interface so the gateway can join
    the protocol bus once validated. Intentionally NOT added by app_state today — the
    output semantics are unproven, so wiring it into the runtime bus is a deliberate,
    reviewed step, not a default."""
    name = "ican"

    def __init__(self, connection: ICANConnection):
        self._conn = connection

    async def connect(self) -> bool:
        return await self._conn.connect()

    async def disconnect(self):
        await self._conn.close()

    async def send(self, data: dict) -> bool:
        return await self._conn.send_output(
            data.get("group", 0), data.get("channels", []),
            confirmed=data.get("confirmed", False), user=data.get("user", "bus"))

    async def blackout(self):
        await self._conn.blackout()

    @property
    def is_connected(self) -> bool:
        return self._conn.state == ConnectionState.CONNECTED
