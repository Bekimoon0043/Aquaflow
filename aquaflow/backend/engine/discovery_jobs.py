"""
engine/discovery_jobs.py — background controller-discovery jobs with real
progress and cancellation.

A subnet sweep takes tens of seconds. Holding an HTTP request open for that
long gives the operator a spinner and no way to stop it. A job runs the sweep
as an asyncio task, exposes progress (fraction + message) and honours cancel.
One job runs at a time — two concurrent sweeps would double the traffic and
race for the I-CAN probe socket.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Awaitable, Callable, Optional

MAX_KEPT = 10


@dataclass
class DiscoveryJob:
    id: str
    status: str = "running"            # running | done | cancelled | failed
    progress: float = 0.0
    message: str = "starting"
    started: float = field(default_factory=time.time)
    finished: Optional[float] = None
    request: dict = field(default_factory=dict)
    result: Optional[dict] = None
    error: str = ""
    cancel: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    task: Optional[asyncio.Task] = field(default=None, repr=False)

    def to_dict(self, include_result: bool = True) -> dict:
        d = {
            "job_id": self.id, "status": self.status, "progress": round(self.progress, 3),
            "message": self.message, "started": self.started, "finished": self.finished,
            "request": self.request, "error": self.error,
            "elapsed_s": round((self.finished or time.time()) - self.started, 1),
        }
        if include_result:
            d["result"] = self.result
        return d


class JobAlreadyRunning(RuntimeError):
    def __init__(self, job_id: str):
        self.job_id = job_id
        super().__init__(f"discovery job {job_id} is already running")


class DiscoveryJobRegistry:
    def __init__(self):
        self._jobs: dict[str, DiscoveryJob] = {}

    def running(self) -> Optional[DiscoveryJob]:
        return next((j for j in self._jobs.values() if j.status == "running"), None)

    def get(self, job_id: str) -> Optional[DiscoveryJob]:
        return self._jobs.get(job_id)

    def list(self) -> list[dict]:
        return [j.to_dict(include_result=False)
                for j in sorted(self._jobs.values(), key=lambda j: j.started, reverse=True)]

    def start(self, runner: Callable[[DiscoveryJob], Awaitable[dict]], request: dict) -> DiscoveryJob:
        """`runner(job)` performs the discovery, calling job.set_progress and
        checking job.cancel. Returns the new job (status running)."""
        active = self.running()
        if active is not None:
            raise JobAlreadyRunning(active.id)
        job = DiscoveryJob(id=uuid.uuid4().hex[:10], request=dict(request))
        self._jobs[job.id] = job
        self._prune()

        async def _run():
            try:
                job.result = await runner(job)
                if job.cancel.is_set() or (job.result or {}).get("cancelled"):
                    job.status = "cancelled"
                    job.message = "cancelled"
                else:
                    job.status = "done"
                    job.message = "complete"
                job.progress = 1.0
            except asyncio.CancelledError:
                job.status = "cancelled"
                job.message = "cancelled"
                raise
            except Exception as e:
                job.status = "failed"
                job.error = f"{e.__class__.__name__}: {e}"
                job.message = "failed"
            finally:
                job.finished = time.time()

        job.task = asyncio.get_running_loop().create_task(_run())
        return job

    def cancel(self, job_id: str) -> Optional[DiscoveryJob]:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        if job.status == "running":
            job.cancel.set()
            job.message = "cancelling…"
        return job

    def _prune(self):
        finished = [j for j in self._jobs.values() if j.status != "running"]
        finished.sort(key=lambda j: j.finished or j.started)
        while len(self._jobs) > MAX_KEPT and finished:
            self._jobs.pop(finished.pop(0).id, None)


def set_progress(job: DiscoveryJob):
    def _cb(frac: float, msg: str):
        job.progress = frac
        job.message = msg
    return _cb


registry = DiscoveryJobRegistry()
