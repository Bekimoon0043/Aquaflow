"""Reusable, editable Blender fountain-component assets."""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from .assets import MATERIAL_LIBRARY, material_key
from .dynamics import equipment_kind
from .materials import input_named, principled_material


def move_to(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def root_object(name, fixture, collection):
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.15
    root.location = fixture["position"]
    root.rotation_euler.z = -math.radians(fixture.get("rotation", 0.0))
    root["aquaflow_fixture_id"] = fixture["id"]
    root["aquaflow_fixture_type"] = fixture["type"]
    root["aquaflow_component_kind"] = equipment_kind(fixture)
    return root


def finish(obj, name, parent, material, location=(0, 0, 0), direction=None):
    obj.name = name
    move_to(obj, parent.users_collection[0])
    obj.parent = parent
    obj.location = location
    if direction:
        obj.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
    if material:
        obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def cylinder(name, parent, material, radius, depth, location, direction=None, vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    return finish(bpy.context.object, name, parent, material, location, direction)


def box(name, parent, material, dimensions, location):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.object
    obj.dimensions = dimensions
    return finish(obj, name, parent, material, location)


def torus(name, parent, material, major_radius, minor_radius, location, direction=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8, major_radius=major_radius, minor_radius=minor_radius)
    return finish(bpy.context.object, name, parent, material, location, direction)


def component_materials():
    result = {}
    for key, spec in MATERIAL_LIBRARY.items():
        from .core import hex_color
        color = hex_color(spec["color"])["srgb"]
        material, shader = principled_material("AF Asset | " + spec["label"], color, spec["roughness"], spec["metallic"])
        if spec.get("anisotropy"):
            input_named(shader, ["Anisotropic", "Anisotropic IOR Level"], spec["anisotropy"])
        if spec.get("ior"):
            input_named(shader, ["IOR"], spec["ior"])
        if spec.get("transmission"):
            input_named(shader, ["Transmission Weight", "Transmission"], spec["transmission"])
        result[key] = material
    return result


def nozzle_asset(fixture, collection, materials):
    root = root_object("AF Nozzle assembly | " + fixture["label"], fixture, collection)
    metal = materials[material_key(fixture)]
    radius = max(0.025, fixture["radius_m"])
    cylinder("Nozzle mounting flange", root, metal, radius * 1.75, 0.028, (0, 0, 0.014))
    cylinder("EPDM mounting seal", root, materials["epdm"], radius * 1.5, 0.008, (0, 0, 0.032))
    cylinder("Nozzle body", root, metal, radius * 1.18, 0.105, (0, 0, 0.088))
    torus("Outlet lip", root, metal, radius * 1.03, max(0.003, radius * 0.13), (0, 0, 0.145))
    cylinder("Dark outlet bore", root, materials["epdm"], radius * 0.88, 0.006, (0, 0, 0.145))
    if fixture["family"] in {"fan", "crown", "bell", "rotating"}:
        torus("Multi-outlet head", root, metal, max(0.065, radius * 1.8), max(0.008, radius * 0.25), (0, 0, 0.165))
    return root


def pump_asset(fixture, collection, materials):
    root = root_object("AF Pump assembly | " + fixture["label"], fixture, collection)
    paint, metal, rubber = materials["cast_equipment"], materials["stainless_316l"], materials["epdm"]
    box("Pump base", root, paint, (0.82, 0.46, 0.08), (0, 0, 0.04))
    cylinder("Motor casing", root, paint, 0.19, 0.42, (-0.13, 0, 0.29), (1, 0, 0))
    cylinder("Pump volute", root, metal, 0.235, 0.20, (0.23, 0, 0.29), (1, 0, 0))
    cylinder("Suction flange", root, metal, 0.115, 0.10, (0.23, 0, 0.29), (0, 1, 0))
    cylinder("Discharge flange", root, metal, 0.09, 0.13, (0.23, 0, 0.52), (0, 0, 1))
    box("Terminal box", root, paint, (0.19, 0.16, 0.10), (-0.15, 0, 0.51))
    for index in range(10):
        angle = index * math.tau / 10
        box("Motor cooling fin", root, paint, (0.34, 0.018, 0.035), (-0.13, 0.19 * math.cos(angle), 0.29 + 0.19 * math.sin(angle)))
    root["aquaflow_behavior"] = "Q∝N; H∝N²; P∝N³; first-order VFD ramp"
    return root


def valve_asset(fixture, collection, materials):
    root = root_object("AF Valve assembly | " + fixture["label"], fixture, collection)
    metal = materials[material_key(fixture)]
    cylinder("Valve body", root, metal, 0.10, 0.28, (0, 0, 0.18), (1, 0, 0))
    for x in (-0.16, 0.16):
        cylinder("Valve flange", root, metal, 0.135, 0.035, (x, 0, 0.18), (1, 0, 0))
        torus("Flange gasket", root, materials["epdm"], 0.105, 0.008, (x * 1.04, 0, 0.18), (1, 0, 0))
    cylinder("Valve stem", root, metal, 0.035, 0.14, (0, 0, 0.31))
    box("Solenoid/actuator", root, materials["cast_equipment"], (0.16, 0.13, 0.18), (0, 0, 0.43))
    root["aquaflow_behavior"] = "Linked branch gate with linear open/close stroke"
    return root


def light_asset(fixture, collection, materials):
    root = root_object("AF Luminaire assembly | " + fixture["label"], fixture, collection)
    metal = materials[material_key(fixture)]
    cylinder("Luminaire housing", root, metal, 0.09, 0.065, (0, 0, 0.0325))
    cylinder("Housing seal", root, materials["epdm"], 0.085, 0.008, (0, 0, 0.067))
    lens_material, shader = principled_material("AF Lens | " + fixture["label"], fixture["color"]["srgb"], 0.08)
    input_named(shader, ["IOR"], 1.5)
    input_named(shader, ["Transmission Weight", "Transmission"], 0.25)
    input_named(shader, ["Emission Color", "Emission"], (*fixture["color"]["linear"], 1.0))
    input_named(shader, ["Emission Strength"], 0.0)
    lens = cylinder("Visible luminaire lens", root, lens_material, 0.074, 0.012, (0, 0, 0.075))
    lens["aquaflow_lens"] = True
    lens["aquaflow_fixture_id"] = fixture["id"]
    return root


def equipment_asset(fixture, collection, materials):
    kind = equipment_kind(fixture)
    if kind == "pump":
        return pump_asset(fixture, collection, materials)
    if kind == "valve":
        return valve_asset(fixture, collection, materials)
    root = root_object("AF Equipment assembly | " + fixture["label"], fixture, collection)
    if kind == "filter":
        cylinder("Filter vessel", root, materials["cast_equipment"], 0.24, 0.72, (0, 0, 0.4))
        cylinder("Filter lid", root, materials["stainless_316l"], 0.255, 0.055, (0, 0, 0.78))
        cylinder("Filter drain", root, materials["stainless_316l"], 0.035, 0.12, (0, 0, 0.04))
    else:
        box("Equipment enclosure", root, materials["cast_equipment"], (0.4, 0.34, 0.42), (0, 0, 0.21))
    return root


def create_component_asset(fixture, collection, materials):
    from .generated_assets import create_generated_asset
    generated = create_generated_asset(fixture, collection)
    if generated is not None:
        return generated
    if fixture["category"] == "water":
        return nozzle_asset(fixture, collection, materials)
    if fixture["category"] == "light":
        return light_asset(fixture, collection, materials)
    return equipment_asset(fixture, collection, materials)


def create_pipe_assets(project, collection, materials):
    for pipe in project.get("pipes", []):
        material = materials["hdpe" if pipe["material"].lower() == "hdpe" else "pvc"]
        root = bpy.data.objects.new("AF Pipe | " + pipe["label"], None)
        collection.objects.link(root)
        root["aquaflow_pipe_id"] = pipe["id"]
        for start, end in zip(pipe["points"], pipe["points"][1:]):
            a, b = Vector(start), Vector(end)
            delta = b - a
            if delta.length < 0.001:
                continue
            cylinder("Pressure pipe", root, material, pipe["diameter_m"] / 2.0, delta.length, (a + b) / 2.0, delta)
        for point in (pipe["points"][0], pipe["points"][-1]):
            cylinder("Pipe flange", root, materials["stainless_316l"], pipe["diameter_m"] * 0.72, 0.025, point)
