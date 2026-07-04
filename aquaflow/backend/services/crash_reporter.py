"""
crash_reporter.py — AquaFlow Stage 4, AQ-S4-002

Crash reporting system: automatic log upload, crash fingerprinting, and support-report
generation.

When the app (backend or UI) hits an unhandled error it builds a structured crash
report, groups it by a deterministic fingerprint (so the same bug is recognised across
machines and minor code drift), spools it, and uploads it — with an offline outbox +
retry so nothing is lost when the network is down. A human-readable support report can
be generated for any crash to hand to the support team.

  * automatic logs uploaded — `CrashReporter.report()` captures recent logs + the
    crash and uploads via a pluggable transport; failed uploads stay in the outbox and
    `flush()` retries them,
  * crash fingerprints generated — `crash_fingerprint()` hashes the exception type +
    the normalised traceback frames (paths → basenames, line numbers/addresses
    stripped) so identical crashes share one id,
  * support reports generated — `generate_support_report()` produces a readable report
    (system info, app version, fingerprint, traceback, recent logs).

Pure and filesystem-scoped (all state under a root dir) so it is fully unit-tested.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import sys
import traceback as _tb
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

APP_VERSION = "0.1.0"


# ── Fingerprinting ──────────────────────────────────────────────────────────────

_FRAME_RE = re.compile(r'File "([^"]+)", line \d+, in (\S+)')


def _normalise_traceback(tb_text: str) -> str:
    """
    Reduce a traceback to a stable signature: one `basename:function` line per frame,
    dropping line numbers, absolute paths and memory addresses so the same bug hashes
    the same across machines and minor code movement.
    """
    frames = [f"{os.path.basename(p)}:{fn}" for p, fn in _FRAME_RE.findall(tb_text or "")]
    if frames:
        return "\n".join(frames)
    s = re.sub(r"0x[0-9a-fA-F]+", "0xADDR", tb_text or "")
    s = re.sub(r"line \d+", "line N", s)
    return s.strip()


def crash_fingerprint(exc_type: str, tb_text: str) -> str:
    """Deterministic 12-hex fingerprint from the exception type + normalised frames."""
    sig = f"{exc_type}\n{_normalise_traceback(tb_text)}"
    return hashlib.sha256(sig.encode("utf-8")).hexdigest()[:12]


# ── Log ring buffer ─────────────────────────────────────────────────────────────

class LogRingBuffer:
    """Bounded buffer of recent log lines to attach automatically to a crash."""

    def __init__(self, capacity: int = 200):
        self._buf: deque = deque(maxlen=capacity)

    def add(self, line: str):
        self._buf.append(f"{datetime.now(timezone.utc).isoformat()} {line}")

    def recent(self, n: int = 50) -> list[str]:
        return list(self._buf)[-n:]

    def clear(self):
        self._buf.clear()


# ── System info ─────────────────────────────────────────────────────────────────

def system_info() -> dict:
    return {
        "app_version": APP_VERSION,
        "platform": platform.platform(),
        "system": platform.system(),
        "python_version": platform.python_version(),
        "machine": platform.machine(),
    }


# ── Crash report ────────────────────────────────────────────────────────────────

def build_crash_report(exc_type: str, message: str, tb_text: str,
                       context: Optional[dict] = None,
                       recent_logs: Optional[list] = None) -> dict:
    fingerprint = crash_fingerprint(exc_type, tb_text)
    return {
        "id": uuid.uuid4().hex[:16],
        "fingerprint": fingerprint,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "exc_type": exc_type,
        "message": str(message),
        "traceback": tb_text,
        "context": context or {},
        "recent_logs": recent_logs or [],
        "system": system_info(),
        "uploaded": False,
    }


def report_from_exception(exc: BaseException, context: Optional[dict] = None,
                          recent_logs: Optional[list] = None) -> dict:
    tb_text = "".join(_tb.format_exception(type(exc), exc, exc.__traceback__))
    return build_crash_report(type(exc).__name__, str(exc), tb_text, context, recent_logs)


# ── Reporter (spool + upload + retry) ───────────────────────────────────────────

class CrashReporter:
    """
    Spools crash reports and uploads them via a transport. Failed uploads stay in the
    outbox; `flush()` retries. The default transport is a local sink (a directory) so
    it works with no network; inject an HTTP transport for a real crash server.
    """

    def __init__(self, root, transport: Optional[Callable[[dict], bool]] = None,
                 log_buffer: Optional[LogRingBuffer] = None):
        self.root = Path(root)
        self.outbox = self.root / "outbox"
        self.uploaded = self.root / "uploaded"
        self.outbox.mkdir(parents=True, exist_ok=True)
        self.uploaded.mkdir(parents=True, exist_ok=True)
        self.log_buffer = log_buffer or LogRingBuffer()
        self._sink = self.root / "sink"
        self.transport = transport or self._local_sink_transport

    def _local_sink_transport(self, report: dict) -> bool:
        self._sink.mkdir(parents=True, exist_ok=True)
        (self._sink / f"{report['id']}.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8", newline="")
        return True

    def _write(self, folder: Path, report: dict):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{report['id']}.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8", newline="")

    def _try_upload(self, report: dict) -> bool:
        try:
            return bool(self.transport(report))
        except Exception:
            return False

    def report(self, exc_type: str, message: str, tb_text: str,
               context: Optional[dict] = None) -> dict:
        """Build, spool, and attempt to upload a crash report (auto log capture)."""
        rep = build_crash_report(exc_type, message, tb_text, context,
                                 recent_logs=self.log_buffer.recent())
        self._write(self.outbox, rep)
        if self._try_upload(rep):
            rep["uploaded"] = True
            self._write(self.uploaded, rep)
            (self.outbox / f"{rep['id']}.json").unlink(missing_ok=True)
        return {"id": rep["id"], "fingerprint": rep["fingerprint"],
                "uploaded": rep["uploaded"]}

    def report_exception(self, exc: BaseException, context: Optional[dict] = None) -> dict:
        tb_text = "".join(_tb.format_exception(type(exc), exc, exc.__traceback__))
        return self.report(type(exc).__name__, str(exc), tb_text, context)

    def flush(self) -> dict:
        """Retry every report still sitting in the outbox."""
        uploaded, remaining = 0, 0
        for path in sorted(self.outbox.glob("*.json")):
            try:
                rep = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if self._try_upload(rep):
                rep["uploaded"] = True
                self._write(self.uploaded, rep)
                path.unlink(missing_ok=True)
                uploaded += 1
            else:
                remaining += 1
        return {"uploaded": uploaded, "remaining": remaining}

    def outbox_count(self) -> int:
        return len(list(self.outbox.glob("*.json")))

    def list_reports(self, limit: int = 100) -> list[dict]:
        reports = []
        for folder in (self.uploaded, self.outbox):
            for path in folder.glob("*.json"):
                try:
                    reports.append(json.loads(path.read_text(encoding="utf-8")))
                except Exception:
                    continue
        reports.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return reports[:limit]

    def get_report(self, report_id: str) -> Optional[dict]:
        for folder in (self.uploaded, self.outbox):
            path = folder / f"{report_id}.json"
            if path.exists():
                try:
                    return json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    return None
        return None

    def summary(self) -> dict:
        """Group crashes by fingerprint (recurring-bug view for support)."""
        groups: dict[str, dict] = {}
        for r in self.list_reports(limit=1000):
            fp = r.get("fingerprint", "?")
            g = groups.setdefault(fp, {"fingerprint": fp, "count": 0,
                                       "exc_type": r.get("exc_type"),
                                       "last_seen": r.get("timestamp"),
                                       "example_id": r.get("id")})
            g["count"] += 1
            if r.get("timestamp", "") > g["last_seen"]:
                g["last_seen"] = r["timestamp"]
        ordered = sorted(groups.values(), key=lambda g: -g["count"])
        return {"total_reports": sum(g["count"] for g in ordered),
                "unique_crashes": len(ordered), "groups": ordered}


# ── Support report ──────────────────────────────────────────────────────────────

def generate_support_report(report: dict) -> dict:
    """Produce a readable support report (text + structured) for a crash."""
    sysinfo = report.get("system", {})
    lines = [
        "AQUAFLOW STUDIO — CRASH SUPPORT REPORT",
        "=" * 44,
        f"Report ID:    {report.get('id')}",
        f"Fingerprint:  {report.get('fingerprint')}  (recurring-crash group id)",
        f"When:         {report.get('timestamp')}",
        f"App version:  {sysinfo.get('app_version')}",
        f"Platform:     {sysinfo.get('platform')}",
        f"Python:       {sysinfo.get('python_version')}",
        "",
        f"Exception:    {report.get('exc_type')}: {report.get('message')}",
        "",
        "Traceback",
        "-" * 44,
        report.get("traceback", "(none)").rstrip(),
        "",
        "Recent logs",
        "-" * 44,
        *(report.get("recent_logs") or ["(none)"]),
        "",
        "Context",
        "-" * 44,
        json.dumps(report.get("context", {}), indent=2),
        "",
        "Send this report to support@luxurycon.example with a description of what you "
        "were doing when the crash occurred.",
    ]
    text = "\n".join(str(l) for l in lines)
    return {
        "report_id": report.get("id"),
        "fingerprint": report.get("fingerprint"),
        "system": sysinfo,
        "exception": {"type": report.get("exc_type"), "message": report.get("message")},
        "text": text,
    }


# ── Global handler + singleton ──────────────────────────────────────────────────

_reporter: Optional[CrashReporter] = None


def get_crash_reporter() -> CrashReporter:
    global _reporter
    if _reporter is None:
        default_root = Path.home() / ".aquaflow" / "crash-reports"
        _reporter = CrashReporter(default_root)
    return _reporter


def install_excepthook(reporter: Optional[CrashReporter] = None) -> None:
    """Auto-report any uncaught exception in the process (opt-in)."""
    reporter = reporter or get_crash_reporter()
    previous = sys.excepthook

    def _hook(exc_type, exc, tb):
        try:
            reporter.report(exc_type.__name__, str(exc),
                            "".join(_tb.format_exception(exc_type, exc, tb)),
                            context={"source": "excepthook"})
        except Exception:
            pass
        previous(exc_type, exc, tb)

    sys.excepthook = _hook
