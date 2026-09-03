"""
engine/field_io.py — AF-IO-003: FieldIOManager, the reader loop for the input side.

Owns one driver per field-I/O source, polls every declared FieldPoint at the scan
rate, timestamps every sample, and keeps the latest quality-tagged Reading per point
in plain memory. Consumers PULL from that memory:

  * the safety kernel reads snapshot()/bound_snapshot() inside its 50 Hz tick — a
    dict lookup, never a network await (AF-IO-004);
  * the telemetry loop reads snapshot() to publish `field_io` frames (AF-IO-007).

Staleness is applied AT READ TIME via Reading.aged(): a point whose device stopped
answering demotes to STALE once its sample is older than 3× the scan period. Nothing
has to notice the failure for the quality to change — the passage of time does it.

Source keys (FieldPoint.source) select the transport:
  "modbus:HOST[:PORT[:UNIT]]" — engine/modbus_client.ModbusTCPClient
  "s7:HOST[:RACK[:SLOT]]"     — engine/s7_client.S7Client (AF-IO-005); addresses in
                                the DB dialect: DB1.DBW4, DB1.DBX2.0 (see
                                docs/S7_DB_CONTRACT.md for the published layout)
  anything else               — UNKNOWN (fail-closed: a transport we don't have is
                                a reading we don't have)

Modbus dialect per point:
  AI  — 5/6-digit "3xxxx" addresses → FC04 input registers; everything else → FC03
        holding registers (parse_register_address supplies the offset either way).
  DI  — the address is a plain 0-based discrete-input offset, read with FC02.
  AO/DO are outputs; the poll loop skips them (the command path is AF-IO-009).

Heartbeat: a point bound to "heartbeat" is expected to be a COUNTER the PLC
increments. A static read of a halted CPU succeeds forever, so liveness is judged on
the value CHANGING: heartbeat_alive() is False once the value has been flat longer
than the allowed window. (The S7 DB contract in AF-IO-005 mandates the counter.)
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from engine.field_points import (
    FieldPoint,
    FieldPointStore,
    PointKind,
    Quality,
    Reading,
    UNKNOWN_READING,
)
from engine.modbus_client import (
    ModbusTCPClient,
    ModbusException,
    ModbusFrameError,
    parse_register_address,
)

logger = logging.getLogger("aquaflow.field_io")


def _is_input_register_notation(address: str) -> bool:
    """True for the classic 3xxxx / 3xxxxx input-register table notation."""
    a = str(address).strip()
    return a.isdigit() and len(a) in (5, 6) and a[0] == "3"


class FieldIOManager:
    """The one reader loop. One instance per process (wired in app_state)."""

    STALE_FACTOR = 3.0          # a sample older than 3× scan period is STALE
    HEARTBEAT_FACTOR = 5.0      # a heartbeat flat longer than 5× scan is dead

    def __init__(self, store: Optional[FieldPointStore] = None, *,
                 scan_rate_s: float = 0.5):
        self.store = store or FieldPointStore().load()
        self.scan_rate_s = max(0.05, float(scan_rate_s))
        self._clients: dict[str, ModbusTCPClient] = {}
        self._readings: dict[str, Reading] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._running = False
        # Heartbeat change-tracking: point id → (last_value, last_change_monotonic)
        self._hb_last: dict[str, tuple] = {}
        self._cycles = 0            # completed poll cycles (all sources)

    # ── lifecycle ────────────────────────────────────────────────────────────
    @property
    def max_age_s(self) -> float:
        return self.scan_rate_s * self.STALE_FACTOR

    async def start(self):
        if self._running:
            return
        self._running = True
        by_source = self.store.by_source()
        for source, points in by_source.items():
            inputs = [p for p in points if p.kind in (PointKind.AI, PointKind.DI)]
            if not inputs:
                continue
            self._tasks[source] = asyncio.create_task(
                self._poll_source(source, inputs))
        logger.info("FieldIOManager started — %d source(s), %d point(s)",
                    len(self._tasks), len(self.store.all()))

    async def stop(self):
        self._running = False
        for task in self._tasks.values():
            task.cancel()
        for task in self._tasks.values():
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks = {}
        for client in self._clients.values():
            await client.close()
        self._clients = {}

    async def reload(self):
        """Restart the poll tasks against the current store contents (after the
        operator edits the inventory)."""
        was_running = self._running
        await self.stop()
        if was_running:
            await self.start()

    # ── the poll loop ────────────────────────────────────────────────────────
    def _client_for(self, source: str):
        """Build (once) the transport client for a source key; None = no transport."""
        client = self._clients.get(source)
        if client is not None:
            return client
        parts = source.split(":")
        if parts[0] == "modbus" and len(parts) >= 2 and parts[1]:
            host = parts[1]
            port = int(parts[2]) if len(parts) > 2 else 502
            unit = int(parts[3]) if len(parts) > 3 else 1
            client = ModbusTCPClient(host, port, unit)
        elif parts[0] == "s7" and len(parts) >= 2 and parts[1]:
            from engine.s7_client import S7Client
            host = parts[1]
            # "s7:HOST[:RACK[:SLOT]]" — port stays 102; rack/slot are the knobs.
            rack = int(parts[2]) if len(parts) > 2 else 0
            slot = int(parts[3]) if len(parts) > 3 else 1
            client = S7Client(host, 102, rack, slot)
        else:
            return None
        self._clients[source] = client
        return client

    async def _poll_source(self, source: str, points: list[FieldPoint]):
        client = self._client_for(source)
        if client is None:
            # A transport we don't have (s7: until AF-IO-005, or a typo) is a reading
            # we don't have. UNKNOWN, permanently and visibly — never a crash, never
            # a silent skip.
            logger.warning("field I/O source %r has no available transport — "
                           "its %d point(s) read UNKNOWN", source, len(points))
            now = time.time()
            for p in points:
                self._readings[p.id] = Reading(None, Quality.UNKNOWN, now, None)
            return

        while self._running:
            try:
                if await client.ensure_connected():
                    for p in points:
                        await self._read_point(client, p)
                # Not connected → touch nothing: existing readings age into STALE
                # on their own; never-read points stay UNKNOWN.
                self._cycles += 1
                await asyncio.sleep(self.scan_rate_s)
            except asyncio.CancelledError:
                break
            except Exception as e:  # pragma: no cover - belt and braces
                logger.error("field I/O poll error on %s: %s", source, e)
                await asyncio.sleep(self.scan_rate_s)

    async def _read_point(self, client, p: FieldPoint):
        from engine.s7_client import S7Client, S7ItemError, S7FrameError
        ts = time.time()
        try:
            if isinstance(client, S7Client):
                # S7 dialect: the address itself says bit vs word (DBX vs DBW).
                raw = await client.read_address(str(p.address).upper(), p.raw_type)
            elif p.kind == PointKind.DI:
                bits = await client.read_discrete_inputs(int(str(p.address).strip()), 1)
                raw = 1 if bits[0] else 0
            else:
                offset = parse_register_address(p.address)
                if _is_input_register_notation(p.address):
                    raw = (await client.read_input_registers(offset, 1))[0]
                else:
                    raw = (await client.read_holding_registers(offset, 1))[0]
        except (ModbusException, S7ItemError) as e:
            # The device is up and says this address is wrong — that is a
            # configuration problem, not a stale link: UNKNOWN (unreadable).
            logger.debug("field point %s unreadable: %s", p.id, e)
            self._readings[p.id] = Reading(None, Quality.UNKNOWN, ts, None)
            return
        except (ModbusFrameError, S7FrameError, ValueError) as e:
            # Transport fault (link died mid-cycle) or malformed address. Leave the
            # last reading in place — aging demotes it to STALE; a never-read point
            # stays UNKNOWN via the snapshot default.
            logger.debug("field point %s read failed: %s", p.id, e)
            return

        reading = p.evaluate(raw, ts)
        self._readings[p.id] = reading
        if p.binds_to == "heartbeat":
            self._track_heartbeat(p.id, reading)

    def _track_heartbeat(self, pid: str, reading: Reading):
        prev = self._hb_last.get(pid)
        now = time.monotonic()
        if reading.quality != Quality.GOOD:
            return                      # a bad read is not a change
        if prev is None or prev[0] != reading.value:
            self._hb_last[pid] = (reading.value, now)

    # ── consumers pull from here (sync, allocation-light, no awaits) ─────────
    def get(self, point_id: str, now: Optional[float] = None) -> Reading:
        r = self._readings.get(str(point_id))
        if r is None:
            return UNKNOWN_READING
        return r.aged(now=now, max_age=self.max_age_s)

    def snapshot(self, now: Optional[float] = None) -> dict[str, Reading]:
        """id → Reading for every declared point, staleness applied. Points never
        read report UNKNOWN — absence is a datum, not a missing key."""
        now = time.time() if now is None else now
        return {p.id: self.get(p.id, now) for p in self.store.all()}

    def bound_snapshot(self, now: Optional[float] = None) -> dict[str, Reading]:
        """binds_to name → the WORST reading among the points bound to it. Two
        sensors on one interlock: the unhealthy one speaks for the pair — that is
        what fail-closed means on the input side. (AF-IO-004's feed.)"""
        rank = {Quality.GOOD: 0, Quality.STALE: 1, Quality.UNKNOWN: 2, Quality.FAULT: 3}
        out: dict[str, Reading] = {}
        for p in self.store.bound_points():
            if p.binds_to == "heartbeat":
                continue                # judged by heartbeat_alive(), not by value
            r = self.get(p.id, now)
            cur = out.get(p.binds_to)
            if cur is None or rank[r.quality] > rank[cur.quality]:
                out[p.binds_to] = r
        return out

    def heartbeat_alive(self, now_mono: Optional[float] = None) -> Optional[bool]:
        """True/False for PLC liveness judged on the counter CHANGING; None when no
        heartbeat point is declared (nothing claims liveness that isn't measured)."""
        hb_points = [p for p in self.store.bound_points() if p.binds_to == "heartbeat"]
        if not hb_points:
            return None
        now_mono = time.monotonic() if now_mono is None else now_mono
        window = self.scan_rate_s * self.HEARTBEAT_FACTOR
        for p in hb_points:
            last = self._hb_last.get(p.id)
            if last is None or (now_mono - last[1]) > window:
                return False
        return True

    def get_status(self) -> dict:
        snap = self.snapshot()
        by_quality: dict[str, int] = {}
        for r in snap.values():
            by_quality[r.quality.value] = by_quality.get(r.quality.value, 0) + 1
        return {
            "running": self._running,
            "scan_rate_s": self.scan_rate_s,
            "sources": sorted(self._tasks.keys()),
            "points": len(snap),
            "by_quality": by_quality,
            "cycles": self._cycles,
            "heartbeat_alive": self.heartbeat_alive(),
        }


# The ONE process-wide instance, wired in app_state next to protocol_bus.
field_io_manager = FieldIOManager()
