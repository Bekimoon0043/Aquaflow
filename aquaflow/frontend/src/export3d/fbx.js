/**
 * fbx.js — AQ-X-016 AquaFlow 3D Export Bridge · FBX (ASCII 7.x) serializer
 *
 * Emits an ASCII FBX 7.3 document: a Geometry + Model + Material triple per node,
 * wired together in the Connections block. ASCII FBX imports into Autodesk tools
 * (Maya/3ds Max), Blender, Unreal and Unity. Geometry vertices are object-local;
 * the node's world position rides on the Model's Lcl Translation.
 *
 * FBX quirk implemented here: the LAST vertex index of every polygon is stored
 * bit-inverted ( -(index+1) ) to mark the polygon boundary.
 */

let _id = 1000000;
function nextId() { return ++_id; }

const f6 = (v) => (+v).toFixed(6);

function geometryBlock(node, geomId) {
  const pos = node.mesh.positions;
  const nrm = node.mesh.normals;
  const idx = node.mesh.indices;

  const verts = [];
  for (let i = 0; i < pos.length; i++) verts.push(f6(pos[i]));

  // PolygonVertexIndex: triangles, last corner bit-inverted.
  const pvi = [];
  for (let i = 0; i < idx.length; i += 3) {
    pvi.push(idx[i], idx[i + 1], -(idx[i + 2] + 1));
  }

  const normals = [];
  for (let i = 0; i < nrm.length; i++) normals.push(f6(nrm[i]));

  return [
    `    Geometry: ${geomId}, "Geometry::${node.name}", "Mesh" {`,
    `        Vertices: *${verts.length} {`,
    `            a: ${verts.join(",")}`,
    `        }`,
    `        PolygonVertexIndex: *${pvi.length} {`,
    `            a: ${pvi.join(",")}`,
    `        }`,
    `        GeometryVersion: 124`,
    `        LayerElementNormal: 0 {`,
    `            Version: 101`,
    `            Name: ""`,
    `            MappingInformationType: "ByVertex"`,
    `            ReferenceInformationType: "Direct"`,
    `            Normals: *${normals.length} {`,
    `                a: ${normals.join(",")}`,
    `            }`,
    `        }`,
    `        Layer: 0 {`,
    `            Version: 100`,
    `            LayerElement:  {`,
    `                Type: "LayerElementNormal"`,
    `                TypedIndex: 0`,
    `            }`,
    `        }`,
    `    }`,
  ].join("\n");
}

function modelBlock(node, modelId) {
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const ry = node.rotationY || 0;
  return [
    `    Model: ${modelId}, "Model::${node.name}", "Mesh" {`,
    `        Version: 232`,
    `        Properties70:  {`,
    `            P: "Lcl Translation", "Lcl Translation", "", "A",${f6(tx)},${f6(ty)},${f6(tz)}`,
    `            P: "Lcl Rotation", "Lcl Rotation", "", "A",0,${f6(ry)},0`,
    `            P: "Lcl Scaling", "Lcl Scaling", "", "A",${f6(sx)},${f6(sy)},${f6(sz)}`,
    `        }`,
    `        Shading: T`,
    `        Culling: "CullingOff"`,
    `    }`,
  ].join("\n");
}

function materialBlock(node, matId) {
  const m = node.material;
  const [r, g, b] = m.baseColor;
  const [er, eg, eb] = m.emissive || [0, 0, 0];
  return [
    `    Material: ${matId}, "Material::${m.name}", "" {`,
    `        Version: 102`,
    `        ShadingModel: "phong"`,
    `        MultiLayer: 0`,
    `        Properties70:  {`,
    `            P: "DiffuseColor", "Color", "", "A",${f6(r)},${f6(g)},${f6(b)}`,
    `            P: "EmissiveColor", "Color", "", "A",${f6(er)},${f6(eg)},${f6(eb)}`,
    `            P: "Shininess", "Number", "", "A",${f6((1 - (m.roughness ?? 0.8)) * 100)}`,
    `            P: "ReflectionFactor", "Number", "", "A",${f6(m.metallic ?? 0)}`,
    `        }`,
    `    }`,
  ].join("\n");
}

export function toFBXASCII(graph) {
  _id = 1000000;
  const meshNodes = (graph.nodes || []).filter((n) => n.mesh && n.mesh.indices.length);

  const objects = [];
  const connections = [];

  meshNodes.forEach((node) => {
    const geomId = nextId();
    const modelId = nextId();
    objects.push(geometryBlock(node, geomId));
    objects.push(modelBlock(node, modelId));
    connections.push(`    C: "OO",${geomId},${modelId}`);  // geometry → model
    connections.push(`    C: "OO",${modelId},0`);          // model → root
    if (node.material) {
      const matId = nextId();
      objects.push(materialBlock(node, matId));
      connections.push(`    C: "OO",${matId},${modelId}`); // material → model
    }
  });

  const now = new Date();
  const header = [
    `; FBX 7.3.0 project file`,
    `; ${graph.meta?.generator || "AquaFlow"} — ${graph.meta?.name || "Scene"}`,
    `; ----------------------------------------------------`,
    ``,
    `FBXHeaderExtension:  {`,
    `    FBXHeaderVersion: 1003`,
    `    FBXVersion: 7300`,
    `    CreationTimeStamp:  {`,
    `        Version: 1000`,
    `        Year: ${now.getUTCFullYear()}`,
    `        Month: ${now.getUTCMonth() + 1}`,
    `        Day: ${now.getUTCDate()}`,
    `    }`,
    `    Creator: "${graph.meta?.generator || "AquaFlow"}"`,
    `}`,
    `GlobalSettings:  {`,
    `    Version: 1000`,
    `    Properties70:  {`,
    `        P: "UpAxis", "int", "Integer", "",1`,
    `        P: "UpAxisSign", "int", "Integer", "",1`,
    `        P: "FrontAxis", "int", "Integer", "",2`,
    `        P: "CoordAxis", "int", "Integer", "",0`,
    `        P: "UnitScaleFactor", "double", "Number", "",1`,
    `    }`,
    `}`,
  ].join("\n");

  const doc = [
    header,
    ``,
    `Definitions:  {`,
    `    Version: 100`,
    `    Count: ${objects.length}`,
    `    ObjectType: "Geometry" { Count: ${meshNodes.length} }`,
    `    ObjectType: "Model" { Count: ${meshNodes.length} }`,
    `    ObjectType: "Material" { Count: ${meshNodes.filter((n) => n.material).length} }`,
    `}`,
    ``,
    `Objects:  {`,
    objects.join("\n"),
    `}`,
    ``,
    `Connections:  {`,
    connections.join("\n"),
    `}`,
    ``,
  ].join("\n");

  return doc;
}
