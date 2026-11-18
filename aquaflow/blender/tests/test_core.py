import math

import pytest

from aquaflow_studio.core import normalize_project, nozzle_hydraulics, simulation_plan


def document():
    return {
        "aquaflow": "1.1",
        "show": {"name": "Test", "duration": 4},
        "engineering": {
            "pool_type": "freeform",
            "params": {"depth": 0.8},
            "geometry": {"type": "polygon", "points": [
                {"x": 10, "y": 20}, {"x": 14, "y": 20}, {"x": 14, "y": 24}, {"x": 10, "y": 24},
            ]},
            "fixtures": [
                {"id": "jet", "type": "nozzle_straight_dn25", "x": 10, "y": 20, "groupId": "jets",
                 "engineering": {"flowLpm": 44, "nozzleDiaMm": 11, "jetHeightM": 2.8}},
                {"id": "light", "type": "light_uw_rgbw_36w", "x": 12, "y": 22, "color": "#0080ff",
                 "engineering": {"lumens": 3000, "wattage": 36}},
            ],
        },
        "render": {"exportFps": 30, "cameraViews": [{"id": "audience", "position": {"x": 0, "y": 3, "z": -8}, "target": {"x": 0, "y": 1, "z": 0}}]},
    }


def test_coordinate_contract_and_saved_camera():
    project = normalize_project(document())
    assert project["center"] == (12.0, 22.0)
    assert project["fixtures"][0]["position"] == (-2.0, 2.0, 0.0)
    assert project["pool"]["points"][0] == (-2.0, 2.0)
    assert project["cameras"][0]["position"] == (0.0, 8.0, 3.0)
    assert project["cameras"][0]["target"] == (0.0, 0.0, 1.0)


def test_nozzle_flow_and_area_drive_native_velocity():
    nozzle = nozzle_hydraulics(document()["engineering"]["fixtures"][0])
    assert nozzle["velocity_source"] == "flow_lpm/nozzle_area"
    expected_velocity = (44 / 60000) / (math.pi * (0.011 / 2) ** 2)
    assert nozzle["velocity_mps"] == pytest.approx(expected_velocity)
    assert nozzle["ideal_height_m"] == pytest.approx(expected_velocity ** 2 / (2 * 9.80665))


def test_lumens_become_radiant_power_not_electrical_watts():
    project = normalize_project(document())
    light = project["fixtures"][1]
    assert light["radiant_watts"] == pytest.approx(10.0)
    assert light["power_source"].startswith("lumens/")


def test_hero_domain_is_local_and_resolution_warning_is_explicit():
    project = normalize_project(document())
    hero = simulation_plan(project, "HERO", "jet", 64)
    site = simulation_plan(project, "SITE", resolution=64)
    assert hero["nozzles"][0]["id"] == "jet"
    assert hero["size"][0] < site["size"][0]
    assert "four cells" in site["warnings"][0]


def test_missing_fixtures_is_an_actionable_error():
    with pytest.raises(ValueError, match="no engineering fixtures"):
        normalize_project({"aquaflow": "1.1", "engineering": {}})
