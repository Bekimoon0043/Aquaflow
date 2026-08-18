"""
AquaFlow Network Scanner
Discovers fountain hardware on the local network:
- Art-Net nodes (UDP broadcast)
- Modbus TCP devices (TCP port scan)
- sACN devices (multicast)
- MQTT brokers
- Generic IP devices via ping
"""
import asyncio
import socket
import struct
import ipaddress
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class DiscoveredDevice:
    ip: str
    protocol: str
    port: int
    label: str = ""
    device_type: str = "unknown"
    manufacturer: str = ""
    model: str = ""
    firmware: str = ""
    universe: int = 0
    channels: int = 0
    mac: str = ""
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "ip": self.ip,
            "protocol": self.protocol,
            "port": self.port,
            "label": self.label or f"{self.protocol.upper()} @ {self.ip}",
            "device_type": self.device_type,
            "manufacturer": self.manufacturer,
            "model": self.model,
            "firmware": self.firmware,
            "universe": self.universe,
            "channels": self.channels,
            "mac": self.mac,
            "extra": self.extra,
        }


class NetworkScanner:
    """
    Scans the local network for fountain control hardware.
    Uses protocol-specific discovery where available,
    falls back to TCP port scanning.
    """

    ARTNET_PORT  = 6454
    SACN_PORT    = 5568
    MODBUS_PORT  = 502
    MQTT_PORT    = 1883
    SCAN_TIMEOUT = 1.5  # seconds per host

    # Common fountain controller ports
    KNOWN_PORTS = {
        502:  ("modbus",  "pump"),
        6454: ("artnet",  "lighting"),
        5568: ("sacn",    "lighting"),
        1883: ("mqtt",    "sensor"),
        4840: ("opcua",   "plc"),
        47808:("bacnet",  "building"),
        20000:("dnp3",    "industrial"),
    }

    # Generic IP devices (the module docstring has always promised these).
    # Surfaces routers, printers, etc. as plain "network" devices so an
    # operator can see that discovery is reaching the network at all, even
    # before any fountain hardware is attached. Kept separate from
    # KNOWN_PORTS so a web port never masquerades as fountain gear.
    GENERIC_PORTS = {
        80:   ("http",  "network"),
        443:  ("https", "network"),
    }

    def __init__(self):
        self._scanning = False
        self._progress = 0.0
        self._results: list[DiscoveredDevice] = []

    @property
    def is_scanning(self) -> bool:
        return self._scanning

    @property
    def progress(self) -> float:
        return self._progress

    @staticmethod
    def _local_ipv4_addresses() -> list[str]:
        """Every non-loopback IPv4 address on this host, across all interfaces."""
        ips: set[str] = set()
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if not ip.startswith("127."):
                    ips.add(ip)
        except OSError:
            pass
        # Default-route address as a fallback when hostname resolution is empty.
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(("8.8.8.8", 80))  # no traffic sent — just selects a route
            ips.add(probe.getsockname()[0])
            probe.close()
        except OSError:
            pass
        return sorted(ips)

    def _subnets_to_scan(self, requested: Optional[str]) -> list[str]:
        """The requested subnet (if any) plus the /24 around every local address,
        so a scan always covers every network this host is actually connected to —
        not just the one the caller guessed."""
        subnets: list[str] = []
        if requested:
            subnets.append(requested)
        for ip in self._local_ipv4_addresses():
            auto = ip.rsplit(".", 1)[0] + ".0/24"
            if auto not in subnets:
                subnets.append(auto)
        return subnets

    async def scan_network(
        self,
        subnet: str = "192.168.1.0/24",
        progress_callback=None,
    ) -> list[DiscoveredDevice]:
        """Full network scan — Art-Net broadcast + TCP port scan"""
        self._scanning = True
        self._progress = 0.0
        self._results = []

        try:
            # Phase 1: Art-Net discovery (fast broadcast)
            logger.info("Phase 1: Art-Net discovery broadcast...")
            artnet_devices = await self._discover_artnet()
            self._results.extend(artnet_devices)
            self._progress = 0.15
            if progress_callback: await progress_callback(0.15, f"Found {len(artnet_devices)} Art-Net devices")

            # Phase 2: TCP port scan — requested subnet PLUS every local subnet
            subnets = self._subnets_to_scan(subnet)
            logger.info(f"Phase 2: TCP scan of {', '.join(subnets)}...")
            hosts: list[str] = []
            host_seen: set[str] = set()
            for sn in subnets:
                try:
                    network = ipaddress.IPv4Network(sn, strict=False)
                except ValueError:
                    continue  # a malformed subnet must not kill the whole scan
                for h in network.hosts():
                    ip = str(h)
                    if ip not in host_seen:
                        host_seen.add(ip)
                        hosts.append(ip)
            total = len(hosts)

            # Skip already found IPs
            found_ips = {d.ip for d in self._results}

            tasks = []
            for host in hosts:
                ip = str(host)
                if ip not in found_ips:
                    tasks.append(self._scan_host(ip))

            # Run in batches of 50 concurrent
            batch_size = 50
            for i in range(0, len(tasks), batch_size):
                batch = tasks[i:i + batch_size]
                results = await asyncio.gather(*batch, return_exceptions=True)
                for r in results:
                    if isinstance(r, list):
                        self._results.extend(r)
                progress = 0.15 + (i / max(len(tasks), 1)) * 0.85
                self._progress = min(0.99, progress)
                if progress_callback:
                    await progress_callback(self._progress, f"Scanned {i + batch_size}/{total} hosts...")

            self._progress = 1.0
            if progress_callback:
                await progress_callback(1.0, f"Scan complete — {len(self._results)} devices found")

            logger.info(f"Scan complete: {len(self._results)} devices found")
            return self._results

        finally:
            self._scanning = False

    async def _discover_artnet(self) -> list[DiscoveredDevice]:
        """Art-Net ArtPoll broadcast discovery, on every connected network.

        Two hard-won rules (verified against a live responder, Aug 2026):
        1. The socket MUST be bound to udp/6454. Art-Net nodes send ArtPollReply
           to port 6454, not back to the poll's source port — an unbound socket
           polls from an ephemeral port and every spec-compliant reply is
           delivered somewhere we are not listening.
        2. Never call setblocking(False) after settimeout() — it zeroes the
           timeout, so the first recvfrom raises BlockingIOError immediately and
           the listen loop dies before any node can answer.
        """
        devices: list[DiscoveredDevice] = []
        seen: set[str] = set()
        try:
            loop = asyncio.get_event_loop()

            # Art-Net ArtPoll packet
            artpoll = (
                b"Art-Net\x00"  # Header
                b"\x00\x20"     # OpPoll
                b"\x00\x0e"     # Protocol version 14
                b"\x02"         # TalkToMe
                b"\x00"         # Priority
            )

            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.bind(("", self.ARTNET_PORT))  # rule 1: own the reply port
            sock.settimeout(0.3)               # rule 2: timeout only, stay blocking

            # Poll the global broadcast plus the directed broadcast of every
            # local subnet, so discovery leaves through every interface — not
            # just the default route.
            targets = {("255.255.255.255", self.ARTNET_PORT)}
            for ip in self._local_ipv4_addresses():
                targets.add((ip.rsplit(".", 1)[0] + ".255", self.ARTNET_PORT))
            for target in targets:
                try:
                    await loop.run_in_executor(None, sock.sendto, artpoll, target)
                except OSError:
                    continue  # that interface can't broadcast — not fatal

            # Listen for ArtPollReply packets until the deadline.
            deadline = loop.time() + 2.5
            while loop.time() < deadline:
                try:
                    data, addr = await loop.run_in_executor(None, sock.recvfrom, 1024)
                except socket.timeout:
                    continue  # nothing yet — keep listening until the deadline
                except OSError:
                    break     # socket genuinely dead
                if addr[0] in seen:
                    continue
                if data[:8] == b"Art-Net\x00" and len(data) > 10:
                    opcode = struct.unpack("<H", data[8:10])[0]
                    if opcode != 0x2100:  # only ArtPollReply (not our own polls)
                        continue
                    device = self._parse_artpoll_reply(data, addr[0])
                    if device:
                        seen.add(addr[0])
                        devices.append(device)

            sock.close()
        except Exception as e:
            logger.debug(f"Art-Net discovery error: {e}")

        return devices

    def _parse_artpoll_reply(self, data: bytes, ip: str) -> Optional[DiscoveredDevice]:
        """Parse ArtPollReply packet"""
        try:
            if len(data) < 197:
                return None
            # Extract fields from ArtPollReply structure
            short_name = data[26:44].decode("ascii", errors="ignore").strip("\x00")
            long_name  = data[44:108].decode("ascii", errors="ignore").strip("\x00")
            universe   = struct.unpack("<H", data[190:192])[0] if len(data) >= 192 else 0
            return DiscoveredDevice(
                ip=ip, protocol="artnet", port=self.ARTNET_PORT,
                label=long_name or short_name or f"Art-Net {ip}",
                device_type="lighting", universe=universe, channels=512,
            )
        except Exception:
            return None

    async def _scan_host(self, ip: str) -> list[DiscoveredDevice]:
        """Scan a single host: fountain control ports first, then generic ports."""
        devices = []
        generic = []
        for ports, bucket in ((self.KNOWN_PORTS, devices), (self.GENERIC_PORTS, generic)):
            for port, (protocol, device_type) in ports.items():
                try:
                    conn = asyncio.open_connection(ip, port)
                    reader, writer = await asyncio.wait_for(conn, timeout=self.SCAN_TIMEOUT)
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass

                    # Port is open — identify device
                    device = await self._identify_device(ip, port, protocol, device_type)
                    bucket.append(device)
                    logger.debug(f"Found {protocol} device at {ip}:{port}")

                except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
                    pass
                except Exception as e:
                    logger.debug(f"Scan error {ip}:{port}: {e}")

        # A real fountain device that also serves a web UI should appear once,
        # as fountain gear — only hosts with NO fountain protocol are reported
        # as generic network devices (one entry per host is enough).
        if not devices and generic:
            devices.append(generic[0])
        return devices

    async def _identify_device(self, ip: str, port: int, protocol: str, device_type: str) -> DiscoveredDevice:
        """Try to identify device details via protocol handshake"""
        label = f"{protocol.upper()} Device"
        if device_type == "network":
            label = f"Network device (web interface) @ {ip}"
        manufacturer = ""
        model = ""

        if protocol == "modbus":
            # Try Modbus device identification (FC 43)
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(ip, port), timeout=1.0
                )
                # Read Device Identification request
                mbap = struct.pack(">HHHB", 1, 0, 5, 1)
                pdu  = bytes([0x2B, 0x0E, 0x01, 0x00])
                writer.write(mbap + pdu)
                await writer.drain()
                response = await asyncio.wait_for(reader.read(256), timeout=1.0)
                writer.close()
                if len(response) > 8:
                    label = f"Modbus Device @ {ip}"
                    device_type = "pump"
            except Exception:
                pass

        return DiscoveredDevice(
            ip=ip, protocol=protocol, port=port,
            label=label, device_type=device_type,
            manufacturer=manufacturer, model=model,
        )

    async def quick_scan(self, subnet: str = "192.168.1.0/24") -> list[DiscoveredDevice]:
        """Fast scan — Art-Net broadcast + common IPs on every connected subnet"""
        self._scanning = True
        self._results = []
        try:
            # Art-Net broadcast (already polls out of every interface)
            artnet = await self._discover_artnet()
            self._results.extend(artnet)

            # Scan only .1-.50 of each subnet for speed — the requested one plus
            # the /24 around every local address, deduplicated.
            quick_ips: list[str] = []
            ip_seen: set[str] = set()
            for sn in self._subnets_to_scan(subnet):
                try:
                    network = ipaddress.IPv4Network(sn, strict=False)
                except ValueError:
                    continue
                base = str(network.network_address).rsplit(".", 1)[0]
                for i in range(1, 51):
                    ip = f"{base}.{i}"
                    if ip not in ip_seen:
                        ip_seen.add(ip)
                        quick_ips.append(ip)

            tasks = [self._scan_host(ip) for ip in quick_ips]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, list):
                    self._results.extend(r)

            return self._results
        finally:
            self._scanning = False


# ── DMX / Art-Net Output Manager ──────────────────────────────────────────────

class HardwareOutputManager:
    """
    Manages real-time hardware output.
    Translates show engine commands into protocol-specific packets.
    """

    def __init__(self):
        self._artnet_sock: Optional[socket.socket] = None
        self._modbus_connections: dict = {}
        self._universe_data: dict[int, bytearray] = {i: bytearray(512) for i in range(16)}
        self._output_enabled = False

    async def start(self):
        try:
            self._artnet_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._artnet_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            self._artnet_sock.setblocking(False)
            self._output_enabled = True
            logger.info("Hardware output manager started")
        except Exception as e:
            logger.warning(f"Hardware output init failed: {e}")

    async def stop(self):
        self._output_enabled = False
        await self.blackout_all()
        if self._artnet_sock:
            self._artnet_sock.close()

    async def set_dmx_channel(self, universe: int, channel: int, value: int):
        """Set a single DMX channel value"""
        if 0 <= universe < 16 and 0 <= channel < 512:
            self._universe_data[universe][channel] = max(0, min(255, value))

    async def set_dmx_range(self, universe: int, start_ch: int, values: list[int]):
        """Set a range of DMX channels"""
        buf = self._universe_data[universe]
        for i, val in enumerate(values):
            ch = start_ch + i
            if 0 <= ch < 512:
                buf[ch] = max(0, min(255, int(val)))

    async def flush_artnet(self, target_ip: str = "255.255.255.255"):
        """Send the full Art-Net state, including zeroed universes for blackout safety."""
        if not self._output_enabled or not self._artnet_sock:
            return
        loop = asyncio.get_event_loop()
        for universe, data in self._universe_data.items():
            packet = self._build_artnet_packet(universe, data)
            try:
                await loop.run_in_executor(
                    None,
                    lambda p=packet: self._artnet_sock.sendto(p, (target_ip, 6454))
                )
            except Exception as e:
                logger.debug(f"Art-Net send error: {e}")

    def _build_artnet_packet(self, universe: int, data: bytearray) -> bytes:
        return (
            b"Art-Net\x00"
            b"\x00\x50"
            b"\x00\x0e"
            b"\x00\x00"
            + struct.pack("<H", universe)
            + struct.pack(">H", 512)
            + bytes(data)
        )

    async def set_modbus_register(self, ip: str, port: int, register: int, value: int):
        """Write a Modbus holding register"""
        key = f"{ip}:{port}"
        try:
            if key not in self._modbus_connections:
                r, w = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=2.0)
                self._modbus_connections[key] = (r, w)
            _, writer = self._modbus_connections[key]
            mbap = struct.pack(">HHHB", 1, 0, 6, 1)
            pdu  = struct.pack(">BHH", 0x06, register, max(0, min(65535, value)))
            writer.write(mbap + pdu)
            await writer.drain()
        except Exception as e:
            logger.debug(f"Modbus write error {key}: {e}")
            self._modbus_connections.pop(key, None)

    async def blackout_all(self):
        """Zero all DMX universes"""
        for universe in self._universe_data:
            self._universe_data[universe] = bytearray(512)
        if self._artnet_sock:
            await self.flush_artnet()

    def get_universe_snapshot(self, universe: int) -> list[int]:
        """Get current DMX values for a universe (for UI display)"""
        return list(self._universe_data.get(universe, bytearray(512)))


# Singletons
scanner = NetworkScanner()
hardware_output = HardwareOutputManager()
