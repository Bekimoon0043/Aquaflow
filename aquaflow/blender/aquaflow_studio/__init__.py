bl_info = {
    "name": "AquaFlow Studio · Fountain to Blender",
    "author": "LuxuryCon",
    "version": (0, 4, 0),
    "blender": (3, 3, 0),
    "location": "File > Import > AquaFlow Fountain, and 3D View > AquaFlow",
    "description": "Native Mantaflow liquid, Cycles water, physical show lighting and cameras from AquaFlow projects",
    "category": "Import-Export",
}

try:
    import bpy
except ModuleNotFoundError:
    bpy = None

if bpy is not None:
    from . import operators, panel, properties


def import_menu(self, context):
    self.layout.operator("aquaflow.import_project", text="AquaFlow Fountain (.aqua / .aquashow)")


def register():
    if bpy is None:
        raise RuntimeError("AquaFlow addon registration requires Blender")
    properties.register()
    operators.register()
    panel.register()
    bpy.types.TOPBAR_MT_file_import.append(import_menu)


def unregister():
    if bpy is None:
        return
    bpy.types.TOPBAR_MT_file_import.remove(import_menu)
    panel.unregister()
    operators.unregister()
    properties.unregister()


if __name__ == "__main__":
    register()
