import * as THREE from 'three/webgpu';
import { Frame, fbox, quad, cylinder, post, hex, solidInfo, KIND, tint, lerp } from './kit.js';
import { box as rawBox } from './shapes.js';

const UPV = new THREE.Vector3(0, 1, 0);
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const icoGeo = new THREE.IcosahedronGeometry(1, 0);

function blob(bucket, c, rx, ry, rz, color, info, rnd, rot = 0) {
  const pos = icoGeo.attributes.position;
  const jit = [];
  for (let i = 0; i < pos.count; i++) jit.push(1 + (rnd() - 0.5) * 0.18);
  const m = new THREE.Matrix4().makeRotationY(rot);
  const P = (i) => {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).multiply(new THREE.Vector3(rx, ry, rz)).multiplyScalar(jit[i]);
    return v.applyMatrix4(m).add(c);
  };
  for (let i = 0; i < pos.count; i += 3) {
    const a = P(i), b = P(i + 1), cc = P(i + 2);
    const mid = a.clone().add(b).add(cc).multiplyScalar(1 / 3).sub(c);
    bucket.face(a, b, cc, [[0, 0], [rx, 0], [0, rz]], color, { info }, mid);
  }
}

const concreteC = () => hex(0x77756e);
const concreteI = (s) => solidInfo(0.95, 0, KIND.concrete, s);

export function buildBusShelter(B, spec, heightAt, rnd) {
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const p0 = f.P(0, 0, 0);
  const g = Math.max(heightAt(p0.x, p0.z), heightAt(...(() => { const q = f.P(1.8, 0, 0.7); return [q.x, q.z]; })()), heightAt(...(() => { const q = f.P(-1.8, 0, 0.7); return [q.x, q.z]; })()));
  const S = B('solid');
  const kind = spec.variant ?? pick(rnd, ['concrete', 'concrete', 'metal']);
  const seed = rnd() * 80;
  const W = kind === 'concrete' ? 3.2 + rnd() * 0.4 : 2.6 + rnd() * 0.8;
  const D = kind === 'concrete' ? 1.5 + rnd() * 0.2 : 1.3 + rnd() * 0.2;
  const Hh = kind === 'concrete' ? 2.45 : 2.5;
  const wood = tint(hex(pick(rnd, [0x7a5a3a, 0x6a5036, 0x8a7a5c])), rnd, 0.05);
  const wi = solidInfo(0.8, 0, KIND.wood, seed);
  if (kind === 'concrete') {
    const c = tint(concreteC(), rnd, 0.05);
    const ci = concreteI(seed);
    const th = 0.1;
    fbox(S, f, 0, g - 0.05, 0, W + 0.2, 0.2, D + 0.2, c, ci);
    fbox(S, f, 0, g + 0.15, D / 2 - th / 2, W, Hh - 0.15, th, c, ci);
    for (const sx of [-1, 1]) {
      const lx = sx * (W / 2 - th / 2);
      fbox(S, f, lx, g + 0.15, 0, th, 0.95, D, c, ci);
      fbox(S, f, lx, g + 0.15 + 0.95 + 0.75, 0, th, Hh - 0.15 - 1.7, D, c, ci);
      fbox(S, f, lx, g + 0.15, -D / 2 + 0.05, th, Hh - 0.15, 0.1, c, ci);
    }
    const roofCol = tint(hex(pick(rnd, [0x4f6f8f, 0x5e7f5b, 0x7a3b2a, 0x8f8d86])), rnd, 0.05);
    rawBox(S, f.P(0, g + Hh + 0.08, 0.0), f.along.clone().multiplyScalar((W + 0.5) / 2), new THREE.Vector3(0, 0.08, 0), f.back.clone().multiplyScalar((D + 0.5) / 2), c, { info: ci }, { bottom: true });
    fbox(S, f, 0, g + Hh - 0.25, -D / 2 - 0.25 + 0.01, W + 0.5, 0.35, 0.02, roofCol, solidInfo(0.7, 0, KIND.paint, seed));
    for (const k of [0, 1, 2]) fbox(S, f, 0, g + 0.46 + 0.0, D / 2 - 0.55 + k * 0.17, W - 0.4, 0.045, 0.12, wood, wi);
    for (const sx of [-1, 1]) fbox(S, f, sx * (W / 2 - 0.5), g + 0.15, D / 2 - 0.35, 0.06, 0.32, 0.5, hex(0x3a3a38), solidInfo(0.6, 0.5, KIND.metal, seed));
  } else {
    const steel = tint(hex(pick(rnd, [0x4a5a50, 0x3a4a5a, 0x5a5a58, 0x2a3a2f])), rnd, 0.05);
    const si = solidInfo(0.55, 0.5, KIND.paint, seed);
    const gl = new THREE.Color(1, 1, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fbox(S, f, sx * W / 2, g, sz * D / 2, 0.08, Hh, 0.08, steel, si);
    rawBox(S, f.P(0, g + Hh + 0.05, 0), f.along.clone().multiplyScalar((W + 0.3) / 2), new THREE.Vector3(0, 0.04, 0), f.back.clone().multiplyScalar((D + 0.4) / 2), steel, { info: si }, { bottom: true });
    fbox(S, f, 0, g + Hh - 0.1, 0, W, 0.05, D, steel, si);
    const G = B('glass');
    const y0 = g + 0.3;
    const y1 = g + Hh - 0.1;
    const gs = rnd() * 40;
    const q = (a, b, c2, d2, dir) => quad(G, a, b, c2, d2, [[0, 0], [1, 0], [1, 1], [0, 1]], gl, [gs, 0, 0, 0], dir);
    q(f.P(-W / 2, y0, D / 2), f.P(W / 2, y0, D / 2), f.P(W / 2, y1, D / 2), f.P(-W / 2, y1, D / 2), f.out);
    q(f.P(W / 2, y0, D / 2), f.P(W / 2, y0, -D / 2), f.P(W / 2, y1, -D / 2), f.P(W / 2, y1, D / 2), f.along.clone().negate());
    q(f.P(-W / 2, y0, -D / 2), f.P(-W / 2, y0, D / 2), f.P(-W / 2, y1, D / 2), f.P(-W / 2, y1, -D / 2), f.along.clone());
    for (const t of [-0.5, 0, 0.5]) fbox(S, f, t * W, g, D / 2, 0.05, Hh, 0.05, steel, si);
    for (const k of [0, 1, 2]) fbox(S, f, 0, g + 0.46, D / 2 - 0.55 + k * 0.17, W - 0.3, 0.045, 0.12, wood, wi);
    fbox(S, f, 0, g + 0.7, D / 2 - 0.1, W - 0.3, 0.3, 0.035, wood, wi);
    for (const sx of [-1, 1]) fbox(S, f, sx * (W / 2 - 0.35), g, D / 2 - 0.4, 0.05, 0.46, 0.4, steel, si);
  }
  return { x: spec.x, y: spec.y, w: W, d: D, heading: f.heading, base: g, top: g + Hh + 0.2 };
}

export function buildWaterTower(B, spec, heightAt, rnd) {
  const x = spec.x;
  const z = -spec.y;
  const g = heightAt(x, z);
  const S = B('solid');
  const R = B('roofMetal');
  const seed = rnd() * 90;
  const H = 15 + rnd() * 9;
  const shaftR = 0.55 + rnd() * 0.15;
  const tankR = 1.65 + rnd() * 0.3;
  const tankH = 3.0 + rnd() * 1.0;
  const paint = tint(hex(pick(rnd, [0xb9bec0, 0x8a959c, 0x7a8a7a, 0x7a3b2a, 0xa9a69c])), rnd, 0.04);
  const rust = rnd() < 0.5;
  const pcol = rust ? tint(hex(0x6b5042), rnd, 0.08) : paint;
  const mi = solidInfo(0.6, 0.35, KIND.metal, seed);
  const base = new THREE.Vector3(x, g, z);
  cylinder(S, base.clone().add(new THREE.Vector3(0, -0.3, 0)), base.clone().add(new THREE.Vector3(0, 0.35, 0)), shaftR + 0.45, shaftR + 0.4, 12, concreteC(), concreteI(seed), { capTop: true });
  const topShaft = H - 1.5;
  cylinder(R, base.clone().add(new THREE.Vector3(0, 0.3, 0)), base.clone().add(new THREE.Vector3(0, topShaft, 0)), shaftR, shaftR * 0.92, 14, pcol, [seed, 0.1, 0, 0.5], { capTop: false });
  for (let h = 3; h < topShaft; h += 3) {
    const r = shaftR * lerp(1, 0.92, h / topShaft) + 0.012;
    cylinder(S, base.clone().add(new THREE.Vector3(0, h, 0)), base.clone().add(new THREE.Vector3(0, h + 0.06, 0)), r, r, 14, pcol.clone().multiplyScalar(0.85), mi, { capTop: false });
  }
  cylinder(S, base.clone().add(new THREE.Vector3(0, topShaft, 0)), base.clone().add(new THREE.Vector3(0, H, 0)), shaftR * 0.92, tankR, 14, pcol, mi, { capTop: false });
  cylinder(R, base.clone().add(new THREE.Vector3(0, H, 0)), base.clone().add(new THREE.Vector3(0, H + tankH, 0)), tankR, tankR, 16, pcol, [seed + 1, 0.15, 0, 0.5], { capTop: false, capBottom: false });
  cylinder(S, base.clone().add(new THREE.Vector3(0, H + tankH, 0)), base.clone().add(new THREE.Vector3(0, H + tankH + 1.0, 0)), tankR + 0.05, 0.25, 16, pcol.clone().multiplyScalar(0.9), mi, { capTop: true });
  cylinder(S, base.clone().add(new THREE.Vector3(0, H + tankH + 1.0, 0)), base.clone().add(new THREE.Vector3(0, H + tankH + 1.35, 0)), 0.3, 0.3, 8, pcol.clone().multiplyScalar(0.8), mi, { capTop: true });
  const rail = hex(0x4a4a48);
  const ri = solidInfo(0.5, 0.6, KIND.metal, seed);
  const walkR = tankR + 0.7;
  cylinder(S, base.clone().add(new THREE.Vector3(0, H + 0.1, 0)), base.clone().add(new THREE.Vector3(0, H + 0.14, 0)), walkR, walkR, 16, rail, ri, { capTop: true, capBottom: true });
  const posts = 16;
  for (let i = 0; i < posts; i++) {
    const t = (i / posts) * Math.PI * 2;
    const px = x + Math.cos(t) * walkR;
    const pz = z + Math.sin(t) * walkR;
    post(S, px, g + H + 0.14, pz, 0.016, 1.0, 4, rail, ri, { capTop: true });
  }
  for (let i = 0; i < posts; i++) {
    const t0 = (i / posts) * Math.PI * 2;
    const t1 = ((i + 1) / posts) * Math.PI * 2;
    const a = new THREE.Vector3(x + Math.cos(t0) * walkR, g + H + 1.14, z + Math.sin(t0) * walkR);
    const b = new THREE.Vector3(x + Math.cos(t1) * walkR, g + H + 1.14, z + Math.sin(t1) * walkR);
    cylinder(S, a, b, 0.014, 0.014, 4, rail, ri, { capTop: false });
  }
  const ang = rnd() * Math.PI * 2;
  const dirx = Math.cos(ang);
  const dirz = Math.sin(ang);
  const lad = new THREE.Vector3(dirz, 0, -dirx);
  const lr = shaftR + 0.04;
  const l0 = new THREE.Vector3(x + dirx * lr, 0, z + dirz * lr);
  for (const s of [-0.2, 0.2]) {
    const a = l0.clone().addScaledVector(lad, s).setY(g + 0.3);
    const b = l0.clone().addScaledVector(lad, s).addScaledVector(new THREE.Vector3(dirx, 0, dirz), (tankR - shaftR) * 0.2).setY(g + H + 0.4);
    cylinder(S, a, b, 0.016, 0.016, 4, rail, ri, { capTop: false });
  }
  const rungs = Math.floor((H - 0.2) / 0.3);
  for (let i = 0; i < rungs; i++) {
    const h = 0.5 + i * 0.3;
    const rr = lr + (i * 0.3 / H) * (tankR - shaftR) * 0.2;
    const c = new THREE.Vector3(x + dirx * rr, g + h, z + dirz * rr);
    cylinder(S, c.clone().addScaledVector(lad, -0.2), c.clone().addScaledVector(lad, 0.2), 0.011, 0.011, 4, rail, ri, { capTop: false });
  }
  cylinder(S, base.clone().add(new THREE.Vector3(shaftR * 0.4, 0.2, shaftR * 0.7)), base.clone().add(new THREE.Vector3(shaftR * 0.4, 1.2, shaftR * 0.7)), 0.08, 0.08, 6, hex(0x3a4a5a), ri, { capTop: true });
  return { x: spec.x, y: spec.y, cyl: true, r: shaftR + 0.4, base: g, top: g + H + tankH + 1.3 };
}

export function buildSilo(B, spec, heightAt, rnd) {
  const x = spec.x;
  const z = -spec.y;
  const g = heightAt(x, z);
  const S = B('solid');
  const R = B('roofMetal');
  const seed = rnd() * 90;
  const tall = rnd() < 0.5;
  const r = tall ? 1.8 + rnd() * 0.5 : 2.6 + rnd() * 0.9;
  const h = tall ? 9 + rnd() * 4 : 5 + rnd() * 2.5;
  const legs = tall ? 0.9 : 0.5;
  const steel = tint(hex(pick(rnd, [0x9aa0a2, 0x8c9496, 0xa5a8a4])), rnd, 0.03);
  const mi = solidInfo(0.5, 0.4, KIND.metal, seed);
  const base = new THREE.Vector3(x, g, z);
  cylinder(S, base.clone().add(new THREE.Vector3(0, -0.25, 0)), base.clone().add(new THREE.Vector3(0, 0.12, 0)), r + 0.15, r + 0.1, 16, concreteC(), concreteI(seed), { capTop: true });
  cylinder(R, base.clone().add(new THREE.Vector3(0, legs, 0)), base.clone().add(new THREE.Vector3(0, h, 0)), r, r, 20, steel, [seed, 0.1, 0, 0.35], { capTop: false });
  if (tall) {
    cylinder(S, base.clone().add(new THREE.Vector3(0, 0.15, 0)), base.clone().add(new THREE.Vector3(0, legs, 0)), 0.3, r, 16, steel.clone().multiplyScalar(0.9), mi, { capTop: false });
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
      cylinder(S, new THREE.Vector3(x + Math.cos(t) * (r - 0.1), g, z + Math.sin(t) * (r - 0.1)), new THREE.Vector3(x + Math.cos(t) * (r - 0.1), g + legs + 0.3, z + Math.sin(t) * (r - 0.1)), 0.07, 0.07, 6, hex(0x5a5a58), mi, {});
    }
  }
  cylinder(S, base.clone().add(new THREE.Vector3(0, h, 0)), base.clone().add(new THREE.Vector3(0, h + r * 0.38, 0)), r + 0.1, 0.22, 20, steel.clone().multiplyScalar(0.95), mi, { capTop: true });
  cylinder(S, base.clone().add(new THREE.Vector3(0, h + r * 0.38, 0)), base.clone().add(new THREE.Vector3(0, h + r * 0.38 + 0.25, 0)), 0.3, 0.3, 8, steel, mi, { capTop: true });
  const ang = rnd() * Math.PI * 2;
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const lad = new THREE.Vector3(dz, 0, -dx);
  const ri = solidInfo(0.5, 0.6, KIND.metal, seed);
  const rail = hex(0x5a5a58);
  for (const s of [-0.2, 0.2]) {
    const a = new THREE.Vector3(x + dx * (r + 0.1), g + 0.3, z + dz * (r + 0.1)).addScaledVector(lad, s);
    const b = new THREE.Vector3(x + dx * (r + 0.1), g + h + 0.4, z + dz * (r + 0.1)).addScaledVector(lad, s);
    cylinder(S, a, b, 0.015, 0.015, 4, rail, ri, { capTop: false });
  }
  for (let i = 0; i < Math.floor(h / 0.3); i++) {
    const c = new THREE.Vector3(x + dx * (r + 0.1), g + 0.5 + i * 0.3, z + dz * (r + 0.1));
    cylinder(S, c.clone().addScaledVector(lad, -0.2), c.clone().addScaledVector(lad, 0.2), 0.01, 0.01, 4, rail, ri, { capTop: false });
  }
  return { x: spec.x, y: spec.y, cyl: true, r: r + 0.1, base: g, top: g + h + r * 0.4 };
}

export function buildWoodPile(B, spec, heightAt, rnd) {
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const S = B('solid');
  const seed = rnd() * 80;
  const L = 2.0 + rnd() * 2.5;
  const Hh = 0.9 + rnd() * 0.5;
  const D = 0.33 + (rnd() < 0.5 ? 0 : 0.33);
  const g = Math.max(...[[-L / 2, 0], [L / 2, 0], [0, 0]].map(([a, b]) => { const p = f.P(a, 0, b); return heightAt(p.x, p.z); }));
  const bark = tint(hex(pick(rnd, [0x6a5238, 0x7a6244, 0x5a4630])), rnd, 0.06);
  const endC = tint(hex(pick(rnd, [0xa98558, 0xb59a6a, 0x9a7a4a])), rnd, 0.06);
  fbox(S, f, 0, g, 0, L + 0.1, 0.1, D + 0.15, hex(0x6a5a46), solidInfo(0.9, 0, KIND.wood, seed));
  const y0 = g + 0.1;
  const front = new THREE.Vector3().copy(f.out);
  const ci = [0.88, 0, 9, seed];
  const a = f.P(-L / 2, y0, -D / 2);
  const b = f.P(L / 2, y0, -D / 2);
  const c = f.P(L / 2, y0 + Hh, -D / 2);
  const d = f.P(-L / 2, y0 + Hh, -D / 2);
  quad(B('logs'), a, b, c, d, [[0, 0], [L, 0], [L, Hh], [0, Hh]], endC, ci, front);
  const a2 = f.P(-L / 2, y0, D / 2);
  const b2 = f.P(L / 2, y0, D / 2);
  const c2 = f.P(L / 2, y0 + Hh, D / 2);
  const d2 = f.P(-L / 2, y0 + Hh, D / 2);
  quad(B('logs'), a2, b2, c2, d2, [[0, 0], [L, 0], [L, Hh], [0, Hh]], endC, ci, front.clone().negate());
  const bi = solidInfo(0.95, 0, KIND.wood, seed);
  quad(S, d, c, c2, d2, [[0, 0], [L, 0], [L, D], [0, D]], bark, bi, UPV);
  quad(S, a, d, d2, a2, [[0, 0], [Hh, 0], [Hh, D], [0, D]], bark, bi, f.along.clone().negate());
  quad(S, b, c, c2, b2, [[0, 0], [Hh, 0], [Hh, D], [0, D]], bark, bi, f.along.clone());
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(S, ...(() => { const p = f.P(sx * (L / 2 + 0.05), 0, sz * (D / 2 + 0.04)); return [p.x, g, p.z]; })(), 0.04, Hh + 0.2, 5, hex(0x5a4630), bi, {});
  const cx = rnd() < 0.5 ? -L / 2 - 0.8 : L / 2 + 0.8;
  const p = f.P(cx, 0, -D / 2 - 0.9);
  const gb = heightAt(p.x, p.z);
  cylinder(S, new THREE.Vector3(p.x, gb - 0.05, p.z), new THREE.Vector3(p.x, gb + 0.42, p.z), 0.24, 0.23, 9, bark, bi, { capTop: true });
  for (let i = 0; i < 6; i++) {
    const q = f.P(cx + (rnd() - 0.5) * 1.4, 0, -D / 2 - 0.9 + (rnd() - 0.5) * 1.2);
    const gq = heightAt(q.x, q.z);
    const ang = rnd() * Math.PI;
    const dxx = Math.cos(ang) * 0.17;
    const dzz = Math.sin(ang) * 0.17;
    cylinder(S, new THREE.Vector3(q.x - dxx, gq + 0.06, q.z - dzz), new THREE.Vector3(q.x + dxx, gq + 0.06, q.z + dzz), 0.06, 0.06, 5, endC, bi, { capTop: true, capBottom: true });
  }
  return { x: spec.x, y: spec.y, w: L, d: D + 0.2, heading: f.heading, base: g, top: g + Hh + 0.1 };
}

export function buildWell(B, spec, heightAt, rnd) {
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const S = B('solid');
  const p0 = f.P(0, 0, 0);
  const g = heightAt(p0.x, p0.z);
  const seed = rnd() * 80;
  const wood = tint(hex(pick(rnd, [0x6f6455, 0x7a6a56, 0x5f5547])), rnd, 0.06);
  const wi = solidInfo(0.9, 0, KIND.wood, seed);
  const kind = spec.variant ?? (rnd() < 0.65 ? 'sweep' : 'culvert');
  if (kind === 'sweep') {
    const c = new THREE.Vector3(p0.x, g, p0.z);
    for (let i = 0; i < 4; i++) {
      fbox(S, f, 0, g + i * 0.2, 0, i % 2 ? 1.0 : 1.3, 0.2, i % 2 ? 1.3 : 1.0, wood, wi);
    }
    fbox(S, f, 0, g + 0.8, 0, 0.7, 0.01, 0.7, hex(0x080806), solidInfo(1, 0, KIND.plain, 0));
    const Hp = 4.2 + rnd() * 0.6;
    for (const sz of [-1, 1]) {
      const bottom = f.P(0.0, g - 0.2, sz * 0.9);
      const top = f.P(0.0, g + Hp, sz * 0.12);
      cylinder(S, new THREE.Vector3(bottom.x, g - 0.4, bottom.z), new THREE.Vector3(top.x, g + Hp, top.z), 0.1, 0.075, 6, wood, wi, { capTop: true });
    }
    const sweepLen = 6.2 + rnd() * 1.2;
    const pivot = f.P(0, g + Hp - 0.1, 0);
    const tilt = 0.28 + rnd() * 0.1;
    const dirv = f.out.clone().multiplyScalar(Math.cos(tilt)).add(new THREE.Vector3(0, -Math.sin(tilt) * 0.3, 0)).normalize();
    const long = sweepLen * 0.72;
    const tip = pivot.clone().addScaledVector(dirv, long);
    const tail = pivot.clone().addScaledVector(dirv, -(sweepLen - long));
    cylinder(S, tail, tip, 0.11, 0.045, 6, wood, wi, { capTop: true, capBottom: true });
    cylinder(S, pivot.clone().addScaledVector(f.along, -0.2), pivot.clone().addScaledVector(f.along, 0.2), 0.04, 0.04, 6, hex(0x3a3a38), solidInfo(0.5, 0.6, KIND.metal, 1), {});
    blob(S, tail.clone().add(new THREE.Vector3(0, -0.4, 0)), 0.3, 0.26, 0.3, hex(0x6a6862), concreteI(seed), rnd);
    const rodTop = tip.clone();
    const bucketTop = new THREE.Vector3(rodTop.x, Math.max(g + 1.1, rodTop.y - 3.3), rodTop.z);
    cylinder(S, bucketTop, rodTop, 0.012, 0.012, 4, hex(0x3a3a38), solidInfo(0.5, 0.7, KIND.metal, 1), { capTop: false });
    cylinder(S, bucketTop.clone().add(new THREE.Vector3(0, -0.28, 0)), bucketTop, 0.14, 0.16, 8, hex(0x7a7a76), solidInfo(0.5, 0.5, KIND.metal, 2), { capTop: false, capBottom: true });
    void c;
    return { x: spec.x, y: spec.y, w: 1.3, d: 1.3, heading: f.heading, base: g, top: g + 0.8 };
  }
  const base = new THREE.Vector3(p0.x, g, p0.z);
  for (let i = 0; i < 2; i++) {
    const y = g + i * 0.5;
    cylinder(S, new THREE.Vector3(base.x, y, base.z), new THREE.Vector3(base.x, y + 0.5, base.z), 0.62, 0.62, 12, concreteC(), concreteI(seed + i), { capTop: i === 1 });
  }
  cylinder(S, new THREE.Vector3(base.x, g + 0.96, base.z), new THREE.Vector3(base.x, g + 0.97, base.z), 0.45, 0.45, 12, hex(0x060606), solidInfo(1, 0, KIND.plain, 0), { capTop: true });
  const postH = 1.5;
  for (const sx of [-1, 1]) fbox(S, f, sx * 0.7, g, 0, 0.1, postH + 0.5, 0.1, wood, wi);
  fbox(S, f, 0, g + postH + 0.4, 0, 1.7, 0.08, 0.1, wood, wi);
  for (const s of [-1, 1]) {
    const a = f.P(-0.95, g + postH + 0.95, 0);
    void a;
    rawBox(S, f.P(0, g + postH + 0.8, s * 0.3), f.along.clone().multiplyScalar(0.95), new THREE.Vector3(0, 0.02, 0).addScaledVector(f.back, s * 0.2), f.back.clone().multiplyScalar(s * 0.35).add(new THREE.Vector3(0, -0.3 * 0, 0)), wood, { info: wi }, {});
  }
  cylinder(S, f.P(-0.6, g + postH + 0.15, 0), f.P(0.7, g + postH + 0.15, 0), 0.06, 0.06, 6, wood, wi, {});
  return { x: spec.x, y: spec.y, cyl: true, r: 0.7, base: g, top: g + 1.0 };
}

export function buildBench(B, spec, heightAt, rnd) {
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const S = B('solid');
  const p = f.P(0, 0, 0);
  const g = Math.max(heightAt(p.x, p.z), ...[-0.8, 0.8].map((a) => { const q = f.P(a, 0, 0); return heightAt(q.x, q.z); }));
  const seed = rnd() * 80;
  const L = 1.4 + rnd() * 0.5;
  const painted = rnd() < 0.4;
  const col = painted ? tint(hex(pick(rnd, [0x5e7f5b, 0x6c8fae, 0xe3e0d6, 0x7a3b2a])), rnd, 0.04) : tint(hex(pick(rnd, [0x7a6a56, 0x8a7a5c, 0x6a5036])), rnd, 0.06);
  const info = solidInfo(0.82, 0, painted ? KIND.paint : KIND.wood, seed);
  const legs = rnd() < 0.5 ? 'concrete' : 'wood';
  const lc = legs === 'concrete' ? concreteC() : col.clone().multiplyScalar(0.8);
  const li = legs === 'concrete' ? concreteI(seed) : info;
  for (const sx of [-1, 1]) {
    fbox(S, f, sx * (L / 2 - 0.2), g - 0.03, 0, 0.1, 0.46, 0.4, lc, li);
    fbox(S, f, sx * (L / 2 - 0.2), g + 0.4, 0.2, 0.08, 0.45, 0.08, lc, li);
  }
  for (const k of [0, 1]) fbox(S, f, 0, g + 0.43, -0.12 + k * 0.19, L, 0.04, 0.15, col, info);
  for (const k of [0, 1]) fbox(S, f, 0, g + 0.62 + k * 0.17, 0.22, L, 0.04, 0.13, col, info);
  return { x: spec.x, y: spec.y, w: L, d: 0.5, heading: f.heading, base: g, top: g + 0.9 };
}

export function buildMailbox(B, spec, heightAt, rnd) {
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const S = B('solid');
  const p = f.P(0, 0, 0);
  const g = heightAt(p.x, p.z);
  const seed = rnd() * 80;
  const body = tint(hex(pick(rnd, [0xa82e22, 0x3a5a8a, 0xc4a02a, 0x5a7a4a, 0x8c9092])), rnd, 0.05);
  const mi = solidInfo(0.5, 0.45, KIND.paint, seed);
  const wood = tint(hex(0x6f6455), rnd, 0.08);
  const wi = solidInfo(0.9, 0, KIND.wood, seed);
  fbox(S, f, 0, g - 0.2, 0, 0.09, 1.35, 0.09, wood, wi);
  fbox(S, f, 0, g + 1.15, 0, 0.36, 0.26, 0.14, body, mi);
  fbox(S, f, 0, g + 1.41, 0.0, 0.34, 0.015, 0.16, body.clone().multiplyScalar(0.8), mi);
  fbox(S, f, 0, g + 1.3, -0.075, 0.2, 0.02, 0.01, hex(0x0e0e0e), solidInfo(1, 0, KIND.plain, 0));
  return { x: spec.x, y: spec.y, w: 0.2, d: 0.2, heading: f.heading, base: g, top: g + 1.45 };
}

export function buildGarden(B, spec, heightAt, rnd) {
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const S = B('organic');
  const D = B('decal');
  const W = 6 + rnd() * 5;
  const L = 8 + rnd() * 6;
  const seed = rnd() * 80;
  const pitch = 0.62 + rnd() * 0.2;
  const rows = Math.floor(W / pitch);
  const soil = tint(hex(0x2f2418), rnd, 0.1);
  const soilI = solidInfo(1, 0, KIND.soil, seed);
  const leafG = tint(hex(pick(rnd, [0x4a6a30, 0x5a7a3a, 0x6a7a30])), rnd, 0.1);
  const leafI = solidInfo(0.85, 0, KIND.veg, seed);
  const dry = tint(hex(0x8a7a4a), rnd, 0.1);
  const n = 6;
  const gx = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const q = f.P((i / n - 0.5) * (W + 1.2), 0, (j / n - 0.5) * (L + 1.2));
      gx.push(new THREE.Vector3(q.x, heightAt(q.x, q.z) + 0.03, q.z));
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = gx[i * (n + 1) + j], b = gx[(i + 1) * (n + 1) + j], c = gx[(i + 1) * (n + 1) + j + 1], d = gx[i * (n + 1) + j + 1];
      D.quad(a, b, c, d, [[i / n, j / n], [(i + 1) / n, j / n], [(i + 1) / n, (j + 1) / n], [i / n, (j + 1) / n]], soil, { info: [seed, 2, 0, 0] }, UPV);
    }
  }
  let gMax = 0;
  for (let r = 0; r < rows; r++) {
    const lx = (r - (rows - 1) / 2) * pitch;
    const crop = pick(rnd, ['nu', 'apples', 'cabbages', 'beets', 'nu', 'beans', 'maize']);
    const segs = Math.ceil(L / 3);
    for (let k = 0; k < segs; k++) {
      const z0 = -L / 2 + (L * k) / segs;
      const z1 = -L / 2 + (L * (k + 1)) / segs;
      const q0 = f.P(lx, 0, z0);
      const q1 = f.P(lx, 0, z1);
      const g0 = heightAt(q0.x, q0.z);
      const g1 = heightAt(q1.x, q1.z);
      const hh = crop === 'apples' ? 0.2 : 0.14;
      const w2 = 0.24;
      const A = (q, g, s) => new THREE.Vector3(q.x, g + 0.02, q.z).addScaledVector(f.along, s * w2);
      const T = (q, g) => new THREE.Vector3(q.x, g + 0.02 + hh, q.z);
      for (const s of [-1, 1]) quad(S, A(q0, g0, s), A(q1, g1, s), T(q1, g1), T(q0, g0), [[0, 0], [z1 - z0, 0], [z1 - z0, 0.25], [0, 0.25]], soil, soilI, f.along.clone().multiplyScalar(s).add(UPV));
      gMax = Math.max(gMax, g0, g1);
      if (crop === 'apples' || crop === 'beets') {
        const hv = crop === 'apples' ? 0.28 : 0.22;
        for (const s of [-1, 1]) quad(S, new THREE.Vector3(q0.x, g0 + 0.1, q0.z).addScaledVector(f.along, s * 0.3), new THREE.Vector3(q1.x, g1 + 0.1, q1.z).addScaledVector(f.along, s * 0.3), new THREE.Vector3(q1.x, g1 + 0.1 + hv, q1.z).addScaledVector(f.along, s * 0.1), new THREE.Vector3(q0.x, g0 + 0.1 + hv, q0.z).addScaledVector(f.along, s * 0.1), [[0, 0], [2, 0], [2, 0.3], [0, 0.3]], rnd() < 0.3 ? dry : leafG, leafI, f.along.clone().multiplyScalar(s).add(UPV));
      } else if (crop === 'cabbages') {
        for (let c = 0; c < 3; c++) {
          const t = (c + 0.5) / 3;
          const q = f.P(lx, 0, lerp(z0, z1, t));
          blob(S, new THREE.Vector3(q.x, heightAt(q.x, q.z) + 0.2, q.z), 0.2, 0.15, 0.2, rnd() < 0.5 ? leafG : tint(hex(0x6a8a5a), rnd, 0.08), leafI, rnd);
        }
      } else if (crop === 'maize') {
        for (let c = 0; c < 4; c++) {
          const q = f.P(lx + (rnd() - 0.5) * 0.1, 0, lerp(z0, z1, (c + 0.5) / 4));
          const g = heightAt(q.x, q.z);
          cylinder(S, new THREE.Vector3(q.x, g, q.z), new THREE.Vector3(q.x + (rnd() - 0.5) * 0.2, g + 1.7 + rnd() * 0.5, q.z + (rnd() - 0.5) * 0.2), 0.012, 0.006, 3, dry, leafI, { capTop: false });
        }
      } else if (crop === 'beans' && k % 2 === 0) {
        const q = f.P(lx, 0, (z0 + z1) / 2);
        const g = heightAt(q.x, q.z);
        for (let c = 0; c < 3; c++) {
          const a = (c / 3) * Math.PI * 2;
          cylinder(S, new THREE.Vector3(q.x + Math.cos(a) * 0.35, g, q.z + Math.sin(a) * 0.35), new THREE.Vector3(q.x, g + 1.9, q.z), 0.014, 0.01, 3, hex(0x6a5a40), solidInfo(0.9, 0, KIND.wood, 1), { capTop: false });
        }
        cylinder(S, new THREE.Vector3(q.x, g + 0.1, q.z), new THREE.Vector3(q.x, g + 1.5, q.z), 0.2, 0.05, 5, leafG, leafI, { capTop: false });
      }
    }
  }
  return { x: spec.x, y: spec.y, w: W, d: L, heading: f.heading, base: gMax, top: gMax, ground: true };
}
