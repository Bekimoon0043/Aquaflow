"""Clearly labeled laser and flame visualization proxies."""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from .materials import input_named


def wavelength_to_rgb(wavelength_nm):
    wavelength = int(wavelength_nm)
    if wavelength < 470:
        return (0.08, 0.25, 1.0)
    if wavelength < 510:
        return (0.0, 0.65, 1.0)
    if wavelength < 540:
        return (0.05, 1.0, 0.18)
    if wavelength < 580:
        return (0.85, 1.0, 0.05)
    if wavelength < 610:
        return (1.0, 0.55, 0.02)
    return (1.0, 0.03, 0.01)


def laser_rgb(fixture):
    wavelengths = (fixture.get("raw", {}).get("engineering") or {}).get("wavelengthNm")
    if isinstance(wavelengths, (list, tuple)) and wavelengths:
        colors = [wavelength_to_rgb(value) for value in wavelengths]
        return tuple(sum(color[index] for color in colors) / len(colors) for index in range(3))
    return (0.1, 0.4, 1.0)


def animate_emission(material, keys, socket, strength):
    shader = material.node_tree.nodes.get("Principled BSDF")
    if not shader:
        return
    for key in keys:
        input_named(shader, [socket], strength * key["level"])
        shader.id_data.keyframe_insert(f"nodes[\"Principled BSDF\"].inputs[\"{socket}\"].default_value", frame=key["frame"])


def create_laser(fixture, animation, target):
    eng = fixture["raw"].get("engineering") or {}
    color = laser_rgb(fixture)
    origin = Vector(fixture["position"]) + Vector((0, 0, 0.2))
    direction = Vector((0, 0, 1))
    length = 12.0
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.025, radius2=0.22, depth=length, location=origin + direction * (length / 2))
    obj = bpy.context.object
    obj.name = "AF Laser beam | " + fixture["label"]
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    target.objects.link(obj)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    material = bpy.data.materials.new("AF Laser volume | " + fixture["label"])
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (*color, 1.0)
    volume.inputs["Density"].default_value = max(0.001, float(eng.get("hazeDensity", 0.03)))
    volume.inputs["Anisotropy"].default_value = 0.5
    volume.inputs["Emission Color"].default_value = (*color, 1.0)
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    obj.data.materials.append(material)
    obj["aquaflow_proxy"] = True
    obj["aquaflow_effect"] = "laser"
    obj["aquaflow_fixture_id"] = fixture["id"]
    for key in animation:
        volume.inputs["Emission Strength"].default_value = 2.0 * key["level"]
        volume.inputs["Emission Strength"].keyframe_insert("default_value", frame=key["frame"])
    light = bpy.data.lights.new("AF Laser source | " + fixture["label"], "SPOT")
    light.color = color
    light.spot_size = math.radians(max(1.0, float(eng.get("scanAngleDeg", 8))))
    light.spot_blend = 0.05
    light.shadow_soft_size = 0.01
    source = bpy.data.objects.new(light.name, light)
    target.objects.link(source)
    source.location = origin
    source.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    for key in animation:
        light.energy = float(eng.get("opticalPowerW", 5.0)) * key["level"]
        light.keyframe_insert("energy", frame=key["frame"])


def flame_material(label):
    material = bpy.data.materials.new("AF Flame | " + label)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get("Principled BSDF")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    noise.inputs["Detail"].default_value = 2.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.15
    ramp.color_ramp.elements[0].color = (0.6, 0.01, 0.0, 1.0)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (1.0, 0.75, 0.05, 1.0)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Emission Color"] if "Emission Color" in shader.inputs else shader.inputs["Emission"])
    input_named(shader, ["Base Color"], (0.2, 0.01, 0.0, 1.0))
    input_named(shader, ["Roughness"], 0.65)
    return material


def create_flame(fixture, keys, target, materials):
    eng = fixture["raw"].get("engineering") or {}
    height = max(0.2, float(eng.get("heightM", 1.5)))
    center = Vector(fixture["position"]) + Vector((0, 0, height / 2))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1.0, location=center)
    obj = bpy.context.object
    obj.name = "AF Flame body | " + fixture["label"]
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    target.objects.link(obj)
    obj.scale = (0.28, 0.28, height / 2)
    material = flame_material(fixture["label"])
    obj.data.materials.append(material)
    obj["aquaflow_proxy"] = True
    obj["aquaflow_effect"] = "flame"
    obj["aquaflow_fixture_id"] = fixture["id"]
    for key in keys:
        level = max(0.001, key["level"])
        obj.scale = (0.28 * level, 0.28 * level, height / 2 * level)
        obj.keyframe_insert("scale", frame=key["frame"])
    animate_emission(material, keys, "Emission Strength", 5.0)
    light = bpy.data.lights.new("AF Flame heat light | " + fixture["label"], "POINT")
    light.color = (1.0, 0.22, 0.025)
    light.shadow_soft_size = 0.25
    source = bpy.data.objects.new(light.name, light)
    target.objects.link(source)
    source.location = center
    for key in keys:
        light.energy = float(eng.get("heatLightW", 300.0)) * key["level"]
        light.keyframe_insert("energy", frame=key["frame"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1.0, location=center + Vector((0.1, 0, height * 0.75)))
    smoke = bpy.context.object
    smoke.name = "AF Flame smoke | " + fixture["label"]
    for collection in list(smoke.users_collection):
        collection.objects.unlink(smoke)
    target.objects.link(smoke)
    smoke.scale = (0.45, 0.45, height * 0.65)
    smoke.data.materials.append(materials["mist"])
    smoke["aquaflow_proxy"] = True
    smoke["aquaflow_effect"] = "smoke"
    for key in keys:
        smoke.hide_render = key["level"] <= 0.005
        smoke.keyframe_insert("hide_render", frame=key["frame"])


def create_special_effects(project, animation, target, materials):
    for fixture in project["fixtures"]:
        if fixture["category"] != "effect":
            continue
        kind = fixture["type"].lower()
        if "laser" in kind:
            create_laser(fixture, animation[fixture["id"]], target)
        elif "flame" in kind or "fire" in kind:
            create_flame(fixture, animation[fixture["id"]], target, materials)
