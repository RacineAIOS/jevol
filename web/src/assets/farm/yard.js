import * as THREE from 'three/webgpu';
import { mulberry32, valueNoise } from '../../engine/rng.js';
import { STYLE, V, frameAt } from './solids.js';

const STEEL = [STYLE.galv, STYLE.galv, { ...STYLE.galv, color: [0.38, 0.4, 0.4] }, { ...STYLE.galv, color: [0.3, 0.2, 0.12], metal: 0.5 }];
const BLUE_POLY = { color: [0.02, 0.06, 0.18], rough: 0.5, metal: 0, mat: 0 };
const matT = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

function trough(s, rng, f) {
  const shape = ['rect', 'rect', 'round', 'half'][Math.floor(rng() * 4)];
  const steel = rng() < 0.2 ? STYLE.rust : STEEL[Math.floor(rng() * STEEL.length)];
  const level = 0.72 + rng() * 0.2;
  const th = 0.025;
  s.groundY = f.ground;
  s.push(f.matrix);
  let floatPos;
  if (shape === 'rect') {
    const L = 2 + rng() * 1;
    const W = 0.55 + rng() * 0.15;
    const H = 0.45 + rng() * 0.15;
    const y0 = 0.06;
    s.box(0, y0 + th / 2, 0, L, th, W, STYLE.black);
    for (const sz of [-1, 1]) {
      s.box(0, y0 + H / 2, sz * (W / 2 - th / 2), L, H, th, steel);
      s.bar(V(-L / 2, y0 + H, sz * (W / 2 - th)), V(L / 2, y0 + H, sz * (W / 2 - th)), 0.02, 0.02, 6, steel);
    }
    for (const sx of [-1, 1]) {
      s.box(sx * (L / 2 - th / 2), y0 + H / 2, 0, th, H, W, steel);
      s.bar(V(sx * (L / 2 - th), y0 + H, -W / 2), V(sx * (L / 2 - th), y0 + H, W / 2), 0.02, 0.02, 6, steel);
    }
    s.box(0, y0 + H * level, 0, L - 2 * th, 0.008, W - 2 * th, STYLE.water);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.box(sx * (L / 2 - 0.1), y0 / 2, sz * (W / 2 - 0.08), 0.1, y0, 0.1, STYLE.black);
    floatPos = [L / 2 - 0.3, y0 + H * level, 0];
  } else if (shape === 'round') {
    const D = 1.5 + rng() * 0.7;
    const H = 0.5 + rng() * 0.1;
    const y0 = 0.04;
    s.bar(V(0, y0, 0), V(0, y0 + H, 0), D / 2, D / 2 + 0.015, 20, steel);
    s.bar(V(0, y0, 0), V(0, y0 + th, 0), D / 2, D / 2, 20, STYLE.black, true);
    s.bar(V(0, y0 + H - 0.01, 0), V(0, y0 + H + 0.012, 0), D / 2 + 0.02, D / 2 + 0.02, 20, steel);
    s.bar(V(0, y0 + H * level - 0.006, 0), V(0, y0 + H * level, 0), D / 2 - th, D / 2 - th, 20, STYLE.water, true);
    floatPos = [D / 2 - 0.35, y0 + H * level, 0.1];
  } else {
    const L = 1.6 + rng() * 0.6;
    const R = 0.38 + rng() * 0.08;
    const g = new THREE.CylinderGeometry(R, R, L, 14, 1, true, Math.PI, Math.PI);
    g.rotateZ(Math.PI / 2);
    s.geo(g, 0, R + 0.1, 0, 1, 1, 1, steel);
    g.dispose();
    const d = level * R;
    const chord = 2 * Math.sqrt(Math.max(0.0004, R * R - (R - d) * (R - d)));
    s.box(0, 0.1 + d, 0, L - 0.03, 0.008, chord, STYLE.water);
    for (const sx of [-1, 1]) {
      s.box(sx * (L / 2 - 0.01), R + 0.1 + 0.0, 0, 0.02, 0.0001, 2 * R, steel);
      s.box(sx * (L / 2 - 0.25), 0.05, 0, 0.1, 0.1, 2 * R + 0.1, STYLE.black);
    }
    floatPos = [L / 2 - 0.3, 0.1 + d, 0];
  }
  const [fx, fy, fz] = floatPos;
  s.bar(V(fx + 0.12, fy + 0.2, fz), V(fx, fy + 0.05, fz), 0.01, 0.01, 5, STYLE.galv);
  const ball = new THREE.SphereGeometry(0.075, 8, 6);
  s.geo(ball, fx, fy + 0.01, fz, 1, 1, 1, STYLE.black);
  ball.dispose();
  s.bar(V(fx + 0.3, 0, fz), V(fx + 0.12, fy + 0.22, fz), 0.02, 0.02, 6, BLUE_POLY);
  s.bar(V(fx + 0.3, 0, fz), V(fx + 1.8, 0, fz + 0.4), 0.02, 0.02, 6, BLUE_POLY);
  if (rng() < 0.5) s.box(0, 0.015, 0, 3.8, 0.03, 2.5, STYLE.concrete);
  s.pop();
}

function manureGeometry(rng, f, heightAt, quality) {
  const L = 3 + rng() * 4;
  const W = 2.5 + rng() * 2.5;
  const H = 0.8 + rng() * 0.8;
  const rings = quality === 'low' ? 5 : 8;
  const segs = quality === 'low' ? 14 : 22;
  const salt = Math.floor(rng() * 1000);
  const pos = [];
  const idx = [];
  const vertex = (i, j) => {
    const t = i / rings;
    const a = (j / segs) * Math.PI * 2;
    const edge = 0.8 + 0.4 * valueNoise(Math.cos(a) * 1.4 + 3, Math.sin(a) * 1.4 + 3, salt);
    const u = Math.cos(a) * (L / 2) * edge * t;
    const w = Math.sin(a) * (W / 2) * edge * t;
    const [wx, wz] = f.world(u, w);
    const profile = (1 - Math.pow(t, 2.4)) * (0.82 + 0.35 * valueNoise(wx * 0.7, wz * 0.7, salt + 5));
    const lump = 0.08 * valueNoise(wx * 3, wz * 3, salt + 9);
    return [wx, heightAt(wx, wz) + Math.max(0, H * profile + lump) - (i === rings ? 0.04 : 0), wz];
  };
  for (let i = 0; i <= rings; i++) for (let j = 0; j < segs; j++) pos.push(...vertex(i, j));
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      const c = (i + 1) * segs + j;
      const d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { g, L, W };
}

function gate(s, rng, f, width, open) {
  const W = Math.max(1, width);
  const leaf = W - 0.1;
  const H = 1.0 + rng() * 0.25;
  const bottom = 0.18 + rng() * 0.08;
  const rails = 4 + Math.floor(rng() * 4);
  const r = 0.017 + rng() * 0.004;
  const style = rng() < 0.12 ? { ...STYLE.galv, color: [0.42, 0.32, 0.2], metal: 0.4 } : STYLE.galv;
  const postStyle = rng() < 0.5 ? STYLE.wood : STYLE.galv;
  s.groundY = f.ground;
  s.push(f.matrix);
  for (const side of [-1, 1]) {
    const gy = f.h(side * (W / 2 + 0.07), 0) - f.ground;
    const R = postStyle === STYLE.wood ? 0.1 : 0.055;
    s.bar(V(side * (W / 2 + 0.07), gy - 0.3, 0), V(side * (W / 2 + 0.07), gy + H + 0.35, 0), R, R * 0.95, 8, postStyle);
  }
  const yBase = Math.max(f.h(-W / 2, 0), f.h(W / 2, 0)) - f.ground;
  s.push(matT(-W / 2, 0, 0).multiply(new THREE.Matrix4().makeRotationY(open)));
  const x0 = 0.03;
  const x1 = leaf + 0.03;
  const y0 = yBase + bottom;
  const y1 = yBase + bottom + H - 0.2;
  const ys = [];
  for (let k = 0; k < rails; k++) {
    const t = k / (rails - 1);
    ys.push(y0 + (y1 - y0) * Math.pow(t, 0.85));
  }
  for (const y of ys) s.bar(V(x0, y, 0), V(x1, y, 0), r, r, 6, style);
  const nv = Math.max(2, Math.round(leaf / 1.5) + 1);
  for (let k = 0; k < nv; k++) {
    const x = x0 + ((x1 - x0) * k) / (nv - 1);
    s.bar(V(x, y0 - 0.02, 0), V(x, y1 + 0.02, 0), r, r, 6, style);
  }
  s.bar(V(x0, y0, 0.0), V(x1, y1, 0.0), r * 0.8, r * 0.8, 5, style);
  if (leaf > 3.5 || rng() < 0.3) s.bar(V(x0, y1, 0.0), V(x1, y0, 0.0), r * 0.8, r * 0.8, 5, style);
  s.box(x0, y0 + 0.05, 0.03, 0.06, 0.05, 0.06, STYLE.black);
  s.box(x0, y1 - 0.05, 0.03, 0.06, 0.05, 0.06, STYLE.black);
  s.box(x1 - 0.02, (y0 + y1) / 2, 0.035, 0.05, 0.12, 0.04, STYLE.rust);
  s.pop();
  s.pop();
}

function decalGeometry(items, heightAt) {
  const N = 6;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  let base = 0;
  for (const d of items) {
    const f = frameAt(d.x, d.y, d.headingDeg, heightAt);
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const u = (i / N) * 2 - 1;
        const v = (j / N) * 2 - 1;
        const [wx, wz] = f.world((u * d.length) / 2, (v * d.width) / 2);
        pos.push(wx, heightAt(wx, wz) + 0.035, wz);
        uv.push(u, v);
        col.push(d.strength, d.kind ?? 0, 0);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = base + i * (N + 1) + j;
        idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1);
      }
    }
    base += (N + 1) * (N + 1);
  }
  if (!items.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildYard({ troughs, manure, gates }, { heightAt, quality = 'high', seed = 1 }, s) {
  const blobs = [];
  const points = [];
  const decals = [];
  (troughs ?? []).forEach((t, i) => {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return;
    const rng = mulberry32((seed * 4001 + i * 9173 + 5) >>> 0);
    const heading = Number.isFinite(t.headingDeg) ? t.headingDeg : rng() * 360;
    const f = frameAt(t.x, t.y, heading, heightAt, 0.9, 0.3);
    trough(s, rng, f);
    const size = 5 + rng() * 2.5;
    blobs.push({ x: t.x, y: t.y, length: size, width: size * 0.85, headingDeg: heading, strength: 0.85 });
    decals.push({ x: t.x, y: t.y, length: size, width: size * 0.85, headingDeg: heading, strength: 0.85, kind: 0 });
    points.push([t.x, -t.y]);
  });
  (manure ?? []).forEach((m, i) => {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    const rng = mulberry32((seed * 5003 + i * 6151 + 11) >>> 0);
    const heading = Number.isFinite(m.headingDeg) ? m.headingDeg : rng() * 360;
    const f = frameAt(m.x, m.y, heading, heightAt);
    const { g, L, W } = manureGeometry(rng, f, heightAt, quality);
    s.groundY = f.ground;
    s.add(g, null, STYLE.manure);
    g.dispose();
    blobs.push({ x: m.x, y: m.y, length: L + 3, width: W + 3, headingDeg: heading, strength: 0.7 });
    decals.push({ x: m.x, y: m.y, length: L * 1.5 + 2, width: W * 1.5 + 2, headingDeg: heading, strength: 0.75, kind: 1 });
    points.push([m.x, -m.y]);
  });
  (gates ?? []).forEach((g, i) => {
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return;
    const rng = mulberry32((seed * 3011 + i * 8081 + 23) >>> 0);
    const heading = Number.isFinite(g.headingDeg) ? g.headingDeg : rng() * 360;
    const width = Number.isFinite(g.width) && g.width > 0.8 ? g.width : [3, 3.6, 4, 4.5][Math.floor(rng() * 4)];
    const f = frameAt(g.x, g.y, heading, heightAt, 0, 0);
    const open = g.open === false ? 0 : g.open === true || rng() < 0.15 ? 1.05 + rng() * 0.7 : 0;
    gate(s, rng, f, width, open);
    blobs.push({ x: g.x, y: g.y, length: width + 2, width: 4, headingDeg: heading, strength: 0.5 });
    decals.push({ x: g.x, y: g.y, length: width + 1.5, width: 3.5, headingDeg: heading, strength: 0.55, kind: 0 });
    points.push([g.x, -g.y]);
  });
  return { blobs, points, decals, decalGeometry: (h) => decalGeometry(decals, h) };
}
