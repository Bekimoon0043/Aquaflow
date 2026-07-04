// Unit tests for the Environment & Material Library (AQ-S3-008).
// Covers the acceptance criteria:
//   1. >= 20 environments included, 2. >= 20 materials included,
//   3. user customization supported (save/edit/delete custom presets + slot limits),
// plus the physics formulas and value ranges from the research spec.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  BUILTIN_ENVIRONMENTS, BUILTIN_MATERIALS, ENV_PARAM_RANGES, MATERIAL_PARAM_RANGES,
  getAllEnvironments, getAllMaterials, getEnvironment, getMaterial, buildThreeMaterial,
  LIBRARY_STATS,
  fresnel, waterReflectionIntensity, windRippleAmplitudeMm, mistVisibilityFactor,
  lightAttenuation, disabledEffectsForWind, reflectionMode, WIND_HARD_LIMIT_MPS,
  REALTIME_REFLECTION_BUDGET,
  saveCustomEnvironment, saveCustomMaterial, listCustomEnvironments, listCustomMaterials,
  deleteCustomEnvironment, deleteCustomMaterial, clearCustomLibrary,
  MAX_CUSTOM_ENVIRONMENTS, MAX_CUSTOM_MATERIALS,
} from '../index'

beforeEach(() => clearCustomLibrary())

// ── 1. environments included ──────────────────────────────────────────────────
describe('environment library', () => {
  it('includes at least 20 environments', () => {
    expect(BUILTIN_ENVIRONMENTS.length).toBeGreaterThanOrEqual(20)
    expect(LIBRARY_STATS.builtin_environments).toBeGreaterThanOrEqual(20)
  })

  it('every environment has unique id + all required parameters', () => {
    const ids = new Set()
    const required = Object.keys(ENV_PARAM_RANGES)
    for (const e of BUILTIN_ENVIRONMENTS) {
      expect(ids.has(e.id)).toBe(false); ids.add(e.id)
      expect(e.name).toBeTruthy()
      for (const k of required) expect(typeof e.params[k]).toBe('number')
    }
  })

  it('all parameters are within the spec ranges', () => {
    for (const e of BUILTIN_ENVIRONMENTS) {
      for (const [k, r] of Object.entries(ENV_PARAM_RANGES)) {
        expect(e.params[k]).toBeGreaterThanOrEqual(r.min)
        expect(e.params[k]).toBeLessThanOrEqual(r.max)
      }
    }
  })
})

// ── 2. materials included ─────────────────────────────────────────────────────
describe('material library', () => {
  it('includes at least 20 PBR materials', () => {
    expect(BUILTIN_MATERIALS.length).toBeGreaterThanOrEqual(20)
    expect(LIBRARY_STATS.builtin_materials).toBeGreaterThanOrEqual(20)
  })

  it('every material has the PBR constants within range', () => {
    const ids = new Set()
    for (const m of BUILTIN_MATERIALS) {
      expect(ids.has(m.id)).toBe(false); ids.add(m.id)
      for (const k of ['roughness', 'metalness', 'ior', 'transmission', 'clearcoat', 'reflectivity']) {
        const r = MATERIAL_PARAM_RANGES[k]
        expect(m[k]).toBeGreaterThanOrEqual(r.min)
        expect(m[k]).toBeLessThanOrEqual(r.max)
      }
    }
  })

  it('polished stainless + water surface match the spec constants', () => {
    const steel = getMaterial('MAT001')
    expect(steel.roughness).toBe(0.05)
    expect(steel.metalness).toBe(1.0)
    expect(steel.clearcoat).toBe(0.90)
    expect(steel.reflectivity).toBe(0.95)
    expect(steel.ior).toBe(2.5)
    const water = getMaterial('MAT019')
    expect(water.transmission).toBe(1.0)
    expect(water.ior).toBe(1.333)
    expect(water.roughness).toBe(0.01)
  })

  it('buildThreeMaterial emits a MeshPhysicalMaterial config', () => {
    const cfg = buildThreeMaterial(getMaterial('MAT017'))   // clear glass
    expect(cfg.transmission).toBe(1.0)
    expect(cfg.transparent).toBe(true)
    expect(cfg.ior).toBe(1.52)
    expect(cfg.specularIntensity).toBe(0.9)
  })
})

// ── 3. user customization ─────────────────────────────────────────────────────
describe('user customization', () => {
  it('saves a custom environment (clamped) and lists it', () => {
    const rec = saveCustomEnvironment({ name: 'My Plaza', params: { ambient_lux: 999999, wind_speed_mps: 4 } })
    expect(rec.id).toMatch(/^env-custom/)
    expect(rec.params.ambient_lux).toBe(ENV_PARAM_RANGES.ambient_lux.max)   // clamped
    expect(rec.params.wind_speed_mps).toBe(4)
    expect(listCustomEnvironments()).toHaveLength(1)
    expect(getAllEnvironments().length).toBe(BUILTIN_ENVIRONMENTS.length + 1)
    expect(getEnvironment(rec.id)).toBeTruthy()
  })

  it('saves a custom material (clamped) and lists it', () => {
    const rec = saveCustomMaterial({ name: 'My Steel', roughness: -3, metalness: 5, ior: 9, reflectivity: 0.8 })
    expect(rec.roughness).toBe(0)     // clamped to min
    expect(rec.metalness).toBe(1)     // clamped to max
    expect(rec.ior).toBe(3)           // clamped to max
    expect(getAllMaterials().length).toBe(BUILTIN_MATERIALS.length + 1)
  })

  it('editing a custom preset updates in place (no duplicate)', () => {
    const rec = saveCustomMaterial({ name: 'A', roughness: 0.3 })
    const edited = saveCustomMaterial({ ...rec, roughness: 0.7 })
    expect(edited.id).toBe(rec.id)
    expect(listCustomMaterials()).toHaveLength(1)
    expect(getMaterial(rec.id).roughness).toBe(0.7)
  })

  it('deletes custom presets', () => {
    const e = saveCustomEnvironment({ name: 'X' })
    const m = saveCustomMaterial({ name: 'Y' })
    deleteCustomEnvironment(e.id); deleteCustomMaterial(m.id)
    expect(listCustomEnvironments()).toHaveLength(0)
    expect(listCustomMaterials()).toHaveLength(0)
  })

  it('enforces the custom slot limits (50 env / 100 mat)', () => {
    for (let i = 0; i < MAX_CUSTOM_ENVIRONMENTS; i++) saveCustomEnvironment({ name: `E${i}` })
    expect(listCustomEnvironments()).toHaveLength(MAX_CUSTOM_ENVIRONMENTS)
    expect(() => saveCustomEnvironment({ name: 'overflow' })).toThrow(/limit/i)
    expect(MAX_CUSTOM_MATERIALS).toBe(100)
  })
})

// ── physics formulas ──────────────────────────────────────────────────────────
describe('formulas', () => {
  it('fresnel matches the spec example (F0=0.02, θ=45° → ≈0.022)', () => {
    expect(fresnel(0.02, 45)).toBeCloseTo(0.0221, 3)
    expect(waterReflectionIntensity(0.98, 0.02, 45)).toBeCloseTo(0.98 * fresnel(0.02, 45), 9)
  })

  it('wind ripple = wind × 1.5 (2 m/s → 3 mm)', () => {
    expect(windRippleAmplitudeMm(2)).toBe(3)
  })

  it('mist visibility = exp(-fog·distance) (0.002, 30 m → ≈0.941)', () => {
    expect(mistVisibilityFactor(0.002, 30)).toBeCloseTo(0.9418, 3)
  })

  it('light attenuation = I0 / d² (1000 lux @ 5 m → 40 lux)', () => {
    expect(lightAttenuation(1000, 5)).toBe(40)
  })

  it('wind at/above 25 m/s disables mist/laminar/fine jets', () => {
    expect(disabledEffectsForWind(20)).toEqual([])
    expect(disabledEffectsForWind(WIND_HARD_LIMIT_MPS)).toEqual(['mist', 'laminar', 'fine_jets'])
  })

  it('reflection falls back to a cubemap beyond the realtime budget', () => {
    expect(reflectionMode(REALTIME_REFLECTION_BUDGET)).toBe('realtime')
    expect(reflectionMode(REALTIME_REFLECTION_BUDGET + 1)).toBe('cubemap')
  })
})
