"""Original generated GLB equipment, with procedural assets as fallback."""

from __future__ import annotations

from pathlib import Path

import bpy

from .asset_factory import move_to, root_object
from .dynamics import equipment_kind


def generated_file(fixture):
    kind = fixture["type"].lower()
    if fixture["category"] == "water":
        if "pirouette" in kind or fixture["family"] == "rotating":
            return "nozzle_b_3outlet.glb", "NozzleSocket"
        if "motion" in kind or any(axis in kind for axis in ("1d", "2d", "3d")):
            return "motion_2d_nozzle.glb", "NozzleSocket"
        if fixture["family"] == "aerated":
            return "nozzle_aerated_dn40.glb", "NozzleSocket"
        if fixture["family"] == "fan":
            return "nozzle_fan_dn25.glb", "NozzleSocket"
        if fixture["family"] == "laminar":
            return "nozzle_laminar_dn25.glb", "NozzleSocket"
        return "nozzle_straight_dn25.glb", "NozzleSocket"
    if fixture["category"] == "light":
        return "light_rgb_uw.glb", "LightSocket"
    if fixture["category"] == "effect":
        if "laser" in kind:
            return "laser_projector.glb", "LaserSocket"
        if "flame" in kind or "fire" in kind:
            return "flame_burner.glb", "FlameSocket"
    equipment = equipment_kind(fixture)
    if equipment == "pump":
        return "pump_centrifugal.glb", None
    if equipment == "valve":
        return "valve_solenoid_dn25.glb", None
    if "manifold" in kind or "distributor" in kind:
        return "manifold_4way.glb", None
    return None, None


def create_generated_asset(fixture, collection):
    filename, socket_name = generated_file(fixture)
    if not filename:
        return None
    path = Path(__file__).resolve().parent / "glb" / filename
    if not path.is_file():
        return None
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except Exception as error:
        print(f"AquaFlow generated asset failed ({filename}): {error}; using procedural geometry")
        return None
    imported = set(bpy.data.objects) - before
    root = root_object("AF GLB assembly | " + fixture["label"], fixture, collection)
    root["aquaflow_generated_asset"] = filename
    for obj in imported:
        move_to(obj, collection)
        if obj.parent is None:
            obj.parent = root
    socket = next((obj for obj in imported if obj.name == socket_name), None)
    if socket and fixture["category"] == "water":
        root.location.z += 0.145 - socket.location.z
    elif socket and fixture["category"] == "light":
        root.location.z += 0.075 - socket.location.z
    if fixture["category"] == "light":
        for obj in imported:
            if obj.type == "MESH" and any(material and material.name.startswith("Lens_RGB") for material in obj.data.materials):
                obj["aquaflow_lens"] = True
                obj["aquaflow_fixture_id"] = fixture["id"]
    return root
