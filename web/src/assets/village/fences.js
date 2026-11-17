import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { quad, tri, cylinder, hex, solidInfo, KIND, tint, lerp } from './kit.js';
import { box as rawBox } from './shapes.js';

const UPV = new THREE.Vector3(0, 1, 0);
const PAINTS = [0xe3e0d6, 0x5e7f5b, 0x6c8fae, 0xc09a52, 0x7a3b2a, 0x8a8478, 0x6b5a48, 0xd8d3c2];

function makePath(line) {
  const segs = [];
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    segs.push({ ax, ay, dx: (bx - ax) / L, dy: (by - ay) / L, s0: total, L });
    total += L;
  }
  const at = (s) => {
    const t = Math.max(0, Math.min(total, s));
    let g = segs[segs.length - 1];
    for (const sg of segs) if (t <= sg.s0 + sg.L) { g = sg; break; }
    const k = t - g.s0;
    return { x: g.ax + g.dx * k, y: g.ay + g.dy * k, dx: g.dx, dy: g.dy };
  };
  return { total, at, segs };
}

const V3 = (p, h) => new THREE.Vector3(p.x, h, -p.y);

function beam(bucket, a, b, sw, sh, color, info) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const across = new THREE.Vector3().crossVectors(dir, UPV).normalize().multiplyScalar(sw / 2);
  const up = new THREE.Vector3().crossVectors(across, dir).normalize().multiplyScalar(sh / 2);
  rawBox(bucket, mid, dir.multiplyScalar(0.5), up, across, color, { info }, {});
}

export function buildFence(B, fence, heightAt, seedIn) {
  const rnd = mulberry32(seedIn);
  const path = makePath(fence.line);
  if (path.total < 0.5) return { length: 0 };
  const gates = (fence.gates ?? []).slice().sort((a, b) => a.at - b.at);
  const intervals = [];
  let s = 0;
  for (const g of gates) {
    const a = g.at - g.width / 2;
    if (a > s + 0.05) intervals.push([s, a]);
    s = g.at + g.width / 2;
  }
  if (s < path.total - 0.05) intervals.push([s, path.total]);
  if (fence.kind === 'wire mesh') buildMesh(B, path, intervals, gates, heightAt, rnd);
  else buildPickets(B, path, intervals, gates, heightAt, rnd);
  return { length: path.total };
}

function buildPickets(B, path, intervals, gates, heightAt, rnd) {
  const S = B('fence');
  const H = 1.15 + rnd() * 0.5;
  const weathered = rnd() < 0.4;
  const paint = weathered ? tint(hex(0x7c7568), rnd, 0.1) : tint(hex(PAINTS[Math.floor(rnd() * PAINTS.length)]), rnd, 0.04);
  const kind = weathered ? KIND.wood : KIND.paint;
  const seed = rnd() * 80;
  const info = solidInfo(0.78, 0, kind, seed);
  const pw = rnd() < 0.5 ? 0.07 : 0.09;
  const gap = 0.04 + rnd() * 0.02;
  const pitch = pw + gap;
  const top = pick(rnd, ['flat', 'pointed', 'flat']);
  const span = 2.0 + rnd() * 0.9;
  const postColor = weathered ? paint.clone().multiplyScalar(0.9) : tint(paint, rnd, 0.02).multiplyScalar(0.95);
  const lean = weathered ? 0.05 : 0.012;
  const miss = weathered ? 0.025 : 0.004;
  const ph = (p) => heightAt(p.x, -p.y);
  const goodPicket = (p, dir, sOff) => {
    if (rnd() < miss) return;
    const g = ph(p) + 0.05;
    const hh = H * (1 + (rnd() - 0.5) * (weathered ? 0.05 : 0.01)) - (top === 'pointed' ? 0.1 : 0);
    const tilt = (rnd() - 0.5) * lean;
    const base = V3(p, g);
    const along = new THREE.Vector3(dir.dx, 0, -dir.dy);
    const nrm = new THREE.Vector3(dir.dy, 0, dir.dx);
    const lenv = new THREE.Vector3(0, hh, 0).addScaledVector(along, tilt * hh);
    const ax = along.clone().multiplyScalar(pw / 2);
    const az = nrm.clone().multiplyScalar(0.01);
    const col = tint(paint, rnd, weathered ? 0.14 : 0.05);
    const p0 = base.clone().addScaledVector(along, -pw / 2);
    const p1 = base.clone().addScaledVector(along, pw / 2);
    const pi = solidInfo(0.78, 0, kind, seed + sOff);
    for (const sgn of [1, -1]) {
      const o = nrm.clone().multiplyScalar(0.01 * sgn);
      quad(S, p0.clone().add(o), p1.clone().add(o), p1.clone().add(lenv).add(o), p0.clone().add(lenv).add(o), [[0, 0], [pw, 0], [pw, hh], [0, hh]], col, pi, o);
    }
    if (top === 'pointed') {
      const t0 = base.clone().add(lenv).addScaledVector(along, -pw / 2);
      const t1 = base.clone().add(lenv).addScaledVector(along, pw / 2);
      const t2 = base.clone().add(lenv).addScaledVector(along, 0).add(new THREE.Vector3(0, 0.1, 0));
      for (const sgn of [-1, 1]) {
        const o = az.clone().multiplyScalar(sgn);
        tri(S, t0.clone().add(o), t1.clone().add(o), t2.clone().add(o), [[0, 0], [pw, 0], [pw / 2, 0.1]], col, solidInfo(0.78, 0, kind, seed), o);
      }
    }
  };
  const addPost = (p, taller = false) => {
    const g = ph(p);
    const hp = H + 0.1 + (taller ? 0.15 : 0);
    const b = V3(p, g - 0.15);
    rawBox(S, b.clone().add(new THREE.Vector3(0, (hp + 0.15) / 2, 0)), new THREE.Vector3(0.045, 0, 0), new THREE.Vector3(0, (hp + 0.15) / 2, 0), new THREE.Vector3(0, 0, 0.045), postColor, { info }, {});
  };
  for (const [a, b] of intervals) {
    const n = Math.max(1, Math.round((b - a) / span));
    const posts = [];
    for (let i = 0; i <= n; i++) posts.push(a + ((b - a) * i) / n);
    for (const sg of path.segs) if (sg.s0 > a + 0.2 && sg.s0 < b - 0.2) posts.push(sg.s0);
    posts.sort((x, y) => x - y);
    for (let i = 0; i < posts.length; i++) {
      const p = path.at(posts[i]);
      addPost(p, i === 0 || i === posts.length - 1);
    }
    for (let i = 0; i + 1 < posts.length; i++) {
      const p0 = path.at(posts[i] + 0.0);
      const p1 = path.at(posts[i + 1] - 0.0);
      const dir = path.at((posts[i] + posts[i + 1]) / 2);
      const g0 = ph(p0);
      const g1 = ph(p1);
      const nrm = new THREE.Vector3(dir.dy, 0, dir.dx).multiplyScalar(-0.025);
      for (const hr of [0.28, H - 0.28]) {
        beam(S, V3(p0, g0 + hr).add(nrm), V3(p1, g1 + hr).add(nrm), 0.045, 0.07, postColor, info);
      }
      const L = posts[i + 1] - posts[i];
      const cnt = Math.floor((L - 0.06) / pitch);
      const start = posts[i] + (L - cnt * pitch) / 2 + pw / 2 + gap / 4;
      for (let k = 0; k < cnt; k++) goodPicket(path.at(start + k * pitch), path.at(start + k * pitch), k);
    }
  }
  for (const g of gates) {
    const p0 = path.at(g.at - g.width / 2);
    const p1 = path.at(g.at + g.width / 2);
    addPost(p0, true);
    addPost(p1, true);
    const dir = path.at(g.at);
    const g0 = ph(p0);
    const g1 = ph(p1);
    const gl = (t, h) => V3({ x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) }, lerp(g0, g1, t) + h);
    const pushback = new THREE.Vector3(dir.dy, 0, dir.dx).multiplyScalar(-0.025);
    const fr = paint.clone().multiplyScalar(0.92);
    const gi = solidInfo(0.78, 0, kind, seed + 7);
    for (const hr of [0.22, H - 0.3]) beam(S, gl(0.04, hr).add(pushback), gl(0.96, hr).add(pushback), 0.045, 0.08, fr, gi);
    beam(S, gl(0.04, 0.22).add(pushback), gl(0.96, H - 0.3).add(pushback), 0.04, 0.07, fr, gi);
    const cnt = Math.floor((g.width - 0.12) / pitch);
    for (let k = 0; k < cnt; k++) {
      const t = (0.06 + (k + 0.5) * pitch) / g.width;
      const pp = { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) };
      const base = V3(pp, lerp(g0, g1, t) + 0.12);
      const along = new THREE.Vector3(dir.dx, 0, -dir.dy);
      const nrm = new THREE.Vector3(dir.dy, 0, dir.dx);
      rawBox(S, base.clone().add(new THREE.Vector3(0, (H - 0.12) / 2, 0)), along.multiplyScalar(pw / 2), new THREE.Vector3(0, (H - 0.12) / 2, 0), nrm.multiplyScalar(0.01), tint(paint, rnd, 0.04), { info: gi }, {});
    }
    const lp = gl(0.9, H * 0.6);
    cylinder(S, lp, lp.clone().add(new THREE.Vector3(0, 0, 0)).addScaledVector(new THREE.Vector3(dir.dx, 0, -dir.dy), -0.12), 0.012, 0.012, 4, hex(0x2a2a2a), solidInfo(0.5, 0.7, KIND.metal, 1), { capTop: false });
  }
}

function pick(rnd, list) {
  return list[Math.floor(rnd() * list.length)];
}

function buildMesh(B, path, intervals, gates, heightAt, rnd) {
  const S = B('fence');
  const M = B('mesh');
  const H = 1.1 + rnd() * 0.5;
  const ph = (p) => heightAt(p.x, -p.y);
  const concrete = tint(hex(0x9a9892), rnd, 0.06);
  const ci = solidInfo(0.95, 0, KIND.concrete, rnd() * 50);
  const wire = hex(0x7d8284);
  const wi = solidInfo(0.5, 0.7, KIND.metal, 1);
  const meshCol = tint(hex(0x6f7476), rnd, 0.08);
  const span = 2.5 + rnd() * 0.5;
  const addPost = (p, strong) => {
    const g = ph(p);
    const hp = H + 0.45;
    const s = strong ? 0.13 : 0.1;
    rawBox(S, V3(p, g - 0.2 + (hp + 0.2) / 2), new THREE.Vector3(s / 2, 0, 0), new THREE.Vector3(0, (hp + 0.2) / 2, 0), new THREE.Vector3(0, 0, s / 2), concrete, { info: ci }, {});
  };
  for (const [a, b] of intervals) {
    const n = Math.max(1, Math.round((b - a) / span));
    const posts = [];
    for (let i = 0; i <= n; i++) posts.push(a + ((b - a) * i) / n);
    for (const sg of path.segs) if (sg.s0 > a + 0.2 && sg.s0 < b - 0.2) posts.push(sg.s0);
    posts.sort((x, y) => x - y);
    posts.forEach((s, i) => addPost(path.at(s), i === 0 || i === posts.length - 1));
    for (let i = 0; i + 1 < posts.length; i++) {
      const p0 = path.at(posts[i]);
      const p1 = path.at(posts[i + 1]);
      const g0 = ph(p0);
      const g1 = ph(p1);
      const dir = path.at((posts[i] + posts[i + 1]) / 2);
      const off = new THREE.Vector3(dir.dy, 0, dir.dx).multiplyScalar(0.07);
      const L = posts[i + 1] - posts[i];
      const a0 = V3(p0, g0 + 0.08).add(off);
      const a1 = V3(p1, g1 + 0.08).add(off);
      const b0 = V3(p0, g0 + H).add(off);
      const b1 = V3(p1, g1 + H).add(off);
      quad(M, a0, a1, b1, b0, [[0, 0], [L, 0], [L, H - 0.08], [0, H - 0.08]], meshCol, [0, 0, 0, 0], off);
      for (const hr of [0.1, H * 0.5, H]) cylinder(S, V3(p0, g0 + hr).add(off), V3(p1, g1 + hr).add(off), 0.0035, 0.0035, 3, wire, wi, { capTop: false });
    }
  }
  for (const g of gates) {
    const p0 = path.at(g.at - g.width / 2);
    const p1 = path.at(g.at + g.width / 2);
    addPost(p0, true);
    addPost(p1, true);
    const g0 = ph(p0);
    const g1 = ph(p1);
    const dir = path.at(g.at);
    const off = new THREE.Vector3(dir.dy, 0, dir.dx).multiplyScalar(0.07);
    const gl = (t, h) => V3({ x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) }, lerp(g0, g1, t) + h).add(off);
    const frame = tint(hex(0x4a5a50), rnd, 0.1);
    const fi = solidInfo(0.5, 0.5, KIND.metal, 3);
    for (const hr of [0.12, H - 0.04]) beam(S, gl(0.03, hr), gl(0.97, hr), 0.04, 0.04, frame, fi);
    for (const t of [0.03, 0.97]) beam(S, gl(t, 0.12), gl(t, H - 0.04), 0.04, 0.04, frame, fi);
    beam(S, gl(0.03, 0.12), gl(0.97, H - 0.04), 0.03, 0.03, frame, fi);
    quad(M, gl(0.03, 0.14), gl(0.97, 0.14), gl(0.97, H - 0.06), gl(0.03, H - 0.06), [[0, 0], [g.width, 0], [g.width, H - 0.2], [0, H - 0.2]], meshCol, [0, 0, 0, 0], off);
  }
}
