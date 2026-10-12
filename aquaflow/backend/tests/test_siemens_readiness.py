import asyncio
import io
import json
import zipfile

import pytest

from engine.siemens_site import SiteStore, create_1212c_starter, create_tia_plcsim_large_io_test
from engine.siemens_runtime import SiemensRuntime
from services.siemens_readiness import commissioning_readiness
from services.siemens_tia_package import build_tia_package
from engine.siemens_hardware import supported_s7_1200_identifier


@pytest.mark.parametrize("identifier", [
    "OrderNumber:6ES7 212-1AE50-0XB0/V1.0",
    "OrderNumber:6ES7 212-1AF40-0XB0/V4.5",
    "OrderNumber:6ES7 212-invented", "OrderNumber:6ES7 212-1AE40-0XB0",
    "OrderNumber:6ES7 212-1AE40-0XB0/V99.0",
])
def test_catalog_gate_does_not_treat_every_21x_cpu_as_supported(identifier):
    assert not supported_s7_1200_identifier(identifier)
    assert supported_s7_1200_identifier("OrderNumber:6ES7 212-1AE40-0XB0/V4.4")


def test_1212c_starter_is_a_simulation_not_a_commissioned_cabinet():
    site = create_1212c_starter()
    assert site["mode"] == "simulated" and not site["plc"]["ip"]
    assert not site["tia"]["cpu_type_identifier"]
    assert all(not c["commissioned"] for c in site["channels"])
    assert site["show"]["duration"] == 20
    assert site["channels"][0]["output"] == "%QW64"
    assert list(site["inputs"].values()) == [f"%I0.{i}" for i in range(5)]
    report = commissioning_readiness(site)
    assert report["status"] == "BLOCKED"
    assert any(c["code"] == "1212c_analog" and "no integrated analog output" in c["detail"] for c in report["checks"])
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as package:
        assert json.loads(package.read("commissioning-readiness.json")) == report


@pytest.mark.parametrize("change", ["mode", "address", "ip", "limit"])
def test_target_changes_remove_old_commissioning_approval(tmp_path, change):
    store = SiteStore(tmp_path / "sites.json")
    site = store.save(create_tia_plcsim_large_io_test())
    assert all(c["commissioned"] for c in site["channels"])
    if change == "mode":
        site.update(mode="physical")
        site["plc"]["ip"] = "192.0.2.10"
    elif change == "address":
        site["channels"][0]["output"] = "%QW80"
    elif change == "limit":
        site["channels"][0]["max_percent"] = 30
    else:
        site["plc"]["ip"] = "192.0.2.11"
    updated = store.save(site, site["revision"])
    assert all(not c["commissioned"] for c in updated["channels"])
    assert all(c["observation"] for c in updated["channels"])
    assert updated["show"] is None


def test_label_only_edit_retains_observations(tmp_path):
    store = SiteStore(tmp_path / "sites.json")
    site = store.save(create_tia_plcsim_large_io_test())
    site["channels"][0]["name"] = "West pump"
    assert all(c["commissioned"] for c in store.save(site, 1)["channels"])


@pytest.mark.parametrize("kind,field", [("valve", "fault_input"), ("light", "fault_input"), ("light", "feedback_input")])
def test_ignored_inputs_block_package_and_physical_arm(tmp_path, kind, field):
    site = create_tia_plcsim_large_io_test()
    next(c for c in site["channels"] if c["kind"] == kind)[field] = "%I1.0"
    report = commissioning_readiness(site)
    assert next(c for c in report["checks"] if c["code"] == "input_support")["state"] == "blocked"
    with pytest.raises(ValueError, match="unsupported"):
        build_tia_package(site)
    site["mode"] = "physical"
    site["plc"]["ip"] = "192.0.2.10"
    store = SiteStore(tmp_path / "sites.json")
    site = store.save(site)
    runtime = SiemensRuntime(store)
    runtime.states[site["id"]] = {"verified": True, "verified_revision": 1}
    with pytest.raises(ValueError, match="unsupported"):
        asyncio.run(runtime.arm(site["id"], True))
    assert not runtime.clients  # fail before creating a transport or writing


def test_readiness_never_claims_hardware_acceptance():
    site = create_1212c_starter()
    site["mode"] = "physical"
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 212-1AE40-0XB0/V4.4"
    for c in site["channels"]:
        c.update(commissioned=True, observation="Operator observed response")
    assert commissioning_readiness(site)["status"] == "HARDWARE_VALIDATION_REQUIRED"
    # S7-1500 is a generator target since 1.2.28; an S7-1200 G2 still blocks.
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 511-1AK02-0AB0/V2.9"
    assert commissioning_readiness(site)["status"] == "HARDWARE_VALIDATION_REQUIRED"
    site["tia"]["cpu_type_identifier"] = "OrderNumber:6ES7 212-1AG50-0XB0/V4.1"
    assert commissioning_readiness(site)["status"] == "BLOCKED"


def test_plcsim_network_readiness_does_not_require_physical_observations():
    site = create_1212c_starter()
    site["mode"] = "plcsim"
    site["plc"]["ip"] = "192.168.43.41"
    report = commissioning_readiness(site)
    observation = next(c for c in report["checks"] if c["code"] == "observations")
    assert observation["state"] == "passed"
    assert "do not commission real equipment" in observation["detail"]


def test_readiness_api_creates_starter_and_does_not_contact_plc(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routes import siemens_sites
    store = SiteStore(tmp_path / "sites.json")
    monkeypatch.setattr(siemens_sites, "store", store)
    app = FastAPI()
    app.include_router(siemens_sites.router, prefix="/sites")
    with TestClient(app) as client:
        response = client.post("/sites/1212c-starter", json={"name": "My 1212C", "tia_version": 17})
        assert response.status_code == 200
        site = response.json()
        before = store.path.read_bytes()
        result = client.get(f"/sites/{site['id']}/readiness")
        assert result.status_code == 200 and result.json()["status"] == "BLOCKED"
        assert store.path.read_bytes() == before
        assert client.get("/sites/absent/readiness").status_code == 404
