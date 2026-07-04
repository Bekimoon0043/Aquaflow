"""
digital_twin.py — AquaFlow Stage 5, AQ-S5-001

Digital Twin Engine: a live software mirror of the physical fountain assets (pumps,
valves, jets, lights) fed by telemetry, with historical replay and predictive
maintenance.

Each asset is registered with its service spec; telemetry is ingested to update the
mirrored state and appended to a time-series history. The engine can replay the state
at any past moment, and forecasts maintenance from accrued runtime + trends
(remaining service hours, projected service date, and predictive anomaly alerts such
as a rising-temperature trend heading for the limit).

  * real assets mirrored — `register_asset()` + `ingest()` keep a live mirror of every
    asset's current state,
  * historical replay supported — `replay_at()` returns the state as of any timestamp;
    `replay_range()` returns the samples over a window,
  * predictive maintenance supported — `maintenance_forecast()` estimates service
    hours/date from the runtime-accrual rate; `predict_anomalies()` fits telemetry
    trends and flags assets heading out of band.

Filesystem-scoped (one JSON per asset) and clock-injectable (telemetry carries an
explicit timestamp) so it is fully unit-tested and deterministic.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse(ts: str) -> datetime:
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _linfit(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Least-squares slope + intercept (slope 0 when degenerate)."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0)
    mx = sum(xs) / n
    my = sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs)
    if denom == 0:
        return 0.0, my
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
    return slope, my - slope * mx


class DigitalTwin:
    """Live mirror + history + predictive maintenance for a set of assets."""

    def __init__(self, root):
        self.root = Path(root)
        (self.root / "assets").mkdir(parents=True, exist_ok=True)

    def _path(self, asset_id: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(asset_id))
        return self.root / "assets" / f"{safe}.json"

    def _load(self, asset_id: str) -> Optional[dict]:
        p = self._path(asset_id)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _save(self, asset: dict):
        self._path(asset["id"]).write_text(json.dumps(asset, indent=2),
                                           encoding="utf-8", newline="")

    # ── Registration + live mirror ──────────────────────────────────────────────
    def register_asset(self, asset_id: str, asset_type: str, name: str = "",
                       service_interval_hours: float = 2000.0,
                       max_temp_c: float = 85.0, max_pressure_bar: float = 10.0) -> dict:
        asset = {
            "id": str(asset_id), "type": asset_type, "name": name or str(asset_id),
            "spec": {"service_interval_hours": float(service_interval_hours),
                     "max_temp_c": float(max_temp_c), "max_pressure_bar": float(max_pressure_bar)},
            "state": {}, "history": [], "services": [],
            "registered_at": _now(),
        }
        self._save(asset)
        return {"id": asset["id"], "type": asset["type"], "name": asset["name"]}

    def ingest(self, asset_id: str, telemetry: dict, timestamp: Optional[str] = None) -> dict:
        asset = self._load(asset_id)
        if not asset:
            raise ValueError(f"unknown asset '{asset_id}'")
        ts = timestamp or _now()
        sample = {"ts": ts,
                  "running": bool(telemetry.get("running", False)),
                  "runtime_hours": float(telemetry.get("runtime_hours", asset["state"].get("runtime_hours", 0.0))),
                  "temperature_c": telemetry.get("temperature_c"),
                  "pressure_bar": telemetry.get("pressure_bar"),
                  "cycles": telemetry.get("cycles")}
        asset["history"].append(sample)
        asset["state"] = {**sample, "last_update": ts}
        self._save(asset)
        return {"asset_id": asset_id, "mirrored": asset["state"]}

    def get_asset(self, asset_id: str) -> Optional[dict]:
        asset = self._load(asset_id)
        if not asset:
            return None
        return {"id": asset["id"], "type": asset["type"], "name": asset["name"],
                "spec": asset["spec"], "state": asset["state"],
                "sample_count": len(asset["history"])}

    def mirror(self) -> list[dict]:
        out = []
        for path in sorted((self.root / "assets").glob("*.json")):
            try:
                a = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append({"id": a["id"], "type": a["type"], "name": a["name"],
                        "state": a["state"], "sample_count": len(a["history"])})
        return out

    # ── Historical replay ───────────────────────────────────────────────────────
    def replay_at(self, asset_id: str, timestamp: str) -> Optional[dict]:
        asset = self._load(asset_id)
        if not asset:
            raise ValueError(f"unknown asset '{asset_id}'")
        target = _parse(timestamp)
        past = [s for s in asset["history"] if _parse(s["ts"]) <= target]
        if not past:
            return None
        state = past[-1]
        return {"asset_id": asset_id, "as_of": timestamp, "state": state,
                "samples_before": len(past)}

    def replay_range(self, asset_id: str, start: str, end: str) -> dict:
        asset = self._load(asset_id)
        if not asset:
            raise ValueError(f"unknown asset '{asset_id}'")
        a, b = _parse(start), _parse(end)
        samples = [s for s in asset["history"] if a <= _parse(s["ts"]) <= b]
        return {"asset_id": asset_id, "start": start, "end": end,
                "count": len(samples), "samples": samples}

    # ── Predictive maintenance ──────────────────────────────────────────────────
    def mark_serviced(self, asset_id: str, timestamp: Optional[str] = None) -> dict:
        asset = self._load(asset_id)
        if not asset:
            raise ValueError(f"unknown asset '{asset_id}'")
        rt = float(asset["state"].get("runtime_hours", 0.0))
        asset["services"].append({"at": timestamp or _now(), "runtime_hours": rt})
        self._save(asset)
        return {"serviced": True, "at_runtime_hours": rt}

    def _accrual_rate_per_day(self, asset: dict) -> float:
        """Runtime hours accrued per wall-clock day, from the history."""
        h = asset["history"]
        if len(h) < 2:
            return 0.0
        t0, t1 = _parse(h[0]["ts"]), _parse(h[-1]["ts"])
        days = (t1 - t0).total_seconds() / 86400.0
        if days <= 0:
            return 0.0
        dr = float(h[-1]["runtime_hours"]) - float(h[0]["runtime_hours"])
        return max(0.0, dr / days)

    def maintenance_forecast(self, asset_id: str, now: Optional[str] = None) -> dict:
        asset = self._load(asset_id)
        if not asset:
            raise ValueError(f"unknown asset '{asset_id}'")
        interval = asset["spec"]["service_interval_hours"]
        runtime = float(asset["state"].get("runtime_hours", 0.0))
        last_service_rt = asset["services"][-1]["runtime_hours"] if asset["services"] else 0.0
        since_service = runtime - last_service_rt
        remaining = interval - since_service

        rate = self._accrual_rate_per_day(asset)
        days_to_service = round(remaining / rate, 2) if rate > 0 and remaining > 0 else (0.0 if remaining <= 0 else None)
        est_date = None
        if days_to_service is not None:
            base = _parse(now) if now else _parse(asset["state"].get("last_update", _now()))
            est_date = (base + timedelta(days=days_to_service)).isoformat()

        if remaining <= 0:
            status = "overdue"
        elif remaining < 0.1 * interval:
            status = "due_soon"
        else:
            status = "ok"

        return {
            "asset_id": asset_id, "service_interval_hours": interval,
            "hours_since_service": round(since_service, 2),
            "hours_remaining": round(remaining, 2),
            "accrual_hours_per_day": round(rate, 3),
            "days_to_service": days_to_service,
            "estimated_service_date": est_date,
            "status": status,
        }

    def predict_anomalies(self, asset_id: str, horizon_days: float = 30.0) -> list[dict]:
        """Fit telemetry trends and flag assets heading out of band within the horizon."""
        asset = self._load(asset_id)
        if not asset:
            raise ValueError(f"unknown asset '{asset_id}'")
        h = [s for s in asset["history"] if s.get("temperature_c") is not None]
        alerts = []
        if len(h) >= 2:
            t0 = _parse(h[0]["ts"])
            xs = [(_parse(s["ts"]) - t0).total_seconds() / 86400.0 for s in h]  # days
            ys = [float(s["temperature_c"]) for s in h]
            slope, intercept = _linfit(xs, ys)                                  # °C per day
            max_temp = asset["spec"]["max_temp_c"]
            current = ys[-1]
            if slope > 0 and current < max_temp:
                days_to_limit = (max_temp - current) / slope
                if days_to_limit <= horizon_days:
                    alerts.append({
                        "type": "temperature_trend", "severity": "warning",
                        "message": f"Temperature rising {slope:.2f} °C/day — projected to reach the "
                                   f"{max_temp:.0f} °C limit in ~{days_to_limit:.1f} days.",
                        "days_to_limit": round(days_to_limit, 1), "slope_per_day": round(slope, 3)})
            elif current >= max_temp:
                alerts.append({"type": "over_temperature", "severity": "critical",
                               "message": f"Temperature {current:.1f} °C at/over the "
                                          f"{max_temp:.0f} °C limit.", "current": current})
        # Runtime/service alert folded in from the forecast.
        fc = self.maintenance_forecast(asset_id)
        if fc["status"] == "overdue":
            alerts.append({"type": "service_overdue", "severity": "critical",
                           "message": f"Service overdue by {-fc['hours_remaining']:.0f} h."})
        elif fc["status"] == "due_soon":
            alerts.append({"type": "service_due_soon", "severity": "warning",
                           "message": f"Service due in {fc['hours_remaining']:.0f} h"
                                      + (f" (~{fc['days_to_service']} days)" if fc["days_to_service"] else "") + "."})
        return alerts

    # ── Fleet summary ───────────────────────────────────────────────────────────
    def summary(self) -> dict:
        assets = self.mirror()
        forecasts = []
        alerts = []
        for a in assets:
            fc = self.maintenance_forecast(a["id"])
            forecasts.append({"id": a["id"], "status": fc["status"],
                              "hours_remaining": fc["hours_remaining"]})
            alerts.extend({**al, "asset_id": a["id"]} for al in self.predict_anomalies(a["id"]))
        return {
            "asset_count": len(assets),
            "running": sum(1 for a in assets if a["state"].get("running")),
            "needs_service": sum(1 for f in forecasts if f["status"] in ("due_soon", "overdue")),
            "forecasts": forecasts,
            "alerts": alerts,
        }


# ── Singleton ──────────────────────────────────────────────────────────────────
_twin: Optional[DigitalTwin] = None


def get_digital_twin() -> DigitalTwin:
    global _twin
    if _twin is None:
        _twin = DigitalTwin(Path.home() / ".aquaflow" / "digital-twin")
    return _twin
