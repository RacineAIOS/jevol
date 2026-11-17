import * as THREE from 'three/webgpu';
import { Bucket, box as rawBox } from './shapes.js';

export const hex = (h) => new THREE.Color(h);
export const KIND = { plain: 0, wood: 1, metal: 2, soil: 3, nest: 4, paint: 5, concrete: 6, veg: 7, feather: 8 };
export const solidInfo = (rough, metal, kind, seed = 0) => [rough, metal, kind, seed];

export const newBucket = () => new Bucket({ info: 4 });

export class Frame {
  constructor(x, y, headingDeg) {
    this.x = x;
    this.y = y;
    this.heading = headingDeg;
    const r = (headingDeg * Math.PI) / 180;
    this.along = new THREE.Vector3(-Math.cos(r), 0, -Math.sin(r));
    this.back = new THREE.Vector3(-Math.sin(r), 0, Math.cos(r));
    this.out = this.back.clone().negate();
  }
  P(lx, h, lz = 0) {
    return new THREE.Vector3(this.x + this.along.x * lx + this.back.x * lz, h, -this.y + this.along.z * lx + this.back.z * lz);
  }
  plan(lx, lz = 0) {
    const p = this.P(lx, 0, lz);
    return [p.x, -p.z];
  }
}

export function fbox(bucket, f, lx, h0, lz, sx, sh, sz, color, info, { bottom = false, rot = 0 } = {}) {
  const c = f.P(lx, h0 + sh / 2, lz);
  let ax = f.along.clone().multiplyScalar(sx / 2);
  let az = f.back.clone().multiplyScalar(sz / 2);
  if (rot) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    ax.applyQuaternion(q);
    az.applyQuaternion(q);
  }
  rawBox(bucket, c, ax, new THREE.Vector3(0, sh / 2, 0), az, color, { info }, { bottom, vOffset: h0 + sh / 2 });
}

export function quad(bucket, a, b, c, d, uvs, color, info, want) {
  bucket.quad(a, b, c, d, uvs, color, { info }, want);
}

export function tri(bucket, a, b, c, uvs, color, info, want) {
  bucket.face(a, b, c, uvs, color, { info }, want);
}

function smoothTri(bucket, p, n, uvs, color, info) {
  for (let i = 0; i < 3; i++) {
    bucket.pos.push(p[i].x, p[i].y, p[i].z);
    bucket.nor.push(n[i].x, n[i].y, n[i].z);
    bucket.uv.push(uvs[i][0], uvs[i][1]);
    bucket.col.push(color.r, color.g, color.b);
    bucket.data.info.push(...info);
  }
}

export function cylinder(bucket, p0, p1, r0, r1, segs, color, info, { capTop = true, capBottom = false, squash = 1 } = {}) {
  const axis = p1.clone().sub(p0);
  const len = axis.length();
  const w = axis.clone().normalize();
  const ref = Math.abs(w.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3().crossVectors(w, ref).normalize();
  const b = new THREE.Vector3().crossVectors(w, a).normalize();
  const ring = (k, r, base) => {
    const t = (k / segs) * Math.PI * 2;
    const dir = a.clone().multiplyScalar(Math.cos(t)).add(b.clone().multiplyScalar(Math.sin(t) * squash));
    return { p: base.clone().addScaledVector(dir, r), n: dir.clone().normalize() };
  };
  const slope = (r0 - r1) / Math.max(len, 1e-6);
  for (let k = 0; k < segs; k++) {
    const A = ring(k, r0, p0);
    const B = ring(k + 1, r0, p0);
    const C = ring(k + 1, r1, p1);
    const D = ring(k, r1, p1);
    const u0 = (k / segs) * Math.PI * 2 * Math.max(r0, r1);
    const u1 = ((k + 1) / segs) * Math.PI * 2 * Math.max(r0, r1);
    const fix = (q) => q.n.clone().addScaledVector(w, slope).normalize();
    const nA = fix(A), nB = fix(B), nC = fix(C), nD = fix(D);
    const check = B.p.clone().sub(A.p).cross(C.p.clone().sub(A.p)).dot(A.n);
    if (check >= 0) {
      smoothTri(bucket, [A.p, B.p, C.p], [nA, nB, nC], [[u0, 0], [u1, 0], [u1, len]], color, info);
      smoothTri(bucket, [A.p, C.p, D.p], [nA, nC, nD], [[u0, 0], [u1, len], [u0, len]], color, info);
    } else {
      smoothTri(bucket, [A.p, C.p, B.p], [nA, nC, nB], [[u0, 0], [u1, len], [u1, 0]], color, info);
      smoothTri(bucket, [A.p, D.p, C.p], [nA, nD, nC], [[u0, 0], [u0, len], [u1, len]], color, info);
    }
  }
  const cap = (base, r, dir, flip) => {
    for (let k = 0; k < segs; k++) {
      const A = ring(k, r, base).p;
      const B = ring(k + 1, r, base).p;
      const n = dir.clone().multiplyScalar(flip);
      const ok = B.clone().sub(A).cross(base.clone().sub(A)).dot(n) >= 0;
      const uvs = [[0, 0], [r, 0], [0, r]];
      smoothTri(bucket, ok ? [A, B, base] : [B, A, base], [n, n, n], uvs, color, info);
    }
  };
  if (capTop && r1 > 0) cap(p1, r1, w, 1);
  if (capBottom && r0 > 0) cap(p0, r0, w, -1);
}

export function post(bucket, x, h0, z, r, height, segs, color, info, opts) {
  cylinder(bucket, new THREE.Vector3(x, h0, z), new THREE.Vector3(x, h0 + height, z), r, r, segs, color, info, opts);
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function tint(color, rnd, amount = 0.1) {
  const k = 1 + (rnd() - 0.5) * 2 * amount;
  return color.clone().multiplyScalar(k);
}

export class CellSet {
  constructor(cell = 128) {
    this.cell = cell;
    this.cells = new Map();
  }
  at(x, y) {
    const key = `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
    if (!this.cells.has(key)) this.cells.set(key, { key, buckets: {} });
    const c = this.cells.get(key);
    return (name) => (c.buckets[name] ??= newBucket());
  }
  toGroup(name, materials, noShadow = new Set()) {
    const group = new THREE.Group();
    group.name = name;
    let triangles = 0;
    let meshes = 0;
    for (const c of this.cells.values()) {
      for (const [mat, bucket] of Object.entries(c.buckets)) {
        if (bucket.empty) continue;
        const mesh = new THREE.Mesh(bucket.geometry(), materials[mat]);
        mesh.name = `${name}-${c.key}-${mat}`;
        if (noShadow.has(mat)) mesh.userData.noShadow = true;
        group.add(mesh);
        triangles += bucket.triangles;
        meshes++;
      }
    }
    group.userData.triangles = triangles;
    group.userData.meshes = meshes;
    return group;
  }
}

export function boxSkip(bucket, c, ax, ay, az, color, attrs, { skip = null, vOffset = 0 } = {}) {
  const axes = [ax, ay, az];
  for (let k = 0; k < 3; k++) {
    const n = axes[k];
    let p = axes[(k + 1) % 3];
    let q = axes[(k + 2) % 3];
    if (Math.abs(p.y) > Math.abs(q.y)) [p, q] = [q, p];
    const lp = p.length();
    const lq = q.length();
    const vertical = Math.abs(q.y) > 0.5 * lq;
    for (const s of [1, -1]) {
      const want = n.clone().multiplyScalar(s).normalize();
      if (want.y < -0.9) continue;
      if (skip && want.dot(skip) > 0.9) continue;
      const fc = c.clone().addScaledVector(n, s);
      const P = (i, j) => fc.clone().addScaledVector(p, i).addScaledVector(q, j);
      const v0 = vertical ? vOffset - lq : -lq;
      const v1 = vertical ? vOffset + lq : lq;
      bucket.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [[-lp, v0], [lp, v0], [lp, v1], [-lp, v1]], color, attrs, want);
    }
  }
}
