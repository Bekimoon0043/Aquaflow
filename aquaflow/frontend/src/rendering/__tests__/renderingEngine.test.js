// Unit tests for the Photorealistic Rendering Engine (AQ-S3-004).
// Covers the three acceptance criteria via the engine's pure, testable core:
//   1. Water physics rendered  — projectile trajectory math.
//   2. Reflections rendered    — water-surface mirror + Fresnel.
//   3. Night scenes supported  — environment presets incl. night.
import { describe, it, expect } from 'vitest'
import {
  GRAVITY, jetLaunchSpeed, apexHeight, timeOfFlight, launchVelocity,
  dropletPosition, simulateJet,
} from '../waterPhysics'
import {
  reflectPoint, reflectionMatrix, fresnelSchlick, normalReflectance, reflectionConfig,
} from '../reflections'
import {
  SCENE_MODES, ENVIRONMENTS, NIGHT_SCENE_NAMES, getSceneMode, isNightScene,
} from '../sceneModes'
import { buildRenderConfig } from '../index'

// ── 1. Water physics ───────────────────────────────────────────────────────────
describe('water physics', () => {
  it('launch speed and apex height are inverse (reach 5 m)', () => {
    const v = jetLaunchSpeed(5)
    expect(v).toBeCloseTo(Math.sqrt(2 * 9.81 * 5), 6)
    expect(apexHeight(v)).toBeCloseTo(5, 6)
  })

  it('time of flight is symmetric rise+fall', () => {
    const v = jetLaunchSpeed(5)            // vertical launch
    expect(timeOfFlight(v)).toBeCloseTo((2 * v) / GRAVITY, 6)
  })

  it('droplet follows parabolic motion (y = vy*t - 0.5 g t^2)', () => {
    const p = dropletPosition({ vy: 10, t: 0.5 })
    expect(p.y).toBeCloseTo(10 * 0.5 - 0.5 * 9.81 * 0.25, 6)
    // Apex: velocity/gravity time → matches apexHeight
    const tApex = 10 / GRAVITY
    expect(dropletPosition({ vy: 10, t: tApex }).y).toBeCloseTo(apexHeight(10), 5)
  })

  it('simulateJet returns a trajectory that peaks near the apex and returns to launch height', () => {
    const pts = simulateJet({ origin: { x: 0, y: 0, z: 0 }, speed: jetLaunchSpeed(4), steps: 20 })
    expect(pts.length).toBe(21)
    const maxY = Math.max(...pts.map(p => p.y))
    expect(maxY).toBeCloseTo(4, 2)                 // apex ≈ requested height
    expect(pts[pts.length - 1].y).toBeCloseTo(0, 4) // returns to launch height
  })

  it('tilt redirects some velocity horizontally (lower apex)', () => {
    const straight = launchVelocity(10, 0, 0)
    const tilted = launchVelocity(10, 30, 0)
    expect(tilted.vy).toBeLessThan(straight.vy)
    expect(Math.abs(tilted.vx)).toBeGreaterThan(0)
  })

  it('the engine gravity constant matches physical gravity', () => {
    expect(GRAVITY).toBeCloseTo(9.81, 6)
  })
})

// ── 2. Reflections ──────────────────────────────────────────────────────────────
describe('reflections', () => {
  it('reflects a point across the water plane', () => {
    expect(reflectPoint({ x: 1, y: 3, z: 2 }, 0)).toEqual({ x: 1, y: -3, z: 2 })
    expect(reflectPoint({ x: 1, y: 3, z: 2 }, 1)).toEqual({ x: 1, y: -1, z: 2 })
  })

  it('reflection matrix (column-major) mirrors y', () => {
    const m = reflectionMatrix(2)
    // column-major: element [5] is the y-scale, [13] is the y-translation
    expect(m[5]).toBe(-1)
    expect(m[13]).toBe(4) // 2*surfaceY
  })

  it('Fresnel: near-mirror at grazing, near-transparent looking straight down', () => {
    expect(fresnelSchlick(0)).toBeCloseTo(1, 6)          // grazing angle → full reflection
    expect(fresnelSchlick(1)).toBeCloseTo(normalReflectance(1.33), 6) // ~0.02 for water
    expect(fresnelSchlick(1)).toBeLessThan(0.03)
    // Monotonic: more grazing → more reflective
    expect(fresnelSchlick(0.2)).toBeGreaterThan(fresnelSchlick(0.8))
  })

  it('reflectionConfig produces a usable water-surface reflection', () => {
    const cfg = reflectionConfig({ surfaceY: 0.5, ior: 1.33, reflectivity: 0.9 })
    expect(cfg.enabled).toBe(true)
    expect(cfg.matrix[13]).toBe(1)   // 2*0.5
    expect(cfg.normalReflectance).toBeLessThan(0.03)
    expect(reflectionConfig({ reflectivity: 0 }).enabled).toBe(false)
  })
})

// ── 3. Night scenes ─────────────────────────────────────────────────────────────
describe('scene modes / night', () => {
  it('exposes all four environments', () => {
    expect(Object.keys(SCENE_MODES).sort()).toEqual(['arena', 'day', 'dusk', 'night'])
    expect(ENVIRONMENTS.NIGHT).toBe('night')
  })

  it('night is a first-class dark scene', () => {
    const night = getSceneMode('night')
    expect(night.isNight).toBe(true)
    expect(night.starfield).toBe(true)
    expect(night.background).toBe(0x020610)
    expect(isNightScene('night')).toBe(true)
    expect(isNightScene('arena')).toBe(true)     // arena is also dark
    expect(isNightScene('day')).toBe(false)
  })

  it('night has lower ambient + stronger bloom/glow than day', () => {
    const night = getSceneMode('night'), day = getSceneMode('day')
    expect(night.ambient.intensity).toBeLessThan(day.ambient.intensity)
    expect(night.bloom.strength).toBeGreaterThan(day.bloom.strength)
    expect(night.fixtureGlow).toBeGreaterThan(day.fixtureGlow)
  })

  it('NIGHT_SCENE_NAMES lists the dark scenes; unknown falls back to night', () => {
    expect(NIGHT_SCENE_NAMES).toContain('night')
    expect(getSceneMode('does-not-exist').id).toBe('night')
  })
})

// ── Engine aggregation ───────────────────────────────────────────────────────────
describe('buildRenderConfig', () => {
  it('assembles scene mode + reflection + per-jet water physics', () => {
    const cfg = buildRenderConfig({
      mode: 'night', surfaceY: 0,
      jets: [{ id: 'j1', origin: { x: 0, y: 0, z: 0 }, heightM: 6 }],
    })
    expect(cfg.isNight).toBe(true)
    expect(cfg.mode.id).toBe('night')
    expect(cfg.reflection.enabled).toBe(true)
    expect(cfg.water.gravity).toBeCloseTo(9.81, 6)
    expect(cfg.water.jets).toHaveLength(1)
    // A 6 m jet should compute an apex ≈ 6 m.
    expect(cfg.water.jets[0].apexHeight).toBeCloseTo(6, 4)
    expect(cfg.water.jets[0].apexY).toBeCloseTo(6, 4)
    expect(cfg.water.jets[0].timeOfFlight).toBeGreaterThan(0)
  })

  it('defaults to a night scene for an unknown mode', () => {
    expect(buildRenderConfig({ mode: 'zzz' }).mode.id).toBe('night')
  })
})
