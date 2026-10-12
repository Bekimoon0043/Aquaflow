#!/usr/bin/env python3
"""
ican_capture.py — passive I-CAN / NETCAN wire recorder.

Run this on the site PC WHILE the original fountain software drives the fountain.
It records every UDP frame between that software and the gateway, decodes what we
already understand, and lets you label what you were doing at the time. Those labels
are the whole point: they are what turns "bit 3 of byte 5 was set" into "bit 3 of
byte 5 is the north jet".

THIS TOOL NEVER TRANSMITS.
It opens a receive-only raw socket and does nothing but listen. It cannot actuate a
relay, cannot interfere with the original software, and does not bind the control
port (2002), so the original software keeps working exactly as it does now.

WHAT IT NEEDS
    * Windows, run AS ADMINISTRATOR (raw capture is privileged).
    * Nothing installed — no Python, no Wireshark, no Npcap.

WHAT IT PRODUCES  (next to the exe, one folder per run)
    capture.jsonl   every frame + every label, machine-readable
    changes.txt     ONLY the moments the output changed (the useful one)
    states.txt      every distinct output state the show used
    capture.txt     the same thing, readable
    summary.txt     decoded channel activity, grouped

Send the whole folder back.
"""
from __future__ import annotations

import ctypes
import datetime as dt
import json
import os
import socket
import struct
import sys
import threading
import time
from pathlib import Path

# ── the bits of the codec we already trust (inlined so this is standalone) ────
FRAME_LEN = 13
CMD_OUTPUT = 0x08
CMD_CHANNEL = 0x03
CMD_STATUS_REPLY = 0x07
GATEWAY_PORT = 200
LOCAL_PORT = 2002

CMD_NAMES = {
    0x08: "OUTPUT/state",
    0x03: "channel-address",
    0x07: "status-reply",
}


def hexdump(data: bytes) -> str:
    return " ".join(f"{b:02X}" for b in bytes(data))


def channels_from_mask(mask: bytes) -> list[int]:
    """bit b of mask byte i  =>  channel i*8 + b + 1"""
    out = []
    for i, byte in enumerate(bytes(mask)):
        for b in range(8):
            if byte & (1 << b):
                out.append(i * 8 + b + 1)
    return out



def pause(msg: str = "\nPress Enter to close."):
    """Never let a closed stdin turn a SUCCESSFUL capture into a crash dialog. The
    files are already written by the time this is called; an EOF here is cosmetic."""
    try:
        input(msg)
    except (EOFError, KeyboardInterrupt):
        pass


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def local_ipv4s() -> list[str]:
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    # Also the address that would be used to reach the outside world.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(ips)


def choose_interface() -> str:
    ips = local_ipv4s()
    if not ips:
        print("No IPv4 interface found. Is the network cable plugged in?")
        sys.exit(2)

    # Prefer the cabinet subnet if it is present — that is almost always the one.
    preferred = [ip for ip in ips if ip.startswith("192.168.5.")]
    if len(preferred) == 1:
        print(f"Using interface {preferred[0]} (the 192.168.5.x cabinet network).")
        return preferred[0]

    print("\nWhich network is the fountain gateway on?\n")
    for i, ip in enumerate(ips, 1):
        hint = "   <-- looks like the cabinet network" if ip.startswith("192.168.5.") else ""
        print(f"  {i}. {ip}{hint}")
    print()
    while True:
        try:
            raw = input(f"Choose 1-{len(ips)} (or type an IP): ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  No selection - exiting.")
            sys.exit(2)
        if raw.isdigit() and 1 <= int(raw) <= len(ips):
            return ips[int(raw) - 1]
        if raw.count(".") == 3:
            return raw
        print("  Not a valid choice.")


class Capture:
    def __init__(self, bind_ip: str, outdir: Path, gw_port: int, local_port: int):
        self.bind_ip = bind_ip
        self.outdir = outdir
        self.gw_port = gw_port
        self.local_port = local_port
        self.records: list[dict] = []
        self.lock = threading.Lock()
        self.running = False
        self.frames = 0
        self.started = time.time()
        self._sock = None

    # ── raw capture ───────────────────────────────────────────────────────────
    def _open(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_IP)
        s.bind((self.bind_ip, 0))
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
        # Promiscuous-ish: receive all IP traffic on this interface.
        s.ioctl(socket.SIO_RCVALL, socket.RCVALL_ON)
        s.settimeout(1.0)
        self._sock = s
        return s

    def _close(self):
        try:
            if self._sock:
                self._sock.ioctl(socket.SIO_RCVALL, socket.RCVALL_OFF)
                self._sock.close()
        except Exception:
            pass

    def run(self):
        s = self._open()
        self.running = True
        while self.running:
            try:
                packet, _ = s.recvfrom(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            rec = self._parse(packet)
            if rec:
                with self.lock:
                    self.records.append(rec)
                    self.frames += 1
                self._print(rec)
        self._close()

    def _parse(self, packet: bytes):
        if len(packet) < 20:
            return None
        ihl = (packet[0] & 0x0F) * 4
        if packet[9] != 17:           # not UDP
            return None
        if len(packet) < ihl + 8:
            return None
        src = socket.inet_ntoa(packet[12:16])
        dst = socket.inet_ntoa(packet[16:20])
        sport, dport, length, _cks = struct.unpack("!HHHH", packet[ihl:ihl + 8])
        payload = packet[ihl + 8: ihl + max(8, length)]

        # Only the gateway conversation. Keep BOTH directions.
        if self.gw_port not in (sport, dport) and self.local_port not in (sport, dport):
            return None

        rec = {
            "t": dt.datetime.now().isoformat(timespec="milliseconds"),
            "mono": round(time.time() - self.started, 3),
            "kind": "frame",
            "src": f"{src}:{sport}",
            "dst": f"{dst}:{dport}",
            "dir": "PC->GW" if dport == self.gw_port else "GW->PC",
            "len": len(payload),
            "hex": hexdump(payload),
        }
        if len(payload) == FRAME_LEN:
            cmd = payload[0]
            rec["cmd"] = f"0x{cmd:02X}"
            rec["cmd_name"] = CMD_NAMES.get(cmd, "unknown")
            rec["flag"] = payload[1]
            rec["group"] = payload[4]
            if cmd == CMD_OUTPUT:
                rec["mask"] = hexdump(payload[5:10])
                rec["channels"] = channels_from_mask(payload[5:10])
            rec["trailer"] = hexdump(payload[10:13])
        return rec

    def _print(self, rec):
        if rec.get("cmd") == "0x08" and rec["dir"] == "PC->GW":
            ch = rec.get("channels") or []
            print(f"  [{rec['mono']:>7.2f}s] OUT  group {rec.get('group')}  "
                  f"channels {ch if ch else '(all off)'}")
        elif rec.get("cmd"):
            print(f"  [{rec['mono']:>7.2f}s] {rec['dir']}  {rec.get('cmd_name')}  {rec['hex']}")

    # ── labels ────────────────────────────────────────────────────────────────
    def note(self, text: str):
        rec = {
            "t": dt.datetime.now().isoformat(timespec="milliseconds"),
            "mono": round(time.time() - self.started, 3),
            "kind": "NOTE",
            "text": text,
        }
        with self.lock:
            self.records.append(rec)
        print(f"  [{rec['mono']:>7.2f}s] *** NOTE: {text}")

    # ── output ────────────────────────────────────────────────────────────────
    def save(self):
        self.outdir.mkdir(parents=True, exist_ok=True)
        with self.lock:
            records = list(self.records)

        with open(self.outdir / "capture.jsonl", "w", encoding="utf-8") as f:
            f.write(json.dumps({
                "kind": "session", "started": dt.datetime.fromtimestamp(self.started).isoformat(),
                "interface": self.bind_ip, "gateway_port": self.gw_port,
                "local_port": self.local_port, "tool": "ican_capture 1.0",
            }) + "\n")
            for r in records:
                f.write(json.dumps(r) + "\n")

        with open(self.outdir / "capture.txt", "w", encoding="utf-8") as f:
            f.write(f"I-CAN capture - interface {self.bind_ip} - "
                    f"{dt.datetime.fromtimestamp(self.started)}\n")
            f.write("=" * 78 + "\n")
            for r in records:
                if r["kind"] == "NOTE":
                    f.write(f"\n[{r['mono']:>8.2f}s] ***** {r['text']} *****\n\n")
                else:
                    ch = r.get("channels")
                    extra = f"  channels={ch}" if ch is not None else ""
                    f.write(f"[{r['mono']:>8.2f}s] {r['dir']:<7} {r['hex']}{extra}\n")

        self._changes(records)
        self._summary(records)

    def _changes(self, records):
        """
        The output sequence, as CHANGES only.

        A music-driven show streams frames continuously - often the same mask many
        times a second - so the raw log is mostly repetition. What actually carries
        the information is the moment the mask changes. This is the artifact to line
        up against a video or the music: every transition, with its timestamp, per
        device group.
        """
        lines = ["OUTPUT CHANGES  (one line per actual change, per group)",
                 "=" * 78,
                 "  time     group  channels now on",
                 "-" * 78]
        last: dict[int, tuple] = {}
        n = 0
        for r in records:
            if r["kind"] == "NOTE":
                lines.append(f"{r['mono']:>8.2f}s  *** {r['text']} ***")
                continue
            if r.get("cmd") != "0x08" or r["dir"] != "PC->GW":
                continue
            g = r.get("group")
            cur = tuple(r.get("channels") or ())
            if last.get(g) == cur:
                continue                     # unchanged - the repetition we skip
            last[g] = cur
            n += 1
            lines.append(f"{r['mono']:>8.2f}s  {str(g):>5}  {list(cur) if cur else '(all off)'}")
        lines.append("-" * 78)
        lines.append(f"{n} change(s). Repeated identical frames are omitted.")
        (self.outdir / "changes.txt").write_text("\n".join(lines), encoding="utf-8")

        # Every distinct mask the show ever used, per group - the output vocabulary.
        vocab: dict[int, set] = {}
        for r in records:
            if r.get("cmd") == "0x08" and r["dir"] == "PC->GW":
                vocab.setdefault(r.get("group"), set()).add(tuple(r.get("channels") or ()))
        v = ["DISTINCT OUTPUT STATES USED, PER GROUP", "=" * 78]
        for g in sorted(vocab, key=lambda x: (x is None, x)):
            v.append(f"\ngroup {g}:  {len(vocab[g])} distinct state(s)")
            for st in sorted(vocab[g]):
                v.append(f"    {list(st) if st else '(all off)'}")
        (self.outdir / "states.txt").write_text("\n".join(v), encoding="utf-8")

    def _summary(self, records):
        """Group frames by the note that was active when they arrived. This is the
        sheet I actually read: 'while the operator said X, these channels were set'."""
        lines = []
        current = "(before any note)"
        seen: dict[str, dict] = {}
        for r in records:
            if r["kind"] == "NOTE":
                current = r["text"]
                seen.setdefault(current, {"masks": set(), "groups": set(), "frames": 0})
                continue
            if r.get("cmd") != "0x08" or r["dir"] != "PC->GW":
                continue
            bucket = seen.setdefault(current, {"masks": set(), "groups": set(), "frames": 0})
            bucket["frames"] += 1
            bucket["groups"].add(r.get("group"))
            bucket["masks"].add(tuple(r.get("channels") or []))

        lines.append("WHAT THE FOUNTAIN WAS DOING  vs  WHAT WENT ON THE WIRE")
        lines.append("=" * 78)
        for note, b in seen.items():
            lines.append(f"\n### {note}")
            lines.append(f"    output frames : {b['frames']}")
            lines.append(f"    groups seen   : {sorted(x for x in b['groups'] if x is not None)}")
            lines.append("    channel sets  :")
            for m in sorted(b["masks"]):
                lines.append(f"        {list(m) if m else '(all off)'}")

        total = sum(1 for r in records if r.get("cmd"))
        lines.append("\n" + "=" * 78)
        lines.append(f"total decoded frames: {total}")
        lines.append(f"notes: {sum(1 for r in records if r['kind'] == 'NOTE')}")
        (self.outdir / "summary.txt").write_text("\n".join(lines), encoding="utf-8")


BANNER = r"""
===============================================================================
  AquaFlow - I-CAN wire capture            (LISTEN ONLY - never transmits)
===============================================================================
  Run the fountain with your NORMAL software. This just watches and records.
  Whenever you do something, type what it was and press Enter. For example:

      north jet on
      north jet off
      all jets on
      ring lights on
      program 1 started

  Those labels are what let us work out which bit drives which device.
  Type  stop  and press Enter when you are finished.
===============================================================================
"""


def main() -> int:
    print(BANNER)

    if os.name != "nt":
        print("This tool is for Windows.")
        return 2
    if not is_admin():
        print("!! NOT RUNNING AS ADMINISTRATOR - capture will fail.\n")
        print("   Close this, right-click the exe, and choose 'Run as administrator'.")
        input("\n   Press Enter to exit.")
        return 1

    bind_ip = choose_interface()
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    outdir = Path(sys.argv[0]).resolve().parent / f"ican_capture_{stamp}"

    cap = Capture(bind_ip, outdir, GATEWAY_PORT, LOCAL_PORT)
    try:
        t = threading.Thread(target=cap.run, daemon=True)
        t.start()
    except Exception as e:
        print(f"\nCould not start capture: {e}")
        pause("Press Enter to exit.")
        return 1

    time.sleep(0.6)
    print(f"\nRecording on {bind_ip}. Frames will appear below as they happen.")
    print("Start the fountain now.\n")

    try:
        while True:
            text = input()
            if text.strip().lower() in ("stop", "quit", "exit"):
                break
            if text.strip():
                cap.note(text.strip())
    except (KeyboardInterrupt, EOFError):
        pass

    cap.running = False
    time.sleep(1.2)
    cap.save()

    print("\n" + "=" * 70)
    print(f"Captured {cap.frames} frame(s).")
    if cap.frames == 0:
        print("\n!! NOTHING WAS CAPTURED. Most likely causes:")
        print("   - the wrong interface was chosen (re-run and pick the cabinet network)")
        print("   - the original fountain software was not running / not sending")
        print("   - this PC is not the one that talks to the gateway")
    else:
        print(f"\nSaved to:  {outdir}")
        print("   capture.jsonl | capture.txt | changes.txt | states.txt | summary.txt")
        print("\nZip that whole folder and send it back.")
    print("=" * 70)
    input("\nPress Enter to close.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
