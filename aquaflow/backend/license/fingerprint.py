"""
backend/license/fingerprint.py
───────────────────────────────
Machine fingerprints for AquaFlow licensing. Needs no secret.

v2 (issued since 1.2.29): sha256("aquaflow-fp-v2|CPU id|board serial|host name").
    Stable: it does not change when a network adapter (Wi-Fi, USB dongle, VPN, Hyper-V)
    is plugged in, unplugged or re-ordered.

v1 (legacy, every license issued before 1.2.29): sha256("MAC|CPU id|board serial|host name"),
    where MAC was whatever adapter uuid.getnode() happened to return. A v1 license is
    accepted when it matches ANY adapter this machine has, so existing licenses keep working.
"""

import hashlib
import platform
import re
import subprocess
import time
import uuid

_MAC = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")
_CACHE_SECONDS = 300
_cache = {}


def _quiet():
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if platform.system() == "Windows" else {}


def _run(command, shell=False):
    try:
        return subprocess.check_output(command, shell=shell, encoding="utf-8", errors="replace",
                                       stderr=subprocess.DEVNULL, timeout=8, **_quiet())
    except Exception:
        return ""


def _windows_value(wmic_query, cim_class, cim_property):
    """Read one WMI value. wmic is deprecated on newer Windows, so fall back to PowerShell CIM."""
    lines = [l.strip() for l in _run(wmic_query, shell=True).splitlines() if l.strip()]
    if len(lines) >= 2:
        return lines[-1]
    value = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                  f"(Get-CimInstance {cim_class} | Select-Object -First 1).{cim_property}"]).strip()
    return value


def cpu_id() -> str:
    system = platform.system()
    try:
        if system == "Windows":
            value = _windows_value("wmic cpu get ProcessorId", "Win32_Processor", "ProcessorId")
            if value:
                return value
        elif system == "Linux":
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "Serial" in line or "Hardware" in line:
                        return line.split(":")[1].strip()
        elif system == "Darwin":
            for line in _run(["ioreg", "-l"]).splitlines():
                if "IOPlatformSerialNumber" in line:
                    return line.split('"')[-2]
    except Exception:
        pass
    return platform.processor() or "UNKNOWN_CPU"


def board_serial() -> str:
    system = platform.system()
    try:
        if system == "Windows":
            value = _windows_value("wmic baseboard get SerialNumber", "Win32_BaseBoard", "SerialNumber")
            if value:
                return value
            return "UNKNOWN"
        if system == "Linux":
            with open("/sys/class/dmi/id/board_serial") as f:
                return f.read().strip()
    except Exception:
        pass
    return "UNKNOWN_MB"


def getnode_mac() -> str:
    """The MAC that v1 used: uuid.getnode(), or zeros when it returned a random address."""
    try:
        node = uuid.getnode()
        if (node >> 40) % 2:
            return "00:00:00:00:00:00"
        return ":".join(f"{(node >> (8 * i)) & 0xff:02x}" for i in reversed(range(6)))
    except Exception:
        return "00:00:00:00:00:00"


def adapter_macs() -> set:
    """Every network adapter MAC this machine knows, including disabled and hidden adapters."""
    macs = {getnode_mac(), "00:00:00:00:00:00"}
    system = platform.system()
    if system == "Windows":
        for line in _run("getmac /fo csv /nh", shell=True).splitlines():
            candidate = line.split(",")[0].strip().strip('"').replace("-", ":").lower()
            if _MAC.match(candidate):
                macs.add(candidate)
        listing = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                        "Get-NetAdapter -IncludeHidden | ForEach-Object { $_.MacAddress }"])
        for line in listing.splitlines():
            candidate = line.strip().replace("-", ":").lower()
            if _MAC.match(candidate):
                macs.add(candidate)
    elif system == "Linux":
        import glob
        for path in glob.glob("/sys/class/net/*/address"):
            try:
                candidate = open(path).read().strip().lower()
                if _MAC.match(candidate):
                    macs.add(candidate)
            except OSError:
                pass
    return macs


def _identity():
    cached = _cache.get("identity")
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    identity = (cpu_id(), board_serial(), platform.node())
    _cache["identity"] = (time.monotonic(), identity)
    return identity


def legacy_fingerprint(mac: str) -> str:
    cpu, board, host = _identity()
    return hashlib.sha256(f"{mac}|{cpu}|{board}|{host}".encode()).hexdigest()


def stable_fingerprint() -> str:
    """The v2 machine ID shown on the Activation screen and used for new licenses."""
    cpu, board, host = _identity()
    return hashlib.sha256(f"aquaflow-fp-v2|{cpu}|{board}|{host}".encode()).hexdigest()


def machine_fingerprints() -> set:
    """Every fingerprint this machine legitimately answers to (v2 plus v1 per adapter)."""
    cached = _cache.get("all")
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return set(cached[1])
    result = {stable_fingerprint()} | {legacy_fingerprint(mac) for mac in adapter_macs()}
    _cache["all"] = (time.monotonic(), frozenset(result))
    return result


def clear_cache():
    _cache.clear()
