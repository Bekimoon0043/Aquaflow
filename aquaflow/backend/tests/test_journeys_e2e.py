"""
Cross-feature end-to-end journey tests (AQ-FIX-006 / AQ-FIX-007).

EVAL-AQ-001 flagged that every existing harness was authored beside the unit it
checks, so the *integration seams* between features (UI-shaped request → API route
→ engine → response, spanning more than one feature) were not guarded. These tests
drive the real FastAPI application through complete user journeys with the exact
payloads the panels send, so a break at any seam fails the suite.

Persistence-backed singletons (fleet / cloud / twin) are repointed at a tmp dir per
test so the journeys are isolated and deterministic.
"""
import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import main
import services.fleet_manager as fleet_mod
import services.asset_cloud as cloud_mod
import services.digital_twin as twin_mod

BASE = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)


def _t(sec):
    return (BASE + timedelta(seconds=sec)).isoformat()


LIVE = {"safety": {"state": "LIVE", "permit": True, "active_faults": [],
                   "inputs": {"plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 5000, "duration_ms": 10000}}
ESTOP = {"safety": {"state": "EMERGENCY_STOP", "permit": False, "active_faults": ["ESTOP_OPEN"],
                    "inputs": {"plc_heartbeat_ok": True}}}


@pytest.fixture
def client(tmp_path):
    # Isolate the persistence-backed singletons so journeys don't touch ~/.aquaflow.
    fleet_mod._fleet = fleet_mod.FleetManager(tmp_path / "fleet")
    cloud_mod._cloud = cloud_mod.AssetCloud(tmp_path / "cloud")
    twin_mod._twin = twin_mod.DigitalTwin(tmp_path / "twin")
    yield TestClient(main.app)
    fleet_mod._fleet = None
    cloud_mod._cloud = None
    twin_mod._twin = None


# ── Journey A — design brief → engineering + construction deliverables ─────────
# Spans: generative designer → concept→design projection → engineering packager
# (CAD/BOM/P&ID/hydraulics) and the construction packager.

def test_journey_brief_to_deliverable_packages(client):
    r = client.post("/api/generative/concepts",
                    json={"brief": {"area_m2": 300, "budget_usd": 400000, "style": "grand",
                                    "theme": "Desert Dawn"}, "count": 3})
    assert r.status_code == 200
    concepts = r.json()["concepts"]
    assert len(concepts) == 3
    concept = concepts[0]

    eng = client.post("/api/generative/engineering-package", json={"concept": concept})
    assert eng.status_code == 200
    assert eng.headers["content-type"] == "application/zip"
    assert eng.headers.get("x-package-complete") == "true"
    assert eng.content[:2] == b"PK"                       # a real ZIP
    names = set(zipfile.ZipFile(io.BytesIO(eng.content)).namelist())
    assert {"layout.dxf", "bill_of_materials.xlsx", "pid.svg", "manifest.json"} <= names

    con = client.post("/api/generative/construction-package", json={"concept": concept})
    assert con.status_code == 200
    assert con.headers.get("x-package-complete") == "true"
    cnames = set(zipfile.ZipFile(io.BytesIO(con.content)).namelist())
    assert {"civil_works.json", "electrical_load.json", "construction_cover.pdf"} <= cnames


# ── Journey B — fleet incident: register → E-stop → dashboard → alert → ack ────
# Spans: fleet manager ← mobile_monitor health/alert derivation, centralised feed.

def test_journey_fleet_incident_and_ack(client):
    assert client.post("/api/fleet/sites", json={"id": "marina", "name": "Marina Bay"}).status_code == 200
    rep = client.post("/api/fleet/sites/marina/status", json={"status": ESTOP})
    assert rep.status_code == 200 and rep.json()["health"] == "estop"

    dash = client.get("/api/fleet/dashboard").json()
    assert dash["critical_alerts"] >= 1
    assert dash["health"]["estop"] >= 1

    alerts = client.get("/api/fleet/alerts").json()["alerts"]
    estop = next(a for a in alerts if a["site_id"] == "marina" and a["code"] == "ESTOP")
    assert estop["acknowledged"] is False

    assert client.post("/api/fleet/alerts/ack",
                       json={"site_id": "marina", "code": "ESTOP"}).status_code == 200
    after = client.get("/api/fleet/alerts").json()["alerts"]
    estop2 = next(a for a in after if a["site_id"] == "marina" and a["code"] == "ESTOP")
    assert estop2["acknowledged"] is True


# ── Journey C — digital twin: register → ingest → mirror → forecast ───────────

def test_journey_twin_ingest_to_forecast(client):
    assert client.post("/api/twin/assets",
                       json={"id": "pump-1", "type": "pump",
                             "service_interval_hours": 2000}).status_code == 200
    ing = client.post("/api/twin/ingest",
                      json={"asset_id": "pump-1",
                            "telemetry": {"running": True, "runtime_hours": 1800,
                                          "temperature_c": 62, "pressure_bar": 5},
                            "timestamp": _t(0)})
    assert ing.status_code == 200

    mirror = client.get("/api/twin/mirror").json()
    assert any(a.get("id") == "pump-1" or a.get("asset_id") == "pump-1"
               for a in (mirror if isinstance(mirror, list) else mirror.get("assets", [])))

    fc = client.get("/api/twin/assets/pump-1/forecast")
    assert fc.status_code == 200
    assert isinstance(fc.json(), dict)


# ── Journey D — cloud: company → backup → restore → remote diagnostics ────────

def test_journey_cloud_backup_and_diagnostics(client):
    assert client.post("/api/cloud/companies",
                       json={"id": "acme", "name": "ACME Fountains"}).status_code == 200
    b = client.post("/api/cloud/companies/acme/backups",
                    json={"asset_id": "dubai-show", "label": "nightly",
                          "data": {"tempo": 128, "jets": [1, 2, 3]}})
    assert b.status_code == 200
    backup_id = b.json()["backup_id"]
    assert b.json()["version"] == 1 and len(b.json()["checksum"]) == 64

    restored = client.get(f"/api/cloud/companies/acme/backups/{backup_id}")
    assert restored.status_code == 200
    assert restored.json()["verified"] is True
    assert restored.json()["data"] == {"tempo": 128, "jets": [1, 2, 3]}

    assert client.post("/api/cloud/companies/acme/diagnostics",
                       json={"site_id": "dubai-mall", "site_name": "Dubai Mall",
                             "status": LIVE}).status_code == 200
    diag = client.get("/api/cloud/companies/acme/diagnostics/dubai-mall")
    assert diag.status_code == 200
    assert diag.json()["health"] == "live"
    assert diag.json()["recommendations"]


# ── Journey E — cross-tenant isolation seam (cloud) ───────────────────────────
# A backup made under one company must never be restorable under another via the API.

def test_journey_cloud_tenant_isolation(client):
    client.post("/api/cloud/companies", json={"id": "acme", "name": "ACME"})
    client.post("/api/cloud/companies", json={"id": "globex", "name": "Globex"})
    b = client.post("/api/cloud/companies/acme/backups",
                    json={"asset_id": "show", "data": {"who": "acme"}}).json()
    # same backup id under the wrong tenant → 404 (not a data leak)
    assert client.get(f"/api/cloud/companies/globex/backups/{b['backup_id']}").status_code == 404
