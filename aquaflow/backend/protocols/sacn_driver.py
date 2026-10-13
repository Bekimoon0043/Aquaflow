"""
sacn_driver.py — AquaFlow Phase 6
Production sACN (ANSI E1.31) driver.
sACN is the ESTA standard for DMX-over-IP, preferred for large multicast networks.
Supports multicast (239.255.X.Y) and unicast, priority arbitration, and
framing per the E1.31 spec.
"""

import asyncio
import socket
import struct
import uuid
import time

from protocols.frame_pacing import paced_loop
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

log = logging.getLogger("aquaflow.sacn")

# ─── sACN / E1.31 constants ───────────────────────────────────────────────────
SACN_PORT = 5568
SACN_PREAMBLE_SIZE = 0x0010
SACN_POSTAMBLE_SIZE = 0x0000
SACN_PACKET_ID = b"ASC-E1.17\x00\x00\x00"  # 12 bytes
VECTOR_ROOT_E131_DATA = 0x00000004
VECTOR_E131_DATA_PACKET = 0x00000002
VECTOR_DMP_SET_PROPERTY = 0x02
START_CODE = 0x00   # DMX start code


def _sacn_multicast_ip(universe: int) -> str:
    """Return the multicast IP for a given universe (1-63999)."""
    assert 1 <= universe <= 63999
    hi = (universe >> 8) & 0xFF
    lo = universe & 0xFF
    return f"239.255.{hi}.{lo}"


def build_sacn_packet(
    universe: int,
    data: bytes,
    sequence: int,
    source_name: str = "AquaFlow Studio",
    priority: int = 100,
    cid: Optional[bytes] = None
) -> bytes:
    """Build a full sACN (E1.31) data packet."""
    if cid is None:
        cid = bytes(16)  # should be a real UUID per device
    assert 1 <= universe <= 63999
    assert 0 <= priority <= 200
    assert 1 <= len(data) <= 512

    # Pad data to 512
    dmx_data = data + b'\x00' * (512 - len(data))
    dmx_with_start = bytes([START_CODE]) + dmx_data  # 513 bytes

    # DMP layer
    dmp_address = struct.pack('>HHH', 0x0000, 0x0001, 0x0201)  # addr, incr, count
    dmp_length = 11 + len(dmx_with_start)
    dmp_flags = 0x70 | ((dmp_length >> 8) & 0x0F)
    dmp_layer = (
        bytes([dmp_flags, dmp_length & 0xFF]) +
        struct.pack('>I', VECTOR_DMP_SET_PROPERTY)[3:4] +  # 1 byte
        bytes([0xA1]) +          # address type + data type
        dmp_address +
        dmx_with_start
    )

    # Framing layer
    source_bytes = source_name.encode('utf-8')[:64].ljust(64, b'\x00')
    framing_data = (
        struct.pack('>I', VECTOR_E131_DATA_PACKET) +
        cid +
        source_bytes +
        bytes([priority]) +
        struct.pack('>H', 0) +        # synchronisation address
        bytes([sequence & 0xFF]) +
        bytes([0x00]) +               # options
        struct.pack('>H', universe) +
        dmp_layer
    )
    framing_length = 2 + len(framing_data)
    framing_flags = 0x70 | ((framing_length >> 8) & 0x0F)
    framing_layer = bytes([framing_flags, framing_length & 0xFF]) + framing_data

    # Root layer
    root_data = (
        struct.pack('>I', VECTOR_ROOT_E131_DATA) +
        cid +
        framing_layer
    )
    root_length = 22 + len(root_data)
    root_flags = 0x70 | ((root_length >> 8) & 0x0F)
    root_layer = bytes([root_flags, root_length & 0xFF]) + root_data

    # Preamble
    preamble = (
        struct.pack('>H', SACN_PREAMBLE_SIZE) +
        struct.pack('>H', SACN_POSTAMBLE_SIZE) +
        SACN_PACKET_ID
    )
    return preamble + root_layer


def parse_sacn_packet(packet: bytes) -> dict:
    """
    Decode an sACN (E1.31) data packet — the inverse of ``build_sacn_packet``.

    Parsed from the tail of the frame (the DMP layer is always last), which is
    robust to the layered length fields. Returns universe, priority, sequence, the
    DMX start code, and the 512 DMX ``data`` bytes. Raises ValueError if the packet
    is not a well-formed E1.31 frame.
    """
    # preamble(4) + packet id(12) + root/framing/dmp layers. Minimum full frame is
    # 638 bytes of layers on top of the 16-byte preamble+id = 654.
    if len(packet) < 638:
        raise ValueError(f"sACN packet too short: {len(packet)} bytes")
    if packet[4:16] != SACN_PACKET_ID:
        raise ValueError("not an sACN packet (bad ACN packet identifier)")
    # Slice from the end: dmp_layer is the final 523 bytes; its last 513 bytes are
    # the DMX start code + 512 channels. The framing fields sit just before it.
    data = bytes(packet[-512:])
    start_code = packet[-513]
    universe = struct.unpack('>H', packet[-525:-523])[0]
    sequence = packet[-527]
    priority = packet[-530]
    return {
        "universe":   universe,
        "priority":   priority,
        "sequence":   sequence,
        "start_code": start_code,
        "data":       data,
    }


@dataclass
class SACNUniverseState:
    universe: int
    data: bytearray = field(default_factory=lambda: bytearray(512))
    sequence: int = 0
    last_sent: float = 0.0
    dirty: bool = False
    unicast_targets: List[str] = field(default_factory=list)
    use_multicast: bool = True
    priority: int = 100


class SACNDriver:
    """
    Production sACN (E1.31) driver.
    Supports both multicast and unicast output.
    Runs at 44 Hz matching Art-Net for consistent timing.
    """
    MAX_HZ = 44
    SOURCE_NAME = "AquaFlow Studio"

    def __init__(self):
        self._universes: Dict[int, SACNUniverseState] = {}
        self._cid = uuid.uuid4().bytes   # unique component identifier
        self._sock: Optional[socket.socket] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._sent_count = 0
        self._error_count = 0
        log.info(f"SACNDriver created — CID: {uuid.UUID(bytes=self._cid)}")

    def configure_universe(
        self,
        universe: int,
        use_multicast: bool = True,
        unicast_targets: Optional[List[str]] = None,
        priority: int = 100
    ):
        if universe not in self._universes:
            self._universes[universe] = SACNUniverseState(universe=universe)
        u = self._universes[universe]
        u.use_multicast = use_multicast
        u.unicast_targets = unicast_targets or []
        u.priority = priority
        mode = "multicast" if use_multicast else f"unicast → {unicast_targets}"
        log.info(f"sACN universe {universe} configured — {mode} priority={priority}")

    def set_channel(self, universe: int, channel: int, value: int):
        assert 0 <= channel < 512
        assert 0 <= value <= 255
        if universe not in self._universes:
            self._universes[universe] = SACNUniverseState(universe=universe)
        self._universes[universe].data[channel] = value
        self._universes[universe].dirty = True

    def set_universe(self, universe: int, data: bytes):
        if universe not in self._universes:
            self._universes[universe] = SACNUniverseState(universe=universe)
        u = self._universes[universe]
        length = min(len(data), 512)
        u.data[:length] = data[:length]
        u.dirty = True

    def blackout(self, universe: Optional[int] = None):
        targets = [universe] if universe is not None else list(self._universes.keys())
        for u in targets:
            if u in self._universes:
                self._universes[u].data = bytearray(512)
                self._universes[u].dirty = True
        log.warning(f"sACN BLACKOUT — universes: {targets}")

    async def start(self):
        self._open_socket()
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info("SACNDriver send loop started")

    async def stop(self):
        self.blackout()
        await asyncio.sleep(0.05)
        self._running = False
        if self._task:
            self._task.cancel()
            try: await self._task
            except asyncio.CancelledError: pass
        if self._sock:
            self._sock.close()
            self._sock = None

    def _open_socket(self):
        try:
            if self._sock:
                self._sock.close()
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            # Enable multicast
            self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            self._sock.setblocking(False)
            log.info("sACN UDP socket opened")
        except Exception as e:
            log.error(f"sACN socket open failed: {e}")
            self._sock = None

    async def _loop(self):
        # AF-NEXT-001: pace on perf_counter so the 44 Hz ceiling holds on Windows,
        # where asyncio.sleep wakes up to one 15.6 ms clock tick early.
        await paced_loop(lambda: self._running, self._send_tick, self.MAX_HZ)

    async def _send_tick(self):
        if not self._sock:
            self._open_socket()
            return
        now = time.time()
        loop = asyncio.get_event_loop()
        for u in self._universes.values():
            if not u.dirty and (now - u.last_sent) < 1.0:
                continue
            u.sequence = (u.sequence + 1) & 0xFF
            packet = build_sacn_packet(
                universe=u.universe,
                data=bytes(u.data),
                sequence=u.sequence,
                source_name=self.SOURCE_NAME,
                priority=u.priority,
                cid=self._cid,
            )
            sent = False
            # Multicast
            if u.use_multicast:
                mc_ip = _sacn_multicast_ip(u.universe)
                try:
                    await loop.run_in_executor(None, self._sock.sendto, packet, (mc_ip, SACN_PORT))
                    sent = True
                    self._sent_count += 1
                except Exception as e:
                    self._error_count += 1
                    if self._error_count % 100 == 1:
                        log.warning(f"sACN multicast send error u{u.universe}: {e}")
            # Unicast targets
            for host in u.unicast_targets:
                try:
                    await loop.run_in_executor(None, self._sock.sendto, packet, (host, SACN_PORT))
                    sent = True
                    self._sent_count += 1
                except Exception as e:
                    self._error_count += 1
            if sent:
                u.dirty = False
                u.last_sent = now

    def get_status(self) -> dict:
        return {
            "universes": list(self._universes.keys()),
            "sent_count": self._sent_count,
            "error_count": self._error_count,
            "running": self._running,
            "socket_ok": self._sock is not None,
            "cid": str(uuid.UUID(bytes=self._cid)),
        }
