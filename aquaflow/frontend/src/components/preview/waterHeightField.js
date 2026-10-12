/**
 * A damped shallow-water heightfield driven by real nozzle landing events.
 *
 * The particle systems report the same impact positions used by containment analysis.
 * Those impacts excite this grid, whose height texture is sampled by the water shader.
 * Unlike decorative expanding rings, neighbouring cells exchange energy: intersecting
 * waves interfere, reflect from the basin edge and settle naturally.
 */
export class WaterHeightField {
  constructor({ extent = 32, resolution = 96, waveSpeed = 1.7, damping = 0.985,
    boundaryDamping = 0.82, maxHeight = 0.22 } = {}) {
    this.extent = extent;
    this.resolution = Math.max(16, Math.floor(resolution));
    this.waveSpeed = waveSpeed;
    this.damping = damping;
    this.boundaryDamping = boundaryDamping;
    this.maxHeight = maxHeight;
    this.cellSize = extent / this.resolution;
    const count = this.resolution * this.resolution;
    this.height = new Float32Array(count);
    this.velocity = new Float32Array(count);
    this.nextHeight = new Float32Array(count);
    this.mask = new Uint8Array(count);
    this._accumulator = 0;
    this.setPool({ type: "rect", width: extent, length: extent });
  }

  setPool(pool = {}) {
    this.pool = { ...pool };
    const n = this.resolution;
    const half = this.extent / 2;
    for (let z = 0; z < n; z++) {
      const wz = ((z + 0.5) / n) * this.extent - half;
      for (let x = 0; x < n; x++) {
        const wx = ((x + 0.5) / n) * this.extent - half;
        const inside = pool.type === "circular"
          ? wx * wx + wz * wz <= Math.pow(Number(pool.radius) || 0, 2)
          : Math.abs(wx) <= (Number(pool.width) || this.extent) / 2
            && Math.abs(wz) <= (Number(pool.length) || this.extent) / 2;
        const i = z * n + x;
        this.mask[i] = inside ? 1 : 0;
        if (!inside) {
          this.height[i] = 0;
          this.velocity[i] = 0;
        }
      }
    }
  }

  setExtent(extent) {
    const next = Math.max(1, Number(extent) || this.extent);
    if (Math.abs(next - this.extent) < 1e-6) return;
    this.extent = next;
    this.cellSize = next / this.resolution;
    this.reset();
    this.setPool(this.pool);
  }

  _grid(x, z) {
    const half = this.extent / 2;
    return {
      x: ((x + half) / this.extent) * this.resolution - 0.5,
      z: ((z + half) / this.extent) * this.resolution - 0.5,
    };
  }

  disturb(x, z, strength = 0.035, radiusM = 0.38) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(strength > 0)) return false;
    const g = this._grid(x, z);
    const radiusCells = Math.max(1, radiusM / this.cellSize);
    const reach = Math.ceil(radiusCells * 2.5);
    const minX = Math.max(0, Math.floor(g.x - reach));
    const maxX = Math.min(this.resolution - 1, Math.ceil(g.x + reach));
    const minZ = Math.max(0, Math.floor(g.z - reach));
    const maxZ = Math.min(this.resolution - 1, Math.ceil(g.z + reach));
    let touched = false;
    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const i = gz * this.resolution + gx;
        if (!this.mask[i]) continue;
        const dx = gx - g.x, dz = gz - g.z;
        const falloff = Math.exp(-(dx * dx + dz * dz) / (2 * radiusCells * radiusCells));
        if (falloff < 0.01) continue;
        // Downward displacement followed by upward velocity produces the compact
        // crown and outward wave seen where a real jet enters the pool.
        this.height[i] = Math.max(-this.maxHeight, this.height[i] - strength * falloff * 0.45);
        this.velocity[i] += strength * falloff * 2.8;
        touched = true;
      }
    }
    return touched;
  }

  _step(dt) {
    const n = this.resolution;
    const c2 = this.waveSpeed * this.waveSpeed;
    const invCell2 = 1 / (this.cellSize * this.cellSize);
    const damp = Math.pow(this.damping, dt * 60);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        if (!this.mask[i]) { this.nextHeight[i] = 0; continue; }
        const h = this.height[i];
        const hasLeft = x > 0 && this.mask[i - 1];
        const hasRight = x + 1 < n && this.mask[i + 1];
        const hasDown = z > 0 && this.mask[i - n];
        const hasUp = z + 1 < n && this.mask[i + n];
        const left = hasLeft ? this.height[i - 1] : h;
        const right = hasRight ? this.height[i + 1] : h;
        const down = hasDown ? this.height[i - n] : h;
        const up = hasUp ? this.height[i + n] : h;
        const laplacian = (left + right + down + up - 4 * h) * invCell2;
        const atBoundary = !hasLeft || !hasRight || !hasDown || !hasUp;
        this.velocity[i] = (this.velocity[i] + c2 * laplacian * dt)
          * damp * (atBoundary ? this.boundaryDamping : 1);
        this.nextHeight[i] = Math.max(-this.maxHeight,
          Math.min(this.maxHeight, h + this.velocity[i] * dt));
      }
    }
    const previous = this.height;
    this.height = this.nextHeight;
    this.nextHeight = previous;
  }

  advance(dt) {
    if (!(dt > 0)) return;
    this._accumulator += Math.min(dt, 0.1);
    const fixed = 1 / 60;
    let steps = 0;
    while (this._accumulator >= fixed && steps < 6) {
      this._step(fixed);
      this._accumulator -= fixed;
      steps++;
    }
  }

  sample(x, z) {
    const g = this._grid(x, z);
    const gx = Math.max(0, Math.min(this.resolution - 1, Math.round(g.x)));
    const gz = Math.max(0, Math.min(this.resolution - 1, Math.round(g.z)));
    return this.height[gz * this.resolution + gx];
  }

  energy() {
    let total = 0;
    for (let i = 0; i < this.height.length; i++) {
      total += this.height[i] * this.height[i] + this.velocity[i] * this.velocity[i] * 0.02;
    }
    return total;
  }

  writeRGBA(out) {
    const scale = 1 / (this.maxHeight * 2);
    for (let i = 0; i < this.height.length; i++) {
      const encoded = Math.max(0, Math.min(255,
        Math.round((this.height[i] + this.maxHeight) * scale * 255)));
      out[i * 4] = encoded;
      out[i * 4 + 1] = encoded;
      out[i * 4 + 2] = encoded;
      out[i * 4 + 3] = this.mask[i] ? 255 : 0;
    }
    return out;
  }

  reset() {
    this.height.fill(0);
    this.velocity.fill(0);
    this.nextHeight.fill(0);
    this._accumulator = 0;
  }
}
