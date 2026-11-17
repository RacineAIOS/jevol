import * as THREE from 'three/webgpu';

export const DEG = Math.PI / 180;

export class Buf {
  constructor(attrs = ['info']) {
    this.attrs = attrs;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.extra = attrs.map(() => []);
  }

  get count() {
    return this.pos.length / 9;
  }

  tri(a, b, c, uvs, color, vals, n = null) {
    let nx, ny, nz;
    if (n) [nx, ny, nz] = n;
    else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(t[0], t[1]);
      this.col.push(color[0], color[1], color[2]);
    }
    for (let k = 0; k < this.attrs.length; k++) {
      const v = vals[k] ?? [0, 0, 0, 0];
      for (let i = 0; i < 3; i++) this.extra[k].push(v[0], v[1], v[2], v[3]);
    }
  }

  quad(a, b, c, d, uvs, color, vals, n = null) {
    this.tri(a, b, c, [uvs[0], uvs[1], uvs[2]], color, vals, n);
    this.tri(a, c, d, [uvs[0], uvs[2], uvs[3]], color, vals, n);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    this.attrs.forEach((name, k) => g.setAttribute(name, new THREE.Float32BufferAttribute(this.extra[k], 4)));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export class Frame {
  constructor(ox, oy, tx, ty, z0) {
    this.ox = ox; this.oy = oy; this.tx = tx; this.ty = ty; this.z0 = z0;
    this.nx = ty; this.ny = -tx;
  }

  static from(a, b, z0) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return new Frame(a[0], a[1], (b[0] - a[0]) / l, (b[1] - a[1]) / l, z0);
  }

  p(u, h, w = 0) {
    const x = this.ox + this.tx * u + this.nx * w;
    const y = this.oy + this.ty * u + this.ny * w;
    return [x, this.z0 + h, -y];
  }

  plan(u, w = 0) {
    return [this.ox + this.tx * u + this.nx * w, this.oy + this.ty * u + this.ny * w];
  }

  get out() { return [this.nx, 0, -this.ny]; }
  get along() { return [this.tx, 0, -this.ty]; }
}

export function box(buf, f, u0, u1, h0, h1, w0, w1, color, vals, faces = 'fsntlr') {
  const P = (u, h, w) => f.p(u, h, w);
  const out = f.out;
  const inn = [-out[0], 0, -out[2]];
  const al = f.along;
  const back = [-al[0], 0, -al[2]];
  if (faces.includes('f')) buf.quad(P(u0, h0, w1), P(u1, h0, w1), P(u1, h1, w1), P(u0, h1, w1), [[u0, h0], [u1, h0], [u1, h1], [u0, h1]], color, vals, out);
  if (faces.includes('s')) buf.quad(P(u1, h0, w0), P(u0, h0, w0), P(u0, h1, w0), P(u1, h1, w0), [[u1, h0], [u0, h0], [u0, h1], [u1, h1]], color, vals, inn);
  if (faces.includes('t')) buf.quad(P(u0, h1, w1), P(u1, h1, w1), P(u1, h1, w0), P(u0, h1, w0), [[u0, w1], [u1, w1], [u1, w0], [u0, w0]], color, vals, [0, 1, 0]);
  if (faces.includes('b')) buf.quad(P(u0, h0, w0), P(u1, h0, w0), P(u1, h0, w1), P(u0, h0, w1), [[u0, w0], [u1, w0], [u1, w1], [u0, w1]], color, vals, [0, -1, 0]);
  if (faces.includes('r')) buf.quad(P(u1, h0, w1), P(u1, h0, w0), P(u1, h1, w0), P(u1, h1, w1), [[w1, h0], [w0, h0], [w0, h1], [w1, h1]], color, vals, al);
  if (faces.includes('l')) buf.quad(P(u0, h0, w0), P(u0, h0, w1), P(u0, h1, w1), P(u0, h1, w0), [[w0, h0], [w1, h0], [w1, h1], [w0, h1]], color, vals, back);
}

export function planBox(buf, x, y, a, l, w, z0, z1, color, vals, faces = 'fsntlr') {
  const tx = Math.cos(a), ty = Math.sin(a);
  const f = new Frame(x - tx * l / 2 - ty * w / 2, y - ty * l / 2 + tx * w / 2, tx, ty, z0);
  box(buf, f, 0, l, 0, z1 - z0, 0, w, color, vals, faces);
}

export function post(buf, x, y, r, z0, z1, color, vals, n = 8, top = true) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [x + r * Math.cos(a0), y + r * Math.sin(a0)];
    const p1 = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
    const am = (a0 + a1) / 2;
    buf.quad([p0[0], z0, -p0[1]], [p1[0], z0, -p1[1]], [p1[0], z1, -p1[1]], [p0[0], z1, -p0[1]],
      [[i / n, 0], [(i + 1) / n, 0], [(i + 1) / n, z1 - z0], [i / n, z1 - z0]], color, vals, [Math.cos(am), 0, -Math.sin(am)]);
    if (top) buf.tri([x, z1, -y], [p0[0], z1, -p0[1]], [p1[0], z1, -p1[1]], [[0, 0], [r, 0], [0, r]], color, vals, [0, 1, 0]);
  }
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const left = (d) => [-d[1], d[0]];

export function offsetLine(line, off) {
  const dirs = line.slice(1).map(([x, y], i) => { const [px, py] = line[i]; const l = Math.hypot(x - px, y - py) || 1; return [(x - px) / l, (y - py) / l]; });
  return line.map(([x, y], i) => {
    if (i === 0 || i === line.length - 1) { const [dx, dy] = dirs[Math.min(i, dirs.length - 1)]; return [x - dy * off, y + dx * off]; }
    const [ax, ay] = dirs[i - 1];
    const [bx, by] = dirs[i];
    const k = off / (1 + ax * bx + ay * by);
    return [x + (-ay - by) * k, y + (ax + bx) * k];
  });
}

export function arcLengths(line) {
  const s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  return s;
}

export function pointAt(line, s, acc = arcLengths(line)) {
  const n = line.length;
  let i = 0;
  while (i < n - 2 && acc[i + 1] < s) i++;
  const l = acc[i + 1] - acc[i] || 1;
  const t = (s - acc[i]) / l;
  const d = unit(sub(line[i + 1], line[i]));
  return { p: [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t], d, i };
}

export function slice(line, s0, s1, acc = arcLengths(line)) {
  const out = [pointAt(line, s0, acc).p];
  for (let i = 1; i < line.length - 1; i++) if (acc[i] > s0 + 1e-6 && acc[i] < s1 - 1e-6) out.push(line[i]);
  out.push(pointAt(line, s1, acc).p);
  return out;
}

export function segDist(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return len(sub(p, add(a, mul(d, t))));
}

function segmentsCross(a, b, c, d) {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segSegDist(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

export function isSimple(poly) {
  const n = poly.length;
  if (polygonArea(poly) <= 0.5) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function polygonsOverlap(a, b, gap = 0) {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i], a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) if (segSegDist(a0, a1, b[j], b[(j + 1) % b.length]) < gap) return true;
  }
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

export function polygonLineDist(poly, line) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    for (let j = 0; j + 1 < line.length; j++) d = Math.min(d, segSegDist(a, b, line[j], line[j + 1]));
  }
  for (const p of line) if (pointInPolygon(p, poly)) return 0;
  return d;
}

export function insetPolygon(poly, off) {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    const d0 = unit(sub(p, a));
    const d1 = unit(sub(b, p));
    const k = off / Math.max(0.2, 1 + dot(d0, d1));
    const nx = -d0[1] - d1[1];
    const ny = d0[0] + d1[0];
    return [p[0] + nx * k, p[1] + ny * k];
  });
}

export function triangulate(poly) {
  return THREE.ShapeUtils.triangulateShape(poly.map(([x, y]) => new THREE.Vector2(x, y)), []);
}

const _c = new THREE.Color();
export const lin = (rgb) => { _c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace); return [_c.r, _c.g, _c.b]; };
export const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
