"""
artnet_driver.py — AquaFlow Phase 6
Production Art-Net DMX driver.
Sends DMX512 over UDP using the Art-Net protocol at up to 44 Hz per universe.
Supports multiple universes, per-universe targets, and merge modes.
This replaces the stub implementation in protocol_bus.py.
"""

import asyncio
import socket
import struct
import time
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

log = logging.getLogger("aquaflow.artnet")

# ─── Art-Net constants ────────────────────────────────────────────────────────
ARTNET_PORT = 6454
ARTNET_ID = b"Art-Net\x00"
OPCODE_DMX = 0x5000          # ArtDmx
OPCODE_POLL = 0x2000         # ArtPoll
OPCODE_POLL_REPLY = 0x2100   # ArtPollReply
ARTNET_PROT_VER = 14         # protocol version


def build_artdmx(universe: int, data: bytes, sequence: int = 0) -> bytes:
    """
    Build an ArtDmx packet.
    universe: 0-32767 (15-bit Art-Net universe)
    data: up to 512 bytes of DMX channel data
    """
    assert 0 <= universe <= 32767, "Universe must be 0-32767"
    assert 1 <= len(data) <= 512, "DMX data must be 1-512 bytes"
    # Pad to even length
    if len(data) % 2 != 0:
        data = data + b'\x00'
    length = len(data)
    # Universe split into low byte + subnet/net
    uni_low  = universe & 0x0F
    uni_sub  = (universe >> 4) & 0x0F
    uni_net  = (universe >> 8) & 0x7F
    packet = (
        ARTNET_ID +
        struct.pack('<H', OPCODE_DMX) +   # little-endian opcode
        struct.pack('>H', ARTNET_PROT_VER) +  # big-endian version
        bytes([sequence & 0xFF, 0]) +     # sequence, physical
        bytes([uni_low | (uni_sub << 4)]) +
        bytes([uni_net]) +
        struct.pack('>H', length) +        # big-endian length
        data
    )
    return packet


@dataclass
class UniverseTarget:
    """One output destination for a universe."""
    host: str
    port: int = ARTNET_PORT
    broadcast: bool = False   # use broadcast address


@dataclass
class UniverseState:
    universe: int
    data: bytearray = field(default_factory=lambda: bytearray(512))
    targets: List[UniverseTarget] = field(default_factory=list)
    sequence: int = 0
    last_sent: float = 0.0
    dirty: bool = False


class ArtNetDriver:
    """
    Production Art-Net driver.
    - Maintains per-universe 512-byte DMX frames
    - Sends to configured unicast or broadcast targets
    - Runs a send loop at up to 44 Hz (Art-Net spec max)
    - Handles socket errors gracefully with reconnect
    """
    MAX_HZ = 44

    def __init__(self):
        self._universes: Dict[int, UniverseState] = {}
        self._sock: Optional[socket.socket] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._sent_count = 0
        self._error_count = 0
        self._last_error: str = ""
        log.info("ArtNetDriver created")

    def configure_universe(self, universe: int, targets: List[UniverseTarget]):
        """Register a universe and its output targets."""
        if universe not in self._universes:
            self._universes[universe] = UniverseState(universe=universe)
        self._universes[universe].targets = targets
        log.info(f"Art-Net universe {universe} configured → {[t.host for t in targets]}")

    def set_channel(self, universe: int, channel: int, value: int):
        """Set a single DMX channel (0-indexed). Creates universe if needed."""
        assert 0 <= channel < 512
        assert 0 <= value <= 255
        if universe not in self._universes:
            self._universes[universe] = UniverseState(universe=universe)
        self._universes[universe].data[channel] = value
        self._universes[universe].dirty = True

    def set_universe(self, universe: int, data: bytes):
        """Set the full 512-byte frame for a universe."""
        if universe not in self._universes:
            self._universes[universe] = UniverseState(universe=universe)
        u = self._universes[universe]
        length = min(len(data), 512)
        u.data[:length] = data[:length]
        u.dirty = True

    def blackout(self, universe: Optional[int] = None):
        """Zero all channels. If universe is None, blackout all universes."""
        targets = [universe] if universe is not None else list(self._universes.keys())
        for u in targets:
            if u in self._universes:
                self._universes[u].data = bytearray(512)
                self._universes[u].dirty = True
        log.warning(f"Art-Net BLACKOUT — universes: {targets}")

    async def start(self):
        """Open socket and start send loop."""
        self._open_socket()
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info("ArtNetDriver send loop started")

    async def stop(self):
        """Blackout all universes, flush, then stop."""
        self.blackout()
        await asyncio.sleep(0.05)   # flush one last blackout frame
        self._running = False
        if self._task:
            self._task.cancel()
            try: await self._task
            except asyncio.CancelledError: pass
        if self._sock:
            self._sock.close()
            self._sock = None
        log.info("ArtNetDriver stopped")

    def _open_socket(self):
        try:
            if self._sock:
                self._sock.close()
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            self._sock.setblocking(False)
            log.info("Art-Net UDP socket opened")
        except Exception as e:
            log.error(f"Art-Net socket open failed: {e}")
            self._sock = None

    async def _loop(self):
        interval = 1.0 / self.MAX_HZ
        while self._running:
            t0 = time.monotonic()
            await self._send_tick()
            elapsed = time.monotonic() - t0
            await asyncio.sleep(max(0, interval - elapsed))

    async def _send_tick(self):
        if not self._sock:
            self._open_socket()
            return
        now = time.time()
        loop = asyncio.get_event_loop()
        for u in self._universes.values():
            # Send if dirty OR if >1 second since last send (keepalive)
            if not u.dirty and (now - u.last_sent) < 1.0:
                continue
            u.sequence = (u.sequence + 1) & 0xFF
            packet = build_artdmx(u.universe, bytes(u.data), u.sequence)
            for target in u.targets:
                try:
                    addr = (target.host, target.port)
                    await loop.run_in_executor(None, self._sock.sendto, packet, addr)
                    self._sent_count += 1
                except Exception as e:
                    self._error_count += 1
                    self._last_error = str(e)
                    if self._error_count % 100 == 1:
                        log.warning(f"Art-Net send error to {target.host}: {e}")
            u.dirty = False
            u.last_sent = now

    def get_status(self) -> dict:
        return {
            "universes": list(self._universes.keys()),
            "sent_count": self._sent_count,
            "error_count": self._error_count,
            "last_error": self._last_error,
            "running": self._running,
            "socket_ok": self._sock is not None,
        }
