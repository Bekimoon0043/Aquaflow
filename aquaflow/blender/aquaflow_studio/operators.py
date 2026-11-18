from pathlib import Path

import bpy
from bpy_extras.io_utils import ImportHelper

from .core import normalize_project
from .io_utils import load_project_document
from .scene_builder import bake_domain, build_scene


class AQUAFLOW_OT_import_project(bpy.types.Operator, ImportHelper):
    bl_idname = "aquaflow.import_project"
    bl_label = "Import AquaFlow Fountain"
    bl_description = "Create an editable Cycles fountain scene from an AquaFlow .aqua/.aquashow/.aquapkg project"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".aqua"
    filter_glob: bpy.props.StringProperty(default="*.aqua;*.aquashow;*.aquapkg;*.json", options={"HIDDEN"})

    def execute(self, context):
        try:
            document, source_dir = load_project_document(self.filepath)
            project = normalize_project(document, source_dir)
            settings = context.scene.aquaflow_settings
            scene, report, _ = build_scene(project, settings, document)
            self.report({"INFO"}, f"Imported {report['fixtures']} fixtures; {len(report['warnings'])} simulation notes. Native liquid is unbaked.")
            return {"FINISHED"}
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


class AQUAFLOW_OT_bake_liquid(bpy.types.Operator):
    bl_idname = "aquaflow.bake_liquid"
    bl_label = "Bake Native Liquid"
    bl_description = "Bake liquid data, mesh and secondary particles into the configured AquaFlow cache"

    def execute(self, context):
        try:
            domain = bake_domain(context.scene)
            self.report({"INFO"}, f"Baked {domain.name}; native liquid is now visible to Cycles")
            return {"FINISHED"}
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


classes = (AQUAFLOW_OT_import_project, AQUAFLOW_OT_bake_liquid)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
