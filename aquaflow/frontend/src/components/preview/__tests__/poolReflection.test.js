import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EasyScene, WATER_SHADER } from "../../panels/easy/EasyScene";
import { FountainScene } from "../FountainScene_v6";
import { DEFAULT_RENDER_SETTINGS, normalizeUnifiedProject } from "../../../store/projectStore";

function classicScene() {
  const scene = Object.create(FountainScene.prototype);
  Object.assign(scene, {
    quality: "medium",
    _poolReflection: 1,
    _reflection: null,
    THREE,
    renderer: {},
    waterMat: { uniforms: { uReflectStrength: { value: 1 } } },
  });
  return scene;
}

describe("pool water reflection", () => {
  it("defaults to full reflection and preserves an explicit zero in the project", () => {
    expect(DEFAULT_RENDER_SETTINGS.poolReflection).toBe(1);
    expect(normalizeUnifiedProject({ render: { poolReflection: 0 } }).render.poolReflection).toBe(0);
  });

  it("scales the Studio water shader reflection down to zero", () => {
    expect(WATER_SHADER.uniforms.reflectionStrength.value).toBe(1);
    expect(WATER_SHADER.fragmentShader).toContain("uniform float reflectionStrength");
    expect(WATER_SHADER.fragmentShader).toContain(") * reflectionStrength");
    const scene = Object.create(EasyScene.prototype);
    scene.waterMirror = { material: { uniforms: { reflectionStrength: { value: 1 } } } };
    scene.setPoolReflection(0);
    expect(scene.poolReflection).toBe(0);
    expect(scene.waterMirror.material.uniforms.reflectionStrength.value).toBe(0);
    scene.setPoolReflection(0.45);
    expect(scene.waterMirror.material.uniforms.reflectionStrength.value).toBe(0.45);
    scene.setPoolReflection(2);
    expect(scene.waterMirror.material.uniforms.reflectionStrength.value).toBe(1);
    scene.setPoolReflection(-1);
    expect(scene.waterMirror.material.uniforms.reflectionStrength.value).toBe(0);
  });

  it("disables the classic reflection probe at zero and restores partial strength", () => {
    const scene = classicScene();
    scene.setPoolReflection(0);
    expect(scene._reflection).toBeNull();
    expect(scene.waterMat.uniforms.uReflectStrength.value).toBe(0);
    scene.setPoolReflection(0.45);
    expect(scene._reflection).not.toBeNull();
    expect(scene.waterMat.uniforms.uReflectStrength.value).toBe(0.45);
    scene.setPoolReflection(0);
    expect(scene._reflection).toBeNull();
    expect(scene.waterMat.uniforms.uReflectStrength.value).toBe(0);
  });

  it("clamps classic reflection values and falls back to full strength for invalid input", () => {
    const scene = classicScene();
    scene.setPoolReflection(2);
    expect(scene._poolReflection).toBe(1);
    expect(scene.waterMat.uniforms.uReflectStrength.value).toBe(1);
    scene.setPoolReflection(-1);
    expect(scene._poolReflection).toBe(0);
    expect(scene.waterMat.uniforms.uReflectStrength.value).toBe(0);
    scene.setPoolReflection(Number.NaN);
    expect(scene._poolReflection).toBe(1);
    expect(scene.waterMat.uniforms.uReflectStrength.value).toBe(1);
  });
});
