import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class Batch {
  constructor() {
    this.parts = [];
  }

  add(geometry, matrix) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push(g);
    return this;
  }

  box(cx, cy, cz, sx, sy, sz, yaw = 0) {
    _q.setFromAxisAngle(UP, yaw);
    _m.compose(_v.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    this.add(UNIT_BOX, _m);
    _s.set(1, 1, 1);
    return this;
  }

  bar(a, b, r0, r1 = r0, sides = 3, capped = false) {
    const dir = _v.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-6) return this;
    const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, !capped);
    _q.setFromUnitVectors(UP, dir.normalize());
    _m.compose(a.clone().add(b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    this.add(g, _m);
    g.dispose();
    return this;
  }

  post(cx, y0, cz, r0, h, r1 = r0, sides = 8) {
    const g = new THREE.CylinderGeometry(r1, r0, h, sides, 1, false);
    _m.makeTranslation(cx, y0 + h / 2, cz);
    this.add(g, _m);
    g.dispose();
    return this;
  }

  tube(points, radius, radial = 12) {
    const n = points.length;
    const pos = [];
    const nor = [];
    const uv = [];
    const rings = [];
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const d = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      dirs.push(d);
      const ref = Math.abs(d.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP;
      const a = new THREE.Vector3().crossVectors(d, ref).normalize();
      const b = new THREE.Vector3().crossVectors(d, a).normalize();
      const ring = [];
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        const nrm = a.clone().multiplyScalar(Math.cos(ang)).add(b.clone().multiplyScalar(Math.sin(ang)));
        ring.push({ p: points[i].clone().add(nrm.clone().multiplyScalar(radius(t))), n: nrm, u: k / radial, v: t });
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < radial; k++) {
        const q = [rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]];
        for (const j of [0, 1, 2, 0, 2, 3]) {
          pos.push(q[j].p.x, q[j].p.y, q[j].p.z);
          nor.push(q[j].n.x, q[j].n.y, q[j].n.z);
          uv.push(q[j].u, q[j].v);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.parts.push(g);
    return this;
  }

  build() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export function mesh(geometry, material, { noShadow = false, name = '' } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  if (noShadow) m.userData.noShadow = true;
  return m;
}

export function countTriangles(object) {
  let t = 0;
  object.traverse((o) => {
    if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return Math.round(t);
}
