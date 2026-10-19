/**
 * blenderScene.js — the Python script that assembles an exported simulation cache into a
 * complete Blender scene: pool / site / fixtures (.glb), the water volume sequence (lit by
 * its Cd colour grid), every RGB fixture as an animated spot light, camera, world and
 * render settings — then saves it as <base>_scene.blend next to the files.
 *
 * Works in Blender 3.3 → 4.x. Run it from Blender: Scripting → Open → Run Script, or
 * `blender --python <base>_blender_scene.py`.
 */

const pyString = (s) => JSON.stringify(String(s ?? ""));

export function buildBlenderScript({ base, exportDir = "", fps, frames, density = 30, watts = 25, hasColor = true, abcName = "" }) {
  return `# AquaFlow Studio -> Blender scene builder (generated).
# Open Blender, go to the Scripting tab, Open this file and press Run Script.
# Keep it in the folder with the .vdb / .glb / _lights.json files.
import bpy, os, json, math
from mathutils import Vector

BASE = ${pyString(base)}
EXPORT_DIR = ${pyString(exportDir)}
FPS = ${Number(fps) || 30}
FRAMES = ${Number(frames) || 1}
DENSITY = ${Number(density) || 30}      # volume shader density (a jet core reads ~1 in the grid)
WATTS_PER_FIXTURE_WATT = ${Number(watts) || 25}
HAS_COLOR = ${hasColor ? "True" : "False"}
ABC_NAME = ${pyString(abcName)}


def find_dir():
    cands = []
    f = globals().get("__file__")
    if f:
        cands.append(os.path.dirname(os.path.abspath(f)))
    try:
        t = bpy.context.space_data.text
        if t and t.filepath:
            cands.append(os.path.dirname(bpy.path.abspath(t.filepath)))
    except Exception:
        pass
    for t in bpy.data.texts:
        if t.filepath:
            cands.append(os.path.dirname(bpy.path.abspath(t.filepath)))
    cands.append(EXPORT_DIR)
    for d in cands:
        if d and os.path.exists(os.path.join(d, BASE + "_lights.json")):
            return d
    raise RuntimeError("AquaFlow: keep this script in the folder with " + BASE + "_lights.json and the .vdb files.")


D = find_dir()
data = json.load(open(os.path.join(D, BASE + "_lights.json"), encoding="utf-8"))
scene = bpy.context.scene
for name in ("Cube", "Light", "Camera"):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.new("AquaFlow " + BASE)
scene.collection.children.link(col)


def own(o):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)


scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, FRAMES

# 1. Pool, water surface, site and fixture bodies (glTF is Y-up; Blender's importer makes it Z-up).
glb = os.path.join(D, BASE + "_scene.glb")
if os.path.exists(glb):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in set(bpy.data.objects) - before:
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        own(o)
        if o.type == 'MESH' and o.name.startswith("WaterSurface"):
            m = bpy.data.materials.new("Pool water")
            m.use_nodes = True
            bsdf = m.node_tree.nodes.get("Principled BSDF")
            bsdf.inputs["Base Color"].default_value = (0.01, 0.05, 0.08, 1)
            bsdf.inputs["Roughness"].default_value = 0.03
            o.data.materials.clear()
            o.data.materials.append(m)

# 2. The water: one OpenVDB volume per frame.
files = sorted(f for f in os.listdir(D) if f.startswith(BASE + ".") and f.endswith(".vdb"))
vol = None
if files:
    bpy.ops.object.volume_import(filepath=os.path.join(D, files[0]), directory=D,
                                 files=[{"name": f} for f in files], align='WORLD', location=(0, 0, 0))
    vol = bpy.context.selected_objects[0]
    vol.name = "Fountain water"
    own(vol)
    vol.data.display.density = 2.0
    m = bpy.data.materials.new("Fountain water")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Density"].default_value = DENSITY
    pv.inputs["Color"].default_value = (0.85, 0.93, 1.0, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(pv.outputs[0], out.inputs["Volume"])
    if HAS_COLOR:
        # Cd = the RGB fixtures' light on the water, frame by frame.
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = "Cd"
        nt.links.new(at.outputs["Color"], pv.inputs["Emission Color"])
        pv.inputs["Emission Strength"].default_value = 6.0
    vol.data.materials.append(m)
elif ABC_NAME and os.path.exists(os.path.join(D, ABC_NAME)):
    # No volumes exported: the Alembic water mesh, lit by its Cd vertex colours.
    before = set(bpy.data.objects)
    bpy.ops.wm.alembic_import(filepath=os.path.join(D, ABC_NAME), as_background_job=False)
    for o in set(bpy.data.objects) - before:
        own(o)
        if o.type != 'MESH':
            continue
        m = bpy.data.materials.new("Fountain water (mesh)")
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (0.75, 0.88, 1.0, 1)
        bsdf.inputs["Roughness"].default_value = 0.05
        for name in ("Transmission", "Transmission Weight"):
            if name in bsdf.inputs:
                bsdf.inputs[name].default_value = 0.9
        if HAS_COLOR:
            at = nt.nodes.new("ShaderNodeAttribute")
            at.attribute_name = "Cd"
            for name in ("Emission", "Emission Color"):
                if name in bsdf.inputs:
                    nt.links.new(at.outputs["Color"], bsdf.inputs[name])
                    break
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 2.0
        o.data.materials.clear()
        o.data.materials.append(m)

# 3. RGB fixtures: spot lights aimed up, colour and power keyed from the show.
for L in data["lights"]:
    ld = bpy.data.lights.new("AquaFlow light " + L["id"], 'SPOT')
    ld.spot_size = math.radians(max(5.0, min(170.0, L["beamDeg"])))
    ld.spot_blend = 0.35
    ld.shadow_soft_size = 0.05
    ld.use_shadow = False           # underwater uplights: shadows add GPU cost, not look
    o = bpy.data.objects.new("Light " + L["id"], ld)
    col.objects.link(o)
    o.location = L["pos"]
    o.rotation_euler = Vector(L["dir"]).to_track_quat('-Z', 'Y').to_euler()
    watts = WATTS_PER_FIXTURE_WATT * L.get("wattage", 18)
    for f, r, g, b, level in L["keys"]:
        ld.color = (r, g, b)
        ld.energy = watts * level
        ld.keyframe_insert("color", frame=f)
        ld.keyframe_insert("energy", frame=f)
    if ld.animation_data and ld.animation_data.action:
        for fc in ld.animation_data.action.fcurves:
            for k in fc.keyframe_points:
                k.interpolation = 'LINEAR'

# 4. Camera, world and render settings.
c = Vector(data["center"])
size = max(data["size"][0], data["size"][1], 4.0)
cam = bpy.data.objects.new("AquaFlow camera", bpy.data.cameras.new("AquaFlow camera"))
col.objects.link(cam)
target = c + Vector((0, 0, max(1.0, data["size"][2] * 0.4)))
cam.location = target + Vector((0, -size * 1.25, size * 0.42))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 30
scene.camera = cam
w = bpy.data.worlds.new("AquaFlow night")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.008, 0.012, 0.025, 1)
scene.world = w
# EEVEE draws up to 128 lights; a bigger rig renders in Cycles instead.
engines = ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if len(data["lights"]) <= 120 else ('CYCLES',)
if engines == ('CYCLES',):
    scene.cycles.samples = 64
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
for engine in engines:
    try:
        scene.render.engine = engine
        break
    except Exception:
        pass
ee = scene.eevee
for attr, value in (("volumetric_tile_size", '4'), ("volumetric_samples", 64), ("volumetric_end", size * 4),
                    ("use_bloom", True), ("bloom_intensity", 0.08)):
    try:
        setattr(ee, attr, value)
    except Exception:
        pass
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.frame_set(max(1, min(FRAMES, FRAMES // 2)))
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            for sp in area.spaces:
                if sp.type == 'VIEW_3D':
                    sp.shading.type = 'MATERIAL'
                    sp.region_3d.view_location = target
                    sp.region_3d.view_distance = size * 1.4
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, BASE + "_scene.blend"))
print("AquaFlow scene saved:", os.path.join(D, BASE + "_scene.blend"))
`;
}
