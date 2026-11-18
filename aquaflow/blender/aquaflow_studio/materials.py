"""Cycles materials for water, stone, metal and aerated water."""

import bpy


def input_named(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def principled_material(name, color, roughness=0.4, metallic=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*color[:3], 1.0)
    shader = material.node_tree.nodes.get("Principled BSDF")
    input_named(shader, ["Base Color"], (*color[:3], 1.0))
    input_named(shader, ["Roughness"], roughness)
    input_named(shader, ["Metallic"], metallic)
    return material, shader


def water_material():
    material, shader = principled_material("AF | Water · IOR 1.333", (0.94, 0.98, 1.0), 0.028)
    input_named(shader, ["IOR"], 1.333)
    input_named(shader, ["Transmission Weight", "Transmission"], 1.0)
    input_named(shader, ["Specular IOR Level", "Specular"], 0.5)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    ripples = nodes.new("ShaderNodeTexNoise")
    ripples.inputs["Scale"].default_value = 7.0
    ripples.inputs["Detail"].default_value = 2.0
    ripples.location = (-650, 100)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.14
    bump.inputs["Distance"].default_value = 0.025
    bump.location = (-300, 80)
    links.new(ripples.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    absorption = nodes.new("ShaderNodeVolumeAbsorption")
    absorption.name = "Water depth absorption"
    absorption.inputs["Color"].default_value = (0.32, 0.68, 0.82, 1.0)
    absorption.inputs["Density"].default_value = 0.055
    absorption.location = (-250, -220)
    scatter = nodes.new("ShaderNodeVolumeScatter")
    scatter.name = "Shallow pool water scattering"
    scatter.inputs["Color"].default_value = (0.72, 0.86, 0.96, 1.0)
    scatter.inputs["Density"].default_value = 0.012
    scatter.inputs["Anisotropy"].default_value = 0.35
    scatter.location = (-250, -380)
    add = nodes.new("ShaderNodeAddShader")
    links.new(absorption.outputs["Volume"], add.inputs[0])
    links.new(scatter.outputs["Volume"], add.inputs[1])
    links.new(add.outputs[0], nodes.get("Material Output").inputs["Volume"])
    if hasattr(material, "use_screen_refraction"): 
        material.use_screen_refraction = True
    return material


def foam_material():
    material, shader = principled_material("AF | Aerated water and foam", (0.88, 0.95, 1.0), 0.28)
    input_named(shader, ["IOR"], 1.333)
    input_named(shader, ["Transmission Weight", "Transmission"], 0.18)
    input_named(shader, ["Subsurface Weight", "Subsurface"], 0.06)
    return material


def mist_material():
    material = bpy.data.materials.new("AF | Atomized water mist")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (0.82, 0.9, 1.0, 1.0)
    volume.inputs["Density"].default_value = 0.75
    volume.inputs["Anisotropy"].default_value = 0.45
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def stone_material(name, color, roughness=0.72):
    material, shader = principled_material(name, color, roughness)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 32.0
    noise.inputs["Detail"].default_value = 3.0
    noise.location = (-550, -120)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.025
    bump.location = (-260, -100)
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def emissive_material(name, color, strength=3.0):
    material, shader = principled_material(name, color, 0.22)
    input_named(shader, ["Emission Color", "Emission"], (*color[:3], 1.0))
    input_named(shader, ["Emission Strength"], strength)
    return material


def make_materials():
    return {
        "water": water_material(),
        "foam": foam_material(),
        "mist": mist_material(),
        "basin": stone_material("AF | Wet dark basin stone", (0.045, 0.065, 0.075), 0.38),
        "deck": stone_material("AF | Surrounding stone", (0.12, 0.14, 0.15), 0.76),
        "metal": principled_material("AF | Stainless nozzle steel", (0.56, 0.62, 0.68), 0.24, 0.92)[0],
        "equipment": principled_material("AF | Plant equipment", (0.12, 0.16, 0.19), 0.4, 0.7)[0],
        "lens": emissive_material("AF | Luminaire lens", (0.8, 0.9, 1.0), 2.0),
    }
