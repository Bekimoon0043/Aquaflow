/**
 * splashMap.js — where the water actually lands.
 *
 * A fountain's realism is not only what the jets look like in the air; it is what
 * they leave behind. Wet stone is darker and glossier than dry stone, and it dries
 * from the edges in. Depence R4 added exactly this pair of features (a splash
 * heatmap and wet surfaces that dry over time) because they are what a designer
 * actually needs to see.
 *
 * This module is the ground truth behind both. It is deliberately pure — no three.js,
 * no WebGL — so the physics can be unit-tested headlessly, the same way jetPhysics.js is.
 *
 * WHERE THIS GOES BEYOND A VISUAL SPLASH MAP
 * ------------------------------------------
 * A renderer-only splash map counts particles, and particles are an artistic quantity:
 * doubling the spawn rate doubles the "spill" without one extra litre leaving the pool.
 * That number cannot be put in front of a client.
 *
 * So every cell here is calibrated. The caller supplies `litresPerImpact`, derived from
 * the SOLVED nozzle flow (AQ-S2-002) divided by the particle spawn rate actually used to
 * render it. Deposition is then a real volumetric rate and `containment()` reports
 * litres/minute leaving the basin and the peak wetting rate in L/min/m² — engineering
 * figures a designer can size a drain or a gutter from.
 *
 * When no calibration is supplied the map still works, and every volumetric field is
 * reported as null rather than as a fabricated number. Uncalibrated is a valid state;
 * a made-up litre value is not.
 */

/** Default drying time constant (seconds) for the wetness field to fall to 1/e. */
export const DEFAULT_DRY_TAU_S = 26.0;

/** Wetness below this reads as dry and is flushed to zero to keep the texture clean. */
const DRY_EPSILON = 0.004;

/**
 * Bilinear deposition weights. Splitting an impact across the four surrounding cells
 * keeps the wet patch smooth instead of aliasing into a grid of hard squares — which
 * matters because the wetness field is sampled directly as a texture.
 */
function bilinearCells(gx, gz, res) {
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const fx = gx - x0, fz = gz - z0;
  const out = [];
  for (let dz = 0; dz <= 1; dz++) {
    for (let dx = 0; dx <= 1; dx++) {
      const x = x0 + dx, z = z0 + dz;
      if (x < 0 || z < 0 || x >= res || z >= res) continue;
      const w = (dx ? fx : 1 - fx) * (dz ? fz : 1 - fz);
      if (w > 0) out.push({ i: z * res + x, w });
    }
  }
  return out;
}

export class SplashMap {
  /**
   * @param {object} opts
   * @param {number} opts.extent      side length in metres of the square the grid covers, centred on the origin
   * @param {number} opts.resolution  cells per side
   * @param {number} opts.dryTauS     drying time constant in seconds
   */
  constructor({ extent = 32, resolution = 128, dryTauS = DEFAULT_DRY_TAU_S } = {}) {
    this.extent = extent;
    this.res = resolution;
    this.dryTauS = dryTauS;
    this.cellM = extent / resolution;
    this.cellAreaM2 = this.cellM * this.cellM;

    // Current surface wetness, 0..1, decaying. Drives the visual.
    this.wet = new Float32Array(resolution * resolution);
    // Cumulative impact weight per cell. Never decays — this is the analysis record.
    this.accum = new Float32Array(resolution * resolution);

    this.totalImpacts = 0;
    this.outsideImpacts = 0;
    this.elapsedS = 0;
    this.litresPerImpact = null;
    this._peakWet = 0;
  }

  /**
   * Calibrate impacts to real volume.
   * @param {number|null} litresPerImpact litres of water represented by one particle impact
   */
  setCalibration(litresPerImpact) {
    this.litresPerImpact =
      Number.isFinite(litresPerImpact) && litresPerImpact > 0 ? litresPerImpact : null;
  }

  /** World metres → grid coordinates. Returns null when outside the mapped square. */
  _toGrid(x, z) {
    const half = this.extent / 2;
    const gx = ((x + half) / this.extent) * this.res;
    const gz = ((z + half) / this.extent) * this.res;
    if (gx < 0 || gz < 0 || gx >= this.res || gz >= this.res) return null;
    return { gx, gz };
  }

  /**
   * Record one impact at world (x, z).
   * @param {number} x world metres
   * @param {number} z world metres
   * @param {number} amount impact weight (1 = one nominal droplet)
   * @param {boolean} insideBasin whether it landed in the water, not on the deck
   * @returns {boolean} whether the impact fell inside the mapped area
   */
  deposit(x, z, amount = 1, insideBasin = true) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(amount > 0)) return false;
    this.totalImpacts += amount;
    if (!insideBasin) this.outsideImpacts += amount;

    const g = this._toGrid(x, z);
    if (!g) return false;

    for (const { i, w } of bilinearCells(g.gx, g.gz, this.res)) {
      this.accum[i] += amount * w;
      // Water landing in the basin joins the pool; it does not make the deck wet.
      // Only deck impacts raise the wetness field the surface shader reads.
      if (!insideBasin) {
        const v = this.wet[i] + amount * w * 0.55;
        this.wet[i] = v > 1 ? 1 : v;
        if (this.wet[i] > this._peakWet) this._peakWet = this.wet[i];
      }
    }
    return true;
  }

  /**
   * Advance drying by `dt` seconds. Exponential decay toward dry, which is how a real
   * wet surface behaves: fast at first while the film is thick, then a long tail.
   */
  dry(dt) {
    if (!(dt > 0)) return;
    this.elapsedS += dt;
    const k = Math.exp(-dt / this.dryTauS);
    let peak = 0;
    for (let i = 0; i < this.wet.length; i++) {
      const v = this.wet[i] * k;
      this.wet[i] = v < DRY_EPSILON ? 0 : v;
      if (this.wet[i] > peak) peak = this.wet[i];
    }
    this._peakWet = peak;
  }

  /** Highest wetness anywhere on the map, 0..1. */
  peakWetness() { return this._peakWet; }

  /**
   * Containment analysis — the engineering answer, not a picture.
   *
   * Volumetric fields are null unless the map has been calibrated against solved flow,
   * because an uncalibrated particle count is not a litre.
   */
  containment() {
    const total = this.totalImpacts;
    const outside = this.outsideImpacts;
    const fractionOutside = total > 0 ? outside / total : 0;

    let spillLpm = null, peakWettingLpmPerM2 = null, containedLpm = null;
    if (this.litresPerImpact && this.elapsedS > 0) {
      const minutes = this.elapsedS / 60;
      spillLpm = (outside * this.litresPerImpact) / minutes;
      containedLpm = ((total - outside) * this.litresPerImpact) / minutes;

      let maxCell = 0;
      for (let i = 0; i < this.accum.length; i++) {
        if (this.accum[i] > maxCell) maxCell = this.accum[i];
      }
      peakWettingLpmPerM2 =
        (maxCell * this.litresPerImpact) / minutes / this.cellAreaM2;
    }

    return {
      totalImpacts: total,
      outsideImpacts: outside,
      fractionOutside,
      percentOutside: fractionOutside * 100,
      calibrated: this.litresPerImpact != null,
      spillLpm,
      containedLpm,
      peakWettingLpmPerM2,
      elapsedS: this.elapsedS,
    };
  }

  /** Largest cumulative deposit in any one cell — the heatmap's normalising constant. */
  peakAccum() {
    let m = 0;
    for (let i = 0; i < this.accum.length; i++) if (this.accum[i] > m) m = this.accum[i];
    return m;
  }

  /**
   * Fill an RGBA byte buffer with the wetness field.
   * R carries wetness; the shader uses it to darken albedo and drop roughness.
   */
  writeWetRGBA(out) {
    const n = this.wet.length;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(1, this.wet[i]));
      const b = (v * 255) | 0;
      out[i * 4] = b; out[i * 4 + 1] = b; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
    }
    return out;
  }

  /**
   * Fill an RGBA byte buffer with the containment heatmap.
   * Cells with no deposit stay fully transparent so the deck shows through.
   */
  writeHeatRGBA(out) {
    const peak = this.peakAccum();
    const inv = peak > 0 ? 1 / peak : 0;
    for (let i = 0; i < this.accum.length; i++) {
      const t = this.accum[i] * inv;
      const [r, g, b] = heatColor(t);
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b;
      // Ramp alpha in quickly so light wetting is still visible, then hold.
      out[i * 4 + 3] = t <= 0 ? 0 : Math.min(255, (40 + t * 470) | 0);
    }
    return out;
  }

  reset() {
    this.wet.fill(0);
    this.accum.fill(0);
    this.totalImpacts = 0;
    this.outsideImpacts = 0;
    this.elapsedS = 0;
    this._peakWet = 0;
  }
}

/**
 * Perceptually-ordered blue → cyan → green → amber → red ramp.
 * Monotonic in luminance, so the heatmap still reads correctly in greyscale
 * and for the ~8% of men with red-green colour deficiency.
 * @returns {[number,number,number]} 0-255 RGB
 */
export function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, 12, 40, 120],
    [0.25, 0, 150, 200],
    [0.50, 40, 200, 120],
    [0.75, 245, 190, 40],
    [1.00, 235, 45, 30],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, r0, g0, b0] = stops[i];
    const [t1, r1, g1, b1] = stops[i + 1];
    if (x <= t1) {
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      return [
        Math.round(r0 + (r1 - r0) * f),
        Math.round(g0 + (g1 - g0) * f),
        Math.round(b0 + (b1 - b0) * f),
      ];
    }
  }
  return [235, 45, 30];
}

/**
 * Is a world point inside the basin?
 * Mirrors the pool shapes the designer can actually build: circular and rectangular
 * analytically (unchanged since calibration), polygons through basinMask.js.
 */
export function insidePool(x, z, pool) {
  if (!pool) return false;
  // AF-3D-017: a polygon basin (freeform / L-shape / islands) carries its mask. Its
  // bounding rectangle is NOT the basin — the notch of an L is deck, not water.
  if (pool.type === "polygon" && pool.mask) return pool.mask.contains(x, z);
  if (pool.type === "circular") {
    const r = pool.radius || 0;
    return x * x + z * z <= r * r;
  }
  const hw = (pool.width || 0) / 2;
  const hl = (pool.length || 0) / 2;
  return Math.abs(x) <= hw && Math.abs(z) <= hl;
}

/**
 * Litres represented by a single rendered particle impact.
 *
 * This is the bridge between the renderer and the hydraulics: the solver says the
 * design moves `solvedFlowLpm` litres a minute, and the renderer spawns
 * `particlesPerSecond` droplets to depict it. One droplet therefore stands for
 * flow / rate litres. Without both numbers there is no honest conversion, so the
 * function returns null and every volumetric readout downstream reports as
 * "not calibrated" rather than guessing.
 */
export function litresPerImpact(solvedFlowLpm, particlesPerSecond) {
  if (!Number.isFinite(solvedFlowLpm) || solvedFlowLpm <= 0) return null;
  if (!Number.isFinite(particlesPerSecond) || particlesPerSecond <= 0) return null;
  return solvedFlowLpm / 60 / particlesPerSecond;
}
