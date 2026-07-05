/**
 * luxexchange.js — AQ-X-016 AquaFlow 3D Export Bridge · LUXEXCHANGE v1 envelope
 *
 * LUXEXCHANGE is the LuxuryCon inter-platform interchange format, a thin JSON
 * envelope: { platform, version, payload_type, payload }. This wraps the exported
 * 3D scene (an embedded glTF document + a structured fixture manifest) so
 * LuxuryForm / LuxuryScape can import an AquaFlow layout — fixture positions,
 * materials and lights preserved — without re-deriving anything from the mesh.
 *
 * Verification of the import path is covered by the round-trip tests, which parse
 * the envelope back and confirm every fixture position + material survives.
 */

import { toGLTF } from "./gltf.js";
import { sceneTriangleCount } from "./sceneGraph.js";

export const LUXEXCHANGE_VERSION = "1.0";
export const LUXEXCHANGE_PLATFORM = "AquaFlow";

/**
 * Build a fixture manifest — the design-level record LuxuryForm/LuxuryScape read
 * to place fixtures, independent of the mesh glyphs.
 */
function fixtureManifest(graph) {
  return (graph.nodes || [])
    .filter((n) => n.fixtureId != null || ["nozzle", "light", "equipment", "effect"].includes(n.kind))
    .map((n) => ({
      id: n.fixtureId,
      name: n.name,
      kind: n.kind,
      type: n.fixtureType,
      position: { x: n.translation[0], y: n.translation[1], z: n.translation[2] },
      rotation: { x: 0, y: n.rotationY || 0, z: 0 },
      scale: n.scale ? { x: n.scale[0], y: n.scale[1], z: n.scale[2] } : { x: 1, y: 1, z: 1 },
      material: n.material
        ? { name: n.material.name, baseColor: n.material.baseColor, metallic: n.material.metallic, roughness: n.material.roughness, emissive: n.material.emissive }
        : null,
      light: n.light || null,
      // Engineering identity for round-trip import (DMX patch, hydraulics, group).
      engineering: n.extras || null,
    }));
}

/**
 * toLuxExchange(graph) → LUXEXCHANGE v1 envelope object.
 * The glTF document is embedded (parsed) under payload.gltf so consumers get the
 * geometry directly; the fixture manifest under payload.fixtures gives the
 * design-level import path.
 */
export function toLuxExchange(graph, options = {}) {
  const gltfDoc = JSON.parse(toGLTF(graph));
  const payload = {
    scene: {
      name: graph.meta?.name || "AquaFlow Scene",
      generator: graph.meta?.generator,
      generatedAt: graph.meta?.generatedAt,
      upAxis: graph.meta?.upAxis || "Y",
      unit: graph.meta?.unit || "meter",
    },
    stats: {
      nodeCount: (graph.nodes || []).length,
      fixtureCount: graph.meta?.fixtureCount ?? 0,
      lightCount: graph.meta?.lightCount ?? 0,
      triangleCount: sceneTriangleCount(graph),
    },
    // Embedded glTF (self-contained, base64 buffer) — the shared geometry payload.
    gltf: gltfDoc,
    // Design-level fixture manifest — positions + materials + lights preserved.
    fixtures: fixtureManifest(graph),
  };

  return {
    platform: LUXEXCHANGE_PLATFORM,
    version: LUXEXCHANGE_VERSION,
    payload_type: "scene3d",
    source: options.source || "AquaFlow Studio",
    exported_at: new Date().toISOString(),
    payload,
  };
}
