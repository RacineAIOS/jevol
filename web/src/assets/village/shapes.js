import * as THREE from 'three/webgpu';

export class Bucket {
  constructor(extras) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.extras = extras;
    this.data = Object.fromEntries(Object.keys(extras).map((k) => [k, []]));
  }
  tri(a, b, c, n, uvs, color, attrs) {
    const ps = [a, b, c];
    for (let i = 0; i < 3; i++) {
      this.pos.push(ps[i].x, ps[i].y, ps[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(color.r, color.g, color.b);
      for (const k in this.data) this.data[k].push(...attrs[k]);
    }
  }
  face(a, b, c, uvs, color, attrs, want) {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-10) return;
    n.normalize();
    if (want && n.dot(want) < 0) this.tri(a, c, b, n.negate(), [uvs[0], uvs[2], uvs[1]], color, attrs);
    else this.tri(a, b, c, n, uvs, color, attrs);
  }
  quad(a, b, c, d, uvs, color, attrs, want) {
    this.face(a, b, c, [uvs[0], uvs[1], uvs[2]], color, attrs, want);
    this.face(a, c, d, [uvs[0], uvs[2], uvs[3]], color, attrs, want);
  }
  get empty() {
    return this.pos.length === 0;
  }
  get triangles() {
    return this.pos.length / 9;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [k, size] of Object.entries(this.extras)) g.setAttribute(k, new THREE.Float32BufferAttribute(this.data[k], size));
    g.computeBoundingSphere();
    return g;
  }
}

export function box(bucket, c, ax, ay, az, color, attrs, { bottom = false, vOffset = 0 } = {}) {
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
      if (!bottom && want.y < -0.9) continue;
      const fc = c.clone().addScaledVector(n, s);
      const P = (i, j) => fc.clone().addScaledVector(p, i).addScaledVector(q, j);
      const v0 = vertical ? vOffset - lq : -lq;
      const v1 = vertical ? vOffset + lq : lq;
      bucket.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [[-lp, v0], [lp, v0], [lp, v1], [-lp, v1]], color, attrs, want);
    }
  }
}
