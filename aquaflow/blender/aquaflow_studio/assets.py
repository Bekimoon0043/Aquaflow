"""Fountain component material and behavior catalog.

Values are generic visualization presets, not manufacturer-certified product models.
Product-specific engineering fields always take precedence over these defaults.
"""

from __future__ import annotations

import math

from .core import clamp

MATERIAL_LIBRARY = {
    "stainless_316l": {"label": "316L stainless · wet", "color": "#b8c0c5", "metallic": 1.0, "roughness": 0.22, "anisotropy": 0.35},
    "brass": {"label": "Machined brass", "color": "#b08d57", "metallic": 1.0, "roughness": 0.28, "anisotropy": 0.2},
    "bronze": {"label": "Bronze · aged wet", "color": "#806443", "metallic": 1.0, "roughness": 0.34, "anisotropy": 0.15},
    "pvc": {"label": "PVC pressure pipe", "color": "#353c43", "metallic": 0.0, "roughness": 0.46},
    "hdpe": {"label": "HDPE pressure pipe", "color": "#171b20", "metallic": 0.0, "roughness": 0.52},
    "epdm": {"label": "EPDM seals", "color": "#111315", "metallic": 0.0, "roughness": 0.76},
    "glass": {"label": "Luminaire glass", "color": "#edf6ff", "metallic": 0.0, "roughness": 0.06, "ior": 1.5, "transmission": 0.9},
    "cast_equipment": {"label": "Painted cast pump equipment", "color": "#243b4a", "metallic": 0.55, "roughness": 0.4},
    "wet_tile": {"label": "Wet pool tile", "color": "#183b4b", "metallic": 0.0, "roughness": 0.24},
    "concrete": {"label": "Cast concrete", "color": "#777a76", "metallic": 0.0, "roughness": 0.84},
}

NOZZLE_BEHAVIOR = {
    "clear": {"outlets": 1, "coherent": True, "air_entrained": False, "waterline_dependent": False},
    "arch": {"outlets": 1, "coherent": True, "air_entrained": False, "waterline_dependent": False},
    "aerated": {"outlets": 1, "coherent": False, "air_entrained": True, "waterline_dependent": True, "non_return_valve_recommended": True},
    "fan": {"outlets": 5, "coherent": True, "air_entrained": False, "shared_flow": True},
    "crown": {"outlets": 8, "coherent": True, "air_entrained": False, "shared_flow": True},
    "rotating": {"outlets": 3, "coherent": True, "air_entrained": False, "shared_flow": True, "default_rpm": 30},
    "bell": {"outlets": 12, "coherent": False, "air_entrained": False, "thin_film": True, "shared_flow": True},
    "cascade": {"outlets": 1, "coherent": False, "air_entrained": False, "thin_film": True, "waterline_dependent": True},
    "mist": {"outlets": 1, "coherent": False, "air_entrained": True, "bulk_liquid_solver": False},
}

EQUIPMENT_BEHAVIOR = {
    "pump": {"flow_law": "Q∝N", "head_law": "H∝N²", "power_law": "P∝N³", "default_tau_s": 1.5},
    "valve": {"default_solenoid_stroke_s": 0.3, "default_motorised_stroke_s": 6.0},
    "pipe": {"model": "volume fill/drain and head-loss metadata", "material": "pvc"},
    "filter": {"model": "additional minor loss; requires maintenance/cleaning metadata"},
    "light": {"model": "radiant power, beam distribution, visible lens emission and water scattering"},
    "tank": {"model": "stored pressure/water volume; no continuous default emission"},
}


def material_key(fixture):
    eng = (fixture.get("raw") or {}).get("engineering") or {}
    requested = str(eng.get("material") or "").lower().replace("-", "_").replace(" ", "_")
    aliases = {"ss316": "stainless_316l", "316l": "stainless_316l", "316": "stainless_316l",
               "stainless": "stainless_316l", "stainless_steel": "stainless_316l", "plastic": "pvc"}
    return aliases.get(requested, requested if requested in MATERIAL_LIBRARY else "stainless_316l")


def native_outlets(fixture):
    """Return representative outlets with shared area/flow for native inflows."""
    family = fixture["family"]
    count = NOZZLE_BEHAVIOR.get(family, NOZZLE_BEHAVIOR["clear"])["outlets"]
    eng = (fixture.get("raw") or {}).get("engineering") or {}
    if family in {"crown", "rotating"}:
        count = int(clamp(eng.get("outletCount"), 3, 24)) if eng.get("outletCount") else count
    base = fixture["direction"]
    azimuth = math.atan2(base[1], base[0])
    elevation = math.asin(base[2])
    outlets = []
    for index in range(count):
        if family == "fan":
            angle = azimuth + (index - (count - 1) / 2) * math.radians(18)
            vertical = max(math.radians(35), elevation)
            offset = ((index - (count - 1) / 2) * 0.055, 0.0, 0.0)
        elif family == "rotating":
            angle = azimuth + index * math.tau / count
            vertical = math.radians(90.0 - clamp(eng.get("sprayAngleDeg"), 0.0, 75.0) if eng.get("sprayAngleDeg") else 74.0)
            offset = (0.075 * math.cos(angle), 0.075 * math.sin(angle), 0.0)
        elif family in {"crown", "bell"}:
            angle = azimuth + index * math.tau / count
            vertical = math.radians(58 if family == "crown" else 68)
            head_radius = 0.075 if family == "crown" else 0.035
            offset = (head_radius * math.cos(angle), head_radius * math.sin(angle), 0.0)
        else:
            angle, vertical, offset = azimuth, elevation, (0.0, 0.0, 0.0)
        direction = (math.cos(angle) * math.cos(vertical), math.sin(angle) * math.cos(vertical), math.sin(vertical))
        outlets.append({"direction": direction, "offset": offset, "radius_scale": 1.0 / math.sqrt(count)})
    return outlets
