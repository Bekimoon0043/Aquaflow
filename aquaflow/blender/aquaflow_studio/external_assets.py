"""Direct .blend effect/material loading; no AquaTiq/engon addon is required.

Third-party assets stay external and are never packed by AquaFlow. Users are responsible
for holding the appropriate asset license on each machine where the files are used.
"""

from __future__ import annotations

import math
from pathlib import Path
from zipfile import ZipFile

import bpy


EFFECTS = {
    "clear": "aq_Effect_Jet-vertical-1_A",
    "arch": "aq_Effect_Jet-vertical-1_A",
    "aerated": "aq_Effect_Jet-vertical-1_B",
    "fan": "aq_Effect_Spray-single-1_A",
    "crown": "aq_Effect_Spray-circular-1_A",
    "bell": "aq_Effect_Stream-downward-1_A",
    "cascade": "aq_Effect_Stream-downward-1_A",
    "mist": "aq_Effect_Mist-up-1_A",
}


def safe_extract_pack(source, destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if destination != target and destination not in target.parents:
                raise ValueError("Unsafe path in water asset pack: " + member.filename)
        archive.extractall(destination)
    return destination / "aquatiq_full"


def library_root(source, extract_directory=None):
    source = Path(source).expanduser()
    if source.is_dir():
        return source
    if source.suffix.lower() == ".paq" and source.is_file():
        if not extract_directory:
            raise ValueError("Choose a folder for extracting the .paq water assets")
        return safe_extract_pack(source, extract_directory)
    raise FileNotFoundError("Water asset source must be a folder or .paq pack: " + str(source))


def effect_path(root, asset_name):
    root = Path(root)
    candidates = [
        root / "blends" / "assets" / "effects" / f"{asset_name}.blend",
        root / "blends" / "models" / "effects" / f"{asset_name}.blend",
    ]
    return next((path for path in candidates if path.is_file()), None)


def material_path(root, material_name):
    root = Path(root)
    candidates = [
        root / "blends" / "materials" / "water" / f"{material_name}.blend",
        root / "blends" / "models" / "materials" / "water" / f"{material_name}.blend",
    ]
    return next((path for path in candidates if path.is_file()), None)


LINKED_COLLECTIONS = {}


def instance_collection(asset_path, asset_name, target):
    key = (str(asset_path), asset_name)
    if key not in LINKED_COLLECTIONS:
        with bpy.data.libraries.load(str(asset_path), link=True) as (data_from, data_to):
            if asset_name in data_from.collections:
                data_to.collections = [asset_name]
            elif data_from.collections:
                data_to.collections = [data_from.collections[0]]
            else:
                raise RuntimeError("Water effect has no collection: " + str(asset_path))
            collection_name = data_to.collections[0]
        LINKED_COLLECTIONS[key] = bpy.data.collections[collection_name]
    obj = bpy.data.objects.new("External water instance | " + asset_name, None)
    obj.instance_type = "COLLECTION"
    obj.instance_collection = LINKED_COLLECTIONS[key]
    target.objects.link(obj)
    obj["external_asset_source"] = str(asset_path)
    return obj


def linear_keys(obj):
    action = obj.animation_data.action if obj.animation_data else None
    if not action or not hasattr(action, "fcurves"):
        return
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "CONSTANT" if curve.data_path == "hide_render" else "LINEAR"


def spawn_effect(fixture, animation, root, target):
    asset_name = EFFECTS.get(fixture["family"])
    if not asset_name:
        return None
    path = effect_path(root, asset_name)
    if not path:
        return None
    obj = instance_collection(path, asset_name, target)
    obj.name = "External water | " + fixture["label"]
    obj.location = fixture["position"]
    obj.rotation_euler.z = -math.radians(fixture.get("rotation", 0.0))
    base = max(0.05, fixture["design_height_m"]) / 3.1314289569854736
    for key in animation[fixture["id"]]:
        level = key["level"]
        horizontal = base * (0.65 + 0.35 * math.sqrt(level))
        obj.scale = (horizontal, horizontal, base * math.sqrt(max(0.001, level)))
        obj.keyframe_insert("scale", frame=key["frame"])
        obj.hide_render = level <= 0.005
        obj.keyframe_insert("hide_render", frame=key["frame"])
    obj["aquaflow_proxy"] = True
    obj["external_water_asset"] = asset_name
    obj["aquaflow_fixture_id"] = fixture["id"]
    linear_keys(obj)
    return obj


def spawn_project_effects(project, animation, fixtures, source, target, extract_directory=None):
    root = library_root(source, extract_directory)
    spawned, missing = [], []
    for fixture in fixtures:
        obj = spawn_effect(fixture, animation, root, target)
        if obj:
            spawned.append(obj)
        elif fixture["family"] in EFFECTS:
            missing.append(f"{fixture['id']} ({EFFECTS[fixture['family']]})")
    return spawned, missing, root


def load_fountain_material(source, extract_directory=None):
    root = library_root(source, extract_directory)
    path = material_path(root, "aq_Water_Fountain")
    if not path:
        return None
    temporary = instance_collection(path, "aq_Water_Fountain", bpy.context.scene.collection)
    try:
        return temporary.instance_collection.objects[0].data.materials[0]
    finally:
        bpy.data.objects.remove(temporary, do_unlink=True)
