import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { Frame, fbox, quad, cylinder, hex, solidInfo, KIND, tint } from './kit.js';
import { makeWall, wallBox, buildWall, buildPlinth, buildWindow, buildDoor, buildDownpipe } from './walls.js';
import { groundRange } from './houses.js';

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const PLASTERS = [0xa7a59d, 0xc2b59b, 0xc9b57e, 0xb2b9a2, 0xd6d2c4, 0xb9a994, 0x9aa3a8];
const TILES = [0x7a4a32, 0x6a7e8a, 0xa5593a, 0x8a8f86, 0xd0c9b6];
const FRAMES = [0xe3e0d6, 0x4a3a2c, 0x6a4a30, 0xd8d3c2];

export function buildCube70(B, spec, heightAt) {
  const rnd = mulberry32(spec.seed ?? 1);
  const w = spec.width;
  const d = spec.depth;
  const f = new Frame(spec.x, spec.y, spec.headingDeg ?? 0);
  const [gLo, gHi] = groundRange(f, w, d, heightAt);
  const floorY = Math.max(gLo + 0.5, gHi - 0.05);
  const hLevel = 2.6;
  const slab = 0.22;
  const topH = floorY + 2 * hLevel + slab;
  const seed = rnd() * 100;
  const plaster = tint(hex(pick(rnd, PLASTERS)), rnd, 0.04);
  const second = rnd() < 0.3 ? tint(hex(pick(rnd, PLASTERS)), rnd, 0.03) : plaster;
  const tiled = rnd() < 0.3;
  const flagUp = rnd() < 0.5 ? 1 : 0;
  const wear = 0.2 + rnd() * 0.7;
  const frameColor = tint(hex(pick(rnd, FRAMES)), rnd, 0.03);
  const concrete = tint(hex(0x85837d), rnd, 0.05);
  const ci = solidInfo(0.95, 0, KIND.concrete, seed);
  const PB = B('plaster');
  const walls = { front: makeWall(f, 'front', w, d), right: makeWall(f, 'right', w, d), back: makeWall(f, 'back', w, d), left: makeWall(f, 'left', w, d) };
  const lens = { front: w, back: w, right: d, left: d };
  buildPlinth(B('plinth'), f, w, d, floorY, heightAt, tint(hex(0x6f6d67), rnd, 0.05), [seed, 0, 0, wear]);
  const garage = rnd() < 0.45 ? pick(rnd, ['right', 'left']) : null;
  const doorSide = rnd() < 0.5 ? 0.3 : 0.7;
  const winW = 1.2;
  const lay = (key, level) => {
    const len = lens[key];
    const ops = [];
    const n = Math.max(1, Math.round((len - 1) / 3));
    for (let i = 0; i < n; i++) {
      const c = ((i + 0.5) * len) / n;
      ops.push({ kind: 'win', u0: c - winW / 2, u1: c + winW / 2, h0: 0.95, h1: 0.95 + 1.35, i });
    }
    return ops;
  };
  const ground = { front: [], back: lay('back', 0), right: lay('right', 0), left: lay('left', 0) };
  const upper = { front: [], back: lay('back', 1), right: lay('right', 1), left: lay('left', 1) };
  const doorU = w * doorSide;
  ground.front.push({ kind: 'door', u0: doorU - 0.55, u1: doorU + 0.55, h0: 0, h1: 2.1 });
  const wc = doorSide < 0.5 ? w * 0.7 : w * 0.3;
  ground.front.push({ kind: 'win', u0: wc - winW / 2 - 0.1, u1: wc + winW / 2 + 0.1, h0: 0.95, h1: 2.3 });
  const balcU = rnd() < 0.7 ? w * (1 - doorSide) : w * doorSide;
  upper.front.push({ kind: 'win', u0: w * doorSide - 0.6, u1: w * doorSide + 0.6, h0: 0.95, h1: 2.3 });
  const hasBalcony = rnd() < 0.7;
  if (hasBalcony) upper.front.push({ kind: 'bdoor', u0: wc - 0.55, u1: wc + 0.55, h0: 0, h1: 2.15 });
  else upper.front.push({ kind: 'win', u0: wc - winW / 2, u1: wc + winW / 2, h0: 0.95, h1: 2.3 });
  if (garage) {
    const key = garage;
    const len = lens[key];
    ground[key] = [{ kind: 'garage', u0: len / 2 - 1.3, u1: len / 2 + 1.3, h0: 0, h1: 2.1 }];
  }
  for (const key of Object.keys(walls)) {
    const wall = walls[key];
    for (let level = 0; level < 2; level++) {
      const y0 = floorY + level * (hLevel + slab / 2) + (level ? slab / 2 : 0);
      const y1 = level ? topH : floorY + hLevel;
      const flag = level === 0 && tiled ? 2 : level === 1 ? flagUp : 0;
      const info = [seed, topH - floorY, flag, wear];
      const ops = (level ? upper : ground)[key].map((o) => ({ ...o }));
      const clean = ops.filter((o) => o.u0 > 0.3 && o.u1 < wall.len - 0.3).sort((a, b) => a.u0 - b.u0).filter((o, i, a) => i === 0 || o.u0 > a[i - 1].u1 + 0.3);
      buildWall(wall, y0, y1, clean, 0.25, PB, level === 0 && tiled ? tint(hex(pick(rnd, TILES)), rnd, 0.03) : level ? second : plaster, info);
      for (const o of clean) {
        if (o.kind === 'win') {
          buildWindow(B, wall, y0, o, { frameColor, glassSeed: rnd() * 90, curtain: rnd() < 0.5 ? 0.35 + rnd() * 0.5 : 0, thick: 0.25 }, rnd);
          wallBox(B('solid'), wall, o.u0 - 0.05, y0 + o.h0 - 0.08, o.u1 - o.u0 + 0.1, 0.05, 0, 0.1, concrete, ci);
        } else if (o.kind === 'door') buildDoor(B, wall, y0, o, tint(hex(pick(rnd, [0x5a3a22, 0x3f5f45, 0x4a4a48, 0x6b2f26])), rnd, 0.04), seed, 0.25);
        else if (o.kind === 'bdoor') buildWindow(B, wall, y0, { ...o, h0: 0.0 }, { frameColor, glassSeed: rnd() * 90, curtain: 0.5, thick: 0.25, sill: false }, rnd);
        else if (o.kind === 'garage') {
          const S = B('solid');
          wallBox(S, wall, o.u0, y0, o.u1 - o.u0, o.h1, -0.2, -0.12, tint(hex(pick(rnd, [0x6a6a66, 0x4f6f5a, 0x7a4a32])), rnd, 0.04), solidInfo(0.6, 0.2, KIND.metal, seed));
          wallBox(S, wall, o.u0 - 0.1, y0, 0.1, o.h1 + 0.1, -0.2, 0.05, concrete, ci);
          wallBox(S, wall, o.u1, y0, 0.1, o.h1 + 0.1, -0.2, 0.05, concrete, ci);
          wallBox(S, wall, o.u0 - 0.1, y0 + o.h1, o.u1 - o.u0 + 0.2, 0.15, -0.2, 0.05, concrete, ci);
        }
      }
    }
  }
  const S = B('solid');
  fbox(S, f, 0, floorY + hLevel - 0.02, 0, w + 0.06, slab + 0.04, d + 0.06, concrete, ci);
  const over = 0.45;
  const rb = B('solid');
  const roofCol = hex(0x34332f);
  const roofInfo = solidInfo(0.95, 0, KIND.concrete, seed + 3);
  fbox(rb, f, 0, topH - 0.05, 0, w + 2 * over, 0.24, d + 2 * over, tint(hex(0x6f6d67), rnd, 0.04), ci);
  const Pt = (lx, lz, h) => f.P(lx, h, lz);
  const hh = topH + 0.19;
  quad(rb, Pt(-w / 2 - over + 0.04, -d / 2 - over + 0.04, hh + 0.03), Pt(w / 2 + over - 0.04, -d / 2 - over + 0.04, hh + 0.03), Pt(w / 2 + over - 0.04, d / 2 + over - 0.04, hh - 0.0), Pt(-w / 2 - over + 0.04, d / 2 + over - 0.04, hh - 0.0), [[0, 0], [w, 0], [w, d], [0, d]], roofCol, roofInfo, new THREE.Vector3(0, 1, 0));
  for (const [lx, lz, sx, sz] of [[0, -d / 2 - over + 0.03, w + 2 * over, 0.06], [0, d / 2 + over - 0.03, w + 2 * over, 0.06], [-w / 2 - over + 0.03, 0, 0.06, d + 2 * over], [w / 2 + over - 0.03, 0, 0.06, d + 2 * over]]) fbox(rb, f, lx, hh - 0.03, lz, sx, 0.15, sz, tint(hex(0x6f6d67), rnd, 0.04), ci);
  const chimney = Pt((rnd() - 0.5) * w * 0.4, (rnd() - 0.5) * d * 0.3, 0);
  fbox(S, f, f.along.dot(chimney.clone().sub(f.P(0, 0, 0))), hh, f.back.dot(chimney.clone().sub(f.P(0, 0, 0))), 0.5, 0.9, 0.5, tint(hex(0x8a8780), rnd, 0.05), ci);
  fbox(S, f, f.along.dot(chimney.clone().sub(f.P(0, 0, 0))), hh + 0.9, f.back.dot(chimney.clone().sub(f.P(0, 0, 0))), 0.62, 0.06, 0.62, concrete, ci);
  const front = walls.front;
  if (hasBalcony) {
    const bw = 2.8;
    const bd = 1.3;
    const y = floorY + hLevel;
    const lx = wc - w / 2;
    fbox(S, f, lx, y - 0.02, -d / 2 - bd / 2, bw, 0.2, bd, concrete, ci);
    const rail = tint(hex(pick(rnd, [0x2f3a40, 0x4a4a48, 0x6b2f26])), rnd, 0.05);
    const ri = solidInfo(0.5, 0.5, KIND.paint, seed);
    const full = rnd() < 0.4;
    const H = 1.0;
    if (full) {
      fbox(S, f, lx, y + 0.18, -d / 2 - bd + 0.04, bw, H - 0.18, 0.08, plaster, solidInfo(0.9, 0, KIND.concrete, seed));
      for (const sx of [-1, 1]) fbox(S, f, lx + sx * (bw / 2 - 0.04), y + 0.18, -d / 2 - bd / 2, 0.08, H - 0.18, bd, plaster, solidInfo(0.9, 0, KIND.concrete, seed));
    } else {
      fbox(S, f, lx, y + H - 0.04, -d / 2 - bd + 0.03, bw, 0.05, 0.06, rail, ri);
      for (const sx of [-1, 1]) fbox(S, f, lx + sx * (bw / 2 - 0.03), y + H - 0.04, -d / 2 - bd / 2, 0.06, 0.05, bd, rail, ri);
      const n = Math.round(bw / 0.12);
      for (let i = 0; i <= n; i++) fbox(S, f, lx - bw / 2 + 0.03 + (i * (bw - 0.06)) / n, y + 0.18, -d / 2 - bd + 0.03, 0.02, H - 0.2, 0.02, rail, ri);
      const m = Math.round(bd / 0.12);
      for (const sx of [-1, 1]) for (let i = 1; i < m; i++) fbox(S, f, lx + sx * (bw / 2 - 0.03), y + 0.18, -d / 2 - (i * bd) / m, 0.02, H - 0.2, 0.02, rail, ri);
    }
  }
  const dx = doorU - w / 2;
  fbox(S, f, dx, floorY + 2.35, -d / 2 - 0.5, 1.8, 0.1, 1.0, concrete, ci);
  const steps = Math.max(2, Math.min(5, Math.round((floorY - heightAt(...(() => { const p = f.P(dx, 0, -d / 2 - 1.0); return [p.x, p.z]; })())) / 0.17)));
  for (let i = 0; i < steps; i++) fbox(S, f, dx, floorY - (i + 1) * 0.17 + 0.0, -d / 2 - 0.3 * (i + 1) + 0.15, 1.5, 0.17 * (steps - i) + 0.05, 0.3, concrete, ci);
  fbox(S, f, dx, floorY - 0.05, -d / 2 - 0.4, 1.5, 0.05, 0.8, concrete, ci);
  buildDownpipe(B, walls.right, 0.25, floorY, topH - 0.1, heightAt, hex(0x6a6a66), 0.1);
  if (rnd() < 0.5) {
    const b = f.P((rnd() - 0.5) * w * 0.5, hh + 0.05, (rnd() - 0.5) * d * 0.4);
    const metal = hex(0x8c8f90);
    const mi = solidInfo(0.45, 0.6, KIND.metal, 1);
    cylinder(S, b, b.clone().add(new THREE.Vector3(0, 3.0, 0)), 0.018, 0.014, 5, metal, mi, {});
    for (let i = 0; i < 4; i++) {
      const y = b.y + 1.4 + i * 0.4;
      const half = 0.55 - i * 0.07;
      cylinder(S, new THREE.Vector3(b.x, y, b.z).addScaledVector(f.along, -half), new THREE.Vector3(b.x, y, b.z).addScaledVector(f.along, half), 0.008, 0.008, 4, metal, mi, { capTop: false });
    }
  }
  return { x: spec.x, y: spec.y, w, d, heading: f.heading, base: gLo, floorY, top: hh + 0.9 };
}
