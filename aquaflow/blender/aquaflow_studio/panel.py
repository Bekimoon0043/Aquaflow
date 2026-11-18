import bpy


class AQUAFLOW_PT_pipeline(bpy.types.Panel):
    bl_label = "AquaFlow to Blender"
    bl_idname = "AQUAFLOW_PT_pipeline"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "AquaFlow"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.aquaflow_settings
        layout.operator("aquaflow.import_project", icon="IMPORT")
        layout.separator()
        layout.prop(settings, "fluid_scope")
        if settings.fluid_scope == "HERO":
            layout.prop(settings, "hero_fixture")
        if settings.fluid_scope != "PROXIES":
            layout.prop(settings, "resolution")
            layout.prop(settings, "show_proxies")
            layout.prop(settings, "secondary_particles")
            layout.prop(settings, "cache_directory")
            layout.operator("aquaflow.bake_liquid", icon="PHYSICS")
        layout.prop(settings, "frame_end")
        layout.prop(settings, "animation_step")
        layout.separator()
        layout.label(text="Cycles lighting and camera")
        layout.prop(settings, "use_ies")
        layout.prop(settings, "light_multiplier")
        layout.prop(settings, "samples")
        layout.prop(settings, "width")
        layout.prop(settings, "height")
        layout.prop(settings, "exposure")
        layout.prop(settings, "motion_blur")
        layout.prop(settings, "bloom")
        layout.prop(settings, "reflection_rig")
        layout.separator()
        layout.label(text="External .blend water assets")
        layout.prop(settings, "use_external_assets")
        if settings.use_external_assets:
            layout.prop(settings, "external_assets_source")
            layout.prop(settings, "external_assets_extract_directory")
            layout.label(text="No AquaTiq addon required; files stay external", icon="INFO")
        if context.scene.get("aquaflow_project"): 
            layout.separator()
            layout.label(text=context.scene["aquaflow_project"], icon="OUTLINER_OB_FONT")
            layout.label(text="Native liquid is unbaked" if any(obj.get("aquaflow_unbaked") for obj in context.scene.objects) else "Native liquid baked")


classes = (AQUAFLOW_PT_pipeline,)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
