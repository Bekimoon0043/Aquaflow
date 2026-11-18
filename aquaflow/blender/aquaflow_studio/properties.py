import bpy


class AQUAFLOW_PG_settings(bpy.types.PropertyGroup):
    fluid_scope: bpy.props.EnumProperty(
        name="Water mode",
        items=[
            ("HERO", "Hero nozzle · native liquid", "High-resolution local liquid domain; other jets can remain labeled design proxies"),
            ("SITE", "Whole site · native liquid", "One liquid domain for the basin and all nozzles; requires careful resolution planning"),
            ("PROXIES", "Design proxies · no fluid bake", "Immediate animated geometry for layout, cameras and lighting; not a fluid simulation"),
        ],
        default="HERO",
    )
    hero_fixture: bpy.props.StringProperty(name="Hero fixture ID", description="Nozzle ID for the local domain; blank selects the highest jet")
    resolution: bpy.props.IntProperty(name="Domain divisions", default=128, min=16, max=8192)
    frame_end: bpy.props.IntProperty(name="Last frame (0 = full show)", default=0, min=0, max=1000000)
    animation_step: bpy.props.IntProperty(name="Animation key step", default=2, min=1, max=30)
    show_proxies: bpy.props.BoolProperty(name="Proxies for unsimulated jets", default=True)
    secondary_particles: bpy.props.BoolProperty(name="Spray, foam and bubbles", default=True)
    use_ies: bpy.props.BoolProperty(name="Use referenced IES profiles", default=True)
    light_multiplier: bpy.props.FloatProperty(name="Light power multiplier", default=1.0, min=0.0, max=100.0)
    samples: bpy.props.IntProperty(name="Cycles samples", default=128, min=1, max=16384)
    width: bpy.props.IntProperty(name="Render width", default=1920, min=16, max=16384)
    height: bpy.props.IntProperty(name="Render height", default=1080, min=16, max=16384)
    exposure: bpy.props.FloatProperty(name="Exposure (stops)", default=0.0, soft_min=-5.0, soft_max=5.0)
    motion_blur: bpy.props.BoolProperty(name="Motion blur", default=True)
    bloom: bpy.props.BoolProperty(name="Controlled highlight glow", default=True)
    reflection_rig: bpy.props.BoolProperty(name="Architectural reflection lighting", default=True)
    use_external_assets: bpy.props.BoolProperty(name="Use external .blend water assets", default=True)
    external_assets_source: bpy.props.StringProperty(name="Water asset folder or .paq", default="C:/Users/user/Downloads/Telegram Desktop/Water Library Aquatiq Full v1.1.1/aquatiq_full", subtype="FILE_PATH")
    external_assets_extract_directory: bpy.props.StringProperty(name="Asset extraction folder", default="//external_water_assets", subtype="DIR_PATH")
    cache_directory: bpy.props.StringProperty(name="Cache root", default="//aquaflow_cache", subtype="DIR_PATH")


classes = (AQUAFLOW_PG_settings,)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.aquaflow_settings = bpy.props.PointerProperty(type=AQUAFLOW_PG_settings)


def unregister():
    del bpy.types.Scene.aquaflow_settings
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
