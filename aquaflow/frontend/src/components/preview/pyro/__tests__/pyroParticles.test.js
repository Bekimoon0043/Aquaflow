import { describe, expect, it } from "vitest";
import { fillPyroParticles } from "../pyroParticles";
import { pyroProduct } from "../../../../show/pyro";

const out = (n = 30000) => ({ pos: new Float32Array(n * 3), col: new Float32Array(n * 3), size: new Float32Array(n) });
const cue = (type, ignition = 1, id = "c1", x = 0) => ({ id, x, y0: 0, z: 0, ignition, product: pyroProduct({ type }) });

describe("firework particles", () => {
  it("nothing before ignition or after the stars fade", () => {
    const c = cue("pyro_shell_75_peony");
    expect(fillPyroParticles([c], 0.5, {}, out()).count).toBe(0);
    expect(fillPyroParticles([c], 1 + 2.4 + 1.8 + 0.1, {}, out()).count).toBe(0);
  });
  it("a shell rises during its lift, then bursts round the burst height", () => {
    const c = cue("pyro_shell_75_peony");
    const o = out();
    const rising = fillPyroParticles([c], 2.2, {}, o);
    expect(rising.count).toBeGreaterThan(0);
    expect(rising.count).toBeLessThan(10);
    const ys = Array.from({ length: rising.count }, (_, i) => o.pos[i * 3 + 1]);
    expect(Math.max(...ys)).toBeGreaterThan(20); expect(Math.max(...ys)).toBeLessThan(90);
    const b = fillPyroParticles([c], 1 + 2.4 + 0.6, {}, o);
    expect(b.count).toBeGreaterThan(100);
    expect(fillPyroParticles([c], 1 + 2.4 + 0.2, {}, out()).flash.intensity).toBeGreaterThan(0);
    expect(b.flash.intensity).toBe(0);
    let far = 0;
    for (let i = 0; i < b.count; i++) far = Math.max(far, Math.hypot(o.pos[i * 3], o.pos[i * 3 + 1] - 90, o.pos[i * 3 + 2]));
    expect(far).toBeGreaterThan(10); expect(far).toBeLessThan(40);   // burst radius 31.5 m
  });
  it("is deterministic in show time (live and baked frames match)", () => {
    const cues = [cue("pyro_shell_100_willow", 0.5, "a"), cue("pyro_mine_75mm", 1, "b", 10), cue("pyro_gerb_6m_10s", 0, "g", -10)];
    const a = out(), b = out();
    const ra = fillPyroParticles(cues, 4.123, {}, a), rb = fillPyroParticles(cues, 4.123, {}, b);
    expect(ra.count).toBe(rb.count);
    expect(Array.from(a.pos.slice(0, ra.count * 3))).toEqual(Array.from(b.pos.slice(0, rb.count * 3)));
  });
  it("respects the particle budget", () => {
    const cues = Array.from({ length: 30 }, (_, i) => cue("pyro_shell_125_chrysanthemum", 0, `s${i}`, i * 3));
    const r = fillPyroParticles(cues, 4, { budget: 5000 }, out());
    expect(r.count).toBeLessThanOrEqual(5000);
    expect(r.count).toBeGreaterThan(1000);
  });
  it("gerbs spray from the ground for their whole duration; cakes fire shot after shot", () => {
    const o = out();
    const g = fillPyroParticles([cue("pyro_gerb_6m_10s", 0)], 5, {}, o);
    expect(g.count).toBeGreaterThan(20);
    let top = 0; for (let i = 0; i < g.count; i++) top = Math.max(top, o.pos[i * 3 + 1]);
    expect(top).toBeGreaterThan(2); expect(top).toBeLessThan(12);
    const early = fillPyroParticles([cue("pyro_cake_25_30mm", 0)], 1.6, {}, out()).count;
    const later = fillPyroParticles([cue("pyro_cake_25_30mm", 0)], 6, {}, out()).count;
    expect(early).toBeGreaterThan(0); expect(later).toBeGreaterThan(0);
  });
});
