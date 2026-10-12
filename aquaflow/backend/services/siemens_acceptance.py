"""End-to-end Siemens acceptance run: verify → pulse every device → watchdog → stop.

Run it against PLCSIM before the PLC is bought, and again on the real cabinet. The record says
exactly what the PLC reported back; on PLCSIM that proves the program, the mapping and the
communication, not the wiring (feedback is then "plc_applied", never "physical").
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from engine.siemens_site import signature

MAX_HISTORY = 50


class AcceptanceStore:
    def __init__(self, path):
        self.path = Path(path)

    def all(self, sid=None):
        try:
            records = json.loads(self.path.read_text(encoding="utf-8"))["records"]
        except (OSError, ValueError, KeyError):
            records = []
        return [r for r in records if sid is None or r["site_id"] == sid]

    def add(self, record):
        records = self.all()
        records.append(record)
        per_site = [r for r in records if r["site_id"] == record["site_id"]][-MAX_HISTORY:]
        records = [r for r in records if r["site_id"] != record["site_id"]] + per_site
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".pending")
        temporary.write_text(json.dumps({"version": 1, "records": records}, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AcceptanceRunner:
    def __init__(self, runtime, site_store, record_store):
        self.runtime, self.sites, self.records = runtime, site_store, record_store
        self.jobs = {}

    def progress(self, sid):
        job = self.jobs.get(sid)
        if job:
            return {k: v for k, v in job.items() if k != "task"}
        history = self.records.all(sid)
        return {"state": "idle", "last": history[-1] if history else None}

    def start(self, sid, *, device_ids=None, seconds=2, include_watchdog=True, flow_path_confirmed=False):
        current = self.jobs.get(sid)
        if current and current["state"] == "running":
            raise ValueError("An acceptance test is already running for this site")
        site = self.sites.get(sid)
        if site["mode"] == "simulated":
            raise ValueError("Switch the site to PLCSIM or physical mode; the acceptance test proves a real "
                             "PLC program, not AquaFlow's internal simulation")
        if not flow_path_confirmed:
            raise ValueError("Confirm the PLC is isolated (PLCSIM) or that every outlet has a safe water path")
        devices = [c for c in sorted(site["channels"], key=lambda c: (c["kind"] != "valve", c["index"]))
                   if c["kind"] in ("valve", "light") and (not device_ids or c["id"] in device_ids)]
        if not devices:
            raise ValueError("No valves or lights selected")
        if len(devices) > 64:
            raise ValueError("Select at most 64 devices per acceptance run")
        job = {"state": "running", "site_id": sid, "started_at": _now(), "steps": [], "total": len(devices) + 2 +
               (1 if include_watchdog else 0)}
        self.jobs[sid] = job
        job["task"] = asyncio.create_task(self._run(sid, site, devices, seconds, include_watchdog,
                                                    flow_path_confirmed, job))
        return self.progress(sid)

    async def _step(self, job, name, coroutine):
        started = time.monotonic()
        step = {"name": name, "ok": False, "detail": "", "seconds": 0.0}
        job["steps"].append(step)
        try:
            ok, detail, data = await coroutine
            step.update(ok=bool(ok), detail=detail, data=data)
        except Exception as exc:  # each step reports its own failure and the run continues safely
            step.update(ok=False, detail=str(exc))
        step["seconds"] = round(time.monotonic() - started, 2)
        return step["ok"]

    async def _verify(self, sid):
        status = await self.runtime.verify(sid)
        ok = bool(status.get("verified"))
        return ok, (f"Contract v{status.get('contract_version')} matches, PLC heartbeat moving"
                    if ok else status.get("error") or "Verify failed"), {"quality": status.get("quality")}

    async def _device(self, sid, site, channel, seconds, flow_path_confirmed):
        await self.runtime.verify(sid)
        await self.runtime.test_device(sid, channel["id"], seconds, flow_path_confirmed)
        await asyncio.sleep(min(seconds / 2, 1.5))
        status = self.runtime.status(sid)
        feedback = status.get("feedback") or {}
        observed = feedback.get(channel["id"]) or {}
        pump = None
        if channel["kind"] == "valve":
            pump = next(c for c in site["channels"] if c["id"] == channel.get("pump_id"))
            ok = bool(observed.get("open"))
            pump_fb = feedback.get(pump["id"]) or {}
            ok = ok and pump_fb.get("applied_percent", 0) > 0
            detail = (f"PLC reports valve OPEN and {pump['name']} at {pump_fb.get('applied_percent', 0):.0f}%"
                      if ok else f"Expected valve open and pump running; PLC reported {observed or 'nothing'}")
        else:
            ok = any(observed.get("rgb") or [])
            detail = f"PLC applied RGB {observed.get('rgb')}" if ok else "PLC applied no light value"
        task = self.runtime.tasks.get(sid)
        if task:
            await task
        final = self.runtime.status(sid)
        if not final.get("stop_confirmed"):
            ok = False
            detail += "; OFF was not confirmed after the pulse"
        if final.get("error"):
            ok = False
            detail += f"; {final['error']}"
        source = observed.get("source", "")
        if source == "plc_applied":
            detail += " (PLC-applied value: proves the program, not the wiring)"
        return ok, detail, {"feedback": observed, "pump": pump["id"] if pump else None, "source": source}

    async def _watchdog(self, sid, flow_path_confirmed):
        await self.runtime.verify(sid)
        result = await self.runtime.watchdog_probe(sid, flow_path_confirmed)
        ok = result["tripped"] and result["recovered"]
        detail = ("AquaFlow went silent for 1.6 s: the PLC dropped Ready with a watchdog fault, then recovered "
                  "with a fresh OFF command" if ok else
                  f"Watchdog did not behave as expected: during={result['during']}, after={result['after']}")
        return ok, detail, result

    async def _final(self, sid):
        status = self.runtime.status(sid)
        ok = bool(status.get("stop_confirmed")) and not status.get("running")
        return ok, "All outputs confirmed OFF" if ok else "OFF state not confirmed", {}

    async def _run(self, sid, site, devices, seconds, include_watchdog, flow_path_confirmed, job):
        try:
            if await self._step(job, "Verify PLC program and connection", self._verify(sid)):
                for channel in devices:
                    label = f"{'Valve' if channel['kind'] == 'valve' else 'Light'}: {channel['name']}"
                    await self._step(job, label, self._device(sid, site, channel, seconds, flow_path_confirmed))
                if include_watchdog:
                    await self._step(job, "Communication-loss watchdog", self._watchdog(sid, flow_path_confirmed))
            await self._step(job, "Everything OFF at the end", self._final(sid))
        finally:
            try:
                await self.runtime.stop(sid)
            except Exception:
                pass
            passed = bool(job["steps"]) and all(s["ok"] for s in job["steps"]) and \
                len(job["steps"]) == job["total"]
            record = {"site_id": sid, "site_name": site["name"], "site_revision": site["revision"],
                      "signature": f"0x{signature(site):08X}", "mode": site["mode"],
                      "started_at": job["started_at"], "finished_at": _now(), "passed": passed,
                      "steps": job["steps"],
                      "meaning": ("PLCSIM proof: program, mapping and communication work. Wiring is not tested."
                                  if site["mode"] == "plcsim" else
                                  "Physical PLC run. Each device still needs a person to confirm the water/light "
                                  "actually responded before it is marked commissioned.")}
            self.records.add(record)
            job.update(state="passed" if passed else "failed", finished_at=record["finished_at"], record=record)
