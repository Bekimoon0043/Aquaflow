"""Build editable Blender scenes from normalized AquaFlow projects."""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

from .animation import build_animation
from .asset_factory import component_materials, create_component_asset, create_pipe_assets
from .assets import native_outlets
from .core import GRAVITY, simulation_plan
from .dynamics import apply_hydraulic_response
from .external_assets import load_fountain_material, spawn_project_effects
from .io_utils import import_packaged_models
from .materials import input_named, make_materials, stone_material
from .procedural_water import spawn_procedural_jets
from .specialEffects import create_special_effects


def option(settings, name, fallback):
    if isinstance(settings, dict):
        return settings.get(name, fallback)
    return getattr(settings, name, fallback)


def slug(value):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "aquaflow")).strip("_") or "aquaflow"


def collection(scene, name):
    result = bpy.data.collections.new(name)
    scene.collection.children.link(result)
    return result


def move_to(obj, target):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    target.objects.link(obj)
    return obj


def mesh_object(name, vertices, faces, target, material=None):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    if material:
        mesh.materials.append(material)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def cube(name, location, dimensions, target, material=None, apply_scale=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    move_to(obj, target)
    if material:
        obj.data.materials.append(material)
    if apply_scale:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cylinder(name, location, radius, depth, target, material, direction=None, vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    move_to(obj, target)
    if direction:
        obj.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def extrude(name, points, bottom, top, target, material=None):
    count = len(points)
    vertices = [(x, y, bottom) for x, y in points] + [(x, y, top) for x, y in points]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, following + count, index + count))
    return mesh_object(name, vertices, faces, target, material)


def effector(obj):
    modifier = obj.modifiers.new("AquaFlow basin collision", "FLUID")
    modifier.fluid_type = "EFFECTOR"
    modifier.effector_settings.surface_distance = 0.001
    modifier.effector_settings.subframes = 1
    obj["aquaflow_effector"] = True


def caustics(obj, caster=False, receiver=False):
    if hasattr(obj.cycles, "is_caustics_caster"):
        obj.cycles.is_caustics_caster = caster
    if hasattr(obj.cycles, "is_caustics_receiver"):
        obj.cycles.is_caustics_receiver = receiver


def collision_wall(points, depth, thickness, target):
    count = len(points)
    vertices = [(x, y, -depth) for x, y in points] + [(x, y, 0.18) for x, y in points]
    faces = [(index, (index + 1) % count, (index + 1) % count + count, index + count) for index in range(count)]
    obj = mesh_object("AF | Watertight basin collision", vertices, faces, target)
    solidify = obj.modifiers.new("Continuous collision thickness", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = 0.0
    solidify.use_even_offset = True
    with bpy.context.temp_override(active_object=obj, object=obj):
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=solidify.name)
        obj.select_set(False)
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["aquaflow_collision_thickness_m"] = thickness
    effector(obj)
    return obj


def overflow_outflow(points, waterline, target):
    center = Vector((sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points)))
    step = max(1, math.ceil(len(points) / 32))
    for index in range(0, len(points), step):
        point = points[index]
        following = points[(index + 1) % len(points)]
        dx, dy = following[0] - point[0], following[1] - point[1]
        length = math.hypot(dx, dy)
        if length < 0.05:
            continue
        midpoint = Vector(((point[0] + following[0]) / 2.0, (point[1] + following[1]) / 2.0))
        inward = center - midpoint
        if inward.length:
            inward.normalize()
        location = midpoint + inward * 0.18
        obj = cube(f"AF | Rim overflow {index:02d}", (location.x, location.y, waterline + 0.13),
                   (length + 0.08, 0.42, 0.22), target, apply_scale=True)
        obj.rotation_euler.z = math.atan2(dy, dx)
        modifier = obj.modifiers.new("Recirculation overflow", "FLUID")
        modifier.fluid_type = "FLOW"
        flow = modifier.flow_settings
        flow.flow_type = "LIQUID"
        flow.flow_behavior = "OUTFLOW"
        flow.use_inflow = True
        obj.hide_render = True
        obj.display_type = "WIRE"
        obj["aquaflow_overflow"] = True
        outer = midpoint - inward * 0.28
        gutter = cube(f"AF | Overspray gutter {index:02d}", (outer.x, outer.y, 0.35),
                      (length + 0.08, 0.45, 0.70), target, apply_scale=True)
        gutter.rotation_euler.z = math.atan2(dy, dx)
        modifier = gutter.modifiers.new("External runoff drain", "FLUID")
        modifier.fluid_type = "FLOW"
        flow = modifier.flow_settings
        flow.flow_type = "LIQUID"
        flow.flow_behavior = "OUTFLOW"
        flow.use_inflow = True
        gutter.hide_render = True
        gutter.display_type = "WIRE"
        gutter["aquaflow_overflow"] = True


def create_pool(scene, project, target, materials, native, plan=None):
    pool = project["pool"]
    points, depth, waterline = pool["points"], pool["depth_m"], pool["waterline_m"]
    if len(points) < 3:
        return []
    floor = extrude("AF | Basin floor", points, -depth - 0.16, -depth, target, materials["basin"])
    walls = [floor]
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        dx, dy = following[0] - point[0], following[1] - point[1]
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        wall = cube(
            f"AF | Basin wall {index + 1:02d}",
            ((point[0] + following[0]) / 2.0, (point[1] + following[1]) / 2.0, (0.16 - depth) / 2.0),
            (length, 0.14, depth + 0.16), target, materials["basin"], True,
        )
        wall.rotation_euler.z = math.atan2(dy, dx)
        walls.append(wall)
    for obj in walls:
        caustics(obj, receiver=True)
    effector(floor)
    if native and plan:
        collision_wall(points, depth, max(0.18, plan["voxel_m"] * 2.5), target)
    if native:
        water = extrude("AF | Initial pool liquid", points, -depth + 0.025, waterline, target, materials["water"])
        modifier = water.modifiers.new("Initial liquid volume", "FLUID")
        modifier.fluid_type = "FLOW"
        flow = modifier.flow_settings
        flow.flow_type = "LIQUID"
        flow.flow_behavior = "GEOMETRY"
        flow.use_inflow = True
        flow.keyframe_insert("use_inflow", frame=1)
        flow.use_inflow = False
        flow.keyframe_insert("use_inflow", frame=2)
        water.hide_render = True
        water.display_type = "WIRE"
        water["aquaflow_helper"] = True
        caustics(water, caster=True)
        overflow_outflow(points, waterline, target)
    else:
        water = extrude("AF | Pool water surface", points, waterline - 0.025, waterline, target, materials.get("pool_water", materials["water"]))
        caustics(water, caster=True)
    cube("AF | Ground beneath basin", (0, 0, -depth - 0.19), (200, 200, 0.08), target, materials["deck"])
    return walls


def create_surfaces(project, target):
    for surface in project["surfaces"]:
        material = stone_material("AF | " + surface["label"], surface["color"]["srgb"], 0.7)
        obj = extrude("AF | " + surface["label"], surface["points"], -0.04, surface["elevation"], target, material)
        effector(obj)
        caustics(obj, receiver=True)


def create_fixture_bodies(project, target, materials):
    for fixture in project["fixtures"]:
        if fixture["visible"]:
            create_component_asset(fixture, target, materials)
    create_pipe_assets(project, target, materials)


def fcurves_of(obj):
    animation = obj.animation_data
    action = animation.action if animation else None
    if not action:
        return []
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    curves = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                curves.extend(bag.fcurves)
    return curves


def interpolation(obj, mode="LINEAR"):
    for curve in fcurves_of(obj):
        for key in curve.keyframe_points:
            key.interpolation = "CONSTANT" if curve.data_path.endswith("use_inflow") else mode


def flow_object(fixture, plan, animation, target, domain, outlet=None, outlet_index=0):
    outlet = outlet or {"direction": fixture["direction"], "offset": (0, 0, 0), "radius_scale": 1.0}
    position = Vector(fixture["position"]) + Vector(outlet["offset"]) + Vector((0, 0, 0.145))
    direction = Vector(outlet["direction"])
    radius = fixture.get("emitter_radius_m", fixture["radius_m"]) * outlet["radius_scale"]
    if fixture["family"] == "cascade":
        position.z += fixture["design_height_m"]
        direction = Vector((math.cos(math.radians(fixture["rotation"])), -math.sin(math.radians(fixture["rotation"])), -0.35)).normalized()
    bpy.ops.mesh.primitive_circle_add(vertices=20, radius=radius, fill_type="NGON", location=position)
    obj = bpy.context.object
    obj.name = "AF Inflow | " + fixture["label"] + (f" · outlet {outlet_index + 1}" if outlet_index else "")
    move_to(obj, target)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    modifier = obj.modifiers.new("Nozzle liquid inflow", "FLUID")
    modifier.fluid_type = "FLOW"
    flow = modifier.flow_settings
    flow.flow_type = "LIQUID"
    flow.flow_behavior = "INFLOW"
    flow.flow_source = "MESH"
    flow.use_plane_init = True
    flow.use_initial_velocity = True
    flow.velocity_normal = 0.0
    flow.velocity_factor = 1.0
    flow.surface_distance = 0.0
    flow.subframes = 2
    for key in animation[fixture["id"]]:
        level = key["level"]
        flow.use_inflow = level > 0.005
        flow.keyframe_insert("use_inflow", frame=key["frame"])
        speed = fixture["velocity_mps"] * math.sqrt(level) if level > 0 else 0.0
        flow.velocity_coord = tuple(direction * speed)
        flow.keyframe_insert("velocity_coord", frame=key["frame"])
    flow.use_inflow = False
    obj.hide_render = True
    obj.display_type = "WIRE"
    obj["aquaflow_fixture_id"] = fixture["id"]
    obj["aquaflow_emitter_radius_m"] = radius
    obj["aquaflow_actual_radius_m"] = fixture["radius_m"]
    interpolation(obj)
    return obj


def create_domain(scene, project, plan, animation, settings, target, materials):
    domain = cube("AF | Native Mantaflow liquid domain", plan["center"], plan["size"], target, materials["water"], True)
    domain.display_type = "WIRE"
    domain.hide_render = True
    domain["aquaflow_domain"] = True
    domain["aquaflow_scope"] = plan["scope"]
    domain["aquaflow_unbaked"] = True
    modifier = domain.modifiers.new("Mantaflow liquid", "FLUID")
    modifier.fluid_type = "DOMAIN"
    settings_fluid = modifier.domain_settings
    settings_fluid.domain_type = "LIQUID"
    settings_fluid.resolution_max = plan["resolution"]
    settings_fluid.cache_type = "MODULAR"
    settings_fluid.cache_frame_start = scene.frame_start
    settings_fluid.cache_frame_end = scene.frame_end
    cache_root = bpy.path.abspath(option(settings, "cache_directory", "//aquaflow_cache"))
    settings_fluid.cache_directory = cache_root + "/" + slug(project["name"]) + "_v2"
    settings_fluid.use_mesh = True
    settings_fluid.mesh_scale = 2
    settings_fluid.particle_radius = 1.0
    settings_fluid.mesh_particle_radius = 1.3
    settings_fluid.mesh_smoothen_pos = 2
    settings_fluid.mesh_smoothen_neg = 2
    settings_fluid.use_speed_vectors = True
    settings_fluid.simulation_method = "FLIP"
    settings_fluid.flip_ratio = 0.82
    settings_fluid.particle_randomness = 0.06
    settings_fluid.use_fractions = True
    settings_fluid.fractions_distance = 0.5
    settings_fluid.use_adaptive_timesteps = True
    settings_fluid.timesteps_min = 1
    settings_fluid.timesteps_max = 6
    settings_fluid.cfl_condition = 2.0
    settings_fluid.use_collision_border_top = False
    settings_fluid.delete_in_obstacle = True
    if option(settings, "secondary_particles", True):
        settings_fluid.use_spray_particles = True
        settings_fluid.use_foam_particles = True
        settings_fluid.use_bubble_particles = True
        settings_fluid.sndparticle_life_min = 0.4
        settings_fluid.sndparticle_life_max = 2.2
    caustics(domain, caster=True)
    for fixture in plan["nozzles"]:
        for outlet_index, outlet in enumerate(native_outlets(fixture)):
            flow_object(fixture, plan, animation, target, domain, outlet, outlet_index)
    configure_secondary_particles(domain, target, materials)
    return domain


def configure_secondary_particles(domain, target, materials):
    bpy.context.view_layer.update()
    for particle_system in domain.particle_systems:
        settings = particle_system.settings
        if getattr(settings, "type", "") == "FLIP":
            continue
        is_foam = "foam" in particle_system.name.lower()
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, -1000))
        droplet = bpy.context.object
        droplet.name = "AF Particle instance | " + particle_system.name
        move_to(droplet, target)
        droplet.data.materials.append(materials["foam"] if is_foam else materials["water"])
        droplet.hide_render = True
        droplet.hide_set(True)
        settings.render_type = "OBJECT"
        settings.instance_object = droplet
        settings.particle_size = 0.025 if is_foam else 0.012
        settings.size_random = 0.65


def tube_jet(fixture, direction, target, material, radius_scale=1.0, minimum_radius=0.022, name_suffix=""):
    direction = Vector(direction)
    proxy_speed = math.sqrt(2.0 * GRAVITY * fixture["design_height_m"]) / max(0.15, direction.z)
    velocity = direction * proxy_speed
    flight = max(0.12, 2.0 * velocity.z / GRAVITY)
    segments, sides = 24, 8
    centers = [velocity * (flight * index / segments) + Vector((0, 0, -0.5 * GRAVITY * (flight * index / segments) ** 2))
               for index in range(segments + 1)]
    vertices, faces = [], []
    for index, center in enumerate(centers):
        tangent = (centers[min(index + 1, segments)] - centers[max(0, index - 1)]).normalized()
        rotation = tangent.to_track_quat("Z", "Y")
        radius = max(minimum_radius, fixture["radius_m"] * radius_scale) * max(0.22, 1.0 - 0.72 * index / segments)
        for side in range(sides):
            angle = side * math.tau / sides
            vertices.append(tuple(center + rotation @ Vector((radius * math.cos(angle), radius * math.sin(angle), 0))))
    for index in range(segments):
        for side in range(sides):
            following = (side + 1) % sides
            a, b = index * sides + side, index * sides + following
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range(segments * sides, (segments + 1) * sides)))
    obj = mesh_object("AF Proxy" + name_suffix + " | " + fixture["label"], vertices, faces, target, material)
    obj.location = fixture["position"]
    return obj


def bell_proxy(fixture, target, material):
    rings, sides = 12, 48
    height = max(0.12, fixture["design_height_m"])
    radius = max(0.25, height * 1.25)
    profile = [(0.02, 0.0), (0.25, 0.55), (0.65, 1.0), (1.0, 0.48), (1.08, 0.0)]
    vertices, faces = [], []
    for ring in range(rings + 1):
        position = ring / rings * (len(profile) - 1)
        left = min(len(profile) - 2, int(position))
        amount = position - left
        r = profile[left][0] * (1 - amount) + profile[left + 1][0] * amount
        z = profile[left][1] * (1 - amount) + profile[left + 1][1] * amount
        for side in range(sides):
            angle = side * math.tau / sides
            vertices.append((radius * r * math.cos(angle), radius * r * math.sin(angle), height * z))
    for ring in range(rings):
        for side in range(sides):
            following = (side + 1) % sides
            a, b = ring * sides + side, ring * sides + following
            faces.append((a, b, b + sides, a + sides))
    obj = mesh_object("AF Proxy bell | " + fixture["label"], vertices, faces, target, material)
    obj.location = fixture["position"]
    solidify = obj.modifiers.new("Thin water film", "SOLIDIFY")
    solidify.thickness = 0.002
    return obj


def cascade_proxy(fixture, target, material):
    height = max(0.1, fixture["design_height_m"])
    width = max(0.3, (fixture["raw"].get("engineering") or {}).get("widthM", 0.8))
    rows = 24
    vertices, faces = [], []
    for row in range(rows + 1):
        amount = row / rows
        for side in (-1, 1):
            vertices.append((side * width / 2.0, 0.08 * math.sin(amount * math.tau), height * (1 - amount)))
    for row in range(rows):
        faces.append((row * 2, row * 2 + 1, row * 2 + 3, row * 2 + 2))
    obj = mesh_object("AF Proxy cascade | " + fixture["label"], vertices, faces, target, material)
    obj.location = fixture["position"]
    obj.rotation_euler.z = -math.radians(fixture["rotation"])
    solidify = obj.modifiers.new("Falling water sheet", "SOLIDIFY")
    solidify.thickness = 0.003
    return obj


def animate_proxy(obj, keys):
    for key in keys:
        scale = max(0.001, math.sqrt(key["level"]))
        obj.scale = (scale, scale, scale)
        obj.keyframe_insert("scale", frame=key["frame"])
        obj.hide_render = key["level"] <= 0.005
        obj.keyframe_insert("hide_render", frame=key["frame"])
    obj["aquaflow_proxy"] = True
    interpolation(obj)


def create_proxies(project, animation, fixtures, target, materials):
    for fixture in fixtures:
        objects = []
        material = materials["foam"] if fixture["aerated"] else materials["water"]
        if fixture["family"] == "bell":
            objects.append(bell_proxy(fixture, target, material))
        elif fixture["family"] == "cascade":
            objects.append(cascade_proxy(fixture, target, material))
        elif fixture["family"] == "mist":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.5, location=fixture["position"])
            obj = bpy.context.object
            obj.name = "AF Proxy mist | " + fixture["label"]
            move_to(obj, target)
            obj.scale = (1.0, 1.0, 1.4)
            obj.data.materials.append(materials["mist"])
            objects.append(obj)
        else:
            asset_directory = Path(__file__).resolve().parent / "assets" / "water"
            objects.extend(spawn_procedural_jets(fixture, animation, target, asset_directory))
        for obj in objects:
            obj["aquaflow_fixture_id"] = fixture["id"]
            caustics(obj, caster=True)
            if not obj.get("procedural_water"):
                animate_proxy(obj, animation[fixture["id"]])


def create_lights(scene, project, animation, settings, target):
    fixtures = {fixture["id"]: fixture for fixture in project["fixtures"]}
    multiplier = option(settings, "light_multiplier", 1.0)
    for fixture in project["fixtures"]:
        if fixture["category"] != "light" or not fixture["visible"]:
            continue
        kind = "AREA" if fixture["area"] else "SPOT" if fixture["beam_angle_deg"] < 110 else "POINT"
        data = bpy.data.lights.new("AF | " + fixture["label"], kind)
        data.use_shadow = True
        data.cycles.is_caustics_light = True
        if kind == "SPOT":
            data.spot_size = math.radians(fixture["beam_angle_deg"])
            data.spot_blend = 0.3
            data.shadow_soft_size = 0.035
        elif kind == "POINT":
            data.shadow_soft_size = 0.055
        else:
            data.shape = "RECTANGLE"
            data.size = fixture["area_width_m"]
            data.size_y = fixture["area_length_m"]
        obj = bpy.data.objects.new("AF Light | " + fixture["label"], data)
        target.objects.link(obj)
        obj.location = (fixture["position"][0], fixture["position"][1], fixture["mount_height_m"])
        paired = fixtures.get(fixture["paired_nozzle_id"])
        if paired:
            aim = Vector(paired["position"]) + Vector((0, 0, paired["design_height_m"] * 0.55))
        elif fixture["mount_height_m"] > 0.2:
            angle = math.radians(fixture["aim_azimuth_deg"])
            aim = obj.location + Vector((math.cos(angle) * 4.0, math.sin(angle) * 4.0, -fixture["mount_height_m"]))
        else:
            aim = obj.location + Vector((0, 0, 2.0))
        obj.rotation_euler = (aim - obj.location).to_track_quat("-Z", "Y").to_euler()
        obj["aquaflow_fixture_id"] = fixture["id"]
        obj["aquaflow_power_source"] = fixture["power_source"]
        ies_node = None
        if option(settings, "use_ies", True) and fixture["ies"]:
            try:
                data.use_nodes = True
                ies_node = data.node_tree.nodes.new("ShaderNodeTexIES")
                ies_node.mode = "EXTERNAL"
                ies_node.filepath = fixture["ies"]
                emission = next(node for node in data.node_tree.nodes if node.type == "EMISSION")
                data.node_tree.links.new(ies_node.outputs[0], emission.inputs["Strength"])
            except Exception as error:
                ies_node = None
                obj["aquaflow_ies_error"] = str(error)
        lens = next((item for item in scene.objects if item.get("aquaflow_lens") and item.get("aquaflow_fixture_id") == fixture["id"]), None)
        lens_material = next((material for material in lens.data.materials if material.name.startswith("Lens_RGB")), lens.data.materials[0]) if lens else None
        lens_shader = lens_material.node_tree.nodes.get("Principled BSDF") if lens_material else None
        for key in animation[fixture["id"]]:
            energy = fixture["radiant_watts"] * multiplier * key["energy_factor"]
            data.color = tuple(max(0.0, min(1.0, channel)) for channel in key["color"])
            data.keyframe_insert("color", frame=key["frame"])
            if ies_node:
                ies_node.inputs["Strength"].default_value = energy
                ies_node.inputs["Strength"].keyframe_insert("default_value", frame=key["frame"])
            else:
                data.energy = energy
                data.keyframe_insert("energy", frame=key["frame"])
            if lens_shader:
                input_named(lens_shader, ["Emission Color", "Emission"], (*key["color"], 1.0))
                input_named(lens_shader, ["Emission Strength"], 5.0 * key["energy_factor"])
                lens_shader.id_data.keyframe_insert("nodes[\"Principled BSDF\"].inputs[\"Emission Color\"].default_value" if "Emission Color" in lens_shader.inputs else "nodes[\"Principled BSDF\"].inputs[\"Emission\"].default_value", frame=key["frame"])
                lens_shader.id_data.keyframe_insert("nodes[\"Principled BSDF\"].inputs[\"Emission Strength\"].default_value", frame=key["frame"])
        interpolation(obj)
        interpolation(data)
        if ies_node:
            interpolation(data.node_tree)


def create_environment(scene, project, target, settings=None):
    world = bpy.data.worlds.new("AF | " + project["environment"].title())
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if project["environment"] == "day":
        sky = world.node_tree.nodes.new("ShaderNodeTexSky")
        if hasattr(sky, "sky_type"):
            sky.sky_type = "NISHITA"
            sky.sun_elevation = math.radians(35)
            sky.sun_rotation = math.radians(135)
        world.node_tree.links.new(sky.outputs[0], background.inputs["Color"])
        background.inputs["Strength"].default_value = 0.3
    else:
        background.inputs["Color"].default_value = (0.05, 0.08, 0.14, 1.0)
        background.inputs["Strength"].default_value = 0.28
        data = bpy.data.lights.new("AF | Night sky reflection", "AREA")
        data.energy = 100.0
        data.shape = "DISK"
        data.size = 12.0
        obj = bpy.data.objects.new("AF | Night sky reflection", data)
        target.objects.link(obj)
        obj.location = (-4, 2, 12)
        obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat("-Z", "Y").to_euler()
        if option(settings, "reflection_rig", True):
            # Clear water needs something to reflect. These named, optional environment
            # sources are art-directed architectural fill, not AquaFlow fixture photometry.
            rig = [
                ("Cool reflection strip", (-6, -4, 7), 150.0, (0.55, 0.72, 1.0), 7.0, 3.0),
                ("Neutral reflection strip", (5, 3, 5), 220.0, (0.78, 0.87, 1.0), 5.0, 2.0),
                ("Audience architectural fill", (0, -8, 4), 70.0, (0.85, 0.9, 1.0), 6.0, 3.0),
            ]
            for label, location, energy, color, width, height in rig:
                data = bpy.data.lights.new("AF Environment | " + label, "AREA")
                data.energy = energy
                data.color = color
                data.shape = "RECTANGLE"
                data.size = width
                data.size_y = height
                obj = bpy.data.objects.new("AF Environment | " + label, data)
                target.objects.link(obj)
                obj.location = location
                obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat("-Z", "Y").to_euler()
                obj["aquaflow_environment_rig"] = True
    scene.world = world


def create_cameras(scene, project, target):
    selected = None
    for view in project["cameras"]:
        data = bpy.data.cameras.new("AF | " + view["name"])
        obj = bpy.data.objects.new("AF Camera | " + view["name"], data)
        target.objects.link(obj)
        obj["aquaflow_camera_id"] = view["id"]
        obj.location = view["position"]
        obj.rotation_euler = (Vector(view["target"]) - obj.location).to_track_quat("-Z", "Y").to_euler()
        data.lens = 32
        data.clip_start = 0.02
        data.clip_end = 1000
        if view["id"] == project["active_camera"]:
            selected = obj
    if not selected:
        points = project["pool"]["points"]
        width = max((point[0] for point in points), default=6) - min((point[0] for point in points), default=-6)
        length = max((point[1] for point in points), default=4) - min((point[1] for point in points), default=-4)
        size = max(5.0, width, length)
        data = bpy.data.cameras.new("AF | Audience camera")
        selected = bpy.data.objects.new("AF Camera | Audience", data)
        target.objects.link(selected)
        selected.location = (0, -size * 1.25, size * 0.42)
        selected.rotation_euler = (Vector((0, 0, 1.2)) - selected.location).to_track_quat("-Z", "Y").to_euler()
        data.lens = 32
        data.clip_start = 0.02
    scene.camera = selected


def configure_compositor(scene, settings):
    if not option(settings, "bloom", True):
        return
    if bpy.app.version >= (5, 0, 0):
        tree = bpy.data.node_groups.new("AquaFlow compositor", "CompositorNodeTree")
        scene.compositing_node_group = tree
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        layers = tree.nodes.new("CompositorNodeRLayers")
        output = tree.nodes.new("NodeGroupOutput")
        try:
            glare = tree.nodes.new("CompositorNodeGlare")
            if hasattr(glare, "glare_type"):
                glare.glare_type = "FOG_GLOW"
                glare.quality = "HIGH"
                glare.threshold = 2.0
                glare.mix = -0.92
            tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
            tree.links.new(glare.outputs["Image"], output.inputs["Image"])
        except Exception:
            scene["aquaflow_compositor_note"] = "Blender 5 glare settings need version-specific tuning; direct beauty output retained"
            tree.links.new(layers.outputs["Image"], output.inputs["Image"])
        return
    scene.use_nodes = True
    nodes, links = scene.node_tree.nodes, scene.node_tree.links
    nodes.clear()
    layers = nodes.new("CompositorNodeRLayers")
    glare = nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 2.0
    glare.mix = -0.92
    composite = nodes.new("CompositorNodeComposite")
    links.new(layers.outputs["Image"], glare.inputs["Image"])
    links.new(glare.outputs["Image"], composite.inputs["Image"])


def configure_render(scene, project, settings):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(option(settings, "samples", 128))
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.025
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 8
    scene.cycles.transmission_bounces = 12
    scene.cycles.transparent_max_bounces = 12
    scene.cycles.volume_bounces = 2
    scene.cycles.caustics_reflective = True
    scene.cycles.caustics_refractive = True
    if hasattr(scene.cycles, "use_light_tree"):
        scene.cycles.use_light_tree = True
    if hasattr(scene.render, "use_motion_blur"):
        scene.render.use_motion_blur = bool(option(settings, "motion_blur", True))
        scene.render.motion_blur_shutter = 0.35
    scene.render.resolution_x = int(option(settings, "width", 1920))
    scene.render.resolution_y = int(option(settings, "height", 1080))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "AgX"
    except (TypeError, ValueError):
        scene.view_settings.view_transform = "Filmic"
    scene.view_settings.exposure = float(option(settings, "exposure", 0.0))
    scene.render.fps = project["fps"]
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    requested_end = int(option(settings, "frame_end", 0))
    scene.frame_end = requested_end if requested_end > 0 else max(1, round(project["duration_s"] * project["fps"]))
    configure_compositor(scene, settings)


def build_scene(project, settings=None, source_document=None):
    settings = settings or {}
    scene = bpy.data.scenes.new("AquaFlow · " + project["name"])
    if bpy.context.window:
        bpy.context.window.scene = scene
    configure_render(scene, project, settings)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.gravity = (0, 0, -GRAVITY)
    geometry = collection(scene, "AF | Basin and fixtures")
    proxies = collection(scene, "AF | Water design proxies")
    native = collection(scene, "AF | Native liquid")
    lights = collection(scene, "AF | Physical show lighting")
    cameras = collection(scene, "AF | Cameras")
    environment = collection(scene, "AF | Environment")
    materials = make_materials()
    materials.update(component_materials())
    animation_project = project
    requested_end = int(option(settings, "frame_end", 0))
    if requested_end > 0:
        animation_project = {**project, "duration_s": min(project["duration_s"], requested_end / project["fps"])}
    animation = build_animation(animation_project, option(settings, "animation_step", 2))
    animation, hydraulic_diagnostics = apply_hydraulic_response(animation_project, animation)
    scope = str(option(settings, "fluid_scope", "HERO")).upper()
    plan = simulation_plan(project, scope, option(settings, "hero_fixture", ""), int(option(settings, "resolution", 128)))
    selected_ids = {fixture["id"] for fixture in plan["nozzles"]}
    proxy_fixtures = [fixture for fixture in project["fixtures"] if fixture["category"] == "water" and fixture["visible"]]
    if plan["scope"] != "PROXIES":
        proxy_fixtures = [] if not option(settings, "show_proxies", True) else [fixture for fixture in proxy_fixtures if fixture["id"] not in selected_ids or fixture.get("under_resolved")]
    external_info = {"enabled": False, "linked_effects": 0, "missing": []}
    if option(settings, "use_external_assets", False):
        spawned, missing, external_root = spawn_project_effects(
            project, animation, proxy_fixtures,
            option(settings, "external_assets_source", ""), proxies,
            option(settings, "external_assets_extract_directory", ""),
        )
        spawned_ids = {obj["aquaflow_fixture_id"] for obj in spawned}
        proxy_fixtures = [fixture for fixture in proxy_fixtures if fixture["id"] not in spawned_ids]
        external_info = {"enabled": True, "linked_effects": len(spawned), "missing": missing,
                         "source": str(external_root), "assets_packed": False}
        pool_material = load_fountain_material(option(settings, "external_assets_source", ""), option(settings, "external_assets_extract_directory", ""))
        if pool_material:
            materials["pool_water"] = pool_material
    create_pool(scene, project, geometry, materials, plan["scope"] != "PROXIES", plan)
    create_surfaces(project, geometry)
    create_fixture_bodies(project, geometry, materials)
    imported_models = import_packaged_models(source_document or {}, geometry)
    create_proxies(project, animation, proxy_fixtures, proxies, materials)
    domain = None
    if plan["scope"] != "PROXIES":
        domain = create_domain(scene, project, plan, animation, settings, native, materials)
    create_lights(scene, project, animation, settings, lights)
    create_special_effects(project, animation, lights, materials)
    create_environment(scene, project, environment, settings)
    create_cameras(scene, project, cameras)
    scene.frame_set(scene.frame_start)
    scene["aquaflow_project"] = project["name"]
    scene["aquaflow_simulation_scope"] = plan["scope"]
    warnings = project["warnings"] + plan["warnings"]
    if external_info["missing"]:
        warnings.append("External water effects missing: " + ", ".join(external_info["missing"]))
    report = {
        "project": project["name"],
        "fixtures": len(project["fixtures"]),
        "nozzles": sum(fixture["category"] == "water" for fixture in project["fixtures"]),
        "lights": sum(fixture["category"] == "light" for fixture in project["fixtures"]),
        "native_simulated_nozzles": [fixture["id"] for fixture in plan["nozzles"]],
        "proxy_nozzles": [fixture["id"] for fixture in proxy_fixtures],
        "scope": plan["scope"],
        "frame_end": scene.frame_end,
        "warnings": warnings,
        "hydraulics": {key: value for key, value in hydraulic_diagnostics.items() if key != "snapshots"},
        "external_assets": external_info,
        "packaged_model_objects": len(imported_models),
        "native_liquid_baked": False,
        "notes": [
            "Native Mantaflow domains are intentionally unbaked after import.",
            "Design-proxy jets are geometry, not fluid simulation.",
            "Blender light watts are radiant-power estimates, not electrical fixture watts.",
            "Use a local high-resolution domain for production hero jets; one coarse site domain cannot resolve millimetre nozzles.",
        ],
    }
    text = bpy.data.texts.new("AQUAFLOW_IMPORT_REPORT.json")
    text.write(json.dumps(report, indent=2))
    if source_document is not None:
        source = bpy.data.texts.new("AQUAFLOW_SOURCE_PROJECT.json")
        source.write(json.dumps(source_document, indent=2))
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
                area.spaces.active.clip_start = 0.02
    return scene, report, domain


def bake_domain(scene, domain=None):
    domain = domain or next((obj for obj in scene.objects if obj.get("aquaflow_domain")), None)
    if not domain:
        raise RuntimeError("This scene has no native AquaFlow liquid domain")
    with bpy.context.temp_override(scene=scene):
        for obj in scene.objects:
            obj.select_set(False)
        domain.select_set(True)
        bpy.context.view_layer.objects.active = domain
        with bpy.context.temp_override(active_object=domain, object=domain):
            bpy.ops.fluid.bake_data()
            bpy.ops.fluid.bake_mesh()
            modifier = next(modifier for modifier in domain.modifiers if modifier.type == "FLUID" and modifier.fluid_type == "DOMAIN")
            if modifier.domain_settings.use_spray_particles or modifier.domain_settings.use_foam_particles:
                bpy.ops.fluid.bake_particles()
    cache_directory = bpy.path.abspath(modifier.domain_settings.cache_directory)
    if not modifier.domain_settings.has_cache_baked_mesh or not os.path.isdir(cache_directory):
        raise RuntimeError("Blender did not create a readable liquid cache: " + cache_directory)
    scene.frame_set(scene.frame_end)
    evaluated = domain.evaluated_get(bpy.context.evaluated_depsgraph_get())
    if len(evaluated.data.vertices) <= 8:
        raise RuntimeError("Blender baked the domain but produced no liquid mesh; check flow visibility, resolution and cache settings")
    scene.frame_set(scene.frame_start)
    domain.hide_render = False
    domain["aquaflow_unbaked"] = False
    report_text = bpy.data.texts.get("AQUAFLOW_IMPORT_REPORT.json")
    if report_text:
        report = json.loads(report_text.as_string())
        report["native_liquid_baked"] = True
        report_text.clear()
        report_text.write(json.dumps(report, indent=2))
    return domain
