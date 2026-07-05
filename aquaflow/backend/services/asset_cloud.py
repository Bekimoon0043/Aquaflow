"""
asset_cloud.py — AquaFlow Stage 5, AQ-S5-005

Global Asset Cloud: a multi-tenant cloud store for AquaFlow customers. Each company is
an isolated tenant that owns its assets (designs / shows / site configs); the cloud keeps
versioned, checksummed backups of those assets and can run remote diagnostics against a
company's sites without anyone being on-site.

  * cloud backups work — `create_backup()` stores a versioned, SHA-256-checksummed
    snapshot of an asset; `restore_backup()` / `latest_backup()` return it and verify the
    checksum so corruption is caught; retention prunes old versions.
  * multi-company support exists — every company is a separate tenant namespace; assets,
    backups and diagnostics are scoped per company and can never leak across tenants.
  * remote diagnostics supported — a site reports its operator status to the cloud
    (`report_diagnostics()`, condensed via the mobile monitor); `run_remote_diagnostic()`
    collects a full remote bundle (health, alerts, connectivity, backup freshness and
    recommendations) for support to act on from anywhere.

Filesystem-scoped (one tree per company) and clock-injectable (explicit `timestamp`/`now`
ISO strings) so it is fully unit-tested and deterministic.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from services.mobile_monitor import build_snapshot, evaluate_alerts

# How many backup versions to keep per asset (older ones are pruned).
RETENTION_PER_ASSET = 10
# A site whose last diagnostic is older than this is considered unreachable.
OFFLINE_TIMEOUT_S = 300.0
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


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(name)) or "_"


def _checksum(data) -> str:
    """Stable SHA-256 of an arbitrary JSON-serialisable payload."""
    blob = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class CloudError(Exception):
    """Raised for tenant/backup errors (unknown company, missing/corrupt backup…)."""


class AssetCloud:
    """Multi-tenant cloud: companies → assets → versioned backups + remote diagnostics."""

    def __init__(self, root):
        self.root = Path(root)
        (self.root / "companies").mkdir(parents=True, exist_ok=True)

    # ── Tenant paths ──────────────────────────────────────────────────────────────
    def _company_dir(self, company_id: str) -> Path:
        return self.root / "companies" / _safe(company_id)

    def _meta_path(self, company_id: str) -> Path:
        return self._company_dir(company_id) / "company.json"

    def _load_company(self, company_id: str) -> Optional[dict]:
        p = self._meta_path(company_id)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _require_company(self, company_id: str) -> dict:
        c = self._load_company(company_id)
        if not c:
            raise CloudError(f"unknown company '{company_id}' — register it first")
        return c

    # ── Companies (tenants) ───────────────────────────────────────────────────────
    def register_company(self, company_id: str, name: str = "", plan: str = "standard") -> dict:
        existing = self._load_company(company_id)
        company = existing or {"id": str(company_id), "created_at": _now()}
        company["name"] = name or company.get("name") or str(company_id)
        company["plan"] = plan or company.get("plan", "standard")
        d = self._company_dir(company_id)
        (d / "backups").mkdir(parents=True, exist_ok=True)
        (d / "diagnostics").mkdir(parents=True, exist_ok=True)
        self._meta_path(company_id).write_text(json.dumps(company, indent=2),
                                               encoding="utf-8", newline="")
        return {"id": company["id"], "name": company["name"], "plan": company["plan"]}

    def list_companies(self) -> list[dict]:
        out = []
        for meta in sorted((self.root / "companies").glob("*/company.json")):
            try:
                c = json.loads(meta.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append({"id": c["id"], "name": c.get("name", c["id"]),
                        "plan": c.get("plan", "standard"),
                        "backup_count": len(list((meta.parent / "backups").glob("*.json"))),
                        "site_count": len(list((meta.parent / "diagnostics").glob("*.json")))})
        return out

    def get_company(self, company_id: str) -> Optional[dict]:
        c = self._load_company(company_id)
        if not c:
            return None
        d = self._company_dir(company_id)
        return {"id": c["id"], "name": c.get("name", c["id"]), "plan": c.get("plan", "standard"),
                "created_at": c.get("created_at"),
                "backup_count": len(list((d / "backups").glob("*.json"))),
                "site_count": len(list((d / "diagnostics").glob("*.json")))}

    # ── Cloud backups ─────────────────────────────────────────────────────────────
    def _backups_dir(self, company_id: str) -> Path:
        return self._company_dir(company_id) / "backups"

    def _all_backups(self, company_id: str) -> list[dict]:
        out = []
        for p in self._backups_dir(company_id).glob("*.json"):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except Exception:
                continue
        # newest first: version desc within an asset, then created_at desc
        out.sort(key=lambda b: (b.get("created_at", ""), b.get("version", 0)), reverse=True)
        return out

    def create_backup(self, company_id: str, asset_id: str, data, label: str = "",
                      asset_type: str = "design", timestamp: Optional[str] = None) -> dict:
        self._require_company(company_id)
        if not asset_id:
            raise CloudError("asset_id is required")
        prior = [b for b in self._all_backups(company_id) if b["asset_id"] == str(asset_id)]
        version = (max((b["version"] for b in prior), default=0)) + 1
        backup_id = uuid.uuid4().hex[:16]
        record = {
            "backup_id": backup_id, "company_id": str(company_id),
            "asset_id": str(asset_id), "asset_type": asset_type,
            "label": label, "version": version,
            "created_at": timestamp or _now(),
            "checksum": _checksum(data),
            "size_bytes": len(json.dumps(data, default=str).encode("utf-8")),
            "data": data,
        }
        (self._backups_dir(company_id) / f"{backup_id}.json").write_text(
            json.dumps(record, indent=2, default=str), encoding="utf-8", newline="")
        self._prune(company_id, str(asset_id))
        return {k: record[k] for k in
                ("backup_id", "asset_id", "asset_type", "label", "version",
                 "created_at", "checksum", "size_bytes")}

    def _prune(self, company_id: str, asset_id: str) -> None:
        versions = sorted(
            (b for b in self._all_backups(company_id) if b["asset_id"] == asset_id),
            key=lambda b: b["version"], reverse=True)
        for stale in versions[RETENTION_PER_ASSET:]:
            (self._backups_dir(company_id) / f"{stale['backup_id']}.json").unlink(missing_ok=True)

    def list_backups(self, company_id: str, asset_id: Optional[str] = None) -> list[dict]:
        self._require_company(company_id)
        rows = self._all_backups(company_id)
        if asset_id is not None:
            rows = [b for b in rows if b["asset_id"] == str(asset_id)]
        return [{k: b[k] for k in ("backup_id", "asset_id", "asset_type", "label",
                                   "version", "created_at", "checksum", "size_bytes")}
                for b in rows]

    def _load_backup(self, company_id: str, backup_id: str) -> Optional[dict]:
        p = self._backups_dir(company_id) / f"{_safe(backup_id)}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def restore_backup(self, company_id: str, backup_id: str) -> dict:
        self._require_company(company_id)
        rec = self._load_backup(company_id, backup_id)
        if not rec:
            raise CloudError(f"backup '{backup_id}' not found for this company")
        # Integrity: the stored data must still match the recorded checksum.
        if _checksum(rec["data"]) != rec["checksum"]:
            raise CloudError(f"backup '{backup_id}' is corrupt — checksum mismatch")
        return {"backup_id": rec["backup_id"], "asset_id": rec["asset_id"],
                "asset_type": rec.get("asset_type", "design"), "version": rec["version"],
                "created_at": rec["created_at"], "checksum": rec["checksum"],
                "verified": True, "data": rec["data"]}

    def latest_backup(self, company_id: str, asset_id: str) -> Optional[dict]:
        self._require_company(company_id)
        versions = [b for b in self._all_backups(company_id) if b["asset_id"] == str(asset_id)]
        if not versions:
            return None
        latest = max(versions, key=lambda b: b["version"])
        return self.restore_backup(company_id, latest["backup_id"])

    # ── Remote diagnostics ────────────────────────────────────────────────────────
    def _diag_dir(self, company_id: str) -> Path:
        return self._company_dir(company_id) / "diagnostics"

    def _diag_path(self, company_id: str, site_id: str) -> Path:
        return self._diag_dir(company_id) / f"{_safe(site_id)}.json"

    def report_diagnostics(self, company_id: str, site_id: str, operator_status: dict,
                          site_name: str = "", timestamp: Optional[str] = None) -> dict:
        self._require_company(company_id)
        if not site_id:
            raise CloudError("site_id is required")
        snap = build_snapshot(operator_status or {})
        alerts = evaluate_alerts(operator_status or {})
        record = {"site_id": str(site_id), "site_name": site_name or str(site_id),
                  "reported_at": timestamp or _now(), "snapshot": snap, "alerts": alerts}
        self._diag_path(company_id, site_id).write_text(
            json.dumps(record, indent=2), encoding="utf-8", newline="")
        return {"site_id": str(site_id), "health": snap["health"], "alert_count": len(alerts)}

    def _load_diag(self, company_id: str, site_id: str) -> Optional[dict]:
        p = self._diag_path(company_id, site_id)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _reachable(self, rec: dict, now: Optional[str]) -> bool:
        last = _parse(rec.get("reported_at"))
        if not last:
            return False
        ref = _parse(now) if now else datetime.now(timezone.utc)
        return (ref - last).total_seconds() <= OFFLINE_TIMEOUT_S

    def run_remote_diagnostic(self, company_id: str, site_id: str,
                             now: Optional[str] = None) -> dict:
        """Collect a full remote diagnostic bundle for one site."""
        self._require_company(company_id)
        rec = self._load_diag(company_id, site_id)
        if not rec:
            raise CloudError(f"no diagnostics reported for site '{site_id}'")
        snap = rec.get("snapshot", {})
        alerts = list(rec.get("alerts", []))
        reachable = self._reachable(rec, now)

        # Backup freshness for this site's asset (if any backups exist).
        backups = [b for b in self._all_backups(company_id) if b["asset_id"] == str(site_id)]
        last_backup = max(backups, key=lambda b: b["version"]) if backups else None

        recommendations = self._recommend(snap, alerts, reachable, last_backup, rec, now)
        return {
            "company_id": str(company_id), "site_id": str(site_id),
            "site_name": rec.get("site_name", site_id),
            "reachable": reachable, "reported_at": rec.get("reported_at"),
            "health": snap.get("health", "unknown"), "snapshot": snap,
            "alerts": sorted(alerts, key=lambda a: _SEV_RANK.get(a["severity"], 9)),
            "has_backup": last_backup is not None,
            "last_backup_version": last_backup["version"] if last_backup else 0,
            "last_backup_at": last_backup["created_at"] if last_backup else None,
            "recommendations": recommendations,
        }

    @staticmethod
    def _recommend(snap, alerts, reachable, last_backup, rec, now) -> list[str]:
        recs = []
        if not reachable:
            recs.append("Site is unreachable — verify network/VPN link to the site controller.")
        health = snap.get("health")
        if health == "estop":
            recs.append("Emergency stop is active — dispatch a technician; do not clear remotely.")
        elif health == "critical":
            recs.append("Critical fault present — inspect faulted subsystem before next show.")
        elif health == "warning":
            recs.append("Warning condition — schedule maintenance at the next window.")
        if not snap.get("plc_online", True):
            recs.append("PLC heartbeat lost — check the PLC link and power.")
        if last_backup is None:
            recs.append("No cloud backup for this site — create one to protect its configuration.")
        if not recs:
            recs.append("Site is healthy — no action required.")
        return recs

    def list_diagnostics(self, company_id: str, now: Optional[str] = None) -> list[dict]:
        self._require_company(company_id)
        out = []
        for p in sorted(self._diag_dir(company_id).glob("*.json")):
            try:
                rec = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            snap = rec.get("snapshot", {})
            up = self._reachable(rec, now)
            out.append({"site_id": rec["site_id"], "site_name": rec.get("site_name", rec["site_id"]),
                        "reachable": up, "health": snap.get("health", "unknown") if up else "offline",
                        "alert_count": len(rec.get("alerts", [])) if up else 0,
                        "reported_at": rec.get("reported_at")})
        return out


# ── Singleton ──────────────────────────────────────────────────────────────────
_cloud: Optional[AssetCloud] = None


def get_asset_cloud() -> AssetCloud:
    global _cloud
    if _cloud is None:
        _cloud = AssetCloud(Path.home() / ".aquaflow" / "asset-cloud")
    return _cloud
