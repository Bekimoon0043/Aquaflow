"""
fleet_manager.py — AquaFlow Stage 5, AQ-S5-004

Fleet Management System: monitor many fountain sites from one place, aggregate them
into a central dashboard, and centralise their alerts.

Each site reports its operator status; the manager condenses it (reusing the mobile
monitor's snapshot + alert derivation), tracks when each site was last seen (so stale
sites show as offline), rolls the fleet up into a dashboard, and merges every site's
alerts into one severity-ranked feed (plus a synthetic alert for any offline site).

  * multiple sites monitored — `register_site()` + `report_status()` keep a live
    health snapshot per site with offline detection,
  * central dashboard works — `dashboard()` rolls up site counts, online/offline, a
    health breakdown, and per-site summaries,
  * alerts centralised — `central_alerts()` merges every site's alerts (attributed to
    the site, acknowledgeable) into one critical-first feed.

Filesystem-scoped (one JSON per site) and clock-injectable (an explicit `now`) so it is
fully unit-tested and deterministic.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from services.mobile_monitor import build_snapshot, evaluate_alerts

OFFLINE_TIMEOUT_S = 120.0
_SEV_RANK = {"critical": 0, "warning": 1, "info": 2}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


class FleetManager:
    def __init__(self, root):
        self.root = Path(root)
        (self.root / "sites").mkdir(parents=True, exist_ok=True)

    def _path(self, site_id: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(site_id))
        return self.root / "sites" / f"{safe}.json"

    def _load(self, site_id: str) -> Optional[dict]:
        p = self._path(site_id)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _save(self, site: dict):
        self._path(site["id"]).write_text(json.dumps(site, indent=2), encoding="utf-8", newline="")

    def _all(self) -> list[dict]:
        out = []
        for path in sorted((self.root / "sites").glob("*.json")):
            try:
                out.append(json.loads(path.read_text(encoding="utf-8")))
            except Exception:
                continue
        return out

    # ── Sites ───────────────────────────────────────────────────────────────────
    def register_site(self, site_id: str, name: str = "", location: str = "",
                      timezone_name: str = "") -> dict:
        existing = self._load(site_id)
        site = existing or {"id": str(site_id), "registered_at": _now(),
                            "last_seen": None, "snapshot": {}, "alerts": [], "acks": []}
        site["name"] = name or site.get("name") or str(site_id)
        site["location"] = location or site.get("location", "")
        site["timezone"] = timezone_name or site.get("timezone", "")
        self._save(site)
        return {"id": site["id"], "name": site["name"], "location": site["location"]}

    def report_status(self, site_id: str, operator_status: dict,
                      timestamp: Optional[str] = None) -> dict:
        site = self._load(site_id)
        if not site:
            raise ValueError(f"unknown site '{site_id}' — register it first")
        snap = build_snapshot(operator_status or {})
        alerts = evaluate_alerts(operator_status or {})
        site["last_seen"] = timestamp or _now()
        site["snapshot"] = snap
        site["alerts"] = alerts
        # drop acks for codes no longer active
        active_codes = {a["code"] for a in alerts}
        site["acks"] = [c for c in site.get("acks", []) if c in active_codes]
        self._save(site)
        return {"site_id": site_id, "health": snap["health"], "alert_count": len(alerts)}

    def is_online(self, site: dict, now: Optional[str] = None) -> bool:
        last = _parse(site.get("last_seen"))
        if not last:
            return False
        ref = _parse(now) if now else datetime.now(timezone.utc)
        return (ref - last).total_seconds() <= OFFLINE_TIMEOUT_S

    def get_site(self, site_id: str, now: Optional[str] = None) -> Optional[dict]:
        site = self._load(site_id)
        if not site:
            return None
        return {"id": site["id"], "name": site["name"], "location": site.get("location", ""),
                "online": self.is_online(site, now), "last_seen": site.get("last_seen"),
                "snapshot": site.get("snapshot", {}), "alerts": site.get("alerts", [])}

    # ── Central dashboard ───────────────────────────────────────────────────────
    def dashboard(self, now: Optional[str] = None) -> dict:
        sites = self._all()
        health_counts = {"live": 0, "warning": 0, "critical": 0, "estop": 0, "idle": 0, "offline": 0}
        online = 0
        rows = []
        total_alerts = 0
        for s in sites:
            up = self.is_online(s, now)
            snap = s.get("snapshot", {})
            health = snap.get("health", "idle") if up else "offline"
            health_counts[health] = health_counts.get(health, 0) + 1
            online += 1 if up else 0
            n_alerts = len(s.get("alerts", [])) if up else 0
            total_alerts += n_alerts
            rows.append({"id": s["id"], "name": s["name"], "location": s.get("location", ""),
                         "online": up, "health": health, "playing": bool(snap.get("playing")),
                         "alert_count": n_alerts, "last_seen": s.get("last_seen")})
        rows.sort(key=lambda r: (0 if not r["online"] else _SEV_RANK.get("critical" if r["health"] in
                                 ("estop", "critical") else "warning" if r["health"] == "warning" else "info", 3), r["name"]))
        critical = self._critical_count(now)
        return {
            "site_count": len(sites),
            "online": online, "offline": len(sites) - online,
            "health": health_counts,
            "total_active_alerts": total_alerts,
            "critical_alerts": critical,
            "sites": rows,
        }

    def _critical_count(self, now):
        return sum(1 for a in self.central_alerts(now) if a["severity"] == "critical")

    # ── Centralised alerts ──────────────────────────────────────────────────────
    def central_alerts(self, now: Optional[str] = None) -> list[dict]:
        out = []
        for s in self._all():
            up = self.is_online(s, now)
            if not up:
                out.append({"site_id": s["id"], "site_name": s["name"], "code": "SITE_OFFLINE",
                            "severity": "warning", "message": f"{s['name']} is offline "
                            f"(no report since {s.get('last_seen') or 'ever'})", "acknowledged": False})
                continue
            acks = set(s.get("acks", []))
            for a in s.get("alerts", []):
                out.append({"site_id": s["id"], "site_name": s["name"], "code": a["code"],
                            "severity": a["severity"], "message": a["message"],
                            "acknowledged": a["code"] in acks})
        out.sort(key=lambda a: (_SEV_RANK.get(a["severity"], 9), a["site_name"], a["code"]))
        return out

    def acknowledge(self, site_id: str, code: str) -> dict:
        site = self._load(site_id)
        if not site:
            raise ValueError(f"unknown site '{site_id}'")
        if code not in site.get("acks", []):
            site.setdefault("acks", []).append(code)
            self._save(site)
        return {"acknowledged": True, "site_id": site_id, "code": code}


# ── Singleton ──────────────────────────────────────────────────────────────────
_fleet: Optional[FleetManager] = None


def get_fleet_manager() -> FleetManager:
    global _fleet
    if _fleet is None:
        _fleet = FleetManager(Path.home() / ".aquaflow" / "fleet")
    return _fleet
