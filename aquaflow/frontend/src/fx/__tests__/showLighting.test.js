import { describe, expect, it } from 'vitest';
import { showLampLevels, showLightExposure } from '../../components/panels/easy/EasyScene';

describe('Studio standalone light rendering', () => {
  it('an off lamp emits no lens or pool light', () => {
    expect(showLampLevels(0, 0, 4)).toMatchObject({ pool: 0, lens: 0 });
  });

  it('a lamp is clearly visible with every water jet off', () => {
    const light = showLampLevels(1, 0, 4);
    expect(light.pool).toBeGreaterThan(0.25);
    expect(light.lens).toBeGreaterThan(1.5);
    expect(light.radius).toBeGreaterThan(1.8);
    expect(light.lensSize).toBeGreaterThan(0.6);
  });

  it('running water strengthens the existing pool glow without changing its full-water level', () => {
    const dry = showLampLevels(1, 0, 8), wet = showLampLevels(1, 1, 8);
    expect(wet.pool).toBeGreaterThan(dry.pool);
    expect(wet.lens).toBeGreaterThan(dry.lens);
    expect(wet.pool).toBeCloseTo(0.8 + 0.012 * 8, 6);
  });

  it('lens and pool brightness follow the light level', () => {
    const dim = showLampLevels(0.3, 0, 4), bright = showLampLevels(0.9, 0, 4);
    expect(bright.lens / dim.lens).toBeCloseTo(3, 6);
    expect(bright.pool / dim.pool).toBeCloseTo(3, 6);
  });
});


describe('Studio dense-light exposure', () => {
  const pool = { shape: 'poly', points: [{ x: -20, z: -10 }, { x: 20, z: -10 }, { x: 20, z: 0 },
    ...Array.from({ length: 33 }, (_, i) => ({ x: 20 * Math.cos(i / 32 * Math.PI), z: 10 * Math.sin(i / 32 * Math.PI) })).slice(1), { x: -20, z: -10 }] };

  it('reduces accumulated light when many lamps share a small pool', () => {
    const result = showLightExposure(pool, 1679);
    expect(result.area).toBeCloseTo(713.6548490545938, 6);
    expect(result.density).toBeCloseTo(1679 / 713.6548490545938, 5);
    expect(result.poolScale).toBeLessThan(0.2);
    expect(result.lensScale).toBeGreaterThanOrEqual(0.35);
  });

  it('does not suppress sparse fountain lighting', () => {
    expect(showLightExposure(pool, 12)).toMatchObject({ poolScale: 1, lensScale: 1 });
    expect(showLightExposure(pool, 0)).toMatchObject({ poolScale: 1, lensScale: 1 });
  });
});
