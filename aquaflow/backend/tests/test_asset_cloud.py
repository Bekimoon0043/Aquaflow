"""
Contract tests for the Global Asset Cloud (AQ-S5-005).

Asserts the three acceptance criteria:
  1. cloud backups work (versioned, checksummed, restore round-trip, corruption caught),
  2. multi-company support exists (tenant isolation across companies),
  3. remote diagnostics supported (report status → collect a remote bundle).
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from services.asset_cloud import AssetCloud, CloudError

BASE = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)


def _t(sec):
    return (BASE + timedelta(seconds=sec)).isoformat()


LIVE = {"safety": {"state": "LIVE", "permit": True, "active_faults": [], "inputs": {"plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 5000, "duration_ms": 10000}}
ESTOP = {"safety": {"state": "EMERGENCY_STOP", "permit": False, "active_faults": ["ESTOP_OPEN"],
                    "inputs": {"plc_heartbeat_ok": True}}}


@pytest.fixture
def cloud(tmp_path):
    c = AssetCloud(tmp_path / "cloud")
    c.register_company("acme", "ACME Fountains", plan="enterprise")
    c.register_company("globex", "Globex Water")
    return c


# ── 1. cloud backups ──────────────────────────────────────────────────────────

def test_backup_versioning_and_restore(cloud):
    v1 = cloud.create_backup("acme", "show", {"tempo": 120}, timestamp=_t(0))
    v2 = cloud.create_backup("acme", "show", {"tempo": 128}, timestamp=_t(1))
    assert v1["version"] == 1 and v2["version"] == 2
    assert cloud.restore_backup("acme", v2["backup_id"])["data"] == {"tempo": 128}
    assert cloud.latest_backup("acme", "show")["version"] == 2


def test_backup_checksum_detects_corruption(cloud):
    b = cloud.create_backup("acme", "show", {"tempo": 120}, timestamp=_t(0))
    p = cloud._backups_dir("acme") / f"{b['backup_id']}.json"
    rec = json.loads(p.read_text(encoding="utf-8"))
    rec["data"]["tempo"] = 999
    p.write_text(json.dumps(rec), encoding="utf-8")
    with pytest.raises(CloudError):
        cloud.restore_backup("acme", b["backup_id"])


def test_backup_retention_prunes_old_versions(cloud):
    for i in range(15):
        cloud.create_backup("acme", "asset", {"v": i}, timestamp=_t(i))
    kept = cloud.list_backups("acme", "asset")
    assert len(kept) == 10
    assert max(b["version"] for b in kept) == 15


def test_backup_unknown_company_errors(cloud):
    with pytest.raises(CloudError):
        cloud.create_backup("nobody", "asset", {"a": 1})


# ── 2. multi-company isolation ────────────────────────────────────────────────

def test_tenant_backup_isolation(cloud):
    a = cloud.create_backup("acme", "show", {"who": "acme"}, timestamp=_t(0))
    cloud.create_backup("globex", "show", {"who": "globex"}, timestamp=_t(0))
    assert len(cloud.list_backups("acme", "show")) == 1
    assert len(cloud.list_backups("globex", "show")) == 1
    # acme's backup id cannot be restored under globex
    with pytest.raises(CloudError):
        cloud.restore_backup("globex", a["backup_id"])


def test_companies_listed(cloud):
    ids = {c["id"] for c in cloud.list_companies()}
    assert ids == {"acme", "globex"}


# ── 3. remote diagnostics ─────────────────────────────────────────────────────

def test_remote_diagnostic_bundle(cloud):
    cloud.report_diagnostics("acme", "marina", ESTOP, site_name="Marina Bay", timestamp=_t(0))
    d = cloud.run_remote_diagnostic("acme", "marina", now=_t(1))
    assert d["health"] == "estop"
    assert any(a["code"] == "ESTOP" for a in d["alerts"])
    assert d["reachable"] is True
    assert any("technician" in r.lower() for r in d["recommendations"])


def test_remote_diagnostic_unreachable_after_timeout(cloud):
    cloud.report_diagnostics("acme", "site", LIVE, timestamp=_t(0))
    assert cloud.run_remote_diagnostic("acme", "site", now=_t(60))["reachable"] is True
    late = cloud.run_remote_diagnostic("acme", "site", now=_t(1000))
    assert late["reachable"] is False
    assert any("unreachable" in r.lower() for r in late["recommendations"])


def test_remote_diagnostic_unknown_site_errors(cloud):
    with pytest.raises(CloudError):
        cloud.run_remote_diagnostic("acme", "ghost", now=_t(1))


def test_diagnostics_scoped_per_company(cloud):
    cloud.report_diagnostics("acme", "a1", LIVE, timestamp=_t(0))
    cloud.report_diagnostics("acme", "a2", LIVE, timestamp=_t(0))
    assert len(cloud.list_diagnostics("acme", now=_t(1))) == 2
    assert len(cloud.list_diagnostics("globex", now=_t(1))) == 0
