import * as THREE from 'three/webgpu';
import { attribute, varying, vec2, vec3, vec4, cameraProjectionMatrix, cameraViewMatrix, viewportSize } from 'three/tsl';

export class WireBatch {
  constructor() {
    this.pos = [];
    this.other = [];
    this.side = [];
    this.dia = [];
    this.index = [];
    this.segments = 0;
  }

  segment(a, b, dia) {
    const base = this.segments * 4;
    const ends = [[a, b, 1], [a, b, -1], [b, a, -1], [b, a, 1]];
    for (const [p, o, s] of ends) {
      this.pos.push(p.x, p.y, p.z);
      this.other.push(o.x, o.y, o.z);
      this.side.push(s);
      this.dia.push(dia);
    }
    this.index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    this.segments++;
    return this;
  }

  polyline(points, dia) {
    for (let i = 0; i < points.length - 1; i++) this.segment(points[i], points[i + 1], dia);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    if (!this.segments) return g;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('other', new THREE.Float32BufferAttribute(this.other, 3));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(this.side, 1));
    g.setAttribute('dia', new THREE.Float32BufferAttribute(this.dia, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.boundingSphere.radius += 2;
    return g;
  }
}

export function createWireMaterial({ color = [0.07, 0.072, 0.075], minPx = 1.1, minAlpha = 0.55 } = {}) {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const pos = attribute('position', 'vec3');
  const other = attribute('other', 'vec3');
  const side = attribute('edge', 'float');
  const dia = attribute('dia', 'float');

  const vP = cameraViewMatrix.mul(vec4(pos, 1)).xyz;
  const vO = cameraViewMatrix.mul(vec4(other, 1)).xyz;
  const clip = cameraProjectionMatrix.mul(vec4(vP, 1));
  const w = vP.z.negate().max(0.05);
  const sx = cameraProjectionMatrix.element(0).x.mul(viewportSize.x).mul(0.5);
  const sy = cameraProjectionMatrix.element(1).y.mul(viewportSize.y).mul(0.5);
  const d = vO.sub(vP);
  const dirPx = vec2(sx.mul(d.x.mul(w).add(vP.x.mul(d.z))), sy.mul(d.y.mul(w).add(vP.y.mul(d.z))));
  const dir = dirPx.div(dirPx.length().max(1e-6));
  const perp = vec2(dir.y.negate(), dir.x);
  const realPx = dia.mul(sy).div(w);
  const drawPx = realPx.max(minPx);
  const offsetNdc = perp.mul(side).mul(drawPx.mul(0.5)).mul(2).div(viewportSize.xy);
  material.vertexNode = vec4(clip.x.add(offsetNdc.x.mul(clip.w)), clip.y.add(offsetNdc.y.mul(clip.w)), clip.z, clip.w);

  material.colorNode = vec3(...color);
  material.opacityNode = varying(realPx.div(drawPx).max(minAlpha).min(1));
  material.alphaToCoverage = true;
  material.transparent = false;
  return material;
}

export function catenaryPoints(a, b, c, n, { terrainAt = null, minClearance = 0 } = {}) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  if (L < 0.5) return [a.clone(), b.clone()];
  const dy = b.y - a.y;
  const build = (cc) => {
    const x0 = L / 2 - cc * Math.asinh(dy / (2 * cc * Math.sinh(L / (2 * cc))));
    const f = (x) => cc * Math.cosh((x - x0) / cc);
    const ya = f(0);
    const pts = [];
    let clear = Infinity;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3(a.x + dx * t, a.y + (f(t * L) - ya), a.z + dz * t);
      pts.push(p);
      if (terrainAt) clear = Math.min(clear, p.y - terrainAt(p.x, p.z));
    }
    return { pts, clear };
  };
  let cc = c;
  let r = build(cc);
  for (let k = 0; k < 8 && terrainAt && r.clear < minClearance; k++) {
    cc *= 1.6;
    r = build(cc);
  }
  return r.pts;
}
