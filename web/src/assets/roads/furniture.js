import * as THREE from 'three/webgpu';

const BOX_FACES = [
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];

export class FurnitureBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.pbr = [];
    this.idx = [];
    this.triangles = 0;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(x, y, z, nx, ny, nz, color, rough, metal) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(color[0], color[1], color[2]);
    this.pbr.push(rough, metal);
  }

  quad(p, color, rough = 0.6, metal = 0) {
    const ux = p[1][0] - p[0][0];
    const uy = p[1][1] - p[0][1];
    const uz = p[1][2] - p[0][2];
    const vx = p[3][0] - p[0][0];
    const vy = p[3][1] - p[0][1];
    const vz = p[3][2] - p[0][2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const b = this.vertexCount;
    for (const q of p) this.vertex(q[0], q[1], q[2], nx, ny, nz, color, rough, metal);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.triangles += 2;
  }

  box(cx, y0, cz, sx, sy, sz, yaw, color, rough = 0.6, metal = 0) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [n, corners] of BOX_FACES) {
      const b = this.vertexCount;
      for (const [a, h, d] of corners) {
        const lx = (a - 0.5) * sx;
        const lz = (d - 0.5) * sz;
        this.vertex(cx + lx * c + lz * s, y0 + h * sy, cz - lx * s + lz * c, n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c, color, rough, metal);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.triangles += 2;
    }
  }

  cyl(cx, y0, cz, r, h, sides, color, rough = 0.5, metal = 0, rTop = r, cap = true) {
    const b = this.vertexCount;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.vertex(cx + ca * r, y0, cz + sa * r, ca, 0, sa, color, rough, metal);
      this.vertex(cx + ca * rTop, y0 + h, cz + sa * rTop, ca, 0, sa, color, rough, metal);
    }
    for (let i = 0; i < sides; i++) {
      const a = b + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.triangles += sides * 2;
    if (!cap) return;
    const t = this.vertexCount;
    this.vertex(cx, y0 + h, cz, 0, 1, 0, color, rough, metal);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      this.vertex(cx + Math.cos(a) * rTop, y0 + h, cz + Math.sin(a) * rTop, 0, 1, 0, color, rough, metal);
    }
    for (let i = 0; i < sides; i++) this.idx.push(t, t + 1 + ((i + 1) % sides), t + 1 + i);
    this.triangles += sides;
  }

  sweep(path, profile, color, rough = 0.5, metal = 0.8) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      for (let j = 0; j < profile.length - 1; j++) {
        const [l0, h0] = profile[j];
        const [l1, h1] = profile[j + 1];
        this.quad([
          [a.x + a.nx * l0, a.y + h0, a.z + a.nz * l0],
          [b.x + b.nx * l0, b.y + h0, b.z + b.nz * l0],
          [b.x + b.nx * l1, b.y + h1, b.z + b.nz * l1],
          [a.x + a.nx * l1, a.y + h1, a.z + a.nz * l1],
        ], color, rough, metal);
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('pbr', new THREE.Float32BufferAttribute(this.pbr, 2));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const lin = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).toArray();
export const COLORS = {
  zinc: lin(150, 154, 156),
  zincDark: lin(118, 122, 125),
  concrete: lin(122, 120, 114),
  white: lin(222, 222, 218),
  band: lin(238, 238, 234),
  red: lin(160, 24, 26),
  yellow: lin(214, 170, 30),
  blue: lin(20, 70, 150),
  grey: lin(110, 112, 114),
  vertex: lin(40, 100, 50),
};

const RAIL_PROFILE = [[0, 0.45], [0, 0.48], [0.04, 0.52], [0.04, 0.56], [0, 0.6], [0, 0.63], [0.04, 0.67], [0.04, 0.71], [0, 0.75]];

export function guardrail(fb, path, doubleSided = false) {
  const lifted = path.map((p) => ({ ...p }));
  fb.sweep(lifted, RAIL_PROFILE, COLORS.zinc, 0.5, 0.6);
  if (doubleSided) {
    const flipped = path.map((p) => ({ ...p, nx: -p.nx, nz: -p.nz }));
    fb.sweep(flipped, RAIL_PROFILE, COLORS.zinc, 0.5, 0.6);
  }
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i > 0) acc += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z);
    if (i === 0 || acc >= 4 - 1e-3) {
      acc = 0;
      const yaw = Math.atan2(p.nx, p.nz);
      fb.box(p.x - p.nx * 0.07, p.y, p.z - p.nz * 0.07, 0.12, 0.95, 0.09, yaw, COLORS.zincDark, 0.6, 0.6);
    }
  }
}

const BARRIER_PROFILE = [[-0.31, 0], [-0.31, 0.08], [-0.2, 0.34], [-0.1, 0.81], [0.1, 0.81], [0.2, 0.34], [0.31, 0.08], [0.31, 0]];

export function concreteBarrier(fb, path) {
  fb.sweep(path, BARRIER_PROFILE, COLORS.concrete, 0.9, 0);
}

export function marker(fb, x, y, z, red = false) {
  fb.cyl(x, y, z, 0.1, 0.8, 8, COLORS.white, 0.6, 0, 0.1, false);
  fb.cyl(x, y + 0.8, z, 0.1, 0.2, 8, red ? COLORS.red : COLORS.band, 0.35, 0, 0.1, false);
  fb.cyl(x, y + 1.0, z, 0.1, 0.3, 8, COLORS.white, 0.6, 0);
}

export function chevrons(fb, x, y, z, faceX, faceZ, height) {
  const w = height * 1.5;
  const rx = faceZ;
  const rz = -faceX;
  const y0 = y + 1.0;
  const P = (lx, ly, off = 0) => [x + rx * lx + faceX * off, y0 + ly, z + rz * lx + faceZ * off];
  fb.cyl(x - faceX * 0.04, y, z - faceZ * 0.04, 0.03, 1.0 + height, 8, COLORS.zinc, 0.5, 0.8);
  fb.quad([P(-w / 2, 0), P(w / 2, 0), P(w / 2, height), P(-w / 2, height)], COLORS.blue, 0.4, 0);
  const n = 3;
  const cw = w / (n + 0.4);
  const t = cw * 0.28;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + cw * (i + 0.7);
    const a = height * 0.36;
    const o = 0.004;
    fb.quad([P(cx - cw / 2, height / 2 - a, o), P(cx - cw / 2 + t, height / 2 - a, o), P(cx + cw / 2, height / 2, o), P(cx + cw / 2 - t, height / 2, o)], COLORS.white, 0.35, 0);
    fb.quad([P(cx + cw / 2 - t, height / 2, o), P(cx + cw / 2, height / 2, o), P(cx - cw / 2 + t, height / 2 + a, o), P(cx - cw / 2, height / 2 + a, o)], COLORS.white, 0.35, 0);
  }
}

export function borne(fb, x, y, z, yaw, cap) {
  fb.box(x, y, z, 0.24, 0.62, 0.17, yaw, COLORS.white, 0.9, 0);
  fb.cyl(x, y + 0.62, z, 0.085, 0.2, 10, cap, 0.8, 0);
}
