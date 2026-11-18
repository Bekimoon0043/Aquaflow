"""Headless AquaFlow -> Blender import, bake and Cycles render.

Example:
  blender -b --python render_aquaflow.py -- --input fountain.aqua --output fountain.blend --render fountain.png
  blender -b --python render_aquaflow.py -- --input fountain.aqua --output hero.blend --scope HERO --resolution 256 --bake
"""

import argparse
import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path:
    sys.path.remove(str(HERE))
sys.path.insert(0, str(HERE))
for module_name in list(sys.modules):
    if module_name == "aquaflow_studio" or module_name.startswith("aquaflow_studio."):
        del sys.modules[module_name]

from aquaflow_studio import register
from aquaflow_studio.core import normalize_project
from aquaflow_studio.io_utils import load_project_document
from aquaflow_studio.scene_builder import bake_domain, build_scene


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--render")
    parser.add_argument("--scope", choices=["HERO", "SITE", "PROXIES"], default="HERO")
    parser.add_argument("--hero-id", default="")
    parser.add_argument("--camera-id", default="")
    parser.add_argument("--resolution", type=int, default=128)
    parser.add_argument("--frame-end", type=int, default=0)
    parser.add_argument("--animation-step", type=int, default=2)
    parser.add_argument("--render-frame", type=int, default=0)
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--light-multiplier", type=float, default=1.0)
    parser.add_argument("--exposure", type=float, default=0.0)
    parser.add_argument("--bake", action="store_true")
    parser.add_argument("--no-proxies", action="store_true")
    parser.add_argument("--no-secondary-particles", action="store_true")
    parser.add_argument("--external-assets-source", default="")
    parser.add_argument("--external-assets-extract-dir", default="")
    parser.add_argument("--no-external-assets", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def main():
    args = arguments()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    register()
    source = Path(args.input).resolve()
    document, source_dir = load_project_document(source)
    project = normalize_project(document, source_dir)
    settings = bpy.context.scene.aquaflow_settings
    settings.fluid_scope = args.scope
    settings.hero_fixture = args.hero_id
    settings.resolution = args.resolution
    settings.frame_end = args.frame_end
    settings.animation_step = args.animation_step
    settings.samples = args.samples
    settings.width = args.width
    settings.height = args.height
    settings.light_multiplier = args.light_multiplier
    settings.exposure = args.exposure
    settings.show_proxies = not args.no_proxies
    settings.secondary_particles = not args.no_secondary_particles
    settings.use_external_assets = not args.no_external_assets
    if args.external_assets_source:
        settings.external_assets_source = args.external_assets_source
    if args.external_assets_extract_dir:
        settings.external_assets_extract_directory = args.external_assets_extract_dir
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    settings.cache_directory = str(output.parent / "aquaflow_cache")
    scene, report, domain = build_scene(project, settings, document)
    if args.camera_id:
        scene.camera = next(obj for obj in scene.objects if obj.get("aquaflow_camera_id") == args.camera_id)
    if args.bake:
        bake_domain(scene, domain)
        report["native_liquid_baked"] = True
    if args.render_frame > 0:
        scene.frame_set(min(scene.frame_end, args.render_frame))
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    if args.render:
        render = Path(args.render).resolve()
        render.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(render)
        bpy.ops.render.render(write_still=True, scene=scene.name)
    print("AQUAFLOW_BLENDER_REPORT " + json.dumps(report))


if __name__ == "__main__":
    main()
