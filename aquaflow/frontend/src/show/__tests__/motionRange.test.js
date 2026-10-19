// Moving nozzles turn as far as their real swing range allows (half the published range, ≤90°);
// fixtures without a range keep the old ±45° limit.
import { describe, it, expect } from 'vitest'
import { evaluateShowFrameAt, motionLimits } from '../evaluateShowFrame'

const show = (engineering) => ({
  fixtures: [{ id: 'm', type: 'motion_nozzle_2d_mdd_l_oase', engineering }],
  clips: [
    { id: 'p', fixtureId: 'm', type: 'motion_pan', startTime: 0, duration: 10, value: 80 },
    { id: 't', fixtureId: 'm', type: 'motion_tilt', startTime: 0, duration: 10, value: -80 },
  ],
})

describe('motion range', () => {
  it('uses half the published pan / tilt range', () => {
    expect(motionLimits({ engineering: { panRangeDeg: 200, tiltRangeDeg: 140 } })).toEqual({ pan: 90, tilt: 70 })
    expect(motionLimits({ engineering: { swingRangeDeg: 90 } })).toEqual({ pan: 45, tilt: 45 })
    expect(motionLimits({})).toEqual({ pan: 45, tilt: 45 })
  })

  it('an OASE MDD L (X 200° / Y 140°) reaches 80° pan and -70° tilt', () => {
    const f = evaluateShowFrameAt(show({ panRangeDeg: 200, tiltRangeDeg: 140 }), 1).fixtures.m
    expect(f.motion.pan).toBe(80)
    expect(f.motion.tilt).toBe(-70)
  })

  it('a fixture without a range stays within ±45°', () => {
    const f = evaluateShowFrameAt(show({}), 1).fixtures.m
    expect(f.motion.pan).toBe(45)
    expect(f.motion.tilt).toBe(-45)
  })
})
