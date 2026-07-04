// Unit tests for the VR Walkthrough Engine (AQ-S3-006).
//   1. Navigation supported          — first-person + waypoint path maths.
//   2. VR mode supported             — WebXR capability detection + session config.
//   3. Client presentation supported — scripted auto-advancing tour.
import { describe, it, expect } from 'vitest'
import {
  NAV_MODES, headingVectors, clampToBounds, firstPersonStep, waypointPath, pathLength, lookAtYaw,
} from '../navigation'
import {
  isWebXRAvailable, isVRSupported, vrSessionOptions, vrReferenceSpaceType, vrState, VR_STATE,
} from '../vrMode'
import {
  DEFAULT_TOUR, buildTour, tourTotalDuration, tourStepAt, presentationConfig,
} from '../presentationMode'
import { createWalkthrough } from '../index'

// ── 1. Navigation ────────────────────────────────────────────────────────────
describe('navigation', () => {
  it('yaw 0 faces -Z; yaw 90 faces +X', () => {
    const a = headingVectors(0)
    expect(a.forward.x).toBeCloseTo(0, 6)
    expect(a.forward.z).toBeCloseTo(-1, 6)
    const b = headingVectors(90)
    expect(b.forward.x).toBeCloseTo(1, 6)
    expect(b.forward.z).toBeCloseTo(0, 6)
  })

  it('first-person walk moves forward along heading', () => {
    const p = firstPersonStep({ position: { x: 0, y: 1.6, z: 0 }, yawDeg: 0,
                                input: { forward: 1 }, speed: 2, dt: 1 })
    expect(p.z).toBeCloseTo(-2, 6)   // forward at yaw 0 = -Z
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(1.6, 6)  // no vertical input
  })

  it('strafe moves along +X at yaw 0', () => {
    const p = firstPersonStep({ position: { x: 0, y: 0, z: 0 }, yawDeg: 0,
                                input: { right: 1 }, speed: 3, dt: 1 })
    expect(p.x).toBeCloseTo(3, 6)
  })

  it('clamps movement to bounds', () => {
    const p = firstPersonStep({ position: { x: 9, y: 0, z: 0 }, yawDeg: 90,
                                input: { forward: 1 }, speed: 100, dt: 1,
                                bounds: { minX: -10, maxX: 10 } })
    expect(p.x).toBe(10)
  })

  it('waypoint path interpolates endpoints and midpoint', () => {
    const wps = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]
    expect(waypointPath(wps, 0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(waypointPath(wps, 1)).toEqual({ x: 10, y: 0, z: 0 })
    expect(waypointPath(wps, 0.5).x).toBeCloseTo(5, 6)
    expect(pathLength(wps)).toBeCloseTo(10, 6)
  })

  it('lookAtYaw faces +X target as 90°', () => {
    expect(lookAtYaw({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(90, 6)
  })

  it('exposes navigation modes', () => {
    expect(NAV_MODES.WALK).toBe('walk')
    expect(Object.values(NAV_MODES)).toContain('tour')
  })
})

// ── 2. VR mode ───────────────────────────────────────────────────────────────
describe('vr mode (WebXR)', () => {
  const xrNav = { xr: { isSessionSupported: async (m) => m === 'immersive-vr' } }
  const noXrNav = {}

  it('detects WebXR availability', () => {
    expect(isWebXRAvailable(xrNav)).toBe(true)
    expect(isWebXRAvailable(noXrNav)).toBe(false)
  })

  it('resolves immersive-vr support', async () => {
    expect(await isVRSupported(xrNav)).toBe(true)
    expect(await isVRSupported(noXrNav)).toBe(false)
  })

  it('provides a valid session request config', () => {
    const opts = vrSessionOptions()
    expect(opts.requiredFeatures).toContain('local-floor')
    expect(vrReferenceSpaceType()).toBe('local-floor')
  })

  it('computes VR state', async () => {
    expect(await vrState(xrNav, false)).toBe(VR_STATE.READY)
    expect(await vrState(xrNav, true)).toBe(VR_STATE.ACTIVE)
    expect(await vrState(noXrNav, false)).toBe(VR_STATE.UNSUPPORTED)
  })

  it('gracefully handles an isSessionSupported that throws', async () => {
    const bad = { xr: { isSessionSupported: async () => { throw new Error('nope') } } }
    expect(await isVRSupported(bad)).toBe(false)
  })
})

// ── 3. Presentation ──────────────────────────────────────────────────────────
describe('client presentation mode', () => {
  it('default tour has captioned steps', () => {
    expect(DEFAULT_TOUR.length).toBeGreaterThan(2)
    expect(DEFAULT_TOUR.every(s => s.caption && s.duration > 0)).toBe(true)
  })

  it('buildTour applies indices + durations', () => {
    const tour = buildTour([{ cameraMode: 'orbit' }, { cameraMode: 'aerial', duration: 4 }], { stepDuration: 5 })
    expect(tour[0].duration).toBe(5)
    expect(tour[1].duration).toBe(4)
    expect(tour[1].index).toBe(1)
  })

  it('tourStepAt auto-advances through steps over time', () => {
    const tour = buildTour([{ caption: 'a', duration: 3 }, { caption: 'b', duration: 3 }, { caption: 'c', duration: 3 }])
    expect(tourStepAt(tour, 1).index).toBe(0)
    expect(tourStepAt(tour, 4).index).toBe(1)
    expect(tourStepAt(tour, 7).index).toBe(2)
    expect(tourTotalDuration(tour)).toBe(9)
  })

  it('loops when elapsed exceeds total', () => {
    const tour = buildTour([{ duration: 2 }, { duration: 2 }])
    expect(tourStepAt(tour, 5, { loop: true }).index).toBe(0)   // 5 % 4 = 1 → step 0
    expect(tourStepAt(tour, 5, { loop: false }).done).toBe(true)
  })

  it('presentation config hides UI + goes fullscreen', () => {
    const cfg = presentationConfig()
    expect(cfg.hideUI).toBe(true)
    expect(cfg.fullscreen).toBe(true)
    expect(cfg.autoAdvance).toBe(true)
  })
})

// ── Aggregate engine ─────────────────────────────────────────────────────────
describe('createWalkthrough', () => {
  it('aggregates navigation + tour + VR capability', () => {
    const w = createWalkthrough({ mode: 'walk', waypoints: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] })
    expect(w.mode).toBe('walk')
    expect(w.positionAt(0.5).x).toBeCloseTo(2, 6)
    expect(w.pathLength()).toBeCloseTo(4, 6)
    expect(w.tour.length).toBeGreaterThan(0)
    expect(typeof w.vrSupported).toBe('function')
  })

  it('falls back to orbit for an unknown mode', () => {
    expect(createWalkthrough({ mode: 'zzz' }).mode).toBe('orbit')
  })
})
