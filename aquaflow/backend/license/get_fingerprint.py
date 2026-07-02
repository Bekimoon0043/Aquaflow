"""
backend/license/get_fingerprint.py
────────────────────────────────────
Run this on the CLIENT'S machine to get their hardware fingerprint.
Send the printed value back to LuxuryCon to generate a license.

IMPORTANT: This script does NOT require AQUAFLOW_LICENSE_SECRET.
           It only reads hardware identifiers — no signing involved.

Usage:
  cd backend
  python -m license.get_fingerprint
"""

import hashlib
import platform
import subprocess
import sys
import uuid
from pathlib import Path


def _get_mac_address() -> str:
    try:
        mac = uuid.getnode()
        if (mac >> 40) % 2:
            return "00:00:00:00:00:00"
        return ":".join(f"{(mac >> (8*i)) & 0xff:02x}" for i in reversed(range(6)))
    except Exception:
        return "00:00:00:00:00:00"


def _get_cpu_id() -> str:
    try:
        if platform.system() == "Windows":
            result = subprocess.check_output(
                "wmic cpu get ProcessorId", shell=True,
                encoding="utf-8", stderr=subprocess.DEVNULL,
            )
            lines = [l.strip() for l in result.strip().splitlines() if l.strip()]
            return lines[-1] if lines else "UNKNOWN"
        elif platform.system() == "Linux":
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "Serial" in line or "Hardware" in line:
                        return line.split(":")[1].strip()
        elif platform.system() == "Darwin":
            result = subprocess.check_output(
                ["ioreg", "-l"], encoding="utf-8", stderr=subprocess.DEVNULL,
            )
            for line in result.splitlines():
                if "IOPlatformSerialNumber" in line:
                    return line.split('"')[-2]
    except Exception:
        pass
    return platform.processor() or "UNKNOWN_CPU"


def _get_motherboard_id() -> str:
    try:
        if platform.system() == "Windows":
            result = subprocess.check_output(
                "wmic baseboard get SerialNumber", shell=True,
                encoding="utf-8", stderr=subprocess.DEVNULL,
            )
            lines = [l.strip() for l in result.strip().splitlines() if l.strip()]
            return lines[-1] if lines else "UNKNOWN"
        elif platform.system() == "Linux":
            result = subprocess.check_output(
                ["cat", "/sys/class/dmi/id/board_serial"],
                encoding="utf-8", stderr=subprocess.DEVNULL,
            )
            return result.strip()
    except Exception:
        pass
    return "UNKNOWN_MB"


def get_fingerprint() -> str:
    """
    Generate hardware fingerprint from MAC + CPU + motherboard.
    Does NOT require any environment variables or secrets.
    """
    mac = _get_mac_address()
    cpu = _get_cpu_id()
    mb  = _get_motherboard_id()
    raw = f"{mac}|{cpu}|{mb}|{platform.node()}"
    return hashlib.sha256(raw.encode()).hexdigest()


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  AQUAFLOW STUDIO — MACHINE FINGERPRINT")
    print("=" * 60)

    fp = get_fingerprint()

    print(f"\n  AQUAFLOW_MACHINE_FINGERPRINT={fp}\n")
    print("  Send this value to LuxuryCon Fountain Systems.")
    print("  They will use it to generate your license file.")
    print("\n  Do NOT share this with anyone other than LuxuryCon.")
    print("=" * 60 + "\n")

    input("  Press Enter to exit...")
