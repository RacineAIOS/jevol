import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const BOX = new THREE.BoxGeometry(1, 1, 1);

export const STYLE = {
  galv: { color: [0.26, 0.27, 0.27], rough: 0.62, metal: 0.3, mat: 1 },
  rust: { color: [0.17, 0.08, 0.04], rough: 0.88, metal: 0.15, mat: 1 },
  wood: { color: [0.3, 0.2, 0.11], rough: 0.9, metal: 0, mat: 2 },
  woodGrey: { color: [0.3, 0.27, 0.23], rough: 0.92, metal: 0, mat: 2 },
  rubber: { color: [0.022, 0.022, 0.022], rough: 0.95, metal: 0, mat: 0 },
  black: { color: [0.03, 0.03, 0.032], rough: 0.7, metal: 0.2, mat: 0 },
  glass: { color: [0.025, 0.04, 0.05], rough: 0.06, metal: 0.1, mat: 5 },
  water: { color: [0.04, 0.07, 0.06], rough: 0.04, metal: 0, mat: 5 },
  manure: { color: [0.1, 0.07, 0.04], rough: 0.85, metal: 0, mat: 3 },
  concrete: { color: [0.27, 0.27, 0.25], rough: 0.95, metal: 0, mat: 0 },
  lamp: { color: [0.8, 0.78, 0.65], rough: 0.2, metal: 0, mat: 5 },
  amber: { color: [0.75, 0.38, 0.04], rough: 0.3, metal: 0, mat: 5 },
};
export const paint = (color, rough = 0.55) => ({ color, rough, metal: 0.05, mat: 4 });

export class Solids {
  constructor() {
    this.parts = [];
    this.stack = [new THREE.Matrix4()];
    this.groundY = 0;
  }

  push(m) {
    this.stack.push(this.stack.at(-1).clone().multiply(m));
    return this;
  }

  pop() {
    this.stack.pop();
    return this;
  }

  add(geometry, matrix, style) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(matrix ? _m.copy(this.stack.at(-1)).multiply(matrix) : this.stack.at(-1));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const info = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col.set(style.color, i * 3);
      info[i * 4] = style.rough;
      info[i * 4 + 1] = style.metal;
      info[i * 4 + 2] = style.mat;
      info[i * 4 + 3] = this.groundY;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('info', new THREE.BufferAttribute(info, 4));
    this.parts.push(g);
    return this;
  }

  box(cx, cy, cz, sx, sy, sz, style, yaw = 0, roll = 0) {
    _q.setFromEuler(new THREE.Euler(roll, yaw, 0, 'YXZ'));
    const m = new THREE.Matrix4().compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    return this.add(BOX, m, style);
  }

  bar(a, b, r0, r1, sides, style, capped = false) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-6) return this;
    const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, !capped);
    _q.setFromUnitVectors(UP, dir.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
    this.add(g, m, style);
    g.dispose();
    return this;
  }

  geo(g, x, y, z, sx, sy, sz, style, yaw = 0) {
    _q.setFromAxisAngle(UP, yaw);
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    return this.add(g, m, style);
  }

  build() {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function frameAt(x, y, headingDeg, heightAt, hl = 0, hw = 0, u0 = 0) {
  const yaw = Math.PI / 2 - (headingDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const world = (u, w) => [x + u * c + w * s, -y - u * s + w * c];
  const h = (u, w) => {
    const [wx, wz] = world(u, w);
    return heightAt(wx, wz);
  };
  const hc = h(u0, 0);
  let pitch = 0;
  let roll = 0;
  let base = hc;
  if (hl > 0) {
    const f = h(u0 + hl, 0);
    const b = h(u0 - hl, 0);
    pitch = Math.atan2(f - b, 2 * hl);
    base = (f + b + hc) / 3;
  }
  if (hw > 0) {
    const r = h(u0, hw);
    const l = h(u0, -hw);
    roll = -Math.atan2(r - l, 2 * hw);
  }
  base -= u0 * Math.tan(pitch);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, base, -y),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, yaw, pitch, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
  return { matrix: m, yaw, ground: base, world, h };
}
