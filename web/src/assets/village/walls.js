import * as THREE from 'three/webgpu';
import { quad, tri, cylinder, hex, solidInfo, KIND, boxSkip } from './kit.js';
import { box as rawBox } from './shapes.js';

const UPV = new THREE.Vector3(0, 1, 0);

export function makeWall(f, which, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  const defs = {
    front: [f.P(-hw, 0, -hd), f.along, f.out, w],
    right: [f.P(hw, 0, -hd), f.back, f.along, d],
    back: [f.P(hw, 0, hd), f.along.clone().negate(), f.back, w],
    left: [f.P(-hw, 0, hd), f.back.clone().negate(), f.along.clone().negate(), d],
  };
  const [start, dir, out, len] = defs[which];
  return {
    which, start, dir, out, len,
    P: (u, h) => start.clone().addScaledVector(dir, u).setY(h),
  };
}

export function wallBox(bucket, wall, u0, h0, su, sh, o0, o1, color, info) {
  const c = wall.P(u0 + su / 2, h0 + sh / 2).addScaledVector(wall.out, (o0 + o1) / 2);
  boxSkip(bucket, c, wall.dir.clone().multiplyScalar(su / 2), new THREE.Vector3(0, sh / 2, 0), wall.out.clone().multiplyScalar(Math.abs(o1 - o0) / 2), color, { info }, { vOffset: h0 + sh / 2, skip: o0 >= -0.001 ? wall.out.clone().negate() : null });
}

export function buildWall(wall, floorY, topH, openings, thick, bucket, color, info) {
  const ops = openings.slice().sort((a, b) => a.u0 - b.u0);
  const H = topH - floorY;
  const piece = (u0, u1, h0, h1) => {
    if (u1 - u0 < 1e-3 || h1 - h0 < 1e-3) return;
    quad(bucket, wall.P(u0, floorY + h0), wall.P(u1, floorY + h0), wall.P(u1, floorY + h1), wall.P(u0, floorY + h1),
      [[u0, h0], [u1, h0], [u1, h1], [u0, h1]], color, info, wall.out);
  };
  let u = 0;
  for (const o of ops) {
    piece(u, o.u0, 0, H);
    piece(o.u0, o.u1, 0, o.h0);
    piece(o.u0, o.u1, o.h1, H);
    u = o.u1;
    const back = wall.out.clone().multiplyScalar(-thick);
    const A = (uu, hh) => wall.P(uu, floorY + hh);
    const B = (uu, hh) => wall.P(uu, floorY + hh).add(back);
    quad(bucket, A(o.u0, o.h0), B(o.u0, o.h0), B(o.u0, o.h1), A(o.u0, o.h1), [[0, o.h0], [thick, o.h0], [thick, o.h1], [0, o.h1]], color, info, wall.dir);
    quad(bucket, A(o.u1, o.h0), B(o.u1, o.h0), B(o.u1, o.h1), A(o.u1, o.h1), [[0, o.h0], [thick, o.h0], [thick, o.h1], [0, o.h1]], color, info, wall.dir.clone().negate());
    quad(bucket, A(o.u0, o.h1), B(o.u0, o.h1), B(o.u1, o.h1), A(o.u1, o.h1), [[o.u0, 0], [o.u0, thick], [o.u1, thick], [o.u1, 0]], color, info, new THREE.Vector3(0, -1, 0));
    if (o.h0 > 0.05) quad(bucket, A(o.u0, o.h0), B(o.u0, o.h0), B(o.u1, o.h0), A(o.u1, o.h0), [[o.u0, 0], [o.u0, thick], [o.u1, thick], [o.u1, 0]], color, info, UPV);
  }
  piece(u, wall.len, 0, H);
}

export function buildGable(wall, floorY, topH, ridgeH, bucket, color, info) {
  const mid = wall.len / 2;
  tri(bucket, wall.P(0, topH), wall.P(wall.len, topH), wall.P(mid, ridgeH),
    [[0, topH - floorY], [wall.len, topH - floorY], [mid, ridgeH - floorY]], color, info, wall.out);
}

export function buildPlinth(bucket, f, w, d, floorY, heightAt, color, info, grow = 0.02) {
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 1.2));
    const outDir = new THREE.Vector3().addScaledVector(f.along, bz - az).addScaledVector(f.back, -(bx - ax)).normalize();
    const side = new THREE.Vector3().addScaledVector(f.along, bx - ax).addScaledVector(f.back, bz - az);
    const out = new THREE.Vector3().crossVectors(side, UPV).normalize();
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const mk = (t, lift) => {
        const lx = ax + (bx - ax) * t;
        const lz = az + (bz - az) * t;
        const p = f.P(lx, 0, lz);
        const g = heightAt(p.x, p.z);
        return f.P(lx, lift ? floorY : g - 0.25, lz).addScaledVector(out, grow);
      };
      const hb = (t) => {
        const p = f.P(ax + (bx - ax) * t, 0, az + (bz - az) * t);
        return heightAt(p.x, p.z) - 0.25;
      };
      quad(bucket, mk(t0, false), mk(t1, false), mk(t1, true), mk(t0, true),
        [[t0 * len, 0], [t1 * len, 0], [t1 * len, floorY - hb(t1)], [t0 * len, floorY - hb(t0)]], color, info, out);
    }
    void outDir;
  }
}

export function buildWindow(B, wall, floorY, o, opt, rnd) {
  const { frameColor, glassSeed, curtain, thick, sill = true } = opt;
  const w = o.u1 - o.u0;
  const h = o.h1 - o.h0;
  const hb = floorY + o.h0;
  const inset = thick * 0.55;
  const A = (u, hh, inset) => wall.P(u, hh).addScaledVector(wall.out, -inset);
  quad(B('glass'), A(o.u0, hb, inset), A(o.u1, hb, inset), A(o.u1, hb + h, inset), A(o.u0, hb + h, inset),
    [[0, 0], [1, 0], [1, 1], [0, 1]], new THREE.Color(1, 1, 1), [glassSeed, curtain, 0, 0], wall.out);
  const bar = 0.05;
  const paint = solidInfo(0.6, 0, KIND.paint, glassSeed);
  const S = B('solid');
  const inset0 = -inset - 0.02;
  const inset1 = -inset + 0.045;
  wallBox(S, wall, o.u0, hb, bar, h, inset0, inset1, frameColor, paint);
  wallBox(S, wall, o.u1 - bar, hb, bar, h, inset0, inset1, frameColor, paint);
  wallBox(S, wall, o.u0, hb, w, bar, inset0, inset1, frameColor, paint);
  wallBox(S, wall, o.u0, hb + h - bar, w, bar, inset0, inset1, frameColor, paint);
  wallBox(S, wall, o.u0 + w / 2 - bar / 2, hb, bar, h, inset0, inset1 + 0.01, frameColor, paint);
  if (h > 1.05) wallBox(S, wall, o.u0, hb + h * 0.68, w, bar * 0.8, inset0, inset1 + 0.005, frameColor, paint);
  if (sill) wallBox(S, wall, o.u0 - 0.04, hb - 0.05, w + 0.08, 0.05, -inset - 0.02, 0.08, frameColor, paint);
}

export function buildSurround(B, wall, floorY, o, color, style, seed, maxTop = Infinity) {
  const S = B('solid');
  const info = solidInfo(0.65, 0, KIND.paint, seed);
  const hb = floorY + o.h0;
  const w = o.u1 - o.u0;
  const h = o.h1 - o.h0;
  const bw = 0.11;
  const th = 0.025;
  wallBox(S, wall, o.u0 - bw, hb - 0.02, bw, h + bw + 0.02, 0, th, color, info);
  wallBox(S, wall, o.u1, hb - 0.02, bw, h + bw + 0.02, 0, th, color, info);
  wallBox(S, wall, o.u0 - bw, hb + h, w + 2 * bw, bw, 0, th + 0.01, color, info);
  if (style === 'crown' && hb + h + bw + 0.28 < maxTop) {
    const base = hb + h + bw;
    const c0 = wall.P(o.u0 - bw - 0.06, base).addScaledVector(wall.out, th + 0.01);
    const c1 = wall.P(o.u1 + bw + 0.06, base).addScaledVector(wall.out, th + 0.01);
    const c2 = wall.P((o.u0 + o.u1) / 2, base + 0.26).addScaledVector(wall.out, th + 0.01);
    tri(S, c0, c1, c2, [[0, 0], [1, 0], [0.5, 0.3]], color, info, wall.out);
    wallBox(S, wall, o.u0 - bw, hb - 0.2, w + 2 * bw, 0.14, 0, th, color, info);
    const teeth = Math.max(4, Math.round((w + 2 * bw) / 0.1));
    for (let i = 0; i < teeth; i++) {
      const u = o.u0 - bw + ((i + 0.5) / teeth) * (w + 2 * bw);
      const dw = (w + 2 * bw) / teeth / 2;
      const a = wall.P(u - dw, hb - 0.2).addScaledVector(wall.out, th);
      const b = wall.P(u + dw, hb - 0.2).addScaledVector(wall.out, th);
      const c = wall.P(u, hb - 0.3).addScaledVector(wall.out, th);
      tri(S, a, b, c, [[0, 0], [1, 0], [0.5, -1]], color, info, wall.out);
    }
  }
}

export function buildShutters(B, wall, floorY, o, color, seed) {
  const info = solidInfo(0.75, 0, KIND.wood, seed);
  const w = (o.u1 - o.u0) / 2 - 0.01;
  const hb = floorY + o.h0 - 0.02;
  const S = B('solid');
  wallBox(S, wall, o.u0 - w - 0.12, hb, w, o.h1 - o.h0 + 0.04, 0, 0.03, color, info);
  wallBox(S, wall, o.u1 + 0.12, hb, w, o.h1 - o.h0 + 0.04, 0, 0.03, color, info);
}

export function buildDoor(B, wall, floorY, o, color, seed, thick) {
  const S = B('solid');
  const info = solidInfo(0.7, 0, KIND.wood, seed);
  const inset = thick * 0.6;
  wallBox(S, wall, o.u0, floorY + o.h0, o.u1 - o.u0, o.h1 - o.h0 - 0.02, -inset - 0.04, -inset, color, info);
  const frame = hex(0x4a3a2a);
  wallBox(S, wall, o.u0 - 0.04, floorY + o.h0, 0.05, o.h1 - o.h0 + 0.04, -inset - 0.04, 0.03, frame, info);
  wallBox(S, wall, o.u1 - 0.01, floorY + o.h0, 0.05, o.h1 - o.h0 + 0.04, -inset - 0.04, 0.03, frame, info);
  wallBox(S, wall, o.u0 - 0.04, floorY + o.h1 - 0.02, o.u1 - o.u0 + 0.08, 0.06, -inset - 0.04, 0.03, frame, info);
  wallBox(S, wall, o.u1 - 0.18, floorY + 1.0, 0.1, 0.03, -inset, -inset + 0.05, hex(0x2c2c2c), solidInfo(0.4, 0.8, KIND.metal, seed));
}

export function buildRoof(B, f, w, d, eaveH, pitchDeg, ridgeAlongWidth, overEave, overGable, roofBucket, roofColor, roofInfo, trim) {
  const tan = Math.tan((pitchDeg * Math.PI) / 180);
  const half = (ridgeAlongWidth ? d : w) / 2;
  const len = ridgeAlongWidth ? w : d;
  const ridgeH = eaveH + half * tan;
  const eaveOut = half + overEave;
  const eaveLow = eaveH - overEave * tan;
  const pt = (a, c, h) => (ridgeAlongWidth ? f.P(a, h, c) : f.P(c, h, a));
  const a0 = -len / 2 - overGable;
  const a1 = len / 2 + overGable;
  const slopeLen = Math.hypot(eaveOut, ridgeH - eaveLow);
  for (const s of [-1, 1]) {
    const E0 = pt(a0, s * eaveOut, eaveLow);
    const E1 = pt(a1, s * eaveOut, eaveLow);
    const R0 = pt(a0, 0, ridgeH);
    const R1 = pt(a1, 0, ridgeH);
    const n = new THREE.Vector3().subVectors(E1, E0).cross(new THREE.Vector3().subVectors(R0, E0));
    if (n.y < 0) n.negate();
    quad(roofBucket, E0, E1, R1, R0, [[0, 0], [a1 - a0, 0], [a1 - a0, slopeLen], [0, slopeLen]], roofColor, roofInfo, n);
    const S = B('solid');
    const mid = E0.clone().add(E1).multiplyScalar(0.5);
    const dirA = E1.clone().sub(E0).normalize();
    const downslope = new THREE.Vector3().subVectors(E0, R0).normalize();
    const outH = downslope.clone().setY(0).normalize();
    rawBox(S, mid.clone().add(new THREE.Vector3(0, -0.07, 0)), dirA.clone().multiplyScalar((a1 - a0) / 2),
      new THREE.Vector3(0, 0.07, 0), outH.clone().multiplyScalar(0.012), trim.fascia, { info: solidInfo(0.7, 0, KIND.paint, 1) }, {});
    if (trim.gutter) {
      const g0 = E0.clone().add(new THREE.Vector3(0, -0.07, 0)).addScaledVector(downslope, 0.05);
      const g1 = E1.clone().add(new THREE.Vector3(0, -0.07, 0)).addScaledVector(downslope, 0.05);
      cylinder(S, g0, g1, 0.055, 0.055, 6, trim.gutter, solidInfo(0.5, 0.35, KIND.metal, 2), { capTop: true, capBottom: true, squash: 0.7 });
    }
  }
  const S = B('solid');
  const r0 = pt(a0 - 0.02, 0, ridgeH + 0.02);
  const r1 = pt(a1 + 0.02, 0, ridgeH + 0.02);
  cylinder(S, r0, r1, 0.09, 0.09, 6, trim.ridge, solidInfo(0.55, 0.2, KIND.metal, 3), { capTop: true, capBottom: true, squash: 0.55 });
  const axisA = ridgeAlongWidth ? f.along : f.back;
  for (const sa of [-1, 1]) {
    for (const s of [-1, 1]) {
      const a = sa * (len / 2 + overGable);
      const P0 = pt(a, s * eaveOut, eaveLow);
      const P1 = pt(a, 0, ridgeH);
      const dirv = P1.clone().sub(P0);
      let perp = new THREE.Vector3().crossVectors(axisA, dirv.clone().normalize()).normalize();
      if (perp.y > 0) perp.negate();
      perp.multiplyScalar(0.085);
      rawBox(S, P0.clone().add(P1).multiplyScalar(0.5).add(perp), dirv.clone().multiplyScalar(0.5), perp, axisA.clone().multiplyScalar(0.012), trim.barge, { info: solidInfo(0.65, 0, KIND.paint, 4) }, {});
    }
  }
  return { ridgeH, eaveH, eaveLow, eaveOut, pt, len, half };
}

export function buildDownpipe(B, wall, u, floorY, eaveY, heightAt, color, off = 0.08) {
  const S = B('solid');
  const top = wall.P(u, eaveY - 0.12).addScaledVector(wall.out, off);
  const gy = heightAt(top.x, top.z);
  const bottom = top.clone().setY(Math.min(gy + 0.2, floorY - 0.1));
  cylinder(S, bottom, top, 0.035, 0.035, 6, color, solidInfo(0.5, 0.3, KIND.metal, 5), { capTop: true });
}
