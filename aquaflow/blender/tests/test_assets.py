import math

import pytest

from aquaflow_studio.assets import MATERIAL_LIBRARY, native_outlets
from aquaflow_studio.core import normalize_project


def test_multi_outlets_share_total_area_and_flow():
    fixture = {"family": "crown", "direction": (0, 0, 1), "raw": {"engineering": {"outletCount": 24}}}
    outlets = native_outlets(fixture)
    assert len(outlets) == 24
    assert sum(outlet["radius_scale"] ** 2 for outlet in outlets) == pytest.approx(1.0)
    assert sum(outlet["direction"][2] > 0 for outlet in outlets) == 24


def test_rotating_basket_has_three_shared_outlets():
    fixture = {"family": "rotating", "direction": (0, 0, 1), "raw": {"engineering": {"outletCount": 3, "rotationRpm": 30, "sprayAngleDeg": 16}}}
    outlets = native_outlets(fixture)
    assert len(outlets) == 3
    assert sum(outlet["radius_scale"] ** 2 for outlet in outlets) == pytest.approx(1.0)
    assert all(outlet["direction"][2] > 0.95 for outlet in outlets)


def test_component_materials_are_distinct_physical_presets():
    assert MATERIAL_LIBRARY["stainless_316l"]["metallic"] == 1.0
    assert MATERIAL_LIBRARY["brass"]["color"] != MATERIAL_LIBRARY["bronze"]["color"]
    assert MATERIAL_LIBRARY["glass"]["ior"] == 1.5
    assert MATERIAL_LIBRARY["epdm"]["roughness"] > MATERIAL_LIBRARY["pvc"]["roughness"]


def test_manual_pipes_are_normalized_with_component_assets():
    project = normalize_project({
        "engineering": {
            "params": {"width": 8, "length": 8},
            "fixtures": [{"id": "jet", "type": "nozzle_straight_dn25", "x": 0, "y": 0}],
            "manualPipes": [{"id": "supply", "points": [{"x": 0, "y": 0}, {"x": 4, "y": 0}], "diameterMm": 65, "material": "hdpe"}],
        }
    })
    assert project["pipes"][0]["diameter_m"] == 0.065
    assert project["pipes"][0]["points"][1] == (0.0, 4.0, -0.2)
    assert project["pipes"][0]["material"] == "hdpe"
