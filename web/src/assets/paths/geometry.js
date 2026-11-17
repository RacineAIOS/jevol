import * as THREE from 'three/webgpu';
import { valueNoise } from '../../engine/rng.js';
import { rutDig } from '../../engine/groundSurface.js';

export const LIFT = 0.07;
export const STEP = 1.5;
const VERGE_SCALE = 0.5;
export const ACROSS = 15;

export function smoothAxis(line, step = STEP) {
  const plan = line.map(([x, y]) => new THREE.Vector3(x, 0, -y));
  let len = 0;
  for (let i = 1; i < plan.length; i++) len += plan[i].distanceTo(plan[i - 1]);
  const n = Math.max(2, Math.ceil(len / step));
  if (plan.length < 3) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = plan[0].clone().lerp(plan[plan.length - 1], i / n);
      return [p.x, p.z];
    });
  }
  const curve = new THREE.CatmullRomCurve3(plan, false, 'centripetal');
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z]);
}

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distToAxis(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return best;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildRibbons(items, roads, heightAt) {
  const axes = items.map((it) => smoothAxis(it.line));
  const hw = items.map((it) => it.width / 2);
  const dominates = (j, i) => hw[j] > hw[i] || (hw[j] === hw[i] && j > i);
  const touches = (i, [x, z]) => {
    for (let j = 0; j < items.length; j++) {
      if (j !== i && distToAxis(x, z, axes[j]) <= hw[j] + 1.2) return true;
    }
    return roads.some((r) => distToAxis(x, z, r.axis) <= r.width / 2 + 1.2);
  };
  const ends = axes.map((axis, i) => ({ start: !touches(i, axis[0]), end: !touches(i, axis[axis.length - 1]) }));
  axes.forEach((axis, i) => {
    const reach = Math.min(hw[i] * 0.8, 1.0);
    const grow = (a, b, atStart) => {
      const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const pts = [];
      for (let d = STEP; d < reach + STEP; d += STEP) pts.push([a[0] + ((a[0] - b[0]) / l) * Math.min(d, reach), a[1] + ((a[1] - b[1]) / l) * Math.min(d, reach)]);
      if (atStart) axis.unshift(...pts.reverse()); else axis.push(...pts);
    };
    const n = axis.length;
    if (!ends[i].end) grow(axis[n - 1], axis[n - 2], false);
    if (!ends[i].start) grow(axis[0], axis[1], true);
  });
  const out = [];
  items.forEach((it, i) => {
    const axis = axes[i];
    const n = axis.length;
    const dJ = new Float32Array(n).fill(1e3);
    for (let k = 0; k < n; k++) {
      const [x, z] = axis[k];
      for (let j = 0; j < items.length; j++) {
        if (j === i || !dominates(j, i)) continue;
        dJ[k] = Math.min(dJ[k], Math.max(0, distToAxis(x, z, axes[j]) - hw[j]));
      }
      for (const r of roads) dJ[k] = Math.min(dJ[k], Math.max(0, distToAxis(x, z, r.axis) - r.width / 2));
    }
    const freeStart = ends[i].start;
    const freeEnd = ends[i].end;
    const along = new Float32Array(n);
    for (let k = 1; k < n; k++) along[k] = along[k - 1] + Math.hypot(axis[k][0] - axis[k - 1][0], axis[k][1] - axis[k - 1][1]);
    const total = along[n - 1];

    const margin = 1.0 + 0.2 * it.width;
    const pos = [];
    const geo = [];
    const dJs = [];
    const hwEffs = [];
    const dFrees = [];
    const digs = [];
    for (let k = 0; k < n; k++) {
      const [x, z] = axis[k];
      const [px, pz] = axis[Math.max(0, k - 1)];
      const [nx, nz] = axis[Math.min(n - 1, k + 1)];
      let tx = nx - px;
      let tz = nz - pz;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const sx = -tz;
      const sz = tx;
      const dFree = Math.min(freeStart ? along[k] : 1e3, freeEnd ? total - along[k] : 1e3);
      const flare = 1 + 0.5 * (1 - smooth(0, 4.5, dJ[k]));
      const hwEff = hw[i] * flare;
      const extent = hwEff + margin;
      hwEffs.push(hwEff);
      dJs.push(dJ[k]);
      dFrees.push(dFree);
      const r = Math.max(it.k.rutOff, 0.4);
      const inner = [0, r * 0.5, r, r + 0.28];
      const half = [...inner];
      for (let q = 1; q <= 4; q++) half.push(inner[3] + ((extent - inner[3]) * q) / 4);
      const offsets = [...half.slice(1).reverse().map((v) => -v), 0, ...half.slice(1)];
      for (let c = 0; c < ACROSS; c++) {
        const a = offsets[c];
        const vx = x + sx * a;
        const vz = z + sz * a;
        pos.push(vx, heightAt(vx, vz) + LIFT, vz);
        geo.push(a, along[k], hwEff, it.seed);
        digs.push(rutDig(a, along[k], { rutOff: it.k.rutOff, rutDepth: it.k.rutDepth, hw: hwEff, dJ: dJ[k], seed: it.seed }));
      }
    }
    const idx = [];
    for (let k = 0; k < n - 1; k++) {
      for (let c = 0; c < ACROSS - 1; c++) {
        const a = k * ACROSS + c;
        const b = a + ACROSS;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    out.push({ item: it, axis, along, total, pos, geo, idx, dig: digs, dJ: dJs, dFree: dFrees, hwEff: hwEffs, margin });
  });
  return out;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]]
  .map(([a, b, c]) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l]; });
const ICO_FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

export class ScatterBuffers {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.root = [];
    this.tufts = 0;
    this.stones = 0;
  }

  tuft(x, y, z, h, rgb, rng, fadeFar, blades = 7, thin = 1) {
    const lin = rgb;
    for (let b = 0; b < blades; b++) {
      const a = rng() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const w = (0.006 + 0.009 * rng()) * thin * (0.6 + h);
      const bh = h * (0.55 + 0.6 * rng());
      const lean = bh * (0.12 + 0.4 * rng());
      const la = rng() * Math.PI * 2;
      const ox = (rng() - 0.5) * 0.08;
      const oz = (rng() - 0.5) * 0.08;
      const bx = x + ox;
      const bz = z + oz;
      const tone = 0.85 + 0.3 * rng();
      const verts = [
        [bx - ca * w, y - 0.02, bz - sa * w, 0.55],
        [bx + ca * w, y - 0.02, bz + sa * w, 0.55],
        [bx + Math.cos(la) * lean, y + bh, bz + Math.sin(la) * lean, 1.15],
      ];
      for (const [vx, vy, vz, k] of verts) {
        this.pos.push(vx, vy, vz);
        this.nor.push(-sa * 0.3, 1, ca * 0.3);
        this.col.push(lin[0] * k * tone, lin[1] * k * tone, lin[2] * k * tone);
        this.root.push(x, y, z, fadeFar);
      }
    }
    this.tufts++;
  }

  stone(x, y, z, size, rgb, rng, fadeFar) {
    const sx = size * (0.7 + 0.6 * rng());
    const sz = size * (0.7 + 0.6 * rng());
    const sy = size * (0.3 + 0.3 * rng());
    const a = rng() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const P = ICO.map(([px, py, pz]) => {
      const j = 0.78 + 0.4 * rng();
      const lx = px * sx * j;
      const lz = pz * sz * j;
      return [x + lx * ca - lz * sa, y + py * sy * j + sy * 0.25, z + lx * sa + lz * ca];
    });
    for (const f of ICO_FACES) {
      const [A, B, C] = f.map((i) => P[i]);
      const ux = B[0] - A[0]; const uy = B[1] - A[1]; const uz = B[2] - A[2];
      const vx = C[0] - A[0]; const vy = C[1] - A[1]; const vz = C[2] - A[2];
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const dir = (A[0] - x) * nx + (A[1] - y - sy * 0.25) * ny + (A[2] - z) * nz < 0 ? -1 : 1;
      const tone = (0.85 + 0.3 * rng()) * (0.85 + 0.2 * Math.max(0, ny * dir));
      const order = dir < 0 ? [f[0], f[2], f[1]] : f;
      for (const i of order) {
        this.pos.push(...P[i]);
        this.nor.push(nx * dir, ny * dir, nz * dir);
        this.col.push(rgb[0] * tone, rgb[1] * tone, rgb[2] * tone);
        this.root.push(x, y, z, fadeFar);
      }
    }
    this.stones++;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRoot', new THREE.Float32BufferAttribute(this.root, 4));
    g.computeBoundingSphere();
    return g;
  }
}

const lin = (srgb) => new THREE.Color().setRGB(srgb[0] / 255, srgb[1] / 255, srgb[2] / 255, THREE.SRGBColorSpace).toArray();
export const VERGE_GREEN = [88, 108, 48];
export const VERGE_DRY = [168, 146, 92];

export function grassRgb(dryness, rng) {
  const d = Math.min(1, Math.max(0, dryness + (rng() - 0.5) * 0.5));
  const a = lin(VERGE_GREEN);
  const b = lin(VERGE_DRY);
  const v = 0.85 + 0.3 * rng();
  return [0, 1, 2].map((i) => (a[i] + (b[i] - a[i]) * d) * v);
}

export function scatterAlong(buf, ribbon, kind, heightAt, rng, density = 1) {
  const { axis, along, total, hwEff, dJ, item } = ribbon;
  const ds = 0.25 / Math.sqrt(density);
  const at = (s) => {
    let k = 1;
    while (k < along.length - 1 && along[k] < s) k++;
    const t = Math.min(1, Math.max(0, (s - along[k - 1]) / (along[k] - along[k - 1] || 1)));
    const x = axis[k - 1][0] + (axis[k][0] - axis[k - 1][0]) * t;
    const z = axis[k - 1][1] + (axis[k][1] - axis[k - 1][1]) * t;
    let tx = axis[k][0] - axis[k - 1][0];
    let tz = axis[k][1] - axis[k - 1][1];
    const l = Math.hypot(tx, tz) || 1;
    return { x, z, nx: -tz / l, nz: tx / l, hw: hwEff[k] * 0.5 + hwEff[k - 1] * 0.5, j: Math.min(dJ[k], dJ[k - 1]) };
  };
  const stoneRgb = lin(kind.stone).map((v) => v * 0.85);
  const FAR_TUFT = 120;
  const FAR_STONE = 55;
  for (let s = 0; s < total; s += ds) {
    const p = at(s + 0.001);
    const sideBase = (side, a, h, rgb) => {
      const x = p.x + p.nx * a * side;
      const z = p.z + p.nz * a * side;
      buf.tuft(x, heightAt(x, z) + LIFT, z, h, rgb, rng, FAR_TUFT, 5, 0.8);
    };
    for (const side of [-1, 1]) {
      const clump = 0.25 + 1.5 * valueNoise(s * 0.4, side * 7.3, item.seed | 0);
      const lambda = kind.edgeRate * 1.8 * ds * clump * density;
      let n = Math.floor(lambda + rng());
      while (n-- > 0) {
        const u = rng();
        const out = Math.pow(u, 1.5);
        const a = p.hw * 0.9 + out * kind.vergeWidth - 0.2;
        if (a < p.hw && rng() > kind.encroach * 0.5) continue;
        const [h0, h1] = kind.vergeH.map((h) => h * VERGE_SCALE);
        const h = (h0 + (h1 - h0) * (0.2 + 0.8 * out)) * (0.6 + 0.8 * rng());
        sideBase(side, a, h, grassRgb(kind.dryness, rng));
      }
    }
    if (kind.strip > 0 && p.j > 2.5) {
      const n0 = kind.stripRate * ds * 2 * kind.strip * density;
      let n = Math.floor(n0 + rng());
      while (n-- > 0) {
        const a = (rng() * 2 - 1) * kind.strip * 0.95;
        const h = (0.12 + 0.3 * rng()) * (0.5 + 0.6 * (1 - Math.abs(a) / kind.strip));
        sideBase(1, a, h, grassRgb(kind.dryness * 0.8, rng));
      }
    }
    if (kind.stoneRate > 0) {
      const n0 = kind.stoneRate * ds * 2 * p.hw * density;
      let n = Math.floor(n0 + rng());
      while (n-- > 0) {
        const a = (rng() < 0.55 ? 1 - Math.pow(rng(), 2) : rng() * 2 - 1) * p.hw * rng.sign();
        const x = p.x + p.nx * a;
        const z = p.z + p.nz * a;
        const size = kind.stoneSize * (0.6 + 1.9 * Math.pow(rng(), 2.5));
        const c = rng();
        buf.stone(x, heightAt(x, z) + LIFT, z, size, stoneRgb.map((v) => v * (0.55 + 0.35 * c)), rng, FAR_STONE);
      }
    }
  }
}
