import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { quad, tri, cylinder, hex, solidInfo, KIND, tint, CellSet } from './kit.js';
import { box as rawBox } from './shapes.js';
import { WireBatch, createWireMaterial, catenaryPoints } from '../street-lamps/wires.js';
import { sharedMaterials } from './materials.js';

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ICO = new THREE.IcosahedronGeometry(1, 0);

function blob(bucket, c, rx, ry, rz, color, info, rnd, rot = 0) {
  const pos = ICO.attributes.position;
  const jit = [];
  for (let i = 0; i < pos.count; i++) jit.push(1 + (rnd() - 0.5) * 0.08);
  const m = new THREE.Matrix4().makeRotationY(rot);
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i).multiply(V(rx, ry, rz)).multiplyScalar(jit[i]).applyMatrix4(m).add(c);
  for (let i = 0; i < pos.count; i += 3) {
    const a = P(i), b = P(i + 1), cc = P(i + 2);
    const mid = a.clone().add(b).add(cc).multiplyScalar(1 / 3).sub(c);
    bucket.face(a, b, cc, [[0, 0], [rx, 0], [0, rz]], color, { info }, mid);
  }
}

export function buildStork(B, at, heading, rnd, pose = 'standing') {
  const S = B('organic');
  const F = V(Math.cos(heading), 0, -Math.sin(heading));
  const Rg = V(Math.sin(heading), 0, Math.cos(heading));
  const white = tint(hex(0xe9e8e2), rnd, 0.03);
  const black = hex(0x15161a);
  const red = hex(0xb02a1e);
  const fi = solidInfo(0.85, 0, KIND.feather, rnd() * 50);
  const ri = solidInfo(0.5, 0, KIND.plain, 1);
  const P = (f, y, s = 0) => at.clone().addScaledVector(F, f).addScaledVector(Rg, s).add(V(0, y, 0));
  if (pose === 'brooding') {
    blob(S, P(0, 0.22), 0.3, 0.2, 0.17, white, fi, rnd, heading);
    blob(S, P(-0.08, 0.3), 0.24, 0.06, 0.16, black, fi, rnd, heading);
    cylinder(S, P(0.22, 0.28), P(0.32, 0.62), 0.045, 0.035, 5, white, fi, {});
    cylinder(S, P(0.32, 0.62), P(0.38, 0.66), 0.04, 0.035, 5, white, fi, {});
    cylinder(S, P(0.38, 0.66), P(0.6, 0.6), 0.026, 0.005, 4, red, ri, { capTop: true });
    return;
  }
  for (const s of [-0.05, 0.05]) {
    cylinder(S, P(0, 0, s), P(0.02, 0.5, s), 0.011, 0.014, 4, red, ri, { capTop: false });
    cylinder(S, P(0, 0.01, s), P(0.1, 0.01, s), 0.009, 0.005, 3, red, ri, { capTop: false });
  }
  blob(S, P(0, 0.63), 0.32, 0.17, 0.15, white, fi, rnd, heading);
  blob(S, P(-0.1, 0.7), 0.27, 0.07, 0.17, black, fi, rnd, heading);
  blob(S, P(-0.3, 0.62), 0.1, 0.05, 0.08, black, fi, rnd, heading);
  cylinder(S, P(0.22, 0.7), P(0.3, 0.9), 0.05, 0.034, 5, white, fi, {});
  cylinder(S, P(0.3, 0.9), P(0.36, 0.96), 0.036, 0.04, 5, white, fi, {});
  cylinder(S, P(0.36, 0.95), P(0.58, 0.9), 0.026, 0.005, 4, red, ri, { capTop: true });
}

export function buildNest(B, c, D, Hn, rnd) {
  const S = B('organic');
  const r0 = D / 2;
  const seed = rnd() * 90;
  const info = solidInfo(0.95, 0, KIND.nest, seed);
  const col = tint(hex(0x6a4c30), rnd, 0.12);
  const light = tint(hex(0x8a6a44), rnd, 0.1);
  const segs = 14;
  const profile = [[0.7, 0.0], [0.97, 0.22], [1.0, 0.55], [0.9, 0.92], [0.62, 1.0], [0.42, 0.78], [0.2, 0.72]];
  const rings = profile.map(([rr, hh]) => {
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const t = (k / segs) * Math.PI * 2;
      const j = 1 + (rnd() - 0.5) * 0.16;
      ring.push(V(c.x + Math.cos(t) * r0 * rr * j, c.y + hh * Hn + (rnd() - 0.5) * 0.04, c.z + Math.sin(t) * r0 * rr * j));
    }
    return ring;
  });
  const center = V(c.x, c.y + 0.7 * Hn, c.z);
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < segs; k++) {
      const a = rings[i][k], b = rings[i][(k + 1) % segs], d = rings[i + 1][k], e = rings[i + 1][(k + 1) % segs];
      const u0 = (k / segs) * Math.PI * 2 * r0;
      const u1 = ((k + 1) / segs) * Math.PI * 2 * r0;
      const mid = a.clone().add(b).add(d).add(e).multiplyScalar(0.25);
      const want = i < 3 ? mid.clone().sub(center).add(V(0, 0.2, 0)) : i === 3 ? V(0, 1, 0) : center.clone().sub(mid).add(V(0, 1, 0));
      quad(S, a, b, e, d, [[u0, i * 0.3], [u1, i * 0.3], [u1, i * 0.3 + 0.3], [u0, i * 0.3 + 0.3]], i >= 3 ? light : col, info, want);
    }
  }
  const lastRing = rings.at(-1);
  for (let k = 0; k < segs; k++) tri(S, lastRing[k], lastRing[(k + 1) % segs], center, [[0, 0], [0.1, 0], [0.05, 0.1]], light, info, V(0, 1, 0));
  const sticks = 10 + Math.floor(rnd() * 8);
  for (let i = 0; i < sticks; i++) {
    const t = rnd() * Math.PI * 2;
    const hh = 0.1 + rnd() * 0.9;
    const base = V(c.x + Math.cos(t) * r0 * 0.9, c.y + hh * Hn, c.z + Math.sin(t) * r0 * 0.9);
    const len = 0.25 + rnd() * 0.4;
    const up = (rnd() - 0.3) * 0.5;
    cylinder(S, base, base.clone().add(V(Math.cos(t) * len, up * len, Math.sin(t) * len)), 0.012, 0.006, 3, tint(hex(0x5a4228), rnd, 0.15), info, { capTop: false });
  }
  return c.y + Hn;
}

export function buildPlatform(B, c, rnd, legsToY = null) {
  const S = B('solid');
  const steel = tint(hex(0x6a6c6a), rnd, 0.08);
  const si = solidInfo(0.55, 0.55, KIND.metal, rnd() * 40);
  const R = 0.6;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2;
    const t1 = ((i + 1) / n) * Math.PI * 2;
    cylinder(S, V(c.x + Math.cos(t0) * R, c.y, c.z + Math.sin(t0) * R), V(c.x + Math.cos(t1) * R, c.y, c.z + Math.sin(t1) * R), 0.014, 0.014, 4, steel, si, { capTop: false });
  }
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
    cylinder(S, V(c.x, c.y, c.z), V(c.x + Math.cos(t) * R, c.y, c.z + Math.sin(t) * R), 0.012, 0.012, 4, steel, si, { capTop: false });
    cylinder(S, V(c.x + Math.cos(t) * R, c.y, c.z + Math.sin(t) * R), V(c.x + Math.cos(t) * 0.12, legsToY ?? c.y - 0.6, c.z + Math.sin(t) * 0.12), 0.012, 0.012, 4, steel, si, { capTop: false });
  }
  return c.y;
}

function buildPole(B, base, total, embed, rnd, seed, lean = V(0, 0, 0)) {
  const S = B('solid');
  const top = base.y - embed + total;
  const dTop = 0.19;
  const dBase = dTop + 0.015 * total;
  const rBaseAbove = (dBase - 0.015 * embed) / 2;
  const concrete = tint(hex(0x85837d), rnd, 0.06);
  const ci = solidInfo(0.95, 0, KIND.concrete, seed);
  cylinder(S, V(base.x, base.y, base.z), V(base.x + lean.x, top, base.z + lean.z), rBaseAbove, dTop / 2, 10, concrete, ci, { capTop: true });
  cylinder(S, V(base.x, base.y - 0.1, base.z), V(base.x, base.y + 0.06, base.z), rBaseAbove + 0.03, rBaseAbove + 0.02, 10, concrete.clone().multiplyScalar(0.85), ci, { capTop: true });
  return top;
}

function buildCrossarm(B, c, axis, rnd, seed, twisted) {
  const S = B('solid');
  const steel = tint(hex(0x6a6c6a), rnd, 0.06);
  const si = solidInfo(0.55, 0.55, KIND.metal, seed);
  const up = V(0, 1, 0);
  const nrm = new THREE.Vector3().crossVectors(axis, up).normalize();
  if (twisted) {
    rawBox(S, c.clone().add(V(0, 0.05, 0)), axis.clone().multiplyScalar(0.04), V(0, 0.09, 0), nrm.clone().multiplyScalar(0.015), steel, { info: si }, {});
    return [c.clone().addScaledVector(nrm, -0.1).add(V(0, 0.0, 0))];
  }
  rawBox(S, c.clone(), axis.clone().multiplyScalar(0.6), V(0, 0.0325, 0), nrm.clone().multiplyScalar(0.03), steel, { info: si }, {});
  const porcelain = hex(0x7a6a58);
  const pi = solidInfo(0.35, 0, KIND.plain, 1);
  const pts = [];
  for (const s of [-0.52, -0.17, 0.17, 0.52]) {
    const p = c.clone().addScaledVector(axis, s).add(V(0, 0.0325, 0));
    cylinder(S, p, p.clone().add(V(0, 0.12, 0)), 0.04, 0.025, 6, porcelain, pi, { capTop: true });
    cylinder(S, p.clone().add(V(0, 0.12, 0)), p.clone().add(V(0, 0.15, 0)), 0.03, 0.02, 6, porcelain, pi, { capTop: true });
    pts.push(p.clone().add(V(0, 0.15, 0)));
  }
  return pts;
}

export function createConcretePoles({ lines = [], nests = [], heightAt = () => 0, seed = 1, stork = 0.5, wires = true } = {}) {
  const rnd = mulberry32(seed * 7919 + 13);
  const cells = new CellSet(128);
  const supports = [];
  const wireBatch = new WireBatch();
  const nestSet = new Set(nests);
  lines.forEach((ln, li) => {
    const span = ln.span ?? 40;
    const pts = ln.line;
    const pos = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.round(L / span));
      for (let k = 0; k < n; k++) pos.push({ x: ax + ((bx - ax) * k) / n, y: ay + ((by - ay) * k) / n, vertex: k === 0 && i > 0, end: k === 0 && i === 0 });
    }
    const last = pts.at(-1);
    pos.push({ x: last[0], y: last[1], end: true });
    const twisted = (ln.kind ?? pick(rnd, ['nu', 'twisted'])) === 'twisted';
    const rows = [];
    pos.forEach((p, i) => {
      const a = pos[Math.max(0, i - 1)];
      const b = pos[Math.min(pos.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dl = Math.hypot(dx, dy) || 1;
      const turn = i > 0 && i < pos.length - 1 ? Math.acos(Math.max(-1, Math.min(1, ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / ((Math.hypot(p.x - a.x, p.y - a.y) || 1) * (Math.hypot(b.x - p.x, b.y - p.y) || 1))))) : 0;
      const aFrame = ln.poles === 'a' || (ln.poles !== 'round' && (p.end || turn > 0.5));
      const idx = supports.length;
      const hasNest = nestSet.has(idx);
      const B = cells.at(p.x, p.y);
      const g = heightAt(p.x, -p.y);
      const base = V(p.x, g, -p.y);
      const total = pick(rnd, [9, 10, 10.5, 12]);
      const embed = total >= 10.5 ? 1.9 : 1.7;
      const alongDir = V(dx / dl, 0, -dy / dl);
      const axis = new THREE.Vector3().crossVectors(alongDir, V(0, 1, 0)).normalize();
      const seedP = rnd() * 90;
      let top;
      if (aFrame) {
        for (const s of [-1, 1]) {
          const bb = base.clone().addScaledVector(axis, s * 0.8);
          bb.y = heightAt(bb.x, bb.z);
          top = buildPole(B, bb, total, embed, rnd, seedP + s, axis.clone().multiplyScalar(-s * 0.55));
        }
        const S = B('solid');
        const steel = tint(hex(0x6a6c6a), rnd, 0.06);
        const si = solidInfo(0.55, 0.55, KIND.metal, seedP);
        const La = total - embed;
        for (const t of [0.35, 0.6]) {
          const sp = 0.8 - 0.55 * t * ((La) / La);
          cylinder(S, base.clone().addScaledVector(axis, -sp).add(V(0, La * t + (heightAt(base.x, base.z) - base.y), 0)), base.clone().addScaledVector(axis, sp).add(V(0, La * t, 0)), 0.02, 0.02, 4, steel, si, { capTop: false });
        }
        top = base.y - embed + total;
      } else {
        top = buildPole(B, base, total, embed, rnd, seedP);
      }
      const armY = hasNest ? top - 0.55 : top - 0.35;
      const centre = V(base.x + (aFrame ? 0 : 0), armY, base.z);
      const attach = buildCrossarm(B, centre, aFrame ? axis : axis, rnd, seedP, twisted);
      rows.push(attach);
      supports.push({ x: p.x, y: p.y, h: top - g });
      if (hasNest) addNestAt(B, V(base.x, top, base.z), rnd, rnd() < stork);
    });
    if (wires) {
      for (let i = 0; i + 1 < rows.length; i++) {
        const A = rows[i];
        const C = rows[i + 1];
        const nW = Math.min(A.length, C.length);
        for (let k = 0; k < nW; k++) {
          const a = A[A.length === 1 ? 0 : k];
          const b = C[C.length === 1 ? 0 : k];
          const dist = Math.hypot(b.x - a.x, b.z - a.z);
          const c = Math.max(250, (dist * dist) / (8 * (0.35 + 0.012 * dist)));
          const pts = catenaryPoints(a, b, c, Math.max(4, Math.round(dist / 6)), { terrainAt: (x, z) => heightAt(x, z), minClearance: 5 });
          wireBatch.polyline(pts, twisted ? 0.045 : 0.012);
        }
      }
    }
  });
  const group = cells.toGroup('village-poles', sharedMaterials());
  if (wireBatch.segments) {
    const m = new THREE.Mesh(wireBatch.build(), wireMaterial());
    m.name = 'village-wires';
    m.userData.noShadow = true;
    group.add(m);
  }
  return { group, supports, stats: { triangles: group.userData.triangles } };
}

let wireMat = null;
const wireMaterial = () => (wireMat ??= createWireMaterial({ color: [0.05, 0.052, 0.055] }));

function addNestAt(B, top, rnd, withStork) {
  const S = B('solid');
  const steel = tint(hex(0x6a6c6a), rnd, 0.08);
  const si = solidInfo(0.55, 0.55, KIND.metal, 3);
  cylinder(S, top, top.clone().add(V(0, 0.4, 0)), 0.03, 0.03, 5, steel, si, { capTop: true });
  const y = buildPlatform(B, top.clone().add(V(0, 0.4, 0)), rnd, top.y - 0.1);
  const D = Math.min(2.1, Math.max(0.9, 1.4 + (rnd() - 0.5) * 0.9));
  const Hn = 0.35 + rnd() * 0.55;
  const topNest = buildNest(B, V(top.x, y + 0.03, top.z), D, Hn, rnd);
  if (withStork) {
    const brood = rnd() < 0.25;
    buildStork(B, V(top.x + (brood ? 0 : 0.15), topNest - (brood ? 0.2 : 0.18), top.z), rnd() * Math.PI * 2, rnd, brood ? 'brooding' : 'standing');
    if (!brood && rnd() < 0.35) buildStork(B, V(top.x - 0.45, topNest - 0.2, top.z + 0.2), rnd() * Math.PI * 2, rnd, 'standing');
  }
}

export function createStorkNests({ points = [], heightAt = () => 0, seed = 1 } = {}) {
  const rnd = mulberry32(seed * 104729 + 7);
  const cells = new CellSet(128);
  for (const p of points) {
    const B = cells.at(p.x, p.y);
    const g = heightAt(p.x, -p.y);
    if (p.onPole) {
      const base = V(p.x, g, -p.y);
      const top = buildPole(B, base, 10.5, 1.9, rnd, rnd() * 90);
      addNestAt(B, V(p.x, top, -p.y), rnd, !!p.stork);
    } else {
      const y0 = p.h ?? g;
      const base = V(p.x, y0, -p.y);
      const S = B('solid');
      const steel = tint(hex(0x6a6c6a), rnd, 0.08);
      const si = solidInfo(0.55, 0.55, KIND.metal, 3);
      for (let i = 0; i < 3; i++) {
        const t = (i / 3) * Math.PI * 2;
        cylinder(S, V(p.x + Math.cos(t) * 0.6, y0, -p.y + Math.sin(t) * 0.6), V(p.x, y0 + 0.9, -p.y), 0.02, 0.02, 4, steel, si, { capTop: false });
      }
      addNestAtLow(B, V(p.x, y0 + 0.9, -p.y), rnd, !!p.stork);
      void base;
    }
  }
  const group = cells.toGroup('village-nests', sharedMaterials());
  return { group, stats: { triangles: group.userData.triangles } };
}

function addNestAtLow(B, top, rnd, withStork) {
  const y = buildPlatform(B, top, rnd, top.y - 0.8);
  const D = Math.min(2.1, Math.max(0.9, 1.4 + (rnd() - 0.5) * 0.9));
  const Hn = 0.35 + rnd() * 0.55;
  const topNest = buildNest(B, V(top.x, y + 0.03, top.z), D, Hn, rnd);
  if (withStork) buildStork(B, V(top.x + 0.15, topNest - 0.18, top.z), rnd() * Math.PI * 2, rnd, 'standing');
}
