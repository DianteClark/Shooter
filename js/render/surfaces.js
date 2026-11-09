// O(1) lookup of what occupies a point on the map: which impact a bullet makes, where debris bounces,
// and where a limb splashes. A one-metre grid of wall indices, built once per match.

// Cosmetic material of each wall kind. Anything unlisted reads as concrete.
const MATERIAL = {
  container: 'metal', hull: 'metal', crane: 'metal',
  crate: 'wood', stall: 'wood',
  wall: 'concrete', building: 'concrete', barrier: 'concrete', border: 'concrete', shop: 'neon',
  rock: 'rock', boulder: 'rock', adobe: 'adobe', sandbag: 'sand', tent: 'cloth',
};

const PER_CELL = 4;

export class Surfaces {
  constructor(map) {
    this.W = Math.ceil(map.width);
    this.H = Math.ceil(map.height);
    this.walls = map.walls;
    this.cells = new Int16Array(this.W * this.H * PER_CELL).fill(-1);
    map.walls.forEach((w, idx) => {
      const x0 = Math.max(0, Math.floor(w.x)), x1 = Math.min(this.W - 1, Math.floor(w.x + w.w));
      const z0 = Math.max(0, Math.floor(w.z)), z1 = Math.min(this.H - 1, Math.floor(w.z + w.d));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const base = (z * this.W + x) * PER_CELL;
        for (let k = 0; k < PER_CELL; k++) if (this.cells[base + k] < 0) { this.cells[base + k] = idx; break; }
      }
    });
  }

  // Innermost wall covering (x,z), or null. Water counts only when nothing stands in it.
  wallAt(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return null;
    const base = (cz * this.W + cx) * PER_CELL;
    let water = null;
    for (let k = 0; k < PER_CELL; k++) {
      const i = this.cells[base + k];
      if (i < 0) break;
      const w = this.walls[i];
      if (x < w.x || x > w.x + w.w || z < w.z || z > w.z + w.d) continue;
      if (w.kind === 'water') water = w; else return w;
    }
    return water;
  }

  // The material struck at a wall surface; the probe steps a little inside along the inverse normal.
  materialAt(x, z, nx, nz) {
    const w = this.wallAt(x - nx * 0.08, z - nz * 0.08) || this.wallAt(x, z);
    return w ? (MATERIAL[w.kind] || 'concrete') : 'concrete';
  }

  // True when a point at height y is inside something solid.
  solid(x, y, z) {
    const w = this.wallAt(x, z);
    return !!w && w.kind !== 'water' && y < (w.h ?? 3);
  }

  isWater(x, z) {
    const w = this.wallAt(x, z);
    return !!w && w.kind === 'water';
  }

  groundAt(x, z) { return this.isWater(x, z) ? -0.75 : 0; }
}
