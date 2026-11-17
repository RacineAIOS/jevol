import * as THREE from 'three/webgpu';

export class DecalBuilder {
  constructor() {
    this.pos = [];
    this.pw = [];
    this.idx = [];
    this.triangles = 0;
  }

  tri(a, b, c, wear) {
    const y = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const base = this.pos.length / 3;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.pw.push(wear);
    }
    if (y >= 0) this.idx.push(base, base + 1, base + 2);
    else this.idx.push(base, base + 2, base + 1);
    this.triangles++;
  }

  quad(a, b, c, d, wear) {
    this.tri(a, b, c, wear);
    this.tri(a, c, d, wear);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('pw', new THREE.Float32BufferAttribute(this.pw, 1));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function frame(p, across, dir, ground) {
  const sx = -p.tz;
  const sz = p.tx;
  const ox = p.x + sx * across;
  const oz = p.z + sz * across;
  return (a, b) => {
    const x = ox + dir * p.tx * a + dir * sx * b;
    const z = oz + dir * p.tz * a + dir * sz * b;
    return [x, ground(x, z), z];
  };
}

function curvedArrow(db, p, dir, ground, wear, { across, L, bend, hw, head, tip, a0 = -L / 2 }) {
  const at = frame(p, across, dir, ground);
  const c = (t) => [a0 + L * t, bend * t * t];
  const nrm = (t) => {
    const db_ = 2 * bend * t;
    const l = Math.hypot(L, db_);
    return [-db_ / l, L / l];
  };
  const N = bend ? 8 : 1;
  for (let i = 0; i < N; i++) {
    const [a0_, b0] = c(i / N);
    const [a1, b1] = c((i + 1) / N);
    const n0 = nrm(i / N);
    const n1 = nrm((i + 1) / N);
    db.quad(
      at(a0_ + n0[0] * hw, b0 + n0[1] * hw), at(a1 + n1[0] * hw, b1 + n1[1] * hw),
      at(a1 - n1[0] * hw, b1 - n1[1] * hw), at(a0_ - n0[0] * hw, b0 - n0[1] * hw), wear,
    );
  }
  const [ea, eb] = c(1);
  const tan = [L, 2 * bend];
  const tl = Math.hypot(tan[0], tan[1]);
  const n = nrm(1);
  db.tri(
    at(ea + n[0] * head, eb + n[1] * head), at(ea - n[0] * head, eb - n[1] * head),
    at(ea + (tan[0] / tl) * tip, eb + (tan[1] / tl) * tip), wear,
  );
}

export function arrow(db, p, dir, ground, wear) {
  curvedArrow(db, p, dir, ground, wear, { across: dir > 0 ? -0.2 : 0.2, L: 2.7, bend: 0.7, hw: 0.07, head: 0.24, tip: 0.75, a0: -1.8 });
}

export function laneArrow(db, p, dir, across, ground, wear) {
  curvedArrow(db, p, dir, ground, wear, { across, L: 3.0, bend: 0, hw: 0.1, head: 0.5, tip: 1.2, a0: -2.2 });
}

export function stopLine(db, p, dir, b0, b1, ground, wear, across = 0) {
  const at = frame(p, across, dir, ground);
  db.quad(at(-0.25, b0), at(0.25, b0), at(0.25, b1), at(-0.25, b1), wear);
}

export function giveWay(db, p, dir, b0, b1, ground, wear, across = 0) {
  const at = frame(p, across, dir, ground);
  const n = Math.max(1, Math.floor((b1 - b0 + 0.5) / 1.0));
  const start = b0 + (b1 - b0 - (n * 1.0 - 0.5)) / 2;
  for (let i = 0; i < n; i++) {
    const b = start + i;
    db.quad(at(-0.25, b), at(0.25, b), at(0.25, b + 0.5), at(-0.25, b + 0.5), wear);
  }
}

export function zebra(db, p, roadWidth, ground, wear, length = 4) {
  const at = frame(p, 0, 1, ground);
  const n = Math.max(3, Math.round(roadWidth / 1.1) - 1);
  const span = n * 0.5 + (n - 1) * 0.6;
  for (let i = 0; i < n; i++) {
    const b = -span / 2 + i * 1.1;
    db.quad(at(-length / 2, b), at(length / 2, b), at(length / 2, b + 0.5), at(-length / 2, b + 0.5), wear);
  }
}

function clip(poly, ns, na, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i];
    const B = poly[(i + 1) % poly.length];
    const da = A[0] * ns + A[1] * na - c;
    const db_ = B[0] * ns + B[1] * na - c;
    if (da >= 0) out.push(A);
    if (da * db_ < 0) {
      const t = da / (da - db_);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out;
}

export function hatchZone(db, at, { s0, s1, a0, a1, slant = 1 }, wear) {
  const h = a1 - a0;
  const along = 0.5 * Math.sqrt(5);
  const pitch = 1.35 * Math.sqrt(5);
  for (let s = s0 - 2 * h - along; s < s1; s += pitch) {
    const k = 2 * h * slant;
    let poly = [[s, a0], [s + along, a0], [s + along + k, a1], [s + k, a1]];
    poly = clip(poly, 1, 0, s0);
    if (poly.length) poly = clip(poly, -1, 0, -s1);
    if (poly.length < 3) continue;
    for (let i = 1; i < poly.length - 1; i++) db.tri(at(...poly[0]), at(...poly[i]), at(...poly[i + 1]), wear);
  }
}

export function longLine(db, at, s0, s1, a, w, wear) {
  db.quad(at(s0, a - w / 2), at(s1, a - w / 2), at(s1, a + w / 2), at(s0, a + w / 2), wear);
}
