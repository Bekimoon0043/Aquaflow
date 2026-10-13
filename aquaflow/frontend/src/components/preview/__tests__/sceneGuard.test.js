import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, "..", name), "utf8");

/**
 * AF-3D-018 — the scene-file growth guardrail.
 *
 * FountainScene_v6.js was 4,387 lines when AF-3D-017..024 started (2026-10-13), after
 * growing from 3,450 despite the realism plan's "must not grow" rule. New rendering
 * work goes into modules (sceneShaders, scenePost, sceneLighting, sceneBasin,
 * basinMask, fixtureLightField, halfResParticles, ...). This test fails CI if the
 * orchestrator ever grows past that line count again. Lower the ceiling as the file
 * shrinks; never raise it.
 */
export const FOUNTAIN_SCENE_MAX_LINES = 4387;

describe("FountainScene_v6.js growth guard (AF-3D-018)", () => {
  const src = read("FountainScene_v6.js");
  const lines = src.split(/\r?\n/).length - (src.endsWith("\n") ? 1 : 0);

  it(`stays at or below ${FOUNTAIN_SCENE_MAX_LINES} lines`, () => {
    expect(lines).toBeLessThanOrEqual(FOUNTAIN_SCENE_MAX_LINES);
  });

  it("every method delegate targets a function that is actually imported", () => {
    // Extracted methods are one-liners: `_name(args) { return fn(this, ...); }`.
    // A missing import is only a runtime ReferenceError, so check statically.
    const imported = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) imported.add(name);
      }
    }
    const delegates = [...src.matchAll(/return\s+(\w+)\(this\b/g)].map(m => m[1]);
    expect(delegates.length).toBeGreaterThan(10);
    const missing = delegates.filter(name => !imported.has(name));
    expect(missing).toEqual([]);
  });
});
