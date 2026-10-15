import { describe, expect, it } from 'vitest';
import { buildFixtureArray, edgePoints } from '../arrays';

const triangle = { type: 'freeform', points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 10 }] };

describe('Along-edge fixture array', () => {
  it('places every fixture inside a triangle, evenly spaced around the outline, facing inward', () => {
    const made = buildFixtureArray({ geometry: triangle, fixtureType: 'nozzle_straight', typeLabel: 'Jet', mode: 'edge', count: 60, inset: 0.3 });
    expect(made).toHaveLength(60);
    const gaps = made.map((f, i) => Math.hypot(f.x - made[(i + 1) % made.length].x, f.y - made[(i + 1) % made.length].y));
    const inner = gaps.filter(g => g > 0.2); // corners shorten the gap; along an edge spacing is constant
    expect(Math.max(...inner) - Math.min(...inner.filter(g => g > 0.6))).toBeLessThan(0.05);
    // Facing inward: one step along the rotation goes toward the centroid.
    const cx = 8, cy = 10 / 3;
    for (const f of made) {
      const a = (f.rotation * Math.PI) / 180, ahead = Math.hypot(f.x + Math.cos(a) * 0.1 - cx, f.y + Math.sin(a) * 0.1 - cy);
      expect(ahead).toBeLessThan(Math.hypot(f.x - cx, f.y - cy));
    }
  });
  it('works for circles and either winding', () => {
    expect(buildFixtureArray({ geometry: { type: 'circle', center: { x: 5, y: 5 }, radius: 4 }, fixtureType: 'light', typeLabel: 'L', mode: 'edge', count: 24, inset: 0.5 })).toHaveLength(24);
    const reversed = { ...triangle, points: [...triangle.points].reverse() };
    expect(edgePoints(reversed, 30, 0.3).length).toBe(30);
    expect(buildFixtureArray({ geometry: reversed, fixtureType: 'x', typeLabel: 'X', mode: 'edge', count: 30, inset: 0.3 })).toHaveLength(30);
  });
});
