import * as THREE from 'three/webgpu';

const lin = (r, g, b) => {
  const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};
const style = (rgb, rough, metal, paint = 0) => ({ c: lin(...rgb), s: [paint, rough, metal] });

export const STYLE = {
  paint: { c: [1, 1, 1], s: [1, 0.3, 0.25] },
  paintMatt: { c: [1, 1, 1], s: [1, 0.55, 0.1] },
  glass: style([26, 34, 44], 0.07, 0.4),
  tyre: style([24, 24, 26], 0.92, 0),
  trim: style([30, 30, 32], 0.6, 0.05),
  under: style([6, 6, 6], 1, 0),
  rim: style([150, 152, 156], 0.35, 0.8),
  head: style([200, 205, 212], 0.15, 0.2),
  tail: style([140, 16, 16], 0.3, 0.1),
  plate: style([222, 222, 216], 0.5, 0),
  bed: style([44, 44, 48], 0.9, 0),
  steel: style([92, 96, 100], 0.6, 0.55),
  steelDark: style([48, 46, 44], 0.7, 0.5),
  rubber: style([38, 35, 31], 0.95, 0.1),
  earth: style([96, 74, 52], 1, 0),
  sand: style([150, 128, 92], 1, 0),
};
const _n = new THREE.Matrix3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.surf = [];
    this.cur = new THREE.Matrix4();
  }

  within(m, fn) {
    const prev = this.cur;
    this.cur = prev.clone().multiply(m);
    fn();
    this.cur = prev;
    return this;
  }

  vertex(p, n, st) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(...st.c);
    this.surf.push(...st.s);
  }

  tri(a, b, c, st, hint, na, nb, nc) {
    _b.copy(b).sub(a);
    _c.copy(c).sub(a);
    const fn = _b.cross(_c).normalize();
    if (!Number.isFinite(fn.x)) return;
    const flip = hint && fn.dot(hint) < 0;
    if (flip) {
      this.vertex(a, na ?? fn.clone().negate(), st);
      this.vertex(c, nc ?? fn.clone().negate(), st);
      this.vertex(b, nb ?? fn.clone().negate(), st);
    } else {
      this.vertex(a, na ?? fn, st);
      this.vertex(b, nb ?? fn, st);
      this.vertex(c, nc ?? fn, st);
    }
  }

  add(geometry, m, st) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    m = this.cur.clone().multiply(m);
    _n.getNormalMatrix(m);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      _a.fromBufferAttribute(p, i).applyMatrix4(m);
      _b.fromBufferAttribute(n, i).applyMatrix3(_n).normalize();
      this.vertex(_a, _b, st);
    }
    return this;
  }

  box(c, s, st, rot = [0, 0, 0]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...c),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YZX')),
      new THREE.Vector3(...s),
    );
    return this.add(UNIT_BOX, m, st);
  }

  span(x0, x1, y0, y1, z0, z1, st) {
    return this.box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [x1 - x0, y1 - y0, z1 - z0], st);
  }

  cylZ(c, r, len, sides, st) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...c),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
      new THREE.Vector3(r, len, r),
    );
    return this.add(cylinderGeometry(sides), m, st);
  }

  wheel(c, r, w, s, sides) {
    this.add(openCylinder(sides), new THREE.Matrix4().compose(new THREE.Vector3(...c), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(r, w, r)), STYLE.tyre);
    const face = (rr, dz, st, n) => this.add(circleGeometry(n), new THREE.Matrix4().compose(
      new THREE.Vector3(c[0], c[1], c[2] + s * dz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s > 0 ? 0 : Math.PI, 0)),
      new THREE.Vector3(rr, rr, 1)), st);
    face(r * 0.97, w / 2, STYLE.tyre, sides);
    face(r * 0.62, w / 2 + 0.004, STYLE.rim, 8);
    return this;
  }

  bar(a, b, t, w, st) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(d.length(), t, w));
    return this.add(UNIT_BOX, m, st);
  }

  extrude(poly, z0, z1, st, m = new THREE.Matrix4()) {
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, z0);
    this.add(g, m, st);
    g.dispose();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const OPEN = new Map();
const openCylinder = (n) => {
  if (!OPEN.has(n)) OPEN.set(n, new THREE.CylinderGeometry(1, 1, 1, n, 1, true));
  return OPEN.get(n);
};
const DISC = new Map();
const circleGeometry = (n) => {
  if (!DISC.has(n)) DISC.set(n, new THREE.CircleGeometry(1, n));
  return DISC.get(n);
};
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new Map();
function cylinderGeometry(sides) {
  if (!CYL.has(sides)) CYL.set(sides, new THREE.CylinderGeometry(1, 1, 1, sides, 1, false));
  return CYL.get(sides);
}
