import * as THREE from 'three/webgpu';
import {
  DEG, sub, add, mul, dot, cross, len, unit, left, offsetLine, arcLengths, pointAt, slice, segDist,
  isSimple, polygonsOverlap, polygonLineDist, insetPolygon, triangulate, lin, scale, pointInPolygon,
} from './geom.js';
import { material, GROUND, GARDEN, RAILING, TRIM } from './materials.js';
import { Ctx, townHouse, block, villa, angle, PALETTE, pick } from './buildings.js';
import { wheelieBin, bench, bollard, treeGrate, fenceLine } from './furniture.js';
import { createStreetLamps } from '../street-lamps/streetLamps.js';
import { createTreeSet } from './treeSet.js';
import { createVehiclesAt, MODELS, PAINTS } from '../vehicles/index.js';
import { mulberry32 } from '../../engine/rng.js';

const LIFT = 0.04;
const CURB = 0.14;

const CHARACTER = {
  suburb: { house: 0.82, block: 0.18, villa: 0 },
  blocks: { house: 0.3, block: 0.7, villa: 0 },
  villas: { house: 0.12, block: 0, villa: 0.88 },
};
const WIDTH = { house: [5, 8], block: [12, 22], villa: [12, 17] };

function roundedAxis(line, R, step = 2) {
  const pts = [line[0]];
  const arcs = [];
  for (let i = 1; i + 1 < line.length; i++) {
    const a = line[i - 1], b = line[i], c = line[i + 1];
    const u = unit(sub(b, a)), v = unit(sub(c, b));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
    if (turn < 1e-3) { pts.push(b); continue; }
    const cut = Math.min(R * Math.tan(turn / 2), len(sub(b, a)) / 2, len(sub(c, b)) / 2);
    const p0 = sub(b, mul(u, cut));
    const p1 = add(b, mul(v, cut));
    const n = Math.max(3, Math.ceil((turn * R) / 1));
    const start = pts.length;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pts.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * b[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * b[1] + t * t * p1[1]]);
    }
    arcs.push([start, pts.length - 1]);
  }
  pts.push(line.at(-1));
  const dense = [pts[0]];
  const isArc = [false];
  const arcOf = new Map();
  arcs.forEach(([a, b], j) => { for (let k = a; k <= b; k++) arcOf.set(k, j); });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = len(sub(b, a));
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 1; k <= n; k++) {
      dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      isArc.push(arcOf.has(i) && arcOf.get(i) === arcOf.get(i - 1));
    }
  }
  const s = arcLengths(dense);
  const out = dense.map((p, i) => {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    const t = unit(sub(b, a));
    return { p, t, n: left(t), s: s[i], arc: isArc[i] };
  });
  return out;
}

function nearestS(axis, p) {
  let best = Infinity, bs = 0;
  for (let i = 0; i + 1 < axis.length; i++) {
    const a = axis[i].p, b = axis[i + 1].p;
    const d = sub(b, a);
    const l2 = dot(d, d) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
    const q = add(a, mul(d, t));
    const dd = len(sub(p, q));
    if (dd < best) { best = dd; bs = axis[i].s + t * Math.sqrt(l2); }
  }
  return bs;
}

function axisAt(axis, s) {
  let i = 0;
  while (i < axis.length - 2 && axis[i + 1].s < s) i++;
  const a = axis[i], b = axis[i + 1];
  const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
  const tt = unit(add(mul(a.t, 1 - t), mul(b.t, t)));
  return { p: add(a.p, mul(sub(b.p, a.p), t)), t: tt, n: left(tt), arc: a.arc || b.arc };
}

function rayHit(p, d, line) {
  let best = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], e = sub(line[i + 1], a);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-9) continue;
    const ap = sub(a, p);
    const k = cross(ap, e) / den;
    const u = cross(ap, d) / den;
    if (k > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && (!best || k < best.k)) best = { k, seg: i };
  }
  return best;
}

const inRanges = (s, ranges, pad = 0) => ranges.some(([a, b]) => s > a - pad && s < b + pad);

export function createStreet({
  line, half = 4, heightAt = () => 0, seed = 1, quality = 'high', sidewalk = 3, road = true, extend = 8,
  cars = 0.3, trees = true, gaps = true, mix = null, name = 'residential-street',
} = {}) {
  const rng = mulberry32(seed * 7907 + 11);
  const ctx = new Ctx(heightAt);
  const o = half + sidewalk;
  const zOf = (p) => heightAt(p[0], -p[1]);

  const d0 = unit(sub(line[1], line[0]));
  const d1 = unit(sub(line.at(-1), line.at(-2)));
  const ext = [sub(line[0], mul(d0, extend)), ...line.slice(1, -1), add(line.at(-1), mul(d1, extend))];
  const R = half + Math.min(sidewalk, 3.5) * 0.97;
  const axis = roundedAxis(ext, R);
  const S = axis.at(-1).s;

  const placed = [];
  const fails = { shape: 0, carriageway: 0, neighbour: 0 };
  const fits = (poly, minDist = o - 0.05) => {
    if (!isSimple(poly)) { fails.shape++; return false; }
    if (polygonLineDist(poly, ext) < minDist) { fails.carriageway++; return false; }
    const shrunk = insetPolygon(poly, 0.08);
    if (placed.some((q) => polygonsOverlap(shrunk, q, 0))) { fails.neighbour++; return false; }
    return true;
  };

  const sides = [1, -1].map((side) => {
    const raw = offsetLine(ext, side * o);
    const F = side === 1 ? raw : [...raw].reverse();
    return { side, raw, F, acc: arcLengths(F), droppedKerbs: [], noCar: [], noTree: [], shops: [], kind: rng() < 0.55 ? GROUND.blacktop : rng() < 0.4 ? GROUND.slabs : rng() < 0.6 ? GROUND.setts : GROUND.concrete };
  });

  const records = [];
  const furniture = { bins: [], benches: [], bollards: [], trees: [], gardens: [], places: [], stubs: [] };
  const lift = LIFT + CURB;

  for (const sd of sides) {
    const { F, acc } = sd;
    const Lf = acc.at(-1);
    let intervals = [];
    for (let i = 1; i + 1 < F.length; i++) {
      const a = unit(sub(F[i], F[i - 1])), b = unit(sub(F[i + 1], F[i]));
      const turn = Math.atan2(cross(a, b), dot(a, b));
      if (Math.abs(turn) < 8 * DEG) continue;
      const D = 10 + rng() * 3;
      const need = turn > 0 ? D * Math.tan(turn / 2) : 0;
      const ra = need + 4 + rng() * 5;
      const rb = need + 4 + rng() * 5;
      intervals.push({ s0: Math.max(0, acc[i] - ra), s1: Math.min(Lf, acc[i] + rb), D, verts: [{ i, turn }] });
    }
    intervals.sort((p, q) => p.s0 - q.s0);
    const merged = [];
    for (const it of intervals) {
      const last = merged.at(-1);
      if (last && it.s0 < last.s1 + 5) { last.s1 = Math.max(last.s1, it.s1); last.D = Math.min(last.D, it.D); last.verts.push(...it.verts); }
      else merged.push({ ...it });
    }
    if (merged.length && merged[0].s0 < 5) merged[0].s0 = 0;
    if (merged.length && merged.at(-1).s1 > Lf - 5) merged.at(-1).s1 = Lf;
    intervals = merged;
    sd.corners = intervals;
    for (const it of intervals) {
      const sharp = slice(F, it.s0, it.s1, acc);
      let path = sharp;
      const chamfered = [path[0]];
      for (let k = 1; k + 1 < path.length; k++) {
        const a = unit(sub(path[k], path[k - 1])), b = unit(sub(path[k + 1], path[k]));
        const turn = Math.atan2(cross(a, b), dot(a, b));
        const c = 2.0;
        if (turn > 60 * DEG && len(sub(path[k], path[k - 1])) > c + 3 && len(sub(path[k + 1], path[k])) > c + 3) {
          chamfered.push(sub(path[k], mul(a, c)), add(path[k], mul(b, c)));
        } else chamfered.push(path[k]);
      }
      chamfered.push(path.at(-1));
      path = chamfered;
      let D = it.D;
      let ok = false;
      for (let tries = 0; tries < 6 && !ok; tries++) {
        const backLine = offsetLine(sharp, D).reverse();
        const poly = [...path, ...backLine];
        if (fits(poly)) {
          const rec = angle(ctx, { path, back: backLine, D, seed: Math.floor(rng() * 1e6), lift });
          placed.push(poly);
          records.push({ type: 'angle', ...rec });
          if (rec.shop) sd.shops.push([it.s0, it.s1]);
          ok = true;
        } else D *= 0.8;
        if (D < 5) break;
      }
      if (!ok) it.failed = true;
    }
  }

  for (const sd of sides) {
    const { F, acc } = sd;
    const Lf = acc.at(-1);
    const runs = [];
    let s = 0;
    for (const it of sd.corners) {
      if (it.s0 > s + 0.01) runs.push([s, it.s0]);
      s = Math.max(s, it.s1);
    }
    if (Lf > s + 0.01) runs.push([s, Lf]);
    for (const [r0, r1] of runs) {
      const L = r1 - r0;
      const pa = pointAt(F, r0 + 0.01, acc), pb = pointAt(F, r1 - 0.01, acc);
      const straight = pa.i === pb.i;
      const character = mix ?? (() => { const r = rng(); return r < 0.4 ? 'suburb' : r < 0.72 ? 'blocks' : 'villas'; })();
      const pieces = [];
      if (gaps && straight && L >= 34 && rng() < 0.5) {
        const place = rng() < 0.45;
        const g = place ? 16 + rng() * 6 : 9 + rng() * 1.5;
        const c = r0 + 10 + g / 2 + rng() * (L - 20 - g);
        pieces.push([r0, c - g / 2], [c + g / 2, r1]);
        makeGap(sd, c - g / 2, c + g / 2, place);
      } else pieces.push([r0, r1]);
      for (const [p0, p1] of pieces) fillRun(sd, p0, p1, character, straight);
    }
  }

  function fillRun(sd, p0, p1, character, straight) {
    const L = p1 - p0;
    if (L < 3) return;
    const w = CHARACTER[character];
    const lots = [];
    let sum = 0;
    for (let guard = 0; guard < 200 && sum < L; guard++) {
      let type = 'house';
      const r = rng();
      if (r < w.villa) type = 'villa';
      else if (r < w.villa + w.block) type = 'block';
      if (!straight && type === 'villa') type = 'house';
      const [lo, hi] = WIDTH[type];
      const rest = L - sum;
      if (rest < lo) {
        if (rest >= 4.2) lots.push({ type: 'house', w: rest });
        else if (lots.length) { const k = (sum + rest) / sum; for (const l of lots) l.w *= k; }
        else lots.push({ type: 'house', w: rest });
        sum = L;
        break;
      }
      const width = lo + rng() * (hi - lo);
      lots.push({ type, w: Math.min(width, rest) });
      sum += Math.min(width, rest);
    }
    let s = p0;
    for (const lot of lots) {
      placeLot(sd, s, s + lot.w, lot.type);
      s += lot.w;
    }
  }

  function placeLot(sd, s0, s1, type) {
    const { F, acc } = sd;
    const a = pointAt(F, s0, acc), b = pointAt(F, s1, acc);
    const A = a.p, B = b.p;
    const t = unit(sub(B, A));
    const k = left(t);
    const Wl = len(sub(B, A));
    const seedL = Math.floor(rng() * 1e6);
    if (type === 'villa' && Wl >= 11) {
      const lotD = 18 + rng() * 6;
      const lotPoly = [A, B, add(B, mul(k, lotD)), add(A, mul(k, lotD))];
      if (fits(lotPoly)) {
        placed.push(lotPoly);
        const rec = placeVilla(sd, A, B, t, k, Wl, lotD, seedL, s0, s1);
        records.push(rec);
        return;
      }
      type = 'house';
    }
    let D = type === 'block' ? 11 + rng() * 3 : 9 + rng() * 3;
    for (let tries = 0; tries < 5; tries++) {
      const poly = [A, B, add(B, mul(k, D)), add(A, mul(k, D))];
      if (fits(poly)) {
        placed.push(poly);
        const lot = { A, B, D, seed: seedL, lift };
        if (type === 'block' && Wl >= 10) {
          const rec = block(ctx, lot);
          records.push({ type: 'block', ...rec });
          if (rec.shop) sd.shops.push([s0, s1]);
        } else records.push({ type: 'town-house', ...townHouse(ctx, lot) });
        return;
      }
      D *= 0.8;
      if (D < 5) break;
    }
  }

  function placeVilla(sd, A, B, t, k, Wl, lotD, seedL, s0, s1) {
    const r = mulberry32(seedL);
    const setback = 3 + r() * 3;
    const Wh = Math.min(11, Math.max(7, Wl - 3.6 - r() * 1.5));
    const Dh = 8 + r() * 2;
    const driveLeft = r() < 0.5;
    const uh0 = driveLeft ? Wl - Wh - 0.8 : 0.8;
    const HA = add(add(A, mul(t, uh0)), mul(k, setback));
    const HB = add(HA, mul(t, Wh));
    const rec = villa(ctx, { A: HA, B: HB, D: Dh, seed: seedL, lift, opts: { garage: r() < 0.3 } });
    const driveU = driveLeft ? 0.4 : Wl - 3.6;
    const doorU = uh0 + Wh / 2 + (r() - 0.5) * 2;
    const style = r();
    const fence = style < 0.3
      ? { kind: RAILING.bars, height: 1.5, wall: 0.6, color: pick(r, [[30, 32, 34], [40, 60, 48], [230, 230, 226]]) }
      : style < 0.55 ? { kind: RAILING.rigid, height: 1.53, wall: r() < 0.5 ? 0.5 : 0, color: lin([40, 72, 48]) }
        : style < 0.7 ? { kind: RAILING.slats, height: 1.6, wall: 0, color: pick(r, PALETTE.wood) }
          : style < 0.85 ? { kind: null, height: 0, wall: 0.9 + r() * 0.5, color: lin([200, 200, 200]) }
            : { kind: RAILING.torsion, height: 1.2, wall: 0, color: lin([46, 76, 52]) };
    if (fence.kind === RAILING.bars || fence.kind === RAILING.rigid || fence.kind === null) fence.wall = fence.wall || 0;
    fence.wallColor = rec.wall === 'wall:render' ? pick(r, PALETTE.villaPlaster) : pick(r, PALETTE.villaPlaster);
    fence.hedge = fence.kind === RAILING.rigid || fence.kind === RAILING.torsion ? (r() < 0.6 ? 1.6 + r() * 0.4 : 0) : 0;
    fence.hedgeColor = pick(r, [[62, 92, 40], [54, 84, 38], [74, 100, 44], [50, 76, 44]]);
    const gateKind = fence.kind === RAILING.slats ? RAILING.slats : RAILING.bars;
    const openings = [
      { u0: driveU, u1: driveU + 3.2, gate: r() < 0.8 ? gateKind : null, gateColor: fence.color },
      { u0: Math.max(driveU + 3.6, Math.min(Wl - 1.4, doorU - 0.5)), u1: Math.max(driveU + 4.6, Math.min(Wl - 0.4, doorU + 0.5)), gate: gateKind, gateColor: fence.color },
    ];
    if (!driveLeft) {
      openings[1].u0 = Math.max(0.4, Math.min(driveU - 1.4, doorU - 0.5));
      openings[1].u1 = openings[1].u0 + 1.0;
    }
    const lineF = [A, B];
    fenceLine(ctx, lineF, fence, openings, (p) => zOf(p) + lift, seedL);
    const sideD = setback + Dh + 2;
    const side = { kind: RAILING.rigid, height: 1.53, wall: 0, color: lin([40, 72, 48]), hedge: r() < 0.5 ? 1.8 : 0, hedgeColor: fence.hedgeColor, wallColor: fence.wallColor };
    fenceLine(ctx, [add(B, mul(k, sideD)), B], side, [], (p) => zOf(p) + lift, seedL + 1);
    furniture.gardens.push({ poly: [A, B, add(B, mul(k, lotD)), add(A, mul(k, lotD))], kind: GARDEN.lawn, z: lift + 0.0 });
    const dA = add(A, mul(t, driveU)), dB = add(A, mul(t, driveU + 3.2));
    furniture.gardens.push({ poly: [dA, dB, add(dB, mul(k, setback + 6)), add(dA, mul(k, setback + 6))], kind: r() < 0.5 ? GARDEN.gravel : GARDEN.paving, z: lift + 0.012 });
    const pu = (openings[1].u0 + openings[1].u1) / 2;
    const pA = add(A, mul(t, pu - 0.6)), pB = add(A, mul(t, pu + 0.6));
    furniture.gardens.push({ poly: [pA, pB, add(pB, mul(k, setback)), add(pA, mul(k, setback))], kind: GARDEN.paving, z: lift + 0.014 });
    if (r() < 0.55) furniture.trees.push({ p: add(add(A, mul(t, driveLeft ? Wl - 1.6 : 1.6)), mul(k, setback + Dh + 3)), species: r() < 0.5 ? 'birch' : 'hornbeam', height: 6 + r() * 4, garden: true });
    const sDrive = nearestS(axis, add(A, mul(t, driveU + 1.6)));
    sd.droppedKerbs.push([sDrive - 2.2, sDrive + 2.2]);
    sd.noCar.push([sDrive - 3, sDrive + 3]);
    sd.noTree.push([sDrive - 3, sDrive + 3]);
    if (r() < 0.45) furniture.bins.push({ p: add(add(A, mul(t, driveLeft ? driveU + 3.6 : driveU - 0.6)), mul(k, -0.5)), a: Math.atan2(-k[1], -k[0]), n: 1 + (r() < 0.5 ? 1 : 0), t });
    return { type: 'villa', ...rec, lot: [s0, s1] };
  }

  function makeGap(sd, g0, g1, place) {
    const { F, acc } = sd;
    const A = pointAt(F, g0, acc).p, B = pointAt(F, g1, acc).p;
    const t = unit(sub(B, A));
    const k = left(t);
    const g = len(sub(B, A));
    const depth = place ? 13 + rng() * 4 : 24 + rng() * 6;
    const poly = [A, B, add(B, mul(k, depth)), add(A, mul(k, depth))];
    if (!fits(poly, o - 0.05)) { fillRun(sd, g0, g1, 'suburb', true); return; }
    placed.push(poly);
    const sA = nearestS(axis, A), sB = nearestS(axis, B);
    sd.noCar.push([Math.min(sA, sB) - 2, Math.max(sA, sB) + 2]);
    sd.noTree.push([Math.min(sA, sB) - 1, Math.max(sA, sB) + 1]);
    if (place) {
      furniture.places.push({ poly, t, k, A, g, depth });
      const nT = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < nT; i++) furniture.trees.push({ p: add(add(A, mul(t, (g * (i + 0.5)) / nT)), mul(k, depth * 0.55)), species: 'hornbeam', height: 7 + rng() * 3, grate: true });
      for (let i = 0; i < 2; i++) furniture.benches.push({ p: add(add(A, mul(t, g * (0.25 + 0.5 * i))), mul(k, depth * 0.3)), a: Math.atan2(-k[1], -k[0]) });
      for (let u = 1; u < g - 0.5; u += 1.6) furniture.bollards.push(add(add(A, mul(t, u)), mul(k, 0.3)));
    } else {
      const mid = add(A, mul(t, g / 2));
      sd.droppedKerbs.push([nearestS(axis, sub(mid, mul(t, 3.2))), nearestS(axis, add(mid, mul(t, 3.2)))].sort((p, q) => p - q));
      furniture.stubs.push({ A, t, k, g, depth });
    }
    const back0 = add(add(A, mul(t, -3)), mul(k, depth + 0.3));
    const back1 = add(back0, mul(t, g + 6));
    const D = 10 + rng() * 2;
    const bp = [back0, back1, add(back1, mul(k, D)), add(back0, mul(k, D))];
    if (fits(bp)) {
      placed.push(bp);
      const lot = { A: back0, B: back1, D, seed: Math.floor(rng() * 1e6), lift };
      records.push(g + 6 >= 14 && rng() < 0.6 ? { type: 'block', ...block(ctx, lot) } : { type: 'town-house', ...townHouse(ctx, lot) });
    }
  }

  const ground = ctx.buf('ground');
  const garden = ctx.buf('garden');
  const curbBuf = ctx.buf('trim');
  const curbColor = lin([182, 178, 168]);
  const curbVals = [[TRIM.plain, 0.85, 0, 7]];
  const P3 = (p, dz) => [p[0], zOf(p) + dz, -p[1]];
  const curbH = (sd, s) => (inRanges(s, sd.droppedKerbs) ? 0.025 : CURB);
  for (let i = 0; i + 1 < axis.length; i++) {
    const a = axis[i], b = axis[i + 1];
    if (road) {
      const cols = [-half, 0, half];
      for (let c = 0; c + 1 < cols.length; c++) {
        const qa0 = add(a.p, mul(a.n, cols[c])), qa1 = add(a.p, mul(a.n, cols[c + 1]));
        const qb0 = add(b.p, mul(b.n, cols[c])), qb1 = add(b.p, mul(b.n, cols[c + 1]));
        const l0 = cols[c], l1 = cols[c + 1];
        const v = [[GROUND.carriageway, half, 3, 0.5]];
        ground.quad(P3(qa0, LIFT), P3(qb0, LIFT), P3(qb1, LIFT), P3(qa1, LIFT), [[a.s, l0], [b.s, l0], [b.s, l1], [a.s, l1]], [1, 1, 1], v, [0, 1, 0]);
      }
    }
    for (const sd of sides) {
      const m = sd.side;
      const ca = add(a.p, mul(a.n, m * half)), cb = add(b.p, mul(b.n, m * half));
      const ha = curbH(sd, a.s), hb = curbH(sd, b.s);
      const ia = add(a.p, mul(a.n, m * (half + 0.15))), ib = add(b.p, mul(b.n, m * (half + 0.15)));
      const face = m === -1 ? [P3(cb, LIFT - 0.02), P3(ca, LIFT - 0.02), P3(ca, LIFT + ha), P3(cb, LIFT + hb)] : [P3(ca, LIFT - 0.02), P3(cb, LIFT - 0.02), P3(cb, LIFT + hb), P3(ca, LIFT + ha)];
      curbBuf.quad(...face, [[0, 0], [1, 0], [1, 0.15], [0, 0.15]], curbColor, curbVals);
      const top = m === 1 ? [P3(ca, LIFT + ha), P3(cb, LIFT + hb), P3(ib, LIFT + hb + 0.005), P3(ia, LIFT + ha + 0.005)] : [P3(cb, LIFT + hb), P3(ca, LIFT + ha), P3(ia, LIFT + ha + 0.005), P3(ib, LIFT + hb + 0.005)];
      curbBuf.quad(...top, [[a.s, 0], [b.s, 0], [b.s, 0.15], [a.s, 0.15]], curbColor, curbVals, [0, 1, 0]);
      const dirA = mul(a.n, m), dirB = mul(b.n, m);
      const hA = rayHit(ia, dirA, sd.raw), hB = rayHit(ib, dirB, sd.raw);
      const oa = hA ? add(ia, mul(dirA, hA.k)) : add(ia, mul(dirA, sidewalk - 0.15));
      const ob = hB ? add(ib, mul(dirB, hB.k)) : add(ib, mul(dirB, sidewalk - 0.15));
      const outer = [oa];
      if (hA && hB && hA.seg !== hB.seg) {
        const lo = Math.min(hA.seg, hB.seg), hi = Math.max(hA.seg, hB.seg);
        const vs = sd.raw.slice(lo + 1, hi + 1);
        outer.push(...(hA.seg < hB.seg ? vs : vs.reverse()));
      }
      outer.push(ob);
      const va = [[sd.kind, 0, 5 + m, 0.3]];
      const zA = LIFT + ha + 0.005, zB = LIFT + hb + 0.005;
      const zo = LIFT + CURB + 0.005;
      for (let q = 0; q + 1 < outer.length; q++) {
        const u0 = outer[q], u1 = outer[q + 1];
        const lu0 = len(sub(u0, ia)), lu1 = len(sub(u1, ib));
        const tri = (p, qq, r, uvs) => { if (m === 1) ground.tri(p, qq, r, uvs, [1, 1, 1], va, [0, 1, 0]); else ground.tri(p, r, qq, [uvs[0], uvs[2], uvs[1]], [1, 1, 1], va, [0, 1, 0]); };
        if (q === 0) tri(P3(ia, zA), P3(ib, zB), P3(u1, zo), [[a.s, 0], [b.s, 0], [b.s, lu1]]);
        else tri(P3(ib, zB), P3(u1, zo), P3(u0, zo), [[b.s, 0], [b.s, lu1], [a.s, lu0]]);
        if (q === 0) tri(P3(ia, zA), P3(u1, zo), P3(u0, zo), [[a.s, 0], [b.s, lu1], [a.s, lu0]]);
      }
    }
  }

  const flatPoly = (buf, poly, dz, vals, uvOf, backDz = dz, backFrom = 2) => {
    const tris = triangulate(poly);
    for (let [i, j, k] of tris) {
      const ar = (poly[j][0] - poly[i][0]) * (poly[k][1] - poly[i][1]) - (poly[j][1] - poly[i][1]) * (poly[k][0] - poly[i][0]);
      if (ar < 0) [j, k] = [k, j];
      const z = (idx) => (idx >= backFrom ? backDz : dz);
      buf.tri(P3(poly[i], z(i)), P3(poly[j], z(j)), P3(poly[k], z(k)), [uvOf(poly[i]), uvOf(poly[j]), uvOf(poly[k])], [1, 1, 1], vals, [0, 1, 0]);
    }
  };
  for (const st of furniture.stubs) {
    const { A, t, k, g, depth } = st;
    const roadW = 5.5;
    const side = (g - roadW) / 2;
    const at = (u, w) => add(add(A, mul(t, u)), mul(k, w));
    for (let w = 0; w < depth; w += 3) {
      const w1 = Math.min(depth, w + 3);
      const cols = [0, side, side + roadW / 2, side + roadW, g];
      for (let c = 0; c + 1 < cols.length; c++) {
        const isRoad = c === 1 || c === 2;
        const v = [[isRoad ? GROUND.carriageway : GROUND.blacktop, roadW / 2, 9, 0.6]];
        const lat = (u) => (isRoad ? u - side - roadW / 2 : Math.abs(u - (c === 0 ? side : side + roadW)));
        const dz = isRoad ? LIFT : LIFT + CURB;
        const quad = [at(cols[c], w), at(cols[c + 1], w), at(cols[c + 1], w1), at(cols[c], w1)];
        ground.quad(P3(quad[0], dz), P3(quad[1], dz), P3(quad[2], dz), P3(quad[3], dz), [[w, lat(cols[c])], [w, lat(cols[c + 1])], [w1, lat(cols[c + 1])], [w1, lat(cols[c])]], [1, 1, 1], v, [0, 1, 0]);
      }
    }
    for (const u of [side, side + roadW]) {
      const s = u === side ? 1 : -1;
      const p0 = at(u, 0.0), p1 = at(u, depth);
      const top0 = at(u - s * 0.15, 0), top1 = at(u - s * 0.15, depth);
      const f = s === 1 ? [P3(p0, LIFT - 0.02), P3(p1, LIFT - 0.02), P3(p1, LIFT + CURB), P3(p0, LIFT + CURB)] : [P3(p1, LIFT - 0.02), P3(p0, LIFT - 0.02), P3(p0, LIFT + CURB), P3(p1, LIFT + CURB)];
      curbBuf.quad(...f, [[0, 0], [1, 0], [1, 0.15], [0, 0.15]], curbColor, curbVals);
      const tp = s === -1 ? [P3(p1, LIFT + CURB), P3(p0, LIFT + CURB), P3(top0, LIFT + CURB + 0.004), P3(top1, LIFT + CURB + 0.004)] : [P3(p0, LIFT + CURB), P3(p1, LIFT + CURB), P3(top1, LIFT + CURB + 0.004), P3(top0, LIFT + CURB + 0.004)];
      curbBuf.quad(...tp, [[0, 0], [1, 0], [1, 0.15], [0, 0.15]], curbColor, curbVals, [0, 1, 0]);
    }
  }
  for (const pl of furniture.places) {
    flatPoly(ground, pl.poly, LIFT + CURB + 0.003, [[GROUND.setts, 0, 11, 0.3]], (p) => [dot(sub(p, pl.A), pl.t), dot(sub(p, pl.A), pl.k)]);
  }
  for (const gd of furniture.gardens) {
    flatPoly(garden, gd.poly, gd.z, [[gd.kind, 0, 13, 0]], (p) => p, gd.kind === GARDEN.lawn ? 0.03 : gd.z, 2);
  }

  const lampModel = rng() < 0.45 ? 'bracket' : rng() < 0.6 ? 'lantern' : 'led';
  const lampH = lampModel === 'bracket' ? 6.5 + rng() * 1.5 : lampModel === 'lantern' ? 4 + rng() * 0.8 : 6 + rng();
  const lamps = [];
  const lampS = [];
  {
    let s = 6 + rng() * 6;
    let k = 0;
    while (s < S - 4) {
      const sd = sides[k % 2];
      const q = axisAt(axis, s);
      if (!q.arc && !inRanges(s, sd.droppedKerbs, 1.5)) {
        const p = add(q.p, mul(q.n, sd.side * (half + 0.55)));
        const dirTo = mul(q.n, -sd.side);
        lamps.push({ x: p[0], y: p[1], heading: Math.atan2(dirTo[0], dirTo[1]) / DEG, model: lampModel, height: lampH });
        lampS.push([sd.side, s]);
        ctx.cylinder(p[0], p[1], zOf(p) - 0.2, zOf(p) + lampH + 0.3, 0.13);
        if (lampModel !== 'lantern') { const hp = add(p, mul(dirTo, 0.8)); ctx.cylinder(hp[0], hp[1], zOf(p) + lampH - 0.6, zOf(p) + lampH + 0.4, 0.55); }
        k++;
        s += 22 + rng() * 4;
      } else s += 2;
    }
  }
  if (trees) {
    for (const sd of sides) {
      if (rng() < 0.35) continue;
      const species = rng() < 0.7 ? 'hornbeam' : 'birch';
      let s = 5 + rng() * 4;
      while (s < S - 3) {
        const q = axisAt(axis, s);
        const nearLamp = lampS.some(([side, ls]) => side === sd.side && Math.abs(ls - s) < 3.5);
        const nearArc = axisAt(axis, s - 7).arc || axisAt(axis, s + 7).arc || q.arc;
        if (!nearArc && !nearLamp && !inRanges(s, sd.noTree, 0.5)) {
          const p = add(q.p, mul(q.n, sd.side * (half + 0.95)));
          furniture.trees.push({ p, species, height: 6.5 + rng() * 2.5, grate: true, a: Math.atan2(q.t[1], q.t[0]) });
          s += 8 + rng() * 2;
        } else s += 1.5;
      }
    }
  }
  for (const sd of sides) {
    for (let i = 0; i + 1 < axis.length; i += 1) {
      const a = axis[i];
      if (!a.arc) continue;
      if (i % 2) continue;
      const tNext = axis[Math.min(axis.length - 1, i + 1)].t;
      const turnLeft = cross(a.t, tNext) > 0;
      if ((turnLeft ? 1 : -1) !== sd.side) continue;
      furniture.bollards.push(add(a.p, mul(a.n, sd.side * (half + 0.35))));
    }
  }
  for (const sd of sides) {
    for (const [s0, s1] of sd.shops) {
      const a = pointAt(sd.F, s0, sd.acc).p, b = pointAt(sd.F, s1, sd.acc).p;
      const sa = nearestS(axis, a), sb = nearestS(axis, b);
      for (let s = Math.min(sa, sb) + 1; s < Math.max(sa, sb) - 1; s += 1.8) {
        const q = axisAt(axis, s);
        if (q.arc || inRanges(s, sd.droppedKerbs, 0.5) || lampS.some(([side, ls]) => side === sd.side && Math.abs(ls - s) < 1)) continue;
        if (furniture.trees.some((tr) => len(sub(tr.p, add(q.p, mul(q.n, sd.side * (half + 0.35))))) < 1.2)) continue;
        if (rng() < 0.5) furniture.bollards.push(add(q.p, mul(q.n, sd.side * (half + 0.35))));
      }
    }
  }
  for (const rec of records) {
    if (rec.type !== 'town-house' || rng() > 0.18) continue;
    const [A, B] = rec.poly;
    const t = unit(sub(B, A));
    const k = left(t);
    furniture.bins.push({ p: add(add(A, mul(t, 0.6 + rng() * 2)), mul(k, -0.55)), a: Math.atan2(-k[1], -k[0]), n: 1, t });
  }
  const boll = rng() < 0.5 ? lin([60, 50, 44]) : lin([46, 50, 54]);
  for (const p of furniture.bollards) bollard(ctx, p[0], p[1], zOf(p) + lift, boll, 3);
  const binColors = [[46, 76, 52], [60, 64, 66], [52, 54, 58], [80, 60, 40]];
  const lidColors = [[214, 180, 30], [46, 76, 52], [60, 64, 66], [40, 80, 150], [110, 70, 40]];
  for (const b of furniture.bins) {
    for (let j = 0; j < b.n; j++) {
      const p = add(b.p, mul(b.t, j * 0.68));
      const body = lin(binColors[Math.floor(rng() * binColors.length)]);
      wheelieBin(ctx, p[0], p[1], zOf(p) + lift, b.a, body, j === 1 ? lin(lidColors[0]) : lin(lidColors[Math.floor(rng() * lidColors.length)]), j);
    }
  }
  for (const b of furniture.benches) bench(ctx, b.p[0], b.p[1], zOf(b.p) + lift, b.a, 5);
  for (const tr of furniture.trees) {
    if (tr.grate) treeGrate(ctx, tr.p[0], tr.p[1], zOf(tr.p) + lift, tr.a ?? 0, 9);
    const z = zOf(tr.p);
    ctx.cylinder(tr.p[0], tr.p[1], z - 0.2, z + 2.6, 0.2);
    ctx.cylinder(tr.p[0], tr.p[1], z + 2.6, z + tr.height, tr.height * 0.2);
  }
  const carList = [];
  if (cars > 0) {
    const models = Object.entries(MODELS).filter(([, m]) => m.L >= 3.6 && m.L <= 4.9);
    const paintW = PAINTS.reduce((a, p) => a + p.w, 0);
    const paint = () => { let r = rng() * paintW; for (const p of PAINTS) { r -= p.w; if (r <= 0) return p.c[Math.floor(rng() * p.c.length)]; } return PAINTS[0].c[0]; };
    const runs = [];
    let r0 = null;
    for (const q of axis) {
      if (!q.arc && r0 === null) r0 = q.s;
      if (q.arc && r0 !== null) { runs.push([r0, q.s]); r0 = null; }
    }
    if (r0 !== null) runs.push([r0, S]);
    for (const [a0, a1] of runs) {
      const sd = sides[rng() < 0.5 ? 0 : 1];
      let s = a0 + 6 + rng() * 3;
      while (s < a1 - 6) {
        const [key, m] = models[Math.floor(rng() * models.length)];
        const sc = s + m.L / 2;
        if (sc + m.L / 2 > a1 - 6) break;
        const free = !inRanges(sc, sd.noCar, m.L / 2) && !inRanges(sc, sd.droppedKerbs, m.L / 2 + 0.5);
        if (free && rng() < cars * 2.2) {
          const q = axisAt(axis, sc);
          const p = add(q.p, mul(q.n, sd.side * (half - 1.05)));
          const dir = sd.side === -1 ? q.t : mul(q.t, -1);
          carList.push({ x: p[0], y: p[1], headingDeg: Math.atan2(dir[0], dir[1]) / DEG, length: m.L, rgb: paint(), key });
          ctx.box(p[0], p[1], zOf(p) - 0.2, zOf(p) + LIFT + 1.6, m.L, 1.9, Math.atan2(q.t[1], q.t[0]) / DEG);
          s += m.L + 0.8 + rng() * 2;
        } else s += m.L + 1 + rng() * 3;
      }
    }
  }

  const group = new THREE.Group();
  group.name = name;
  let triangles = 0;
  for (const [key, buf] of ctx.bufs) {
    if (!buf.count) continue;
    const mesh = new THREE.Mesh(buf.geometry(), material(key));
    mesh.name = `${name}-${key}`;
    triangles += buf.count;
    if (key === 'ground' || key === 'garden') {
      mesh.userData.noShadow = true;
      mesh.receiveShadow = true;
    }
    if (key === 'glass' || key === 'railing') mesh.userData.noShadow = key === 'glass';
    group.add(mesh);
  }
  const lampSet = createStreetLamps({ points: lamps, seed, heightAt: (x, z) => heightAt(x, z) + lift - 0.05, quality });
  group.add(lampSet.group);
  const treeSet = createTreeSet(furniture.trees.map((tr) => ({ x: tr.p[0], y: tr.p[1], species: tr.species, height: tr.height })), { seed });
  treeSet.group.name = `${name}-trees`;
  group.add(treeSet.group);
  let carGroup = null;
  if (carList.length) {
    carGroup = createVehiclesAt({ cars: carList, seed, heightAt: (x, z) => heightAt(x, z) + LIFT });
    carGroup.name = `${name}-cars`;
    group.add(carGroup);
  }

  const counts = {};
  for (const r of records) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const stats = {
    buildings: records.length, counts, triangles, windows: ctx.count.windows, lamps: lamps.length, trees: furniture.trees.length,
    cars: carList.length, bins: furniture.bins.length, benches: furniture.benches.length, bollards: furniture.bollards.length,
    obstacles: ctx.obstacles.length, length: S, fails,
  };
  return {
    group,
    stats,
    records,
    facade: o,
    axis: ext,
    addObstacles(sink) {
      for (const [kind, ...v] of ctx.obstacles) sink[kind](...v);
    },
    clearGrass(world, className = 'road_minor') {
      const cls = world.meta?.classes?.indexOf(className) ?? -1;
      if (cls < 0 || !world.classes) return 0;
      const hard = [...records.filter((r) => r.poly).map((r) => r.poly), ...furniture.places.map((p) => p.poly),
        ...furniture.stubs.map(({ A, t, k, g, depth }) => [A, add(A, mul(t, g)), add(add(A, mul(t, g)), mul(k, depth)), add(A, mul(k, depth))])];
      const xs = ext.map((p) => p[0]), ys = ext.map((p) => p[1]);
      const pad = o + 40;
      const { size, half: wh } = world;
      let n = 0;
      for (let y = Math.floor(Math.min(...ys) - pad); y <= Math.max(...ys) + pad; y++) {
        for (let x = Math.floor(Math.min(...xs) - pad); x <= Math.max(...xs) + pad; x++) {
          const row = Math.round(-y + wh);
          const col = Math.round(x + wh);
          if (row < 0 || row >= size || col < 0 || col >= size) continue;
          let near = false;
          for (let i = 0; !near && i + 1 < ext.length; i++) near = segDist([x, y], ext[i], ext[i + 1]) <= o + 0.7;
          if (!near) near = hard.some((poly) => pointInPolygon([x, y], poly));
          if (near && world.classes[row * size + col] !== cls) { world.classes[row * size + col] = cls; n++; }
        }
      }
      if (n && world.classTex) world.classTex.needsUpdate = true;
      return n;
    },
    update(camera) {
      treeSet.update(camera);
    },
    info: () => `street: ${stats.buildings} buildings (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}), ${stats.windows} bays, `
      + `${(triangles / 1000).toFixed(0)} k merged triangles, ${stats.lamps} lamps, ${stats.trees} trees, ${stats.cars} cars, ${stats.obstacles} obstacles`,
  };
}

export { segDist, scale };
