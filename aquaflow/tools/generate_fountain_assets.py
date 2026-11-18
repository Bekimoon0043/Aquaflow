"""
generate_fountain_assets.py
===========================

Procedurally models, validates and exports ORIGINAL, GENERIC fountain equipment
for AquaFlow (Three.js) using only Blender's bundled Python modules.

Target: Blender 3.3 LTS (guards are included so it also runs on 4.x).

Outputs (in the chosen output directory):
  * aquaflow_fountain_assets.blend   editable file, one collection per asset
  * <asset>.glb                      one glTF 2.0 binary per asset (12 files)
  * contact-sheet.png                labelled render of every asset
  * asset-report.json                dimensions, triangles, materials, sockets,
                                     pivots, texture warnings, validation result

Conventions
  * Authored Z-up in metres, mounting base at local Z = 0, centred on the
    mounting axis. Exported with export_yup=True, so Blender +Z becomes glTF +Y.
  * Every socket is an EMPTY whose local +Z is the flow / emission / connection
    direction (pointing away from the equipment). In glTF that is local +Y.
  * Moving parts (Rotor_Z, Pan_Z, Tilt_X, Head_Tilt_X) are separate meshes whose
    origin sits exactly on their mechanical axis, with identity rotation/scale,
    so they can be animated programmatically by rotating the node.
  * No water, splashes, scenery, logos, markings or baked animation.

Run:
  blender --background --factory-startup --python generate_fountain_assets.py -- --output <dir>
"""

import argparse
import json
import math
import os
import re
import struct
import sys
import time
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector

SCRIPT_VERSION = "1.0.0"
TAU = 2.0 * math.pi
SHARP_ANGLE = math.radians(35.0)
LOG_PREFIX = "[AquaFlow]"


def log(msg):
    print(f"{LOG_PREFIX} {msg}", flush=True)


# --------------------------------------------------------------------------- #
# Arguments
# --------------------------------------------------------------------------- #
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="generate_fountain_assets.py")
    p.add_argument("output", nargs="?", default=None, help="output directory")
    p.add_argument("-o", "--output", dest="output_opt", default=None, help="output directory")
    p.add_argument("--samples", type=int, default=48, help="Cycles samples for the contact sheet")
    p.add_argument("--no-render", action="store_true", help="skip the contact-sheet render")
    p.add_argument("--reimport-all", action="store_true",
                   help="re-import every GLB instead of only motion_2d_nozzle.glb")
    a = p.parse_args(argv)
    out = a.output_opt or a.output or os.path.join(os.getcwd(), "aquaflow_fountain_assets")
    return os.path.abspath(out), a


# --------------------------------------------------------------------------- #
# Math helpers
# --------------------------------------------------------------------------- #
def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation(Vector((x, y, z)))


def rot_to(direction):
    """Rotation matrix that maps local +Z onto `direction`."""
    d = Vector(direction).normalized()
    return Vector((0.0, 0.0, 1.0)).rotation_difference(d).to_matrix().to_4x4()


def place(pos, direction=(0.0, 0.0, 1.0), spin=0.0):
    return T(*pos) @ rot_to(direction) @ Matrix.Rotation(spin, 4, "Z")


AX = rot_to((1.0, 0.0, 0.0))  # local +Z -> world +X (used for lathes along X)


# --------------------------------------------------------------------------- #
# Materials (Principled BSDF only -> survives glTF export, no textures needed)
# --------------------------------------------------------------------------- #
M_SS = "AISI304_Stainless"
M_SSP = "AISI304_Polished"
M_BRASS = "Brass"
M_BRONZE = "Bronze"
M_EPDM = "EPDM_Rubber_Black"
M_PVC = "PVC_Dark"
M_PAINT = "Motor_Paint_Blue"
M_STEEL = "Painted_Steel_Grey"
M_HOUSING = "Housing_Powdercoat"
M_GLASS = "Optical_Glass"
M_LENS = "Lens_RGB"
M_BORE = "Bore_Dark"
M_CERAMIC = "Ceramic_Insulator"

MATERIAL_SPECS = {
    M_SS: dict(color=(0.56, 0.57, 0.58), metallic=1.0, rough=0.30,
               note="AISI 304 stainless steel, brushed"),
    M_SSP: dict(color=(0.70, 0.71, 0.72), metallic=1.0, rough=0.07,
                note="AISI 304 stainless steel, mirror polished"),
    M_BRASS: dict(color=(0.80, 0.56, 0.22), metallic=1.0, rough=0.30,
                  note="Machined brass"),
    M_BRONZE: dict(color=(0.47, 0.29, 0.14), metallic=1.0, rough=0.42,
                   note="Cast gunmetal bronze"),
    M_EPDM: dict(color=(0.016, 0.016, 0.017), metallic=0.0, rough=0.88, spec=0.3,
                 note="Black EPDM rubber"),
    M_PVC: dict(color=(0.030, 0.034, 0.038), metallic=0.0, rough=0.45,
                note="Dark grey PVC / glass-filled polymer"),
    M_PAINT: dict(color=(0.020, 0.090, 0.220), metallic=0.0, rough=0.35, coat=0.35,
                  note="Painted motor housing"),
    M_STEEL: dict(color=(0.18, 0.19, 0.20), metallic=0.0, rough=0.55,
                  note="Painted carbon-steel baseframe"),
    M_HOUSING: dict(color=(0.045, 0.048, 0.052), metallic=0.0, rough=0.55,
                    note="Weatherproof powder-coated aluminium"),
    M_GLASS: dict(color=(0.95, 0.97, 0.98), metallic=0.0, rough=0.02, transmission=1.0, ior=1.52,
                  note="Optical glass window"),
    M_LENS: dict(color=(0.90, 0.93, 0.95), metallic=0.0, rough=0.15, transmission=0.92, ior=1.49,
                 note="Thick RGB luminaire lens - AquaFlow drives its emissive colour at runtime"),
    M_BORE: dict(color=(0.010, 0.010, 0.011), metallic=0.5, rough=0.60,
                 note="Dark interior of bores and recesses"),
    M_CERAMIC: dict(color=(0.80, 0.78, 0.72), metallic=0.0, rough=0.45,
                    note="Ceramic igniter insulator"),
}


def _set_input(node, names, value):
    for n in names:
        sock = node.inputs.get(n)
        if sock is not None:
            try:
                sock.default_value = value
                return True
            except Exception:
                pass
    return False


def make_material(name, spec):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or \
            nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    col = tuple(spec["color"]) + (1.0,)
    _set_input(bsdf, ("Base Color",), col)
    _set_input(bsdf, ("Metallic",), spec["metallic"])
    _set_input(bsdf, ("Roughness",), spec["rough"])
    if spec.get("transmission"):
        _set_input(bsdf, ("Transmission", "Transmission Weight"), spec["transmission"])
        _set_input(bsdf, ("IOR",), spec.get("ior", 1.5))
    if spec.get("coat"):
        _set_input(bsdf, ("Clearcoat", "Coat Weight"), spec["coat"])
    if spec.get("spec") is not None:
        _set_input(bsdf, ("Specular", "Specular IOR Level"), spec["spec"])
    mat.diffuse_color = col
    mat.metallic = spec["metallic"]
    mat.roughness = spec["rough"]
    mat["aquaflow_material"] = spec["note"]
    return mat


def make_materials():
    for name, spec in MATERIAL_SPECS.items():
        make_material(name, spec)


# --------------------------------------------------------------------------- #
# Mesh builder: every primitive is a closed shell built in a temp bmesh,
# normals recalculated outward, then merged into one mesh per part.
# --------------------------------------------------------------------------- #
class MeshBuilder:
    def __init__(self):
        self.bm = bmesh.new()
        self.materials = []

    def mi(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def _commit(self, src, matrix=None):
        if matrix is not None:
            bmesh.ops.transform(src, matrix=matrix, verts=list(src.verts))
        bmesh.ops.recalc_face_normals(src, faces=list(src.faces))
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = f.material_index
        src.free()

    # ---- solids of revolution ------------------------------------------- #
    def lathe(self, profile, mat, seg=40, matrix=None, dark_last=0, dark_mat=None,
              mats=None, phase=0.0):
        """Revolve an (r, z) profile around local Z.

        Profile either starts and ends on the axis (r == 0) or is a closed loop
        entirely off-axis. Edge k joins profile point k to k+1; `mats` maps
        edge index -> material, `dark_last` paints the last N edges dark
        (used for visible bores).
        """
        dark_mat = dark_mat or M_BORE
        pts = []
        for p in profile:
            r, z = max(0.0, float(p[0])), float(p[1])
            if pts and abs(pts[-1][0] - r) < 1e-9 and abs(pts[-1][1] - z) < 1e-9:
                continue
            pts.append((r, z))
        n = len(pts)
        if n < 2:
            return
        on_axis = [r < 1e-9 for r, _ in pts]
        axis_closed = on_axis[0] and on_axis[-1]
        if not axis_closed and any(on_axis):
            raise ValueError("lathe profile must start+end on the axis or be an off-axis loop")
        src = bmesh.new()
        rings = []
        for r, z in pts:
            if r < 1e-9:
                rings.append([src.verts.new((0.0, 0.0, z))])
            else:
                rings.append([src.verts.new((r * math.cos(phase + TAU * i / seg),
                                             r * math.sin(phase + TAU * i / seg), z))
                              for i in range(seg)])
        n_edges = n - 1 if axis_closed else n
        for k in range(n_edges):
            a, b = rings[k], rings[(k + 1) % n]
            if len(a) == 1 and len(b) == 1:
                continue
            m = mat
            if mats and k in mats:
                m = mats[k]
            if k >= n_edges - dark_last:
                m = dark_mat
            idx = self.mi(m)
            for i in range(seg):
                j = (i + 1) % seg
                if len(a) == 1:
                    vs = (a[0], b[i], b[j])
                elif len(b) == 1:
                    vs = (a[i], a[j], b[0])
                else:
                    vs = (a[i], a[j], b[j], b[i])
                try:
                    f = src.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = idx
        self._commit(src, matrix)

    def cylinder(self, r, z0, z1, mat, seg=32, chamfer=0.0, matrix=None):
        c = min(chamfer, r * 0.4, (z1 - z0) * 0.4)
        if c > 0:
            prof = [(0, z0), (r - c, z0), (r, z0 + c), (r, z1 - c), (r - c, z1), (0, z1)]
        else:
            prof = [(0, z0), (r, z0), (r, z1), (0, z1)]
        self.lathe(prof, mat, seg, matrix)

    def tube(self, r_out, r_in, z0, z1, mat, seg=32, chamfer=0.0, matrix=None, inner_mat=None):
        c = min(chamfer, (r_out - r_in) * 0.4, (z1 - z0) * 0.4)
        prof = [(r_in, z0), (r_out - c, z0), (r_out, z0 + c), (r_out, z1 - c), (r_out - c, z1), (r_in, z1)]
        self.lathe(prof, mat, seg, matrix, dark_last=1 if inner_mat else 0, dark_mat=inner_mat)

    def hex_prism(self, R, z0, z1, mat, matrix=None, chamfer=None):
        """Hexagon (circumradius R) extruded along local Z, chamfered."""
        c = chamfer if chamfer is not None else min(0.08 * R, 0.2 * (z1 - z0))
        prof = [(0, z0), (R - c, z0), (R, z0 + c), (R, z1 - c), (R - c, z1), (0, z1)]
        self.lathe(prof, mat, seg=6, matrix=matrix, phase=math.pi / 6)

    def sphere(self, r, center, mat, seg=16, rings=8):
        prof = [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings))
                for i in range(rings + 1)]
        self.lathe(prof, mat, seg, T(*center))

    def torus(self, R, r, mat, seg=48, minor=8, matrix=None):
        prof = [(R + r * math.cos(TAU * i / minor), r * math.sin(TAU * i / minor)) for i in range(minor)]
        self.lathe(prof, mat, seg, matrix)

    def thread_solid(self, r, z0, z1, pitch, depth, mat, seg=24, matrix=None):
        prof = [(0, z0), (r - depth, z0)]
        z = z0
        while z + pitch <= z1 + 1e-9:
            prof += [(r, z + pitch * 0.5), (r - depth, z + pitch)]
            z += pitch
        prof += [(r - depth, z1), (0, z1)]
        self.lathe(prof, mat, seg, matrix)

    def thread_tube(self, r_out, r_in, z0, z1, pitch, depth, mat, seg=24, matrix=None):
        """Hollow male thread; the bore is painted dark."""
        prof = [(r_in, z0), (r_out - depth, z0)]
        z = z0
        while z + pitch <= z1 + 1e-9:
            prof += [(r_out, z + pitch * 0.5), (r_out - depth, z + pitch)]
            z += pitch
        prof += [(r_out - depth, z1), (r_in, z1)]
        self.lathe(prof, mat, seg, matrix, dark_last=1)

    # ---- prismatic -------------------------------------------------------- #
    def box(self, size, center, mat, bevel=0.0, bseg=1, matrix=None):
        src = bmesh.new()
        bmesh.ops.create_cube(src, size=1.0)
        sx, sy, sz = size
        for v in src.verts:
            v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
        if bevel > 0:
            bmesh.ops.bevel(src, geom=list(src.verts) + list(src.edges), offset=bevel,
                            offset_type="OFFSET", segments=bseg, profile=0.5,
                            affect="EDGES", clamp_overlap=True)
        idx = self.mi(mat)
        for f in src.faces:
            f.material_index = idx
        M = T(*center)
        if matrix is not None:
            M = matrix @ M
        self._commit(src, M)

    def prism(self, pts_xz, y0, y1, mat, matrix=None):
        """Polygon in the XZ plane extruded along Y (y0 -> y1)."""
        src = bmesh.new()
        bot = [src.verts.new((x, y0, z)) for x, z in pts_xz]
        top = [src.verts.new((x, y1, z)) for x, z in pts_xz]
        src.faces.new(bot)
        src.faces.new(list(reversed(top)))
        n = len(pts_xz)
        for i in range(n):
            j = (i + 1) % n
            src.faces.new((bot[i], bot[j], top[j], top[i]))
        idx = self.mi(mat)
        for f in src.faces:
            f.material_index = idx
        self._commit(src, matrix)

    def sweep(self, points, radii, mat, seg=16, matrix=None):
        """Closed tube along a polyline (parallel-transport frames, capped)."""
        P = [Vector(p) for p in points]
        n = len(P)
        if not isinstance(radii, (list, tuple)):
            radii = [radii] * n
        tans = []
        for i in range(n):
            if i == 0:
                t = P[1] - P[0]
            elif i == n - 1:
                t = P[-1] - P[-2]
            else:
                t = P[i + 1] - P[i - 1]
            tans.append(t.normalized())
        nrm = [tans[0].orthogonal().normalized()]
        for i in range(1, n):
            q = tans[i - 1].rotation_difference(tans[i])
            v = q @ nrm[-1]
            v = (v - tans[i] * v.dot(tans[i])).normalized()
            nrm.append(v)
        src = bmesh.new()
        rings = []
        for i in range(n):
            b = tans[i].cross(nrm[i]).normalized()
            rings.append([src.verts.new(P[i] + radii[i] * (math.cos(TAU * k / seg) * nrm[i] +
                                                           math.sin(TAU * k / seg) * b))
                          for k in range(seg)])
        idx = self.mi(mat)
        for i in range(n - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(seg):
                kk = (k + 1) % seg
                src.faces.new((a[k], a[kk], b[kk], b[k])).material_index = idx
        c0 = src.verts.new(P[0])
        c1 = src.verts.new(P[-1])
        for k in range(seg):
            kk = (k + 1) % seg
            src.faces.new((c0, rings[0][kk], rings[0][k])).material_index = idx
            src.faces.new((c1, rings[-1][k], rings[-1][kk])).material_index = idx
        self._commit(src, matrix)

    # ---- output ----------------------------------------------------------- #
    def finalize(self, name, collection, parent, location):
        bm = self.bm
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) != 2:
                e.smooth = False
                continue
            try:
                ang = e.calc_face_angle(0.0)
            except Exception:
                ang = 0.0
            e.smooth = ang <= SHARP_ANGLE  # hard edge above 35 deg
        me = bpy.data.meshes.new(name + "_Mesh")
        bm.to_mesh(me)
        bm.free()
        self.bm = None
        for m in self.materials:
            me.materials.append(bpy.data.materials[m])
        if hasattr(me, "use_auto_smooth"):  # Blender < 4.1
            me.use_auto_smooth = True
            me.auto_smooth_angle = SHARP_ANGLE
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        ob.parent = parent
        ob.location = location
        wn = ob.modifiers.new("WeightedNormals", "WEIGHTED_NORMAL")
        wn.mode = "FACE_AREA"
        wn.weight = 50
        wn.keep_sharp = True
        return ob


# --------------------------------------------------------------------------- #
# Reusable mechanical details
# --------------------------------------------------------------------------- #
def bolt(b, pos, d, direction=(0, 0, 1), mat=M_SS):
    """Washer + hex head + protruding stud tip. `pos` is the seating face."""
    M = place(pos, direction)
    b.cylinder(0.95 * d, 0.0, 0.12 * d, mat, seg=12, matrix=M)
    b.hex_prism(0.92 * d, 0.12 * d, 0.77 * d, mat, matrix=M)
    b.cylinder(0.45 * d, 0.77 * d, 1.10 * d, mat, seg=8, chamfer=0.1 * d, matrix=M)


def cap_screw(b, pos, d, direction=(0, 0, 1), mat=M_SS):
    """Socket-head cap screw with a dark drive recess."""
    M = place(pos, direction)
    b.lathe([(0, 0), (0.8 * d, 0), (0.8 * d, 0.55 * d), (0.7 * d, 0.7 * d),
             (0.38 * d, 0.7 * d), (0.38 * d, 0.35 * d), (0, 0.33 * d)],
            mat, seg=12, matrix=M, dark_last=2)


def recess_hole(b, pos, normal, r, depth, rim=0.0025, mat=M_SS, seg=12):
    """Raised rim with a dark blind bore (air intakes, vents, burner ports)."""
    ro = r + rim
    M = place(pos, normal)
    b.lathe([(0, -(depth + 0.003)), (ro, -(depth + 0.003)), (ro, 0.002),
             (ro - 0.6 * rim, 0.0032), (r, 0.0032), (r, -depth), (0, -depth)],
            mat, seg=seg, matrix=M, dark_last=2)


def cable_gland(b, pos, direction, s=0.010, cable_len=0.04):
    M = place(pos, direction)
    b.hex_prism(1.15 * s, 0.0, 0.55 * s, M_SS, matrix=M)
    b.lathe([(0, 0.5 * s), (0.95 * s, 0.5 * s), (0.95 * s, 1.2 * s), (0.75 * s, 1.55 * s),
             (0.5 * s, 1.6 * s), (0, 1.6 * s)], M_SS, seg=16, matrix=M)
    b.cylinder(0.42 * s, 1.5 * s, 1.6 * s + cable_len, M_EPDM, seg=12, matrix=M)


def mounting_flange(b, r_out, thick, n_bolts, pcd, bolt_d, gasket=0.003, mat=M_SS,
                    seg=48, bolt_phase=math.pi / 4):
    """EPDM gasket at Z=0, flange on top, bolt heads on the flange face."""
    if gasket:
        b.cylinder(r_out * 0.96, 0.0, gasket, M_EPDM, seg=seg)
    z0, z1 = gasket, gasket + thick
    c = min(0.0015, thick * 0.2)
    b.lathe([(0, z0), (r_out - c, z0), (r_out, z0 + c), (r_out, z1 - c), (r_out - c, z1), (0, z1)],
            mat, seg)
    for i in range(n_bolts):
        a = bolt_phase + TAU * i / n_bolts
        bolt(b, (pcd * math.cos(a), pcd * math.sin(a), z1), bolt_d)
    return z1


# --------------------------------------------------------------------------- #
# Asset container
# --------------------------------------------------------------------------- #
class AssetBuild:
    def __init__(self, spec, parent_coll):
        self.spec = spec
        self.name = spec["name"]
        self.coll = bpy.data.collections.new(self.name)
        parent_coll.children.link(self.coll)
        r = bpy.data.objects.new(self.name, None)
        r.empty_display_type = "PLAIN_AXES"
        r.empty_display_size = 0.05
        self.coll.objects.link(r)
        r["aquaflow_name"] = self.name
        r["aquaflow_asset"] = self.name
        r["aquaflow_role"] = spec["role"]
        r["collision"] = spec.get("collision", "aabb")
        r["units"] = "metres"
        r["mounting_origin"] = "base centre at local origin, base plane Z=0 (glTF Y=0)"
        r["socket_axis"] = "socket local +Z (glTF +Y) = flow/emission/connection direction"
        r["generator"] = f"generate_fountain_assets.py {SCRIPT_VERSION}"
        r["description"] = spec["description"]
        self.root = r
        self.sockets = []
        self.pivots = []

    def part(self, b, name, parent=None, location=(0, 0, 0), pivot=None):
        ob = b.finalize(name, self.coll, parent or self.root, Vector(location))
        ob["aquaflow_name"] = name
        ob["aquaflow_part"] = True
        if pivot:
            for k, v in pivot.items():
                ob[k] = v
            self.pivots.append(name)
        return ob

    def socket(self, name, loc, direction=(0, 0, 1), parent=None, kind="connection", **props):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "SINGLE_ARROW"
        e.empty_display_size = 0.04
        self.coll.objects.link(e)
        e.parent = parent or self.root
        e.location = Vector(loc)
        e.rotation_euler = rot_to(direction).to_euler()
        e["aquaflow_name"] = name
        e["aquaflow_socket"] = kind
        for k, v in props.items():
            e[k] = v
        self.sockets.append(name)
        return e

    def objects(self):
        return [self.root] + list(self.root.children_recursive)


# --------------------------------------------------------------------------- #
# 1. Straight clear-jet nozzle DN25
# --------------------------------------------------------------------------- #
def build_nozzle_straight(A):
    b = MeshBuilder()
    z = mounting_flange(b, 0.055, 0.012, 4, 0.042, 0.008)
    b.thread_solid(0.0167, z, z + 0.022, 0.0023, 0.0011, M_BRASS)
    z1 = z + 0.022
    b.hex_prism(0.026, z1 - 0.001, z1 + 0.015, M_BRASS)
    b.lathe([(0, 0.050), (0.020, 0.050), (0.020, 0.058), (0.0185, 0.064), (0.0175, 0.135),
             (0.0175, 0.160), (0.0108, 0.205), (0.0108, 0.214), (0.0096, 0.2198), (0.0074, 0.220),
             (0.0062, 0.2185), (0.0062, 0.170), (0, 0.168)], M_BRASS, seg=40, dark_last=2)
    # stainless flow-straightener collar with grip grooves
    b.lathe([(0.0172, 0.132), (0.0225, 0.132), (0.0235, 0.134), (0.0235, 0.141), (0.0222, 0.142),
             (0.0222, 0.145), (0.0235, 0.146), (0.0235, 0.151), (0.0222, 0.152), (0.0222, 0.155),
             (0.0235, 0.156), (0.0235, 0.161), (0.0225, 0.163), (0.0172, 0.163)], M_SS, seg=40)
    cap_screw(b, (0.0233, 0, 0.1485), 0.0035, (1, 0, 0))
    A.part(b, "Nozzle_Body")
    A.socket("NozzleSocket", (0, 0, 0.220), (0, 0, 1), kind="water_outlet", outlet_diameter_m=0.0124)
    A.socket("InletSocket", (0, 0, 0), (0, 0, -1), kind="pipe_inlet", nominal_size="DN25")


# --------------------------------------------------------------------------- #
# 2. Aerated / foam nozzle DN40
# --------------------------------------------------------------------------- #
def build_nozzle_aerated(A):
    b = MeshBuilder()
    z = mounting_flange(b, 0.075, 0.014, 4, 0.058, 0.010)
    b.thread_solid(0.0240, z, z + 0.028, 0.0023, 0.0012, M_BRONZE)
    b.hex_prism(0.036, z + 0.027, z + 0.048, M_BRONZE)
    b.lathe([(0, 0.062), (0.031, 0.062), (0.031, 0.098), (0.033, 0.100), (0.033, 0.112), (0, 0.112)],
            M_BRONZE, seg=40)
    # aeration chamber with wide foam outlet
    b.lathe([(0, 0.110), (0.046, 0.110), (0.052, 0.116), (0.052, 0.250), (0.046, 0.262),
             (0.036, 0.272), (0.034, 0.275), (0.034, 0.312), (0.032, 0.3195), (0.029, 0.320),
             (0.026, 0.318), (0.026, 0.235), (0, 0.232)], M_SS, seg=48, dark_last=2)
    for zz in (0.128, 0.238):
        b.tube(0.0545, 0.051, zz, zz + 0.006, M_SS, seg=48, chamfer=0.001)
    # two staggered rows of air-intake holes
    for row, zz in enumerate((0.165, 0.205)):
        for i in range(8):
            a = TAU * i / 8 + (math.pi / 8 if row else 0.0)
            u = Vector((math.cos(a), math.sin(a), 0))
            recess_hole(b, u * 0.052 + Vector((0, 0, zz)), u, 0.0055, 0.004, rim=0.0025)
    A.part(b, "Nozzle_Body")
    A.socket("NozzleSocket", (0, 0, 0.320), (0, 0, 1), kind="water_outlet", outlet_diameter_m=0.052)
    A.socket("InletSocket", (0, 0, 0), (0, 0, -1), kind="pipe_inlet", nominal_size="DN40")


# --------------------------------------------------------------------------- #
# 3. Laminar nozzle DN25
# --------------------------------------------------------------------------- #
def build_nozzle_laminar(A):
    b = MeshBuilder()
    z = mounting_flange(b, 0.060, 0.012, 4, 0.046, 0.008)
    b.thread_solid(0.0167, z, z + 0.020, 0.0023, 0.0011, M_BRASS)
    b.hex_prism(0.026, z + 0.019, z + 0.034, M_BRASS)
    b.lathe([(0, 0.048), (0.0195, 0.048), (0.0195, 0.056), (0.0365, 0.072), (0.0375, 0.075),
             (0.0375, 0.232), (0.0365, 0.235), (0.0115, 0.272), (0, 0.272)], M_SS, seg=48)
    for zz in (0.080, 0.152, 0.222):
        b.tube(0.0405, 0.0370, zz, zz + 0.008, M_SS, seg=48, chamfer=0.001)
        cap_screw(b, (0.0403, 0, zz + 0.004), 0.003, (1, 0, 0))
    # narrow polished outlet tip
    b.lathe([(0, 0.268), (0.0118, 0.268), (0.0118, 0.276), (0.0072, 0.292), (0.0060, 0.2995),
             (0.0049, 0.300), (0.0040, 0.2985), (0.0040, 0.272), (0, 0.270)], M_SSP, seg=40, dark_last=2)
    bolt(b, (-0.0372, 0, 0.115), 0.007, (-1, 0, 0))  # purge plug
    A.part(b, "Nozzle_Body")
    A.socket("NozzleSocket", (0, 0, 0.300), (0, 0, 1), kind="water_outlet", outlet_diameter_m=0.008)
    A.socket("InletSocket", (0, 0, 0), (0, 0, -1), kind="pipe_inlet", nominal_size="DN25")


# --------------------------------------------------------------------------- #
# 4. Fan nozzle DN25 with a real slot
# --------------------------------------------------------------------------- #
def build_nozzle_fan(A):
    b = MeshBuilder()
    z = mounting_flange(b, 0.050, 0.012, 4, 0.038, 0.007)
    b.thread_solid(0.0167, z, z + 0.020, 0.0023, 0.0011, M_BRASS)
    b.hex_prism(0.026, z + 0.019, z + 0.034, M_BRASS)
    b.lathe([(0, 0.047), (0.019, 0.047), (0.019, 0.070), (0.023, 0.078), (0.023, 0.100), (0, 0.100)],
            M_BRASS, seg=40)
    half_d, gap = 0.024, 0.0015
    b.prism([(-0.030, 0.095), (0.030, 0.095), (0.140, 0.150), (0.140, 0.156),
             (-0.140, 0.156), (-0.140, 0.150)], -half_d, half_d, M_SS)
    lip_t = half_d - gap
    for s in (-1, 1):
        b.box((0.280, lip_t, 0.026), (0, s * (gap + lip_t / 2), 0.169), M_SS, bevel=0.0012)
        b.box((0.016, 2 * gap + 0.001, 0.026), (s * 0.132, 0, 0.169), M_SS)
    b.box((0.250, 2 * gap + 0.0004, 0.006), (0, 0, 0.157), M_BORE)  # slot floor
    for x in (-0.105, -0.035, 0.035, 0.105):
        for s in (-1, 1):
            cap_screw(b, (x, s * half_d, 0.169), 0.0035, (0, s, 0))
    A.part(b, "Nozzle_Body")
    A.socket("NozzleSocket", (0, 0, 0.182), (0, 0, 1), kind="water_outlet",
             fan_slot_length_m=0.25, fan_slot_width_m=0.003, fan_plane="local XZ")
    A.socket("InletSocket", (0, 0, 0), (0, 0, -1), kind="pipe_inlet", nominal_size="DN25")


# --------------------------------------------------------------------------- #
# 5. Rotating 3-outlet basket nozzle
# --------------------------------------------------------------------------- #
def build_basket(A):
    b = MeshBuilder()
    z = mounting_flange(b, 0.090, 0.014, 6, 0.072, 0.010)
    b.thread_solid(0.030, z, z + 0.026, 0.0028, 0.0014, M_BRONZE, seg=28)
    b.hex_prism(0.042, z + 0.025, z + 0.046, M_BRONZE)
    b.lathe([(0, 0.060), (0.034, 0.060), (0.034, 0.148), (0.038, 0.153), (0.038, 0.168), (0, 0.168)],
            M_BRONZE, seg=48)
    b.lathe([(0, 0.166), (0.046, 0.166), (0.048, 0.168), (0.048, 0.186), (0.046, 0.188), (0, 0.188)],
            M_SS, seg=48)
    b.torus(0.034, 0.0025, M_EPDM, seg=40, minor=6, matrix=T(0, 0, 0.189))
    base = A.part(b, "Basket_Base")

    pivot_z = 0.188
    r = MeshBuilder()
    r.lathe([(0, 0), (0.042, 0), (0.044, 0.003), (0.044, 0.032), (0.036, 0.046), (0.014, 0.056), (0, 0.056)],
            M_SS, seg=48)
    r.hex_prism(0.013, 0.054, 0.066, M_SS)
    outlets = []
    for k in range(3):
        th = math.pi / 2 + TAU * k / 3
        u = Vector((math.cos(th), math.sin(th), 0))
        t = Vector((-math.sin(th), math.cos(th), 0))
        S = u * 0.035 + Vector((0, 0, 0.022))
        C = u * 0.150 + Vector((0, 0, 0.030))
        E = u * 0.205 + Vector((0, 0, 0.100))
        pts = [S.lerp(C, s).lerp(C.lerp(E, s), s) for s in [i / 8 for i in range(9)]]
        r.sweep(pts, 0.013, M_SS, seg=14)
        r.sphere(0.018, E, M_SS, seg=16, rings=8)
        d = (u * 0.30 + t * 0.35 + Vector((0, 0, 1))).normalized()
        r.lathe([(0, -0.010), (0.0165, -0.010), (0.0165, 0.028), (0.0125, 0.068), (0.0108, 0.084),
                 (0.0090, 0.088), (0.0065, 0.088), (0.0065, 0.060), (0, 0.058)],
                M_BRASS, seg=20, matrix=place(E, d), dark_last=2)
        outlets.append((E + d * 0.088, d))
    r.torus(0.205, 0.008, M_SS, seg=72, minor=8, matrix=T(0, 0, 0.100))
    rotor = A.part(r, "Rotor_Z", parent=base, location=(0, 0, pivot_z),
                   pivot={"aquaflow_pivot": "spin", "pivot_axis": "Z", "rotation_range_deg": "continuous"})
    for i, (pos, d) in enumerate(outlets, 1):
        A.socket(f"Outlet_{i}", pos, d, parent=rotor, kind="water_outlet", outlet_diameter_m=0.013)
    A.socket("InletSocket", (0, 0, 0), (0, 0, -1), kind="pipe_inlet", nominal_size="DN50")


# --------------------------------------------------------------------------- #
# 6. Two-axis robotic nozzle
# --------------------------------------------------------------------------- #
def build_motion_2d(A):
    b = MeshBuilder()
    b.box((0.250, 0.250, 0.003), (0, 0, 0.0015), M_EPDM)
    b.box((0.260, 0.260, 0.016), (0, 0, 0.011), M_SS, bevel=0.003)
    for x in (-0.105, 0.105):
        for y in (-0.105, 0.105):
            bolt(b, (x, y, 0.019), 0.012)
    b.lathe([(0, 0.019), (0.095, 0.019), (0.098, 0.022), (0.098, 0.185), (0.094, 0.192), (0.080, 0.198),
             (0, 0.198)], M_PAINT, seg=56)
    b.tube(0.108, 0.090, 0.019, 0.031, M_SS, seg=56, chamfer=0.0015)
    for i in range(8):
        a = TAU * i / 8 + math.pi / 8
        bolt(b, (0.1015 * math.cos(a), 0.1015 * math.sin(a), 0.031), 0.006)
    b.lathe([(0, 0.196), (0.072, 0.196), (0.074, 0.198), (0.074, 0.210), (0.072, 0.212), (0, 0.212)],
            M_SS, seg=48)
    cable_gland(b, (0, -0.0975, 0.080), (0, -1, 0), s=0.009, cable_len=0.04)
    base = A.part(b, "Base", pivot={"aquaflow_pivot": "fixed_base", "pivot_axis": "none"})

    p = MeshBuilder()  # Pan_Z local frame (origin on the pan axis at the bearing face)
    p.lathe([(0, 0), (0.070, 0), (0.072, 0.002), (0.072, 0.018), (0.068, 0.022), (0, 0.022)], M_SS, seg=48)
    p.box((0.166, 0.070, 0.012), (0, 0, 0.028), M_SS, bevel=0.002)
    for s in (-1, 1):
        p.box((0.016, 0.070, 0.120), (s * 0.075, 0, 0.094), M_SS, bevel=0.002)
        p.cylinder(0.035, -0.008, 0.008, M_SS, seg=32, matrix=T(s * 0.075, 0, 0.153) @ AX)
    p.cylinder(0.032, 0.083, 0.135, M_PAINT, seg=32, chamfer=0.003, matrix=T(0, 0, 0.153) @ AX)
    p.cylinder(0.026, 0.135, 0.140, M_SS, seg=32, chamfer=0.001, matrix=T(0, 0, 0.153) @ AX)
    p.cylinder(0.024, -0.091, -0.083, M_SS, seg=32, chamfer=0.0015, matrix=T(0, 0, 0.153) @ AX)
    cable_gland(p, (0.110, 0, 0.122), (0, 0, -1), s=0.006, cable_len=0.02)
    pan = A.part(p, "Pan_Z", parent=base, location=(0, 0, 0.212),
                 pivot={"aquaflow_pivot": "pan", "pivot_axis": "Z", "rotation_range_deg": "continuous"})

    t = MeshBuilder()  # Tilt_X local frame (origin on the yoke axis)
    t.cylinder(0.030, -0.067, 0.067, M_SS, seg=32, chamfer=0.002, matrix=AX)
    t.lathe([(0, 0.0), (0.026, 0.0), (0.026, 0.040), (0.022, 0.050), (0.022, 0.118), (0.013, 0.162),
             (0.0115, 0.177), (0.0098, 0.185), (0.0068, 0.185), (0.0068, 0.150), (0, 0.148)],
            M_SSP, seg=40, dark_last=2)
    t.tube(0.0245, 0.0215, 0.060, 0.070, M_SS, seg=40, chamfer=0.001)
    tilt = A.part(t, "Tilt_X", parent=pan, location=(0, 0, 0.153),
                  pivot={"aquaflow_pivot": "tilt", "pivot_axis": "X", "rotation_range_deg": "-90..90"})
    A.socket("NozzleSocket", (0, 0, 0.185), (0, 0, 1), parent=tilt, kind="water_outlet",
             outlet_diameter_m=0.0136)


# --------------------------------------------------------------------------- #
# 7. Submersible RGB luminaire
# --------------------------------------------------------------------------- #
def build_light(A):
    b = MeshBuilder()
    b.box((0.200, 0.060, 0.006), (0, 0, 0.003), M_SS, bevel=0.0015)
    for x in (-0.075, 0.075):
        bolt(b, (x, 0, 0.006), 0.007)
    for s in (-1, 1):
        x = s * 0.1065
        b.box((0.006, 0.040, 0.062), (x, 0, 0.037), M_SS, bevel=0.001)
        b.cylinder(0.020, -0.003, 0.003, M_SS, seg=24, matrix=T(x, 0, 0.068) @ AX)
        bolt(b, (s * 0.1095, 0, 0.068), 0.009, (s, 0, 0))
    A.part(b, "Mounting_Bracket")

    h = MeshBuilder()
    h.lathe([(0, 0.014), (0.086, 0.014), (0.096, 0.020), (0.100, 0.030), (0.100, 0.100), (0.087, 0.100),
             (0.087, 0.090), (0, 0.090)], M_SS, seg=56)
    h.cylinder(0.080, 0.090, 0.092, M_PVC, seg=40)
    h.cylinder(0.007, 0.092, 0.095, M_CERAMIC, seg=12)
    for i in range(6):
        a = TAU * i / 6
        h.cylinder(0.007, 0.092, 0.095, M_CERAMIC, seg=12, matrix=T(0.040 * math.cos(a), 0.040 * math.sin(a), 0))
    h.lathe([(0.083, 0.098), (0.108, 0.098), (0.110, 0.100), (0.110, 0.112), (0.106, 0.117),
             (0.095, 0.120), (0.083, 0.120)], M_SSP, seg=64)
    for i in range(6):
        a = TAU * i / 6 + math.pi / 6
        cap_screw(h, (0.100 * math.cos(a), 0.100 * math.sin(a), 0.1155), 0.004)
    h.lathe([(0, 0.096), (0.085, 0.096), (0.085, 0.112), (0.082, 0.115), (0.050, 0.1165), (0, 0.117)],
            M_LENS, seg=56)
    for s in (-1, 1):
        h.cylinder(0.016, -0.002, 0.002, M_SS, seg=24, matrix=T(s * 0.1015, 0, 0.068) @ AX)
    cable_gland(h, (0, -0.0995, 0.050), (0, -1, 0), s=0.009, cable_len=0.03)
    body = A.part(h, "Luminaire_Body")
    A.socket("LightSocket", (0, 0, 0.117), (0, 0, 1), parent=body, kind="light_emitter",
             beam_axis="+Z", emissive_material=M_LENS)


# --------------------------------------------------------------------------- #
# 8. Dry-installed centrifugal pump
# --------------------------------------------------------------------------- #
def build_pump(A):
    b = MeshBuilder()
    zc = 0.24
    MX = T(0, 0, zc) @ AX
    b.box((0.84, 0.44, 0.025), (0, 0, 0.0125), M_STEEL, bevel=0.003)
    for x in (-0.39, 0.39):
        for y in (-0.19, 0.19):
            bolt(b, (x, y, 0.025), 0.014)
    for x in (-0.30, -0.06):  # motor feet
        b.box((0.07, 0.30, 0.012), (x, 0, 0.031), M_PAINT, bevel=0.002)
        b.box((0.05, 0.18, 0.075), (x, 0, 0.0745), M_PAINT, bevel=0.002)
        for y in (-0.12, 0.12):
            bolt(b, (x, y, 0.037), 0.012)
    b.box((0.09, 0.26, 0.012), (0.18, 0, 0.031), M_STEEL, bevel=0.002)  # pump foot
    b.box((0.06, 0.14, 0.060), (0.18, 0, 0.067), M_STEEL, bevel=0.002)
    for y in (-0.10, 0.10):
        bolt(b, (0.18, y, 0.037), 0.012)
    # motor, fan cowl, grille
    b.lathe([(0, -0.36), (0.135, -0.36), (0.145, -0.35), (0.145, 0.02), (0.132, 0.03), (0, 0.03)],
            M_PAINT, seg=56, matrix=MX)
    b.lathe([(0, -0.425), (0.130, -0.425), (0.148, -0.418), (0.152, -0.405), (0.152, -0.36), (0, -0.36)],
            M_PAINT, seg=56, matrix=MX)
    for R in (0.030, 0.060, 0.090, 0.120):
        b.torus(R, 0.0035, M_BORE, seg=48, minor=6, matrix=MX @ T(0, 0, -0.4255))
    # cooling fins
    n_fins = 30
    for k in range(n_fins):
        phi = TAU * k / n_fins
        if math.sin(phi) > 0.82 or math.sin(phi) < -0.60:
            continue
        R = Matrix.Rotation(phi - math.pi / 2, 4, "X")
        b.box((0.34, 0.004, 0.024), (0, 0, 0), M_PAINT,
              matrix=T(-0.17, 0, zc) @ R @ T(0, 0, 0.153))
    # terminal box
    b.box((0.13, 0.14, 0.07), (-0.13, 0, 0.42), M_PAINT, bevel=0.006, bseg=2)
    b.box((0.136, 0.146, 0.010), (-0.13, 0, 0.460), M_PAINT, bevel=0.003)
    for dx in (-0.055, 0.055):
        for dy in (-0.06, 0.06):
            cap_screw(b, (-0.13 + dx, dy, 0.465), 0.004)
    cable_gland(b, (-0.13, -0.0695, 0.415), (0, -1, 0), s=0.010, cable_len=0.05)
    # bearing lantern and volute
    b.lathe([(0, 0.03), (0.10, 0.03), (0.10, 0.042), (0.075, 0.056), (0.075, 0.098), (0.118, 0.106),
             (0.118, 0.112), (0, 0.112)], M_PAINT, seg=48, matrix=MX)
    b.lathe([(0, 0.108), (0.125, 0.108), (0.135, 0.118), (0.135, 0.232), (0.125, 0.242), (0, 0.242)],
            M_BRONZE, seg=56, matrix=MX)
    xs, pts, rad = 0.18, [], []
    n_sp = 40
    for i in range(n_sp + 1):
        tt = i / n_sp
        phi = 0.25 + (TAU - 0.25) * tt
        R = 0.085 + 0.050 * tt
        pts.append((xs, R * math.cos(phi), zc + R * math.sin(phi)))
        rad.append(0.028 + 0.032 * tt)
    for h, rr in ((0.04, 0.059), (0.09, 0.056), (0.14, 0.053), (0.18, 0.051), (0.212, 0.050)):
        pts.append((xs, 0.135, zc + h))
        rad.append(rr)
    b.sweep(pts, rad, M_BRONZE, seg=24)
    b.lathe([(0, 0.445), (0.058, 0.445), (0.058, 0.462), (0.085, 0.462), (0.085, 0.488), (0.083, 0.490),
             (0.042, 0.490), (0.042, 0.452), (0, 0.450)], M_BRONZE, seg=48, matrix=T(xs, 0.135, 0), dark_last=2)
    for i in range(4):
        a = math.pi / 4 + TAU * i / 4
        bolt(b, (xs + 0.068 * math.cos(a), 0.135 + 0.068 * math.sin(a), 0.490), 0.010)
    # axial suction inlet
    b.lathe([(0, 0.24), (0.062, 0.24), (0.062, 0.36), (0.075, 0.365), (0.075, 0.375), (0.100, 0.375),
             (0.100, 0.398), (0.098, 0.400), (0.048, 0.400), (0.048, 0.370), (0, 0.368)],
            M_BRONZE, seg=48, matrix=MX, dark_last=2)
    for i in range(6):
        a = TAU * i / 6
        bolt(b, (0.400, 0.085 * math.cos(a), zc + 0.085 * math.sin(a)), 0.010, (1, 0, 0))
    A.part(b, "Pump_Body")
    A.socket("InletSocket", (0.400, 0, zc), (1, 0, 0), kind="pipe_inlet", nominal_size="DN100")
    A.socket("OutletSocket", (xs, 0.135, 0.490), (0, 0, 1), kind="pipe_outlet", nominal_size="DN80")


# --------------------------------------------------------------------------- #
# 9. Solenoid valve DN25
# --------------------------------------------------------------------------- #
def build_valve(A):
    b = MeshBuilder()
    zc = 0.036
    b.box((0.090, 0.056, 0.072), (0, 0, 0.036), M_BRASS, bevel=0.006, bseg=2)
    for s in (-1, 1):
        M = T(0, 0, zc) @ rot_to((s, 0, 0))
        b.hex_prism(0.027, 0.040, 0.072, M_BRASS, matrix=M)
        b.thread_tube(0.0167, 0.0125, 0.072, 0.140, 0.0023, 0.0011, M_BRASS, matrix=M)
    b.lathe([(0, 0.070), (0.027, 0.070), (0.027, 0.080), (0.021, 0.084), (0.021, 0.096), (0, 0.096)],
            M_BRASS, seg=40)
    b.box((0.064, 0.064, 0.074), (0, 0, 0.133), M_PVC, bevel=0.005, bseg=2)  # coil overmould
    b.hex_prism(0.012, 0.170, 0.178, M_SS)
    b.cylinder(0.005, 0.178, 0.184, M_SS, seg=12, chamfer=0.001)
    b.box((0.034, 0.026, 0.040), (0, 0.045, 0.140), M_PVC, bevel=0.003)  # connector base
    b.box((0.030, 0.022, 0.036), (0, 0.069, 0.140), M_PVC, bevel=0.003)  # plug
    cap_screw(b, (0, 0.080, 0.140), 0.004, (0, 1, 0))
    cable_gland(b, (0, 0.069, 0.122), (0, 0, -1), s=0.007, cable_len=0.02)
    arrow = [(-0.030, 0.032), (0.010, 0.032), (0.010, 0.026), (0.030, 0.036), (0.010, 0.046),
             (0.010, 0.040), (-0.030, 0.040)]
    b.prism(arrow, -0.0295, -0.0275, M_BRASS)  # cast flow-direction arrow (+X)
    A.part(b, "Valve_Body")
    A.socket("InletSocket", (-0.140, 0, zc), (-1, 0, 0), kind="pipe_inlet", nominal_size="DN25")
    A.socket("OutletSocket", (0.140, 0, zc), (1, 0, 0), kind="pipe_outlet", nominal_size="DN25")


# --------------------------------------------------------------------------- #
# 10. Four-way stainless manifold
# --------------------------------------------------------------------------- #
def build_manifold(A):
    b = MeshBuilder()
    zc = 0.16
    MX = T(0, 0, zc) @ AX
    b.lathe([(0, -0.36), (0.0445, -0.36), (0.0445, 0.36), (0.043, 0.372), (0.038, 0.385), (0.030, 0.394),
             (0.016, 0.399), (0, 0.400)], M_SS, seg=48, matrix=MX, mats={0: M_BORE})
    b.lathe([(0.040, -0.400), (0.093, -0.400), (0.095, -0.398), (0.095, -0.379), (0.062, -0.375),
             (0.050, -0.355), (0.040, -0.355)], M_SS, seg=48, matrix=MX, dark_last=1)
    for i in range(8):
        a = TAU * i / 8 + math.pi / 8
        bolt(b, (-0.400, 0.077 * math.cos(a), zc + 0.077 * math.sin(a)), 0.012, (-1, 0, 0))
    xs = (-0.24, -0.08, 0.08, 0.24)
    for x in xs:
        b.cylinder(0.0168, zc, 0.224, M_SS, seg=28, matrix=T(x, 0, 0))
        b.torus(0.0172, 0.003, M_SS, seg=28, minor=6, matrix=T(x, 0, zc + 0.044))  # weld bead
        b.hex_prism(0.026, 0.222, 0.246, M_SS, matrix=T(x, 0, 0))
        b.lathe([(0, 0.244), (0.0225, 0.244), (0.0225, 0.256), (0.021, 0.258), (0.0145, 0.258),
                 (0.0145, 0.236), (0, 0.234)], M_SS, seg=32, matrix=T(x, 0, 0), dark_last=2)
    Rz = Matrix.Rotation(math.pi / 2, 4, "Z")
    for x in (-0.30, 0.30):
        b.box((0.10, 0.17, 0.012), (x, 0, 0.006), M_SS, bevel=0.002)
        for y in (-0.065, 0.065):
            bolt(b, (x, y, 0.012), 0.010)
        b.prism([(-0.07, 0.012), (0.07, 0.012), (0.05, 0.108), (-0.05, 0.108)], -0.006, 0.006, M_SS,
                matrix=T(x, 0, 0) @ Rz)
        b.box((0.024, 0.13, 0.008), (x, 0, 0.104), M_SS, bevel=0.001)  # clamp plate
        b.box((0.030, 0.060, 0.008), (x, 0, 0.112), M_EPDM)  # cradle pad
        ub = [(x, 0.0505, 0.092), (x, 0.0505, 0.13)]
        ub += [(x, 0.0505 * math.cos(a), zc + 0.0505 * math.sin(a))
               for a in [math.pi * i / 12 for i in range(13)]]
        ub += [(x, -0.0505, 0.13), (x, -0.0505, 0.092)]
        b.sweep(ub, 0.005, M_SS, seg=10)
        for y in (-0.0505, 0.0505):
            b.hex_prism(0.008, 0.0, 0.007, M_SS, matrix=T(x, y, 0.100) @ rot_to((0, 0, -1)))
    A.part(b, "Manifold_Body")
    A.socket("InletSocket", (-0.400, 0, zc), (-1, 0, 0), kind="pipe_inlet", nominal_size="DN80")
    for i, x in enumerate(xs, 1):
        A.socket(f"OutletSocket_{i}", (x, 0, 0.258), (0, 0, 1), kind="pipe_outlet", nominal_size="DN25")


# --------------------------------------------------------------------------- #
# 11. Outdoor laser projector on yoke
# --------------------------------------------------------------------------- #
def build_laser(A):
    y = MeshBuilder()
    y.box((0.22, 0.16, 0.012), (0, 0, 0.006), M_HOUSING, bevel=0.002)
    for x in (-0.09, 0.09):
        for yy in (-0.06, 0.06):
            bolt(y, (x, yy, 0.012), 0.008)
    y.cylinder(0.050, 0.012, 0.028, M_SS, seg=40, chamfer=0.002)
    y.box((0.217, 0.060, 0.014), (0, 0, 0.035), M_HOUSING, bevel=0.002)
    for s in (-1, 1):
        x = s * 0.1025
        y.box((0.012, 0.050, 0.188), (x, 0, 0.136), M_HOUSING, bevel=0.002)
        y.cylinder(0.025, -0.006, 0.006, M_HOUSING, seg=32, matrix=T(x, 0, 0.230) @ AX)
        y.lathe([(0, 0), (0.022, 0), (0.022, 0.012), (0.012, 0.016), (0, 0.016)], M_PVC, seg=8,
                matrix=place((s * 0.1085, 0, 0.230), (s, 0, 0)))
    yoke = A.part(y, "Yoke")

    h = MeshBuilder()  # local origin on the tilt axis
    h.box((0.18, 0.30, 0.14), (0, 0, 0), M_HOUSING, bevel=0.012, bseg=3)
    for i in range(9):
        h.box((0.004, 0.24, 0.045), (-0.08 + 0.02 * i, 0.01, 0.0905), M_HOUSING)
    h.box((0.165, 0.008, 0.125), (0, -0.152, 0), M_HOUSING, bevel=0.003)
    MY = rot_to((0, -1, 0))
    h.tube(0.034, 0.027, 0.0, 0.030, M_HOUSING, seg=40, chamfer=0.002, matrix=T(0, -0.155, 0) @ MY,
           inner_mat=M_BORE)
    h.cylinder(0.0272, 0.0, 0.0025, M_BORE, seg=40, matrix=T(0, -0.1555, 0) @ MY)
    h.cylinder(0.0272, 0.0, 0.004, M_GLASS, seg=40, matrix=T(0, -0.158, 0) @ MY)
    for x in (-0.07, 0.07):
        for z in (-0.05, 0.05):
            cap_screw(h, (x, -0.156, z), 0.004, (0, -1, 0))
            cap_screw(h, (x, 0.150, z), 0.004, (0, 1, 0))
    for x in (-0.04, 0.04):
        cable_gland(h, (x, 0.1495, -0.025), (0, 1, 0), s=0.009, cable_len=0.03)
    head = A.part(h, "Head_Tilt_X", parent=yoke, location=(0, 0, 0.230),
                  pivot={"aquaflow_pivot": "tilt", "pivot_axis": "X", "rotation_range_deg": "-45..45"})
    A.socket("LaserSocket", (0, -0.162, 0), (0, -1, 0), parent=head, kind="laser_aperture",
             beam_axis="+Z")


# --------------------------------------------------------------------------- #
# 12. Flame-effect burner
# --------------------------------------------------------------------------- #
def build_burner(A):
    b = MeshBuilder()
    z = mounting_flange(b, 0.130, 0.010, 4, 0.112, 0.010)
    b.lathe([(0, z), (0.105, z), (0.108, z + 0.003), (0.108, 0.140), (0.104, 0.150), (0.090, 0.157),
             (0, 0.158)], M_SS, seg=56)
    for i in range(12):
        a = TAU * i / 12
        u = Vector((math.cos(a), math.sin(a), 0))
        recess_hole(b, u * 0.108 + Vector((0, 0, 0.050)), u, 0.005, 0.005, rim=0.0022)
    b.lathe([(0, 0.155), (0.032, 0.155), (0.032, 0.163), (0.014, 0.176), (0.006, 0.180), (0, 0.180)],
            M_SS, seg=40)
    ring_R, ring_r, ring_z = 0.062, 0.0085, 0.172
    b.torus(ring_R, ring_r, M_BRASS, seg=56, minor=10, matrix=T(0, 0, ring_z))
    for k in range(3):
        a = math.pi / 6 + TAU * k / 3
        b.sweep([(0, 0, 0.166), (0.058 * math.cos(a), 0.058 * math.sin(a), ring_z)], 0.005, M_BRASS, seg=10)
    for k in range(24):
        a = TAU * k / 24
        recess_hole(b, (ring_R * math.cos(a), ring_R * math.sin(a), ring_z + ring_r - 0.001), (0, 0, 1),
                    0.0016, 0.003, rim=0.0012, mat=M_BRASS, seg=8)
    # ignition housing and electrode
    b.box((0.040, 0.026, 0.026), (0, 0.092, 0.168), M_SS, bevel=0.002)
    b.cylinder(0.0055, 0.181, 0.190, M_CERAMIC, seg=12, chamfer=0.001, matrix=T(0, 0.086, 0))
    b.sweep([(0, 0.086, 0.188), (0, 0.086, 0.196), (0, 0.072, 0.196), (0, 0.066, 0.188)], 0.0012, M_SS, seg=8)
    # gas inlet and igniter lead
    MXn = T(-0.106, 0, 0.060) @ rot_to((-1, 0, 0))
    b.hex_prism(0.018, 0.0, 0.012, M_BRASS, matrix=MXn)
    b.thread_tube(0.0105, 0.0075, 0.012, 0.040, 0.0018, 0.0009, M_BRASS, matrix=MXn)
    cable_gland(b, (0.1075, 0, 0.060), (1, 0, 0), s=0.008, cable_len=0.03)
    A.part(b, "Burner_Body")
    A.socket("FlameSocket", (0, 0, 0.182), (0, 0, 1), kind="flame_outlet")
    A.socket("GasInletSocket", (-0.146, 0, 0.060), (-1, 0, 0), kind="gas_inlet", nominal_size="DN15")


# --------------------------------------------------------------------------- #
# Asset registry (exact filenames, budgets, expected dimensions)
# --------------------------------------------------------------------------- #
ASSETS = [
    dict(name="nozzle_straight_dn25", build=build_nozzle_straight, role="nozzle.straight_jet",
         budget=8000, expect={"z": 0.22}, required=["NozzleSocket"],
         description="DN25 clear-jet nozzle, brass body, stainless flange and flow-straightener collar"),
    dict(name="nozzle_aerated_dn40", build=build_nozzle_aerated, role="nozzle.aerated_foam",
         budget=8000, expect={"z": 0.32}, required=["NozzleSocket"],
         description="DN40 aerated foam nozzle with two rows of air-intake holes"),
    dict(name="nozzle_laminar_dn25", build=build_nozzle_laminar, role="nozzle.laminar",
         budget=8000, expect={"z": 0.30}, required=["NozzleSocket"],
         description="Long laminar nozzle with flow-straightening body and polished outlet"),
    dict(name="nozzle_fan_dn25", build=build_nozzle_fan, role="nozzle.fan",
         budget=8000, expect={"x": 0.28, "z": 0.18}, required=["NozzleSocket"],
         description="DN25 fan nozzle with a 3 mm x 250 mm slot"),
    dict(name="nozzle_b_3outlet", build=build_basket, role="nozzle.rotating_basket",
         budget=12000, expect={"diameter": 0.45, "z": 0.38},
         required=["Rotor_Z", "Outlet_1", "Outlet_2", "Outlet_3"],
         description="Rotating basket nozzle with three inclined outlets on a Rotor_Z pivot"),
    dict(name="motion_2d_nozzle", build=build_motion_2d, role="nozzle.motion_2axis",
         budget=12000, expect={"z": 0.55}, required=["Base", "Pan_Z", "Tilt_X", "NozzleSocket"],
         description="Two-axis robotic nozzle: Base -> Pan_Z -> Tilt_X -> NozzleSocket"),
    dict(name="light_rgb_uw", build=build_light, role="light.underwater_rgb",
         budget=8000, expect={"diameter": 0.22, "z": 0.12}, required=["LightSocket"],
         description="Submersible RGB luminaire with stainless bezel, bracket and cable gland"),
    dict(name="pump_centrifugal", build=build_pump, role="pump.centrifugal_dry",
         budget=15000, expect={"x": 0.85, "y": 0.45, "z": 0.50}, required=["InletSocket", "OutletSocket"],
         recentre=True,
         description="Dry-installed end-suction centrifugal pump on baseframe"),
    dict(name="valve_solenoid_dn25", build=build_valve, role="valve.solenoid",
         budget=8000, expect={"x": 0.28}, required=["InletSocket", "OutletSocket"], recentre=True,
         description="DN25 brass solenoid valve with threaded ports, coil and plug connector"),
    dict(name="manifold_4way", build=build_manifold, role="pipework.manifold",
         budget=8000, expect={"x": 0.80},
         required=["InletSocket", "OutletSocket_1", "OutletSocket_2", "OutletSocket_3", "OutletSocket_4"],
         recentre=True,
         description="Stainless DN80 header with four DN25 outlets on saddle supports"),
    dict(name="laser_projector", build=build_laser, role="effect.laser_projector",
         budget=10000, expect={"z": 0.35}, required=["LaserSocket"],
         description="Generic weatherproof laser projector on adjustable yoke (no markings)"),
    dict(name="flame_burner", build=build_burner, role="effect.flame_burner",
         budget=10000, expect={"z": 0.20}, required=["FlameSocket"],
         description="Generic flame-effect burner visual model; no certification is implied"),
]


# --------------------------------------------------------------------------- #
# Scene setup / utilities
# --------------------------------------------------------------------------- #
def reset_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.curves, bpy.data.images, bpy.data.worlds):
        for item in list(coll):
            coll.remove(item)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    scenes = list(bpy.data.scenes)
    scene = scenes[0]
    for s in scenes[1:]:
        bpy.data.scenes.remove(s)
    scene.name = "AquaFlow_Equipment"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def strip_suffix(name):
    return re.sub(r"\.\d{3}$", "", name)


def mesh_descendants(A):
    return [o for o in A.objects() if o.type == "MESH"]


def find_by_canon(A, canon):
    for o in A.objects():
        if o.get("aquaflow_name") == canon:
            return o
    return None


def claim_names(A):
    """Give this asset's objects their exact canonical names (needed because
    Blender object names are global and several assets share socket names)."""
    for o in A.objects():
        canon = o.get("aquaflow_name", o.name)
        if o.name != canon:
            other = bpy.data.objects.get(canon)
            if other is not None and other is not o:
                other.name = canon + "__parked"
            o.name = canon


def world_bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    found = False
    for o in objs:
        if o.type != "MESH":
            continue
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        mw = o.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
            found = True
        oe.to_mesh_clear()
    return (lo, hi) if found else (Vector(), Vector())


def recentre(A):
    bpy.context.view_layer.update()
    lo, hi = world_bbox(A.objects())
    c = (lo + hi) * 0.5
    t = Vector((-c.x, -c.y, 0.0))
    if t.length < 1e-6:
        return
    for ch in A.root.children:
        if ch.type == "MESH" and ch.location.length < 1e-9:
            ch.data.transform(Matrix.Translation(t))
            for g in ch.children:
                g.location += t
        else:
            ch.location += t
    bpy.context.view_layer.update()


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def analyse_mesh(o, dg):
    """Returns dict: tris, invalid_normals, inverted_shells, non_manifold, degenerate."""
    oe = o.evaluated_get(dg)
    me = oe.to_mesh()
    res = dict(tris=0, invalid_normals=0, inverted_shells=0, non_manifold=0, degenerate=0, shells=0)
    try:
        me.calc_loop_triangles()
        res["tris"] = len(me.loop_triangles)
        if hasattr(me, "calc_normals_split"):
            me.calc_normals_split()
            loop_normals = [l.normal for l in me.loops]
        elif hasattr(me, "corner_normals"):
            loop_normals = [cn.vector for cn in me.corner_normals]
        else:
            loop_normals = []
        for n in loop_normals:
            ln = n.length
            if not math.isfinite(ln) or abs(ln - 1.0) > 1e-3:
                res["invalid_normals"] += 1
        for p in me.polygons:
            ln = p.normal.length
            if not math.isfinite(ln) or ln < 0.5:
                res["invalid_normals"] += 1
            if p.area < 1e-12:
                res["degenerate"] += 1
        edge_use = {}
        for p in me.polygons:
            for ek in p.edge_keys:
                edge_use[ek] = edge_use.get(ek, 0) + 1
        res["non_manifold"] = sum(1 for c in edge_use.values() if c != 2)
        # per-shell signed volume -> catches inward-facing shells
        parent = list(range(len(me.vertices)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for p in me.polygons:
            vs = p.vertices
            r0 = find(vs[0])
            for v in vs[1:]:
                rv = find(v)
                if rv != r0:
                    parent[rv] = r0
        vol = {}
        co = [v.co for v in me.vertices]
        for lt in me.loop_triangles:
            a, b, c = (co[i] for i in lt.vertices)
            k = find(lt.vertices[0])
            vol[k] = vol.get(k, 0.0) + a.dot(b.cross(c)) / 6.0
        res["shells"] = len(vol)
        res["inverted_shells"] = sum(1 for v in vol.values() if v < -1e-12)
    finally:
        oe.to_mesh_clear()
    return res


def image_problems(materials):
    warnings = []
    for m in materials:
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type != "TEX_IMAGE":
                continue
            img = n.image
            if img is None:
                warnings.append(f"{m.name}: image node '{n.name}' has no image")
                continue
            if img.packed_file is None:
                path = bpy.path.abspath(img.filepath)
                if not path or not os.path.exists(path):
                    warnings.append(f"{m.name}: image '{img.name}' missing on disk and not packed")
            if max(img.size[0], img.size[1]) > 2048:
                warnings.append(f"{m.name}: image '{img.name}' exceeds 2K ({img.size[0]}x{img.size[1]})")
    return warnings


def validate_asset(A):
    spec = A.spec
    errors, warnings = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    objs = A.objects()
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        errors.append("asset has no mesh geometry")

    # required sockets / pivots
    for req in spec["required"]:
        o = find_by_canon(A, req)
        if o is None:
            errors.append(f"required object '{req}' missing")
        elif req.endswith("Socket") or req.startswith("Outlet") or "Socket_" in req:
            if o.type != "EMPTY":
                errors.append(f"socket '{req}' must be an EMPTY, is {o.type}")
    for s in A.sockets:
        o = find_by_canon(A, s)
        if o is not None and o.type != "EMPTY":
            errors.append(f"socket '{s}' is not an EMPTY")

    # transforms
    for o in objs:
        if any(abs(s - 1.0) > 1e-6 for s in o.scale):
            errors.append(f"{o.get('aquaflow_name', o.name)}: scale not applied {tuple(o.scale)}")
        if o.matrix_world.determinant() <= 0:
            errors.append(f"{o.get('aquaflow_name', o.name)}: negative/zero world scale")
        if o.type == "MESH" and any(abs(r) > 1e-6 for r in o.rotation_euler):
            errors.append(f"{o.get('aquaflow_name', o.name)}: rotation not applied")
        if o.type == "MESH" and o is not None and o.get("aquaflow_pivot") is None and o.location.length > 1e-6:
            errors.append(f"{o.get('aquaflow_name', o.name)}: location not applied")

    # geometry
    tris, nonman, inv_norm, inv_shell, degen = 0, 0, 0, 0, 0
    for o in meshes:
        r = analyse_mesh(o, dg)
        tris += r["tris"]
        nonman += r["non_manifold"]
        inv_norm += r["invalid_normals"]
        inv_shell += r["inverted_shells"]
        degen += r["degenerate"]
    if tris > spec["budget"]:
        errors.append(f"triangle budget exceeded: {tris} > {spec['budget']}")
    if inv_norm:
        errors.append(f"{inv_norm} invalid (NaN/zero) normals")
    if inv_shell:
        errors.append(f"{inv_shell} shells with inward-facing normals")
    if nonman:
        errors.append(f"{nonman} non-manifold edges")
    if degen:
        warnings.append(f"{degen} near-zero-area faces")

    # materials
    mats = []
    for o in meshes:
        if len(o.material_slots) == 0:
            errors.append(f"{o.get('aquaflow_name')}: no material")
        for i, slot in enumerate(o.material_slots):
            if slot.material is None:
                errors.append(f"{o.get('aquaflow_name')}: empty material slot {i}")
            elif slot.material not in mats:
                mats.append(slot.material)
        n_slots = len(o.material_slots)
        if any(p.material_index >= n_slots for p in o.data.polygons):
            errors.append(f"{o.get('aquaflow_name')}: faces reference a missing material slot")
    tex_warn = image_problems(mats)
    if tex_warn:
        errors.extend(f"texture: {w}" for w in tex_warn if "missing" in w or "no image" in w)
        warnings.extend(f"texture: {w}" for w in tex_warn if "exceeds" in w)

    # dimensions / scale / placement
    lo, hi = world_bbox(objs)
    dims = hi - lo
    centre = (lo + hi) * 0.5
    exp = spec["expect"]
    measured = {"x": dims.x, "y": dims.y, "z": dims.z, "diameter": max(dims.x, dims.y)}
    for k, v in exp.items():
        if not (0.75 * v <= measured[k] <= 1.25 * v):
            errors.append(f"scale: {k} = {measured[k]:.3f} m, expected ~{v:.3f} m (+/-25%)")
    if abs(lo.z) > 0.001:
        errors.append(f"mounting base not at Z=0 (min Z = {lo.z:.4f} m)")
    tol = max(0.03, 0.10 * max(dims.x, dims.y))
    if abs(centre.x) > tol or abs(centre.y) > tol:
        errors.append(f"not centred over mounting origin (centre {centre.x:.3f}, {centre.y:.3f})")

    sockets = []
    for s in A.sockets:
        o = find_by_canon(A, s)
        mw = o.matrix_world
        d = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
        sockets.append(dict(name=s, parent=o.parent.get("aquaflow_name", o.parent.name),
                            kind=o.get("aquaflow_socket"),
                            position_m=[round(c, 4) for c in mw.translation],
                            direction_zup=[round(c, 4) for c in d]))
    pivots = []
    for pv in A.pivots:
        o = find_by_canon(A, pv)
        pivots.append(dict(name=pv, kind=o.get("aquaflow_pivot"), axis=o.get("pivot_axis"),
                           position_m=[round(c, 4) for c in o.matrix_world.translation]))

    A.root["dimensions_m"] = [round(dims.x, 4), round(dims.y, 4), round(dims.z, 4)]
    A.root["triangles"] = tris
    return dict(
        dimensions_m={"x": round(dims.x, 4), "y": round(dims.y, 4), "z": round(dims.z, 4)},
        bbox_min_m=[round(c, 4) for c in lo], bbox_max_m=[round(c, 4) for c in hi],
        expected_m=exp, triangles=tris, triangle_budget=spec["budget"],
        materials=sorted(m.name for m in mats), sockets=sockets, pivots=pivots,
        mesh_objects=[o.get("aquaflow_name") for o in meshes],
        missing_texture_warnings=tex_warn, errors=errors, warnings=warnings,
        _centre=centre,
    )


# --------------------------------------------------------------------------- #
# Export + GLB inspection + re-import
# --------------------------------------------------------------------------- #
def export_asset(A, path):
    claim_names(A)
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in A.objects():
        o.select_set(True)
    vl.objects.active = A.root
    bpy.ops.export_scene.gltf(
        filepath=path,
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
    )
    for o in A.objects():
        o.select_set(False)


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError("not a glTF 2.0 binary")
    if length != len(data):
        raise ValueError(f"GLB header length {length} != file size {len(data)}")
    off, gj, bin_len = 12, None, 0
    while off < len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            gj = json.loads(chunk.decode("utf-8"))
        elif ctype == b"BIN\x00":
            bin_len = clen
        off += 8 + clen
    if gj is None:
        raise ValueError("GLB has no JSON chunk")
    return gj, bin_len


def inspect_glb(A, path, rep):
    errs, info = [], {}
    gj, bin_len = read_glb(path)
    nodes = gj.get("nodes", [])
    names = [n.get("name", "") for n in nodes]
    info["nodes"] = names
    info["bin_bytes"] = bin_len
    info["generator"] = gj.get("asset", {}).get("generator")
    root = next((n for n in nodes if n.get("name") == A.name), None)
    if root is None:
        errs.append("root node missing in GLB")
    else:
        ex = root.get("extras", {})
        if ex.get("collision") != A.spec.get("collision", "aabb"):
            errs.append("root extras missing collision recommendation")
        if ex.get("aquaflow_role") != A.spec["role"]:
            errs.append("root extras missing aquaflow_role")
    for req in A.spec["required"] + A.sockets:
        if req not in names:
            errs.append(f"node '{req}' missing in GLB")
    for n in nodes:
        if n.get("name") in A.sockets and "mesh" in n:
            errs.append(f"socket '{n['name']}' exported as mesh")
    if gj.get("cameras"):
        errs.append("GLB contains cameras")
    if "KHR_lights_punctual" in gj.get("extensionsUsed", []):
        errs.append("GLB contains lights")
    for buf in gj.get("buffers", []):
        if "uri" in buf:
            errs.append("GLB references an external buffer")
    for img in gj.get("images", []):
        if "uri" in img or "bufferView" not in img:
            errs.append(f"GLB image '{img.get('name')}' not embedded")
    gl_mats = [m.get("name") for m in gj.get("materials", [])]
    info["materials"] = gl_mats
    missing = sorted(set(rep["materials"]) - set(gl_mats))
    if missing:
        errs.append(f"materials lost on export: {missing}")
    tris = 0
    acc = gj.get("accessors", [])
    for mesh in gj.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "material" not in prim:
                errs.append(f"primitive in mesh '{mesh.get('name')}' has no material")
            if prim.get("mode", 4) == 4:
                if "indices" in prim:
                    tris += acc[prim["indices"]]["count"] // 3
                else:
                    tris += acc[prim["attributes"]["POSITION"]]["count"] // 3
    info["triangles"] = tris
    if tris != rep["triangles"]:
        errs.append(f"GLB triangle count {tris} != Blender count {rep['triangles']}")
    return errs, info


def reimport_check(A, path, rep):
    errs = []
    before = {k: set(getattr(bpy.data, k)) for k in ("objects", "meshes", "materials", "images", "collections")}
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    new_objs = [o for o in bpy.data.objects if o not in before["objects"]]
    by_name = {strip_suffix(o.name): o for o in new_objs}
    for req in [A.name] + A.spec["required"] + A.sockets:
        if req not in by_name:
            errs.append(f"re-import: '{req}' not found")
    for s in A.sockets:
        o = by_name.get(s)
        if o is not None and o.type != "EMPTY":
            errs.append(f"re-import: socket '{s}' came back as {o.type}")
    for o in new_objs:
        if o.type == "MESH":
            if not o.data.materials or any(m is None for m in o.data.materials):
                errs.append(f"re-import: mesh '{o.name}' lost its materials")
    lo, hi = world_bbox(new_objs)
    dims = hi - lo
    ref = rep["dimensions_m"]
    for axis, val in zip("xyz", dims):
        if abs(val - ref[axis]) > 0.002:
            errs.append(f"re-import: {axis} dimension {val:.4f} != {ref[axis]:.4f}")
    # compare a socket position (Y-up -> Z-up round trip)
    for s in rep["sockets"][:1]:
        o = by_name.get(s["name"])
        if o is not None:
            dpos = (o.matrix_world.translation - Vector(s["position_m"])).length
            if dpos > 0.002:
                errs.append(f"re-import: socket '{s['name']}' moved by {dpos:.4f} m")
    result = dict(file=os.path.basename(path), objects=len(new_objs),
                  dimensions_m=[round(v, 4) for v in dims], errors=errs)
    # clean up everything the importer created
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for k in ("meshes", "materials", "images", "collections"):
        coll = getattr(bpy.data, k)
        for item in [i for i in coll if i not in before[k]]:
            coll.remove(item)
    return result


# --------------------------------------------------------------------------- #
# Contact sheet (separate scene: studio lights + camera never touch the GLBs)
# --------------------------------------------------------------------------- #
def build_contact_sheet(builds, reports, out_png, samples):
    sc = bpy.data.scenes.new("ContactSheet")
    sc.unit_settings.system = "METRIC"
    sc.render.engine = "CYCLES"
    try:
        sc.cycles.device = "CPU"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x = 2400
    sc.render.resolution_y = 1920
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.filepath = out_png

    # world: uniform light backdrop for camera rays, gradient for reflections
    w = bpy.data.worlds.new("ContactSheet_World")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    mix = nt.nodes.new("ShaderNodeMixShader")
    lp = nt.nodes.new("ShaderNodeLightPath")
    bg_cam = nt.nodes.new("ShaderNodeBackground")
    bg_cam.inputs[0].default_value = (0.62, 0.64, 0.67, 1.0)
    bg_env = nt.nodes.new("ShaderNodeBackground")
    bg_env.inputs[1].default_value = 1.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.055, 1)
    ramp.color_ramp.elements[1].color = (1.1, 1.1, 1.15, 1)
    e = ramp.color_ramp.elements.new(0.5)
    e.color = (0.35, 0.36, 0.38, 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs[0])
    nt.links.new(ramp.outputs["Color"], bg_env.inputs[0])
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg_env.outputs[0], mix.inputs[1])
    nt.links.new(bg_cam.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])

    elev = math.radians(70.0)
    cam_rot = (elev, 0.0, 0.0)
    right = Vector((1, 0, 0))
    up = Vector((0, math.cos(elev), math.sin(elev)))
    fwd = Vector((0, math.sin(elev), -math.cos(elev)))

    label_mat = bpy.data.materials.new("CS_Label")
    label_mat.use_nodes = True
    lnt = label_mat.node_tree
    lnt.nodes.clear()
    em = lnt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (0.012, 0.014, 0.018, 1)
    lo_ = lnt.nodes.new("ShaderNodeOutputMaterial")
    lnt.links.new(em.outputs[0], lo_.inputs[0])

    def text(body, loc, size, align_y="TOP"):
        cu = bpy.data.curves.new("CS_Text", "FONT")
        cu.body = body
        cu.size = size
        cu.align_x = "CENTER"
        cu.align_y = align_y
        cu.materials.append(label_mat)
        ob = bpy.data.objects.new("CS_Text", cu)
        ob.location = loc
        ob.rotation_euler = cam_rot
        sc.collection.objects.link(ob)
        return ob

    cols, cell = 4, 1.0
    for i, A in enumerate(builds):
        rep = reports[A.name]
        col, row = i % cols, i // cols
        cc = right * (col - 1.5) * cell - up * (row - 1.0) * cell
        d = rep["dimensions_m"]
        s = 0.60 / max(d["x"], d["y"], d["z"])
        inst = bpy.data.objects.new(f"CS_{A.name}", None)
        inst.instance_type = "COLLECTION"
        inst.instance_collection = A.coll
        inst.scale = (s, s, s)
        inst.location = cc + up * 0.07 - rep["_centre"] * s
        sc.collection.objects.link(inst)
        text(f"{i + 1:02d}  {A.name}.glb\n{d['x']:.2f} x {d['y']:.2f} x {d['z']:.2f} m   "
             f"{rep['triangles']:,} tris",
             cc - up * 0.36, 0.048)
    text("AquaFlow fountain equipment  -  generic procedural GLB assets  "
         "(each cell scaled to fit; dimensions are real)",
         up * 1.63, 0.06, align_y="CENTER")

    cam_data = bpy.data.cameras.new("CS_Camera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 4.4
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("CS_Camera", cam_data)
    cam.location = -fwd * 20.0
    cam.rotation_euler = cam_rot
    sc.collection.objects.link(cam)
    sc.camera = cam

    for name, strength, direction, angle in (("CS_Key", 3.2, (-0.6, 0.9, -0.8), 12.0),
                                              ("CS_Fill", 1.1, (0.8, 0.7, -0.3), 25.0),
                                              ("CS_Rim", 2.0, (0.1, -1.0, -0.6), 8.0)):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = strength
        ld.angle = math.radians(angle)
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(lo)

    bpy.ops.render.render(write_still=True, scene=sc.name)
    return os.path.exists(out_png)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    t0 = time.time()
    out_dir, args = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    log(f"Blender {bpy.app.version_string} - output: {out_dir}")

    addon_ok = True
    try:
        import addon_utils
        addon_utils.enable("io_scene_gltf2", default_set=True)
    except Exception:
        addon_ok = False

    scene = reset_scene()
    make_materials()
    equip = bpy.data.collections.new("AquaFlow_Equipment")
    scene.collection.children.link(equip)

    builds, reports, fatal = [], {}, []
    for spec in ASSETS:
        try:
            A = AssetBuild(spec, equip)
            spec["build"](A)
            if spec.get("recentre"):
                recentre(A)
            builds.append(A)
            log(f"built {spec['name']}")
        except Exception as exc:
            traceback.print_exc()
            fatal.append(f"{spec['name']}: build failed: {exc}")
    bpy.context.view_layer.update()

    # geometry validation
    for A in builds:
        rep = validate_asset(A)
        rep["filename"] = A.name + ".glb"
        rep["role"] = A.spec["role"]
        rep["collision"] = A.spec.get("collision", "aabb")
        reports[A.name] = rep
        d = rep["dimensions_m"]
        log(f"{A.name:24s} {d['x']:.3f} x {d['y']:.3f} x {d['z']:.3f} m  "
            f"{rep['triangles']:6d}/{rep['triangle_budget']} tris  sockets={len(rep['sockets'])}")

    # export
    for A in builds:
        rep = reports[A.name]
        path = os.path.join(out_dir, A.name + ".glb")
        try:
            if os.path.exists(path):
                os.remove(path)
            export_asset(A, path)
            if not os.path.exists(path) or os.path.getsize(path) == 0:
                raise RuntimeError("exporter produced no file")
            rep["file_bytes"] = os.path.getsize(path)
            errs, info = inspect_glb(A, path, rep)
            rep["glb_check"] = info
            rep["errors"].extend(f"glb: {e}" for e in errs)
        except Exception as exc:
            traceback.print_exc()
            rep["errors"].append(f"export failed: {exc}")

    # re-import test
    reimport_results = []
    targets = builds if args.reimport_all else [A for A in builds if A.name == "motion_2d_nozzle"][:1]
    for A in targets:
        path = os.path.join(out_dir, A.name + ".glb")
        if not os.path.exists(path):
            continue
        try:
            r = reimport_check(A, path, reports[A.name])
        except Exception as exc:
            traceback.print_exc()
            r = dict(file=os.path.basename(path), errors=[f"re-import raised: {exc}"])
        reimport_results.append(r)
        reports[A.name]["errors"].extend(r["errors"])
        log(f"re-import {r['file']}: {'OK' if not r['errors'] else 'FAILED'}")
    if not reimport_results:
        fatal.append("no GLB could be re-imported")

    # contact sheet
    png = os.path.join(out_dir, "contact-sheet.png")
    sheet_ok = None
    if not args.no_render and builds:
        try:
            log("rendering contact sheet ...")
            sheet_ok = build_contact_sheet(builds, reports, png, args.samples)
        except Exception as exc:
            traceback.print_exc()
            sheet_ok = False
            fatal.append(f"contact sheet failed: {exc}")
        if sheet_ok is False and not any("contact sheet" in f for f in fatal):
            fatal.append("contact sheet was not written")

    # editable blend
    blend = os.path.join(out_dir, "aquaflow_fountain_assets.blend")
    try:
        bpy.context.window_manager  # noqa: B018 - ensures WM exists in background
        bpy.ops.wm.save_as_mainfile(filepath=blend, check_existing=False, compress=True)
    except Exception as exc:
        traceback.print_exc()
        fatal.append(f"saving .blend failed: {exc}")

    # report
    missing_assets = [s["name"] for s in ASSETS if s["name"] not in reports]
    for m in missing_assets:
        fatal.append(f"asset '{m}' missing")
    failed = [n for n, r in reports.items() if r["errors"]]
    success = not fatal and not failed
    assets_out = []
    for s in ASSETS:
        r = reports.get(s["name"])
        if r is None:
            continue
        r = {k: v for k, v in r.items() if not k.startswith("_")}
        r["status"] = "PASS" if not r["errors"] else "FAIL"
        assets_out.append(r)
    report = dict(
        generator=f"generate_fountain_assets.py {SCRIPT_VERSION}",
        blender_version=bpy.app.version_string,
        created=time.strftime("%Y-%m-%dT%H:%M:%S"),
        output_dir=out_dir,
        blend_file=os.path.basename(blend),
        contact_sheet=os.path.basename(png) if sheet_ok else None,
        conventions=dict(units="metres", authored_up="+Z", gltf_up="+Y", export_yup=True,
                         mounting_base="local Z=0 (glTF Y=0), centred on mounting axis",
                         socket_axis="empty local +Z (glTF +Y) = flow/emission/connection direction"),
        gltf_addon_enabled=addon_ok,
        reimport_test=reimport_results,
        assets=assets_out,
        fatal_errors=fatal,
        success=success,
        elapsed_s=round(time.time() - t0, 1),
    )
    with open(os.path.join(out_dir, "asset-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # summary
    print("")
    log("=" * 72)
    for r in assets_out:
        d = r["dimensions_m"]
        log(f"{r['status']}  {r['filename']:28s} {d['x']:.3f}x{d['y']:.3f}x{d['z']:.3f} m "
            f"{r['triangles']:6d} tris")
        for e in r["errors"]:
            log(f"      ERROR: {e}")
        for wmsg in r["warnings"]:
            log(f"      warn : {wmsg}")
    for f_ in fatal:
        log(f"FATAL: {f_}")
    log("=" * 72)
    log(("SUCCESS" if success else "FAILURE") + f": {len(assets_out) - len(failed)}/{len(ASSETS)} assets passed")
    log(f"Output directory: {out_dir}")
    return 0 if success else 1


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    except Exception:
        traceback.print_exc()
        code = 1
    if bpy.app.background:
        sys.exit(code)
