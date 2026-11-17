import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { Frame, fbox, quad, cylinder, hex, solidInfo, KIND, tint, clamp } from './kit.js';
import {
  makeWall, wallBox, buildWall, buildGable, buildPlinth, buildWindow, buildSurround, buildShutters, buildDoor, buildRoof, buildDownpipe,
} from './walls.js';

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const col = (rnd, list, amount = 0.05) => tint(hex(pick(rnd, list)), rnd, amount);
const DOORS = [0x5a3a22, 0x3f5f45, 0x4f6f8f, 0x6b2f26, 0x8a6a3a, 0xd8d3c2];
const ROOF_METAL = [0x8b2e22, 0x7a2a20, 0x5a3a2b, 0x4c3a30, 0x35553c];
const ROOF_FIBER = [0x6e6d68, 0x5f5e59, 0x7a7974, 0x54534f];

export const WOOD_RECIPES = {
  logs: { wall: 'log', colors: [0x6b4f36, 0x7a6a5a, 0x8a6a45], trim: [0xe3e0d6], style: 'crown', shutters: 0.25, roof: 'fiber', plinth: 'stone', corners: 'logs', wear: [0.4, 0.9] },
  'green-boards': { wall: 'board', flag: 0, colors: [0x5e7f5b, 0x4f7058, 0x6b8a5e], trim: [0xe9e6dd], style: 'plain', shutters: 0.3, roof: 'fiber', plinth: 'concrete', corners: 'boards', wear: [0.3, 0.8] },
  'ochre-siding': { wall: 'board', flag: 1, colors: [0xc09a52, 0xb88b45, 0xcaa965], trim: [0xe9e6dd, 0xd8d3c2], style: 'plain', shutters: 0.15, roof: 'metal', plinth: 'concrete', corners: 'boards', wear: [0.2, 0.7] },
  'faded-blue': { wall: 'board', flag: 1, colors: [0x7a9cb4, 0x6c8fae, 0x86a6b0], trim: [0xe9e6dd], style: 'crown', shutters: 0.2, roof: 'fiber', plinth: 'stone', corners: 'boards', wear: [0.4, 0.95], porch: 'veranda' },
  'carved-brown': { wall: 'board', flag: 0, colors: [0x6b4a32, 0x5c4030, 0x7a5638], trim: [0xe3e0d6, 0xd9d2be], style: 'crown', shutters: 0.5, roof: 'metal', plinth: 'concrete', corners: 'boards', wear: [0.2, 0.6] },
  'washed-grey': { wall: 'board', flag: 0, colors: [0x7c7568, 0x6f6b62, 0x857f72], trim: [0x8c8478, 0xd8d3c2], style: 'plain', shutters: 0.1, roof: 'metal', plinth: 'stone', corners: 'boards', wear: [0.8, 1.0], neglected: true },
};
export const WOOD_RECIPE_NAMES = Object.keys(WOOD_RECIPES);

export function groundRange(f, w, d, heightAt) {
  let lo = Infinity;
  let hi = -Infinity;
  const nx = Math.max(2, Math.ceil(w / 1.5));
  const nz = Math.max(2, Math.ceil(d / 1.5));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      if (i > 0 && i < nx && j > 0 && j < nz) continue;
      const p = f.P(-w / 2 + (w * i) / nx, 0, -d / 2 + (d * j) / nz);
      const g = heightAt(p.x, p.z);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
  }
  return [lo, hi];
}

function layoutBays(len, rnd, { door = false, doorBay = null, winW = [0.95, 1.15], winH = [1.2, 1.4], sill = [0.9, 1.0], bay = 2.3, minWin = 0, eave = 2.5 }) {
  const nb = Math.max(1, Math.round((len - 0.6) / bay));
  const doorAt = door ? (doorBay ?? Math.floor(rnd() * nb)) : -1;
  const ops = [];
  const wh = winH[0] + rnd() * (winH[1] - winH[0]);
  const ww = winW[0] + rnd() * (winW[1] - winW[0]);
  const sh = Math.min(sill[0] + rnd() * (sill[1] - sill[0]), eave - 0.4 - wh);
  for (let i = 0; i < nb; i++) {
    const c = ((i + 0.5) * len) / nb;
    if (i === doorAt) ops.push({ kind: 'door', u0: c - 0.5, u1: c + 0.5, h0: 0, h1: Math.min(2.0, eave - 0.3) });
    else if (len / nb > ww + 0.7 || nb === 1) ops.push({ kind: 'win', u0: c - ww / 2, u1: c + ww / 2, h0: sh, h1: sh + wh });
  }
  if (!ops.length && minWin) ops.push({ kind: 'win', u0: len / 2 - ww / 2, u1: len / 2 + ww / 2, h0: sh, h1: sh + wh });
  return ops;
}

function buildPorch(B, f, w, d, floorY, doorOp, kind, rnd, ctx, wallFront, color, trim) {
  const S = B('solid');
  const concrete = hex(0x8c8a84);
  const ci = solidInfo(0.95, 0, KIND.concrete, ctx.seed);
  const cx = (doorOp.u0 + doorOp.u1) / 2 - w / 2;
  if (kind === 'veranda') {
    const vw = 2.1;
    const vd = 1.5;
    const vh = 2.25;
    const lz = -d / 2 - vd / 2;
    const frame = trim;
    const pinfo = solidInfo(0.6, 0, KIND.paint, ctx.seed);
    fbox(S, f, cx, floorY - 0.1, lz, vw + 0.1, 0.1, vd + 0.1, concrete, ci);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fbox(S, f, cx + sx * vw / 2, floorY, lz + sz * (vd / 2), 0.07, vh, 0.07, frame, pinfo);
    const glassC = new THREE.Color(1, 1, 1);
    const G = B('glass');
    const gseed = rnd() * 50;
    const gl = (a, b, c, d2, dir) => quad(G, a, b, c, d2, [[0, 0], [1, 0], [1, 1], [0, 1]], glassC, [gseed, 0, 0, 0], dir);
    const y0 = floorY + 0.35;
    const y1 = floorY + vh - 0.06;
    const hz = vd / 2;
    gl(f.P(cx - vw / 2, y0, lz - hz), f.P(cx + vw / 2, y0, lz - hz), f.P(cx + vw / 2, y1, lz - hz), f.P(cx - vw / 2, y1, lz - hz), f.out);
    gl(f.P(cx + vw / 2, y0, lz - hz), f.P(cx + vw / 2, y0, lz + hz), f.P(cx + vw / 2, y1, lz + hz), f.P(cx + vw / 2, y1, lz - hz), f.along.clone());
    gl(f.P(cx - vw / 2, y0, lz + hz), f.P(cx - vw / 2, y0, lz - hz), f.P(cx - vw / 2, y1, lz - hz), f.P(cx - vw / 2, y1, lz + hz), f.along.clone().negate());
    fbox(S, f, cx, floorY, lz - hz + 0.02, vw, 0.35, 0.04, color, solidInfo(0.7, 0, KIND.wood, ctx.seed));
    for (const sx of [-1, 1]) fbox(S, f, cx + sx * (vw / 2 - 0.02), floorY, lz, 0.04, 0.35, vd, color, solidInfo(0.7, 0, KIND.wood, ctx.seed));
    for (const t of [-0.33, 0.33]) fbox(S, f, cx + t * vw, floorY, lz - hz, 0.04, vh, 0.04, frame, pinfo);
    fbox(S, f, cx, floorY + vh - 0.06, lz, vw + 0.08, 0.06, vd + 0.08, frame, pinfo);
    const rb = ctx.roofBucket;
    const hi = floorY + vh + 0.12;
    const lo = floorY + vh - 0.05;
    quad(rb, f.P(cx - vw / 2 - 0.15, hi, -d / 2 + 0.0), f.P(cx + vw / 2 + 0.15, hi, -d / 2), f.P(cx + vw / 2 + 0.15, lo, lz - hz - 0.2), f.P(cx - vw / 2 - 0.15, lo, lz - hz - 0.2),
      [[0, 0], [vw + 0.3, 0], [vw + 0.3, vd], [0, vd]], ctx.roofColor, ctx.roofInfo, new THREE.Vector3(0, 1, 0));
    fbox(S, f, cx, floorY - 0.2, lz - hz - 0.25, vw, 0.2, 0.5, concrete, ci);
    return;
  }
  const steps = clamp(Math.round((floorY - ctx.groundFront) / 0.17), 2, 5);
  const sw = 1.5;
  const tread = 0.3;
  for (let i = 0; i < steps; i++) {
    const hh = floorY - 0.02 - (steps - 1 - i) * ((floorY - ctx.groundFront) / steps);
    fbox(S, f, cx, ctx.groundFront - 0.1, -d / 2 - tread * (steps - 1 - i) - tread / 2 - 0.0, sw, hh - ctx.groundFront + 0.1, tread, concrete, ci);
  }
  fbox(S, f, cx, floorY - 0.1, -d / 2 - 0.45 - 0.0, sw + 0.1, 0.1, 0.9 + 0.0, concrete, ci);
  if (kind === 'canopy') {
    const post = hex(0x6a5036);
    const pi = solidInfo(0.85, 0, KIND.wood, ctx.seed);
    const pz = -d / 2 - 1.0;
    for (const sx of [-1, 1]) fbox(S, f, cx + sx * (sw / 2 + 0.05), floorY, pz, 0.1, 2.3, 0.1, post, pi);
    const hi = floorY + 2.7;
    const lo = floorY + 2.4;
    quad(ctx.roofBucket, f.P(cx - 1.0, hi, -d / 2), f.P(cx + 1.0, hi, -d / 2), f.P(cx + 1.0, lo, pz - 0.45), f.P(cx - 1.0, lo, pz - 0.45),
      [[0, 0], [2, 0], [2, 1.2], [0, 1.2]], ctx.roofColor, ctx.roofInfo, new THREE.Vector3(0, 1, 0));
    fbox(S, f, cx, lo - 0.1, pz - 0.45, 2.04, 0.1, 0.05, post, pi);
    fbox(S, f, cx, floorY + 2.3, pz, 2.0, 0.1, 0.1, post, pi);
  }
}

export function buildWoodHouse(B, spec, heightAt) {
  const rnd = mulberry32(spec.seed ?? 1);
  const name = spec.recipe ?? pick(rnd, WOOD_RECIPE_NAMES);
  const R = WOOD_RECIPES[name];
  const w = spec.width;
  const d = spec.depth;
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const [gLo, gHi] = groundRange(f, w, d, heightAt);
  const plinthH = 0.4 + rnd() * 0.3;
  const floorY = Math.max(gLo + plinthH, gHi - 0.05);
  const eave = 2.35 + rnd() * 0.4;
  const topH = floorY + eave;
  const pitch = 33 + rnd() * 9;
  const gableStreet = rnd() < 0.55;
  const rAW = d > w + 0.5 ? false : w > d + 0.5 ? true : !gableStreet;
  const wear = R.wear[0] + rnd() * (R.wear[1] - R.wear[0]);
  const wallColor = col(rnd, R.colors, 0.05);
  const trimColor = col(rnd, R.trim, 0.03);
  const seed = rnd() * 100;
  const thick = R.wall === 'log' ? 0.2 : 0.14;
  const wallBucket = B(R.wall === 'log' ? 'log' : 'board');
  const flag = R.wall === 'log' ? 0 : R.flag;
  const info = [seed, topH - floorY, flag, wear];
  const roofType = R.roof;
  const roofColor = roofType === 'fiber' ? col(rnd, ROOF_FIBER, 0.06) : col(rnd, ROOF_METAL, 0.04);
  const roofInfo = [rnd() * 100, roofType === 'fiber' ? 0.2 + rnd() * 0.8 : rnd() * 0.5, 0, roofType === 'fiber' ? wear : wear * 0.8 + (R.neglected ? 0.15 : 0)];
  const roofBucket = B(roofType === 'fiber' ? 'roofFiber' : 'roofMetal');
  const frameColor = rnd() < 0.7 ? trimColor : hex(0xe9e6dd);
  const door = col(rnd, DOORS, 0.04);
  const groundFront = heightAt(...(() => { const p = f.P(0, 0, -d / 2 - 0.9); return [p.x, p.z]; })());

  const front = makeWall(f, 'front', w, d);
  const right = makeWall(f, 'right', w, d);
  const back = makeWall(f, 'back', w, d);
  const left = makeWall(f, 'left', w, d);
  const doorBay = rnd() < 0.5 ? 0 : null;
  const hasPorch = pick(rnd, ['stoop', 'canopy', 'stoop']);
  const porch = R.porch ?? hasPorch;
  const walls = {
    front: layoutBays(w, rnd, { door: true, doorBay, eave }),
    back: layoutBays(w, rnd, { door: rnd() < 0.4, minWin: 1, eave }),
    right: layoutBays(d, rnd, { minWin: 1, bay: 2.8, eave }),
    left: layoutBays(d, rnd, { minWin: 1, bay: 2.8, eave }),
  };
  const wallObj = { front, back, right, left };
  const gablesOn = rAW ? ['right', 'left'] : ['front', 'back'];
  const trim = {
    fascia: trimColor.clone().multiplyScalar(0.9),
    barge: trimColor,
    gutter: rnd() < 0.7 ? hex(pick(rnd, [0x6a6a66, 0x5a3a2b, 0xd8d3c2, 0x35553c])) : null,
    ridge: roofType === 'fiber' ? hex(0x6f6e69) : roofColor.clone().multiplyScalar(0.8),
  };

  buildPlinth(B('plinth'), f, w, d, floorY, heightAt, R.plinth === 'stone' ? col(rnd, [0x6c685e, 0x7a756a], 0.06) : col(rnd, [0x74726c, 0x7f7d77], 0.05), [seed, 0, R.plinth === 'stone' ? 1 : 0, wear]);
  const roof = buildRoof(B, f, w, d, topH, pitch, rAW, 0.45, 0.35, roofBucket, roofColor, roofInfo, trim);
  let doorOp = null;
  for (const [key, wall] of Object.entries(wallObj)) {
    const ops = walls[key];
    const isGable = gablesOn.includes(key);
    buildWall(wall, floorY, topH, ops, thick, wallBucket, wallColor, info);
    if (isGable) buildGable(wall, floorY, topH, roof.ridgeH, wallBucket, wallColor, info);
    for (const o of ops) {
      if (o.kind === 'door') {
        buildDoor(B, wall, floorY, o, door, seed, thick);
        if (key === 'front') doorOp = o;
        buildSurround(B, wall, floorY, { ...o, h0: 0 }, frameColor, 'plain', seed);
      } else {
        buildWindow(B, wall, floorY, o, { frameColor, glassSeed: rnd() * 90, curtain: rnd() < 0.55 ? 0.35 + rnd() * 0.5 : 0, thick }, rnd);
        buildSurround(B, wall, floorY, o, frameColor, R.style, seed, topH);
        if (rnd() < R.shutters) buildShutters(B, wall, floorY, o, col(rnd, [0x3f5f45, 0x4f6f8f, 0x6b2f26, 0x5a3a22], 0.05), seed);
      }
    }
    if (isGable && rnd() < 0.7) {
      const mid = wall.len / 2;
      const base = topH + 0.6;
      const o = { u0: mid - 0.3, u1: mid + 0.3, h0: base - floorY, h1: base - floorY + 0.7 };
      if (base + 0.7 < roof.ridgeH - 0.4) {
        buildWindow(B, wall, floorY, o, { frameColor, glassSeed: rnd() * 90, curtain: 0, thick: 0.0, sill: true }, rnd);
        buildSurround(B, wall, floorY, o, frameColor, 'plain', seed);
      }
    }
  }
  const S = B('solid');
  if (R.corners === 'logs') {
    const rows = Math.floor(eave / 0.2);
    const bark = col(rnd, [0x5f4630, 0x6d5039], 0.05);
    for (let i = 0; i < rows; i++) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const alongX = (i + (sx * sz > 0 ? 1 : 0)) % 2 === 0;
        const px = sx * (w / 2 + (alongX ? 0.1 : 0));
        const pz = sz * (d / 2 + (alongX ? 0 : 0.1));
        fbox(S, f, px, floorY + i * 0.2 + 0.01, pz, alongX ? 0.42 : 0.2, 0.18, alongX ? 0.2 : 0.42, bark, solidInfo(0.9, 0, KIND.wood, seed + i));
      }
    }
  } else {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      fbox(S, f, sx * w / 2, floorY, sz * d / 2, 0.13, eave, 0.13, trimColor, solidInfo(0.7, 0, KIND.paint, seed));
    }
  }
  if (doorOp) {
    buildPorch(B, f, w, d, floorY, doorOp, porch, rnd, { seed, roofBucket, roofColor, roofInfo, groundFront }, front, frameColor, trimColor);
  }
  if (rnd() < 0.85) {
    const a = (rnd() - 0.5) * roof.len * 0.5;
    const cs = 0.5 + rnd() * 0.2;
    const top = roof.ridgeH + 0.7 + rnd() * 0.4;
    const MB = B('masonry');
    const c0 = roof.pt(a, 0, 0);
    const cInfo = [rnd() * 50, top, 1, 0.3];
    const brick = hex(0x8e4a38);
    const pos = roof.pt(a, 0, 0);
    const cb = new THREE.Vector3(pos.x, 0, pos.z);
    void c0;
    fbox(MB, f, f.along.dot(cb.clone().sub(f.P(0, 0, 0))), roof.ridgeH - 0.7, f.back.dot(cb.clone().sub(f.P(0, 0, 0))), cs, top - roof.ridgeH + 0.7, cs, brick, cInfo);
    fbox(S, f, f.along.dot(cb.clone().sub(f.P(0, 0, 0))), top, f.back.dot(cb.clone().sub(f.P(0, 0, 0))), cs + 0.14, 0.07, cs + 0.14, hex(0x8c8a84), solidInfo(0.95, 0, KIND.concrete, seed));
    fbox(S, f, f.along.dot(cb.clone().sub(f.P(0, 0, 0))), top + 0.065, f.back.dot(cb.clone().sub(f.P(0, 0, 0))), cs - 0.2, 0.01, cs - 0.2, hex(0x151515), solidInfo(1, 0, KIND.plain, 0));
  }
  if (trim.gutter) {
    const eaveWalls = rAW ? ['front', 'back'] : ['right', 'left'];
    const ew = wallObj[pick(rnd, eaveWalls)];
    buildDownpipe(B, ew, rnd() < 0.5 ? 0.3 : ew.len - 0.3, floorY, topH, heightAt, trim.gutter);
  }
  if (rnd() < 0.6) {
    const a = (rnd() - 0.5) * roof.len * 0.6;
    const base = roof.pt(a, 0, roof.ridgeH);
    const metal = hex(0x8c8f90);
    const mi = solidInfo(0.45, 0.6, KIND.metal, 1);
    const top = base.clone().add(new THREE.Vector3(0, 3.0, 0));
    cylinder(S, base, top, 0.018, 0.014, 5, metal, mi, {});
    for (let i = 0; i < 4; i++) {
      const y = base.y + 1.4 + i * 0.4;
      const half = 0.55 - i * 0.07;
      const p0 = new THREE.Vector3(base.x, y, base.z).addScaledVector(f.along, -half);
      const p1 = new THREE.Vector3(base.x, y, base.z).addScaledVector(f.along, half);
      cylinder(S, p0, p1, 0.008, 0.008, 4, metal, mi, { capTop: false });
    }
  }
  const total = { x: spec.x, y: spec.y, w, d, heading: f.heading, base: gLo, floorY, top: roof.ridgeH, recipe: name, gableStreet: !rAW };
  return total;
}

export function buildBarn(B, spec, heightAt, brick) {
  const rnd = mulberry32(spec.seed ?? 1);
  const w = spec.width;
  const d = spec.depth;
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const [gLo, gHi] = groundRange(f, w, d, heightAt);
  const plinthH = 0.25 + rnd() * 0.2;
  const floorY = Math.max(gLo + plinthH, gHi - 0.05);
  const eave = 3.0 + rnd() * 1.2;
  const topH = floorY + eave;
  const pitch = 24 + rnd() * 10;
  const rAW = w >= d;
  const wear = 0.3 + rnd() * 0.7;
  const seed = rnd() * 100;
  const wallBucket = brick ? B('masonry') : B('board');
  const wallColor = brick ? col(rnd, [0x9fa09a, 0x93958d, 0xa9aaa3], 0.05) : col(rnd, [0x4a3626, 0x5a4634, 0x6a5a48, 0x7a6e60], 0.06);
  const info = [seed, topH - floorY, brick ? 0 : 2, wear];
  const roofType = rnd() < (brick ? 0.7 : 0.35) ? 'fiber' : 'metal';
  const roofColor = roofType === 'fiber' ? col(rnd, ROOF_FIBER, 0.06) : col(rnd, [0x5a3a2b, 0x4c3a30, 0x7a2a20, 0x6b6a66], 0.05);
  const roofInfo = [rnd() * 100, 0.3 + rnd() * 0.7, 0, wear];
  const roofBucket = B(roofType === 'fiber' ? 'roofFiber' : 'roofMetal');
  const doorColor = col(rnd, [0x5c4129, 0x44563c, 0x6a6358, 0x7a3b2a], 0.05);
  const trim = { fascia: hex(0x5a4a3a), barge: hex(0x5a4a3a), gutter: brick && rnd() < 0.4 ? hex(0x6a6a66) : null, ridge: roofType === 'fiber' ? hex(0x6f6e69) : roofColor.clone().multiplyScalar(0.8) };
  const frontW = makeWall(f, 'front', w, d);
  const rightW = makeWall(f, 'right', w, d);
  const backW = makeWall(f, 'back', w, d);
  const leftW = makeWall(f, 'left', w, d);
  const thick = brick ? 0.25 : 0.06;
  const dh = Math.min(3.0, eave - 0.5);
  const doorW = Math.min(3.2, (rAW ? w : w) * 0.4);
  const ops = { front: [], back: [], right: [], left: [] };
  const bigDoorU = (len) => (rnd() < 0.5 ? len / 2 : len * (0.3 + rnd() * 0.4));
  const u = bigDoorU(w);
  ops.front.push({ kind: 'bigdoor', u0: u - doorW / 2, u1: u + doorW / 2, h0: 0, h1: dh });
  const hi = (len, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = ((i + 0.5) * len) / n;
      out.push({ kind: 'hi', u0: c - 0.3, u1: c + 0.3, h0: eave - 1.15, h1: eave - 0.7 });
    }
    return out;
  };
  for (const key of ['right', 'left']) {
    const len = key === 'right' ? d : d;
    const n = Math.max(1, Math.floor(len / 3.2));
    ops[key].push(...hi(len, n).filter(() => rnd() < 0.8));
  }
  if (rnd() < 0.6) ops.back.push({ kind: 'bigdoor', u0: w / 2 - 1.0, u1: w / 2 + 1.0, h0: 0, h1: 2.4 });
  if (rnd() < 0.7) {
    const uu = Math.min(w - 0.6, u + doorW / 2 + 0.9);
    if (uu + 0.5 < w) ops.front.push({ kind: 'door', u0: uu - 0.45, u1: uu + 0.45, h0: 0, h1: 1.95 });
  }
  const plinthCol = hex(0x8a8883);
  buildPlinth(B('plinth'), f, w, d, floorY, heightAt, plinthCol, [seed, 0, 0, wear]);
  const roof = buildRoof(B, f, w, d, topH, pitch, rAW, 0.35, 0.3, roofBucket, roofColor, roofInfo, trim);
  const S = B('solid');
  const wallsObj = { front: frontW, back: backW, right: rightW, left: leftW };
  const gablesOn = rAW ? ['right', 'left'] : ['front', 'back'];
  for (const [key, wall] of Object.entries(wallsObj)) {
    const list = ops[key].filter((o) => o.u1 < wall.len - 0.1 && o.u0 > 0.1);
    list.sort((a, b) => a.u0 - b.u0);
    const clean = [];
    for (const o of list) if (!clean.length || o.u0 > clean.at(-1).u1 + 0.2) clean.push(o);
    buildWall(wall, floorY, topH, clean, thick, wallBucket, wallColor, info);
    if (gablesOn.includes(key)) {
      buildGable(wall, floorY, topH, roof.ridgeH, wallBucket, wallColor, info);
      const mid = wall.len / 2;
      const hv = topH + 0.45;
      if (roof.ridgeH - hv > 0.9) {
        const vent = hex(0x1a1a18);
        wallBox(S, wall, mid - 0.3, hv, 0.6, 0.35, 0, 0.02, vent, solidInfo(0.9, 0, KIND.wood, seed));
      }
    }
    for (const o of clean) {
      const wid = o.u1 - o.u0;
      if (o.kind === 'bigdoor') {
        const inset = thick * 0.6;
        const wd = hex(0x000000);
        void wd;
        wallBox(S, wall, o.u0, floorY, wid, o.h1 - o.h0 - 0.03, -inset - 0.05, -inset, doorColor, solidInfo(0.8, 0, KIND.wood, seed));
        const rail = doorColor.clone().multiplyScalar(0.8);
        for (const hr of [0.35, (o.h1 - o.h0) * 0.5, o.h1 - o.h0 - 0.4]) wallBox(S, wall, o.u0, floorY + hr, wid, 0.16, -inset, -inset + 0.04, rail, solidInfo(0.85, 0, KIND.wood, seed));
        wallBox(S, wall, o.u0 + wid / 2 - 0.02, floorY, 0.04, o.h1 - o.h0 - 0.03, -inset, -inset + 0.05, hex(0x2a2a2a), solidInfo(0.6, 0.4, KIND.metal, seed));
        for (const half of [0, 1]) {
          const ua = o.u0 + half * (wid / 2);
          const pA = wall.P(ua + 0.08, floorY + 0.4).addScaledVector(wall.out, -inset + 0.04);
          const pB = wall.P(ua + wid / 2 - 0.08, floorY + (o.h1 - o.h0) - 0.45).addScaledVector(wall.out, -inset + 0.04);
          const dirv = pB.clone().sub(pA);
          const perp = new THREE.Vector3().crossVectors(dirv, wall.out).normalize().multiplyScalar(0.08);
          if (half) { perp.negate(); }
          cylinder(S, pA, pB, 0.045, 0.045, 4, rail, solidInfo(0.85, 0, KIND.wood, seed), { capTop: true, capBottom: true, squash: 0.5 });
        }
        wallBox(S, wall, o.u0 - 0.2, floorY - 0.15, wid + 0.4, 0.15, -inset, 0.9, hex(0x8a8883), solidInfo(0.95, 0, KIND.concrete, seed));
      } else if (o.kind === 'door') {
        buildDoor(B, wall, floorY, o, doorColor, seed, thick);
      } else if (o.kind === 'hi') {
        const dark = brick ? hex(0x4a4a46) : hex(0x2a221a);
        buildWindow(B, wall, floorY, o, { frameColor: dark, glassSeed: rnd() * 90, curtain: 0, thick, sill: false }, rnd);
      }
    }
  }
  if (!brick) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) fbox(S, f, sx * w / 2, floorY, sz * d / 2, 0.14, eave, 0.14, wallColor.clone().multiplyScalar(0.8), solidInfo(0.9, 0, KIND.wood, seed));
  if (trim.gutter) {
    const ew = (rAW ? [frontW, backW] : [rightW, leftW])[rnd() < 0.5 ? 0 : 1];
    buildDownpipe(B, ew, 0.3, floorY, topH, heightAt, trim.gutter, 0.1);
  }
  return { x: spec.x, y: spec.y, w, d, heading: f.heading, base: gLo, floorY, top: roof.ridgeH, brick, gableStreet: !rAW };
}
