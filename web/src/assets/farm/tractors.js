import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { Solids, STYLE, paint, V, frameAt } from './solids.js';

const PAINTS = [
  [0.025, 0.06, 0.2], [0.24, 0.025, 0.02], [0.4, 0.14, 0.02], [0.2, 0.21, 0.22], [0.03, 0.12, 0.055], [0.22, 0.16, 0.03],
];
const RIMS = [[0.3, 0.3, 0.29], [0.32, 0.3, 0.24], [0.06, 0.06, 0.07]];

const matT = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const rotZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const rotX = (a) => new THREE.Matrix4().makeRotationX(a);

function arch(s, x, y, z, R, w, style, frac = 1) {
  const g = new THREE.CylinderGeometry(R, R, w, 10, 1, true, Math.PI / 2, Math.PI * frac);
  g.rotateX(Math.PI / 2);
  s.geo(g, x, y, z, 1, 1, 1, style);
  g.dispose();
}

function wheel(s, x, z, R, w, rimStyle, lugs, side) {
  const tyre = STYLE.rubber;
  s.bar(V(x, R, z - w / 2), V(x, R, z + w / 2), R - 0.05, R - 0.05, lugs > 16 ? 18 : 14, tyre, true);
  const lug = new THREE.BoxGeometry(0.075, 0.07, w * 0.55);
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    for (const k of [-1, 1]) {
      const m = matT(x, R, z).multiply(rotZ(a + (k > 0 ? 0 : Math.PI / lugs))).multiply(matT(R - 0.025, 0, k * w * 0.25)).multiply(rotX(k * 0.5));
      s.add(lug, m, tyre);
    }
  }
  lug.dispose();
  const rimR = R * 0.58;
  s.bar(V(x, R, z - w * 0.46), V(x, R, z + w * 0.46), rimR, rimR, 14, rimStyle, true);
  s.bar(V(x, R, z + side * w * 0.46), V(x, R, z + side * (w * 0.46 + 0.07)), R * 0.22, R * 0.18, 8, rimStyle, true);
}

function tractorBody(s, rng, o) {
  const body = paint(o.color);
  const dark = STYLE.black;
  const rimStyle = { ...paint(o.rim, 0.5), mat: 4 };
  const lugsR = 20;
  for (const side of [-1, 1]) {
    wheel(s, -1.3, side * 0.88, 0.75, 0.58, rimStyle, lugsR, side);
    wheel(s, 1.3, side * 0.84, 0.5, 0.4, rimStyle, 14, side);
    arch(s, -1.3, 0.75, side * 0.88, 0.86, 0.66, body);
    arch(s, 1.3, 0.5, side * 0.84, 0.6, 0.47, body, 0.55);
  }
  s.box(-0.9, 0.82, 0, 2.3, 0.42, 0.78, body);
  s.box(1.3, 0.5, 0, 0.18, 0.18, 1.5, dark);
  s.box(0.55, 1.28, 0, 1.75, 0.72, 0.8, body);
  s.box(1.55, 1.14, 0, 0.55, 0.52, 0.7, body);
  s.box(1.84, 1.14, 0, 0.04, 0.4, 0.58, dark);
  for (const side of [-1, 1]) s.box(1.83, 1.34, side * 0.3, 0.05, 0.1, 0.16, STYLE.lamp);
  s.box(2.0, 0.55, 0, 0.3, 0.38, 0.62, { ...STYLE.black, color: [0.06, 0.06, 0.065] });
  for (const side of [-1, 1]) {
    s.box(-0.9, 0.62, side * 0.74, 0.6, 0.05, 0.22, dark);
    s.box(-0.35, 0.85, side * 0.5, 0.7, 0.34, 0.26, dark);
  }
  const cx = -1.0;
  const cw = 1.42;
  const cl = 1.4;
  s.box(cx, 2.31, 0, cl, 1.35, cw - 0.04, STYLE.glass);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.box(cx + sx * (cl / 2 - 0.03), 2.0 + 0.0, sz * (cw / 2 - 0.03), 0.07, 1.95, 0.07, body);
  s.box(cx, 2.82, 0, cl + 0.12, 0.1, cw + 0.1, body);
  s.box(cx, 1.3, 0, cl, 0.12, cw, body);
  s.box(cx - 0.25, 2.89, 0, 0.55, 0.05, 0.5, STYLE.black);
  for (const side of [-1, 1]) s.box(cx + cl / 2 + 0.04, 2.86, side * 0.45, 0.06, 0.07, 0.2, STYLE.lamp);
  if (rng() < 0.6) s.box(cx - 0.55, 2.94, 0.45, 0.14, 0.12, 0.14, STYLE.amber);
  for (const side of [-1, 1]) {
    s.bar(V(cx + cl / 2, 2.35, side * (cw / 2)), V(cx + cl / 2 + 0.12, 2.35, side * (cw / 2 + 0.38)), 0.012, 0.012, 5, dark);
    s.box(cx + cl / 2 + 0.12, 2.35, side * (cw / 2 + 0.4), 0.04, 0.3, 0.2, dark);
  }
  s.bar(V(0.15, 1.5, -0.3), V(0.15, 2.65, -0.3), 0.05, 0.045, 7, { ...STYLE.rust, color: [0.12, 0.08, 0.06] });
  s.box(0.15, 2.69, -0.3, 0.16, 0.025, 0.16, dark, 0, 0.25);
  for (const side of [-1, 1]) {
    s.bar(V(-1.7, 0.55, side * 0.5), V(-2.35, 0.42, side * 0.62), 0.03, 0.03, 6, STYLE.black);
    s.bar(V(-1.75, 1.0, side * 0.62), V(-2.15, 0.55, side * 0.62), 0.02, 0.02, 5, STYLE.black);
  }
  s.bar(V(-1.7, 1.25, 0), V(-2.25, 0.95, 0), 0.025, 0.025, 6, STYLE.black);
  s.bar(V(-1.98, 0.7, -0.15), V(-2.1, 0.7, 0.15), 0.03, 0.03, 6, STYLE.black);
  if (o.loader) loader(s, o, body);
}

function loader(s, o, body) {
  const lift = o.lift;
  for (const side of [-1, 1]) {
    const z = side * 0.72;
    s.bar(V(-0.95, 1.45, z), V(-0.5, 2.05 + lift * 0.4, z), 0.06, 0.06, 6, body);
    s.bar(V(-0.5, 2.05 + lift * 0.4, z), V(2.35, 0.75 + lift, z), 0.065, 0.055, 6, body);
    s.bar(V(-0.35, 1.0, z), V(-0.3, 1.9 + lift * 0.4, z), 0.03, 0.03, 5, STYLE.galv);
    s.bar(V(1.0, 1.1, z), V(2.45, 0.7 + lift, z), 0.025, 0.025, 5, STYLE.galv);
  }
  s.bar(V(2.4, 0.75 + lift, -0.8), V(2.4, 0.75 + lift, 0.8), 0.05, 0.05, 6, body);
  const gx = 2.6;
  const gy = 0.5 + lift;
  s.box(gx, gy + 0.02, 0, 0.8, 0.05, 1.9, STYLE.galv, 0, 0);
  s.box(gx - 0.35, gy + 0.32, 0, 0.05, 0.7, 1.9, STYLE.galv);
  for (const side of [-1, 1]) s.box(gx, gy + 0.28, side * 0.95, 0.8, 0.55, 0.05, STYLE.galv);
  s.box(gx + 0.42, gy - 0.02, 0, 0.06, 0.06, 1.9, STYLE.rust);
}

function trailer(s, rng, o) {
  const body = paint(o.trailerColor, 0.6);
  const len = 4.2 + rng() * 0.8;
  const w = 2.1;
  const wall = 0.95 + rng() * 0.3;
  const ax = -(0.9 + len * 0.62);
  const floorY = 0.95;
  s.box(-(0.9 + len / 2), floorY, 0, len, 0.1, w, body);
  for (const side of [-1, 1]) s.box(-(0.9 + len / 2), floorY + wall / 2, side * (w / 2 - 0.02), len, wall, 0.045, body);
  s.box(-0.9 - 0.02, floorY + wall / 2, 0, 0.045, wall, w, body);
  s.box(-0.9 - len + 0.02, floorY + wall / 2, 0, 0.045, wall, w, body);
  for (const side of [-1, 1]) {
    s.box(-(0.9 + len / 2), floorY + wall, side * (w / 2 - 0.02), len, 0.06, 0.08, body);
    for (let i = 1; i < 5; i++) s.box(-0.9 - (i * len) / 5, floorY + wall / 2, side * (w / 2 + 0.03), 0.07, wall, 0.04, body);
  }
  if (o.load) {
    const g = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    s.geo(g, -(0.9 + len / 2), floorY + wall - 0.12, 0, len * 0.46, 0.5, w * 0.46, STYLE.manure);
    g.dispose();
  }
  s.box(-(0.9 + len / 2), 0.86, 0, len, 0.08, 0.14, STYLE.black);
  s.bar(V(0, 0.75, 0), V(-0.9, 0.9, 0), 0.05, 0.06, 6, STYLE.black);
  s.bar(V(0, 0.75, 0), V(-0.9, 0.9, -0.3), 0.03, 0.03, 5, STYLE.black);
  s.bar(V(0, 0.75, 0), V(-0.9, 0.9, 0.3), 0.03, 0.03, 5, STYLE.black);
  s.bar(V(ax, 0.6, -0.95), V(ax, 0.6, 0.95), 0.05, 0.05, 6, STYLE.black);
  for (const side of [-1, 1]) {
    wheel(s, ax, side * 1.0, 0.6, 0.42, { ...paint(o.rim, 0.5) }, 16, side);
    arch(s, ax, 0.6, side * 1.0, 0.69, 0.5, STYLE.black);
  }
  s.box(-0.9 - len + 0.0, 0.8, 0.6, 0.12, 0.1, 0.3, STYLE.amber);
  s.box(-0.9 - len + 0.0, 0.8, -0.6, 0.12, 0.1, 0.3, STYLE.amber);
}

function tanker(s, rng, o) {
  const tank = rng() < 0.5 ? paint(o.trailerColor, 0.5) : STYLE.galv;
  const len = 3.4 + rng() * 0.8;
  const R = 0.72 + rng() * 0.08;
  const cy = 1.3;
  const x0 = -1.2;
  s.bar(V(x0, cy, 0), V(x0 - len, cy, 0), R, R, 14, tank, true);
  const dome = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const e of [0, 1]) {
    const g = dome.clone().rotateZ(e ? Math.PI / 2 : -Math.PI / 2);
    s.geo(g, e ? x0 : x0 - len, cy, 0, 0.35, R, R, tank);
    g.dispose();
  }
  dome.dispose();
  s.bar(V(x0 - len * 0.45, cy + R - 0.05, 0), V(x0 - len * 0.45, cy + R + 0.12, 0), 0.24, 0.24, 10, STYLE.black, true);
  for (let i = 1; i < 4; i++) s.bar(V(x0 - (i * len) / 4, cy, 0), V(x0 - (i * len) / 4 - 0.05, cy, 0), R + 0.02, R + 0.02, 14, STYLE.black, true);
  s.bar(V(0, 0.75, 0), V(x0 - 0.3, 0.8, 0), 0.05, 0.05, 6, STYLE.black);
  s.box(x0 - len / 2, 0.68, 0, len, 0.1, 0.2, STYLE.black);
  const ax = x0 - len * 0.55;
  s.bar(V(ax, 0.7, -0.95), V(ax, 0.7, 0.95), 0.05, 0.05, 6, STYLE.black);
  for (const side of [-1, 1]) {
    wheel(s, ax, side * 1.0, 0.7, 0.5, paint(o.rim, 0.5), 16, side);
    arch(s, ax, 0.7, side * 1.0, 0.79, 0.58, STYLE.black);
  }
  s.bar(V(x0 - len - 0.3, 0.95, 0), V(x0 - len - 0.3, 1.5, 0), 0.07, 0.07, 8, STYLE.black);
  s.bar(V(x0 - len - 0.3, 1.0, 0), V(x0 - len - 0.9, 0.85, 0), 0.06, 0.06, 8, STYLE.black);
}

const KINDS = ['trailer', 'tanker', 'loader', 'plain'];

export function buildTractors(list, { heightAt, seed = 1 } = {}) {
  const s = new Solids();
  const blobs = [];
  const points = [];
  (list ?? []).forEach((t, i) => {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return;
    const rng = mulberry32((seed * 6007 + i * 7211 + 3) >>> 0);
    const heading = Number.isFinite(t.headingDeg) ? t.headingDeg : rng() * 360;
    const kind = KINDS.includes(t.kind) ? t.kind : KINDS[Math.floor(rng() * 3.4)];
    const o = {
      color: PAINTS[Math.floor(rng() * PAINTS.length)],
      rim: RIMS[Math.floor(rng() * RIMS.length)],
      trailerColor: PAINTS[Math.floor(rng() * PAINTS.length)],
      loader: kind === 'loader',
      lift: rng() * 0.5,
      load: rng() < 0.5,
    };
    const f = frameAt(t.x, t.y, heading, heightAt, 1.3, 0.85);
    s.groundY = f.ground;
    s.push(f.matrix);
    tractorBody(s, rng, o);
    s.pop();
    if (kind === 'trailer' || kind === 'tanker') {
      const ang = (rng() - 0.5) * 0.3;
      const hx = -2.35;
      const [hwx, hwz] = f.world(hx, 0);
      const hy = -hwz;
      const heading2 = heading + (ang * 180) / Math.PI;
      const f2 = frameAt(hwx, hy, heading2, heightAt, kind === 'trailer' ? 2.3 : 2.0, 1.0, kind === 'trailer' ? -3.4 : -3.0);
      s.groundY = f2.ground;
      s.push(f2.matrix);
      (kind === 'trailer' ? trailer : tanker)(s, rng, o);
      s.pop();
      blobs.push({ x: t.x, y: t.y, length: 11, width: 3.4, headingDeg: heading, strength: 0.18 });
    } else {
      blobs.push({ x: t.x, y: t.y, length: 6, width: 3, headingDeg: heading, strength: 0.15 });
    }
    points.push([t.x, -t.y]);
  });
  return { geometry: s.build(), blobs, points };
}
