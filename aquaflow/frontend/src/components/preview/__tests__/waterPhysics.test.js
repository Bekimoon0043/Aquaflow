import { describe, it, expect } from 'vitest';
import { terminalSpeed, launchForApex, riseTime, fallTime, footprint, insidePolygon, oversprayShare, windSafeScale, visibleLead, calibrateFromTrack, G } from '../waterPhysics';
import { buildSiteModel } from '../../programmer/studio/siteCapability';
import { siteContext, runCase } from '../../programmer/studio/showGenerators';
import { SITES, makeSong, SONGS } from '../../programmer/studio/evalCorpus';

const basin = [[-8, -5], [8, -5], [8, 5], [-8, 5]];

describe('water physics', () => {
  it('drops fall at their terminal speed (Gunn–Kinzer: ~4, 6.5, 9 m/s for 1, 2, 5 mm)', () => {
    expect(terminalSpeed(1)).toBeCloseTo(4.0, 0);
    expect(terminalSpeed(2)).toBeCloseTo(6.5, 0);
    expect(terminalSpeed(5)).toBeCloseTo(9.1, 0);
  });

  it('a jet column needs a little more than free-fall speed and rises in about √(2h/g)', () => {
    for (const h of [1, 5, 20]) {
      const free = Math.sqrt(2 * G * h);
      expect(launchForApex(h)).toBeGreaterThan(free);
      expect(launchForApex(h)).toBeLessThan(free * 1.2);
      expect(riseTime(h)).toBeLessThanOrEqual(Math.sqrt((2 * h) / G) + 1e-9);
      expect(riseTime(h)).toBeGreaterThan(0.9 * Math.sqrt((2 * h) / G));
    }
    expect(fallTime(5, 6.5)).toBeGreaterThan(Math.sqrt(10 / G));
    expect(visibleLead(5, { delayS: 0.3 })).toBeCloseTo(0.3 + riseTime(5), 6);
  });

  it('keeps a central jet in the basin, but wind and the edge push water out', () => {
    const centre = { x: 0, y: 0, heightM: 4 };
    expect(oversprayShare(centre, basin)).toBe(0);
    const edge = { x: 7.6, y: 0, heightM: 6 };
    expect(oversprayShare(edge, basin, { windMs: 5 })).toBeGreaterThan(0.5);
    expect(windSafeScale(edge, basin, { windMs: 5 })).toBeLessThan(0.5);
    expect(windSafeScale(centre, basin, { windMs: 2 })).toBe(1);
    const pts = footprint({ x: 0, y: 0, heightM: 6 }, { windMs: 4, windDirDeg: 0 });
    expect(pts.reduce((s, p) => s + p.x * p.w, 0) / pts.reduce((s, p) => s + p.w, 0)).toBeGreaterThan(0.5);   // drifts downwind (+x)
    expect(insidePolygon(0, 0, basin)).toBe(true);
    expect(insidePolygon(9, 0, basin)).toBe(false);
  });

  it('fits delay, apex and drag from jet-tip points measured on video', () => {
    const delay = 0.25, vt = 20, v0 = launchForApex(4, vt), k = G / (vt * vt), pts = [];
    for (let t = 0.3; t < 1.2; t += 0.08) {
      let z = 0, v = v0, s = 0;
      while (s < t - delay && v > 0) { z += v * 0.001; v += (-G - k * v * Math.abs(v)) * 0.001; s += 0.001; }
      if (v > 0) pts.push({ t, h: z });
    }
    const fit = calibrateFromTrack(pts);
    expect(fit.delayS).toBeCloseTo(delay, 1);
    expect(fit.rms).toBeLessThan(0.05);
    expect(() => calibrateFromTrack(pts.slice(0, 2))).toThrow(/4 frames/);
  });
});

describe('site model with basin, wind and calibration', () => {
  const ring = siteContext(SITES.ring().fixtures);
  const tight = [[-8.4, -5.4], [8.4, -5.4], [8.4, 5.4], [-8.4, 5.4]];
  it('lowers areas whose water would leave the basin, explains why, and uses measured timing', () => {
    const calm = buildSiteModel(ring.items, { design: ring.design, overrides: { basin: tight } });
    const windy = buildSiteModel(ring.items, { design: ring.design, overrides: { basin: tight, windMs: 4 } });
    const avg = (scm) => scm.areas.reduce((s, a) => s + a.heightScale, 0) / scm.areas.length;
    expect(avg(windy)).toBeLessThan(avg(calm));
    expect(windy.tips.some((t) => /lands outside the basin at 4 m\/s/.test(t))).toBe(true);
    const cal = buildSiteModel(ring.items, { design: ring.design, overrides: { calibration: { nozzle_straight_dn25: { delayS: 0.6, vtMs: 25 } } } });
    const jet = cal.outputs.find((o) => o.id === 'j0');
    expect(jet.latency).toMatchObject({ delayS: 0.6, provenance: 'calibrated' });
    expect(jet.latency.leadS).toBeCloseTo(visibleLead(4, { delayS: 0.6, vt: 25 }), 2);
  });

  it('the generated show keeps every jet inside the basin at the site wind', () => {
    const site = siteContext(SITES.ring().fixtures, undefined, { basin: tight, windMs: 2 });
    const r = runCase('plan-v1', site, makeSong(SONGS.ballad));
    expect(r.gates.counts.splash || 0).toBe(0);
    expect(r.pass).toBe(true);
  });
});
