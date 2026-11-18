"""Self-contained animated fountain-water sprites and materials."""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

from .assets import native_outlets
from .materials import input_named
from .procedural_textures import generate_jet_sequence

MATERIALS = {}


def sequence_node(nodes, directory, variant, kind, location):
    path = Path(directory) / f"{variant}_{kind}_0001.png"
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(path), check_existing=True)
    node.image.source = "SEQUENCE"
    node.image_user.frame_duration = 30
    node.image_user.frame_start = 1
    node.image_user.frame_offset = 0
    node.image_user.use_cyclic = True
    node.image_user.use_auto_refresh = True
    node.location = location
    return node


def animated_material(directory, variant):
    directory = generate_jet_sequence(Path(directory), variant)
    key = (str(directory), variant)
    if key in MATERIALS:
        return MATERIALS[key]
    material = bpy.data.materials.new("AF Original | Animated " + variant + " water")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    mask = sequence_node(nodes, directory, variant, "mask", (-700, 200))
    normal = sequence_node(nodes, directory, variant, "normal", (-700, -180))
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.65
    normal_map.location = (-430, -150)
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (-120, 120)
    input_named(shader, ["Base Color"], (0.82, 0.92, 1.0, 1.0) if variant == "aerated" else (0.70, 0.86, 1.0, 1.0))
    input_named(shader, ["Roughness"], 0.28 if variant == "aerated" else 0.18)
    input_named(shader, ["IOR"], 1.333)
    input_named(shader, ["Transmission Weight", "Transmission"], 0.04 if variant == "aerated" else 0.12)
    links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    transparent.location = (-110, 390)
    mix = nodes.new("ShaderNodeMixShader")
    mix.location = (180, 160)
    links.new(mask.outputs["Color"], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(shader.outputs[0], mix.inputs[2])
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (410, 160)
    links.new(mix.outputs[0], output.inputs["Surface"])
    if hasattr(material, "use_screen_refraction"):
        material.use_screen_refraction = True
    MATERIALS[key] = material
    return material


def plane_object(name, root, material, rotation=0.0):
    vertices = [(-0.5, 0, 0), (0.5, 0, 0), (0.5, 0, 1), (-0.5, 0, 1)]
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], [(0, 1, 2, 3)])
    mesh.update()
    uv = mesh.uv_layers.new(name="Water UV")
    for index, coordinate in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[index].uv = coordinate
    obj = bpy.data.objects.new(name, mesh)
    root.users_collection[0].objects.link(obj)
    obj.parent = root
    obj.rotation_euler.z = rotation
    mesh.materials.append(material)
    return obj


def linear_keys(obj):
    action = obj.animation_data.action if obj.animation_data else None
    if not action or not hasattr(action, "fcurves"):
        return
    for curve in action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "CONSTANT" if curve.data_path == "hide_render" else "LINEAR"


def spawn_procedural_jets(fixture, animation, target, asset_directory):
    outlets = native_outlets(fixture) if fixture["family"] in {"fan", "crown", "rotating"} else [None]
    material = animated_material(asset_directory, "aerated" if fixture["aerated"] else "clear")
    result = []
    for index, outlet in enumerate(outlets):
        outlet = outlet or {"direction": fixture["direction"], "offset": (0, 0, 0), "radius_scale": 1.0}
        root = bpy.data.objects.new("AF Original water | " + fixture["label"] + (f" · {index + 1}" if len(outlets) > 1 else ""), None)
        target.objects.link(root)
        root.location = Vector(fixture["position"]) + Vector(outlet["offset"]) + Vector((0, 0, 0.145))
        base_rotation = Vector(outlet["direction"]).to_track_quat("Z", "Y")
        root.rotation_euler = base_rotation.to_euler()
        plane_object("Water sheet A", root, material)
        plane_object("Water sheet B", root, material, math.pi / 2)
        height = fixture["design_height_m"] * outlet["radius_scale"]
        width = max(0.16, height * (0.42 if fixture["aerated"] else 0.28))
        rpm = float((fixture["raw"].get("engineering") or {}).get("rotationRpm", 30.0))
        for key in animation[fixture["id"]]:
            level = key["level"]
            horizontal = width * (0.7 + 0.3 * math.sqrt(level))
            root.scale = (horizontal, horizontal, max(0.001, height * math.sqrt(level)))
            root.keyframe_insert("scale", frame=key["frame"])
            root.hide_render = level <= 0.005
            root.keyframe_insert("hide_render", frame=key["frame"])
            if fixture["family"] == "rotating":
                root.rotation_euler = (base_rotation @ Quaternion((0, 0, 1), math.tau * rpm * key["time"] / 60.0)).to_euler()
                root.keyframe_insert("rotation_euler", frame=key["frame"])
        root["aquaflow_proxy"] = True
        root["procedural_water"] = True
        root["aquaflow_fixture_id"] = fixture["id"]
        linear_keys(root)
        result.append(root)
    return result
