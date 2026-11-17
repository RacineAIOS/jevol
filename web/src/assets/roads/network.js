import * as THREE from 'three/webgpu';
import { mulberry32, hash2 } from '../../engine/rng.js';
import { resample, curveStretches, pointAt, nearestOnPolyline, lateral, rank } from './util.js';
import { planRoad, markingPlan, MARK } from './plan.js';
import { Buffers, buildSections, addStrip, addFan } from './ribbon.js';
import { asphaltMaterial, vergeMaterial, paintMaterial, furnitureMaterial, signMaterial } from './materials.js';
import { DecalBuilder, arrow, laneArrow, stopLine, giveWay, zebra, hatchZone, longLine } from './decals.js';
import { FurnitureBuilder, COLORS, guardrail, concreteBarrier, marker, chevrons, borne } from './furniture.js';
import { SignBuilder, signAtlas, signStack } from './signs.js';

export const UNPAVED = new Set(['Gravel road', 'Track', 'Trail', 'Stairs']);
const OVERLAP = 0.7;
const FLARE = { local: 1.0, rural: 1.4, regional: 2.0, national: 2.5, dual: 2.0, roundabout: 1.5, ramp: 1.5 };

export function createRoadNetwork({ roads, seed = 1, heightAt = () => 0, step = 3, urban = false, furniture = true, grass = [0.105, 0.145, 0.05], extras, realism = false } = {}) {
  const items = [];
  roads.forEach((road, index) => {
    if (UNPAVED.has(road.nature) || road.width < 0.5 || road.line.length < 2) return;
    const rng = mulberry32(Math.floor(hash2(index, 17, seed) * 4294967295));
    const first = road.line[0];
    const last = road.line[road.line.length - 1];
    const closed = road.nature === 'Roundabout' && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1.5;
    const plan = planRoad(road, rng, { urban, ...road.style });
    if (realism && road.style?.wear === undefined) {
      plan.wear = Math.min(1, plan.wear + 0.16);
      plan.tone = Math.min(1, plan.tone + 0.12);
    }
    items.push({ road, index, rng, plan, closed, line: road.line.map((p) => [...p]), trim: { start: null, end: null }, junctions: [] });
  });

  findJunctions(items);

  const asphalt = new Buffers();
  const verge = new Buffers();
  const decals = new DecalBuilder();
  const fb = new FurnitureBuilder();
  const sb = new SignBuilder();
  const grassAt = typeof grass === 'function' ? grass : () => grass;
  const ctx = { heightAt, grassAt, step, asphalt, verge, decals, fb, sb, furniture, items, realism, extraMeshes: [], seed };
  for (const item of items) buildItem(item, ctx);
  if (furniture) for (const item of items) addPriorityFurniture(item, ctx);
  extras?.(ctx);

  const group = new THREE.Group();
  group.name = 'roads';
  const meshes = {};
  const add = (name, geometry, material, noShadow) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.userData.noShadow = noShadow;
    group.add(mesh);
    meshes[name] = mesh;
  };
  if (asphalt.idx.length) add('roads-asphalt', asphalt.geometry(), asphaltMaterial({ worn: realism }), true);
  if (verge.idx.length) add('roads-verge', verge.geometry(), vergeMaterial({ worn: realism }), true);
  if (decals.idx.length) add('roads-paint', decals.geometry(), paintMaterial(), true);
  if (fb.idx.length) add('roads-furniture', fb.geometry(), furnitureMaterial(), false);
  if (sb.idx.length) add('roads-signs', sb.geometry(), signMaterial(signAtlas()), false);

  for (const mesh of ctx.extraMeshes) {
    group.add(mesh);
    meshes[mesh.name] = mesh;
  }
  const tris = (b) => b.idx.length / 3;
  const stats = {
    roads: items.length,
    asphaltTriangles: tris(asphalt),
    vergeTriangles: tris(verge),
    paintTriangles: decals.triangles,
    furnitureTriangles: fb.triangles,
    signTriangles: sb.triangles,
    extraTriangles: ctx.extraTriangles ?? 0,
    drawCalls: Object.keys(meshes).length,
    length: items.reduce((a, it) => a + (it.rs?.length ?? 0), 0),
  };
  stats.triangles = stats.asphaltTriangles + stats.vergeTriangles + stats.paintTriangles + stats.furnitureTriangles + stats.signTriangles + stats.extraTriangles;
  return {
    group,
    meshes,
    stats,
    items,
    info: () => `roads ${items.length}  ${(stats.length / 1000).toFixed(2)} km  ${(stats.triangles / 1000).toFixed(0)} k triangles  ${stats.drawCalls} meshes`,
  };
}

function endInfo(rs, which) {
  const pts = rs.pts;
  const p = which === 'start' ? pts[0] : pts[pts.length - 1];
  const q = which === 'start' ? pts[Math.min(2, pts.length - 1)] : pts[Math.max(0, pts.length - 3)];
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: p.x, z: p.z, inx: dx / l, inz: dz / l };
}

function trimLine(line, which, dist) {
  if (dist <= 0.01) return;
  const pts = which === 'start' ? line.slice() : line.slice().reverse();
  let left = dist;
  while (pts.length > 2) {
    const l = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    if (l > left) break;
    left -= l;
    pts.shift();
  }
  const l = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1;
  const t = Math.min(left / l, 0.9);
  pts[0] = [pts[0][0] + (pts[1][0] - pts[0][0]) * t, pts[0][1] + (pts[1][1] - pts[0][1]) * t];
  const out = which === 'start' ? pts : pts.reverse();
  line.length = 0;
  line.push(...out);
}

function findJunctions(items) {
  for (const it of items) it.coarse = resample(it.line.map((p) => [...p]), 6, it.closed);
  const ends = [];
  for (const it of items) {
    if (it.closed) continue;
    for (const which of ['start', 'end']) ends.push({ it, which, ...endInfo(it.coarse, which), used: false });
  }
  const trims = [];
  for (const e of ends) {
    if (e.used) continue;
    const cluster = ends.filter((o) => !o.used && Math.hypot(o.x - e.x, o.z - e.z) < 1.5);
    if (cluster.length < 3) continue;
    cluster.forEach((c) => { c.used = true; });
    let best = null;
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        const a = cluster[i];
        const b = cluster[j];
        const align = -(a.inx * b.inx + a.inz * b.inz);
        const score = -(rank(a.it.road) + rank(b.it.road)) + (a.it.road.width + b.it.road.width) * 0.2 + align * 3;
        if (!best || score > best.score) best = { a, b, score };
      }
    }
    const tx = best.a.inx - best.b.inx;
    const tz = best.a.inz - best.b.inz;
    const tl = Math.hypot(tx, tz) || 1;
    const major = Math.max(best.a.it.road.width, best.b.it.road.width);
    const majorPlan = rank(best.a.it.road) <= rank(best.b.it.road) ? best.a.it : best.b.it;
    for (const c of cluster) {
      if (c === best.a || c === best.b) continue;
      const sin = Math.abs((c.inx * tz - c.inz * tx) / tl);
      const dist = Math.max(0, (major / 2 - OVERLAP) / Math.max(0.35, sin));
      trims.push({ c, dist, major: majorPlan, majorW: major, sin, P: { x: e.x, z: e.z } });
    }
  }
  for (const e of ends) {
    if (e.used) continue;
    let best = null;
    for (const q of items) {
      if (q === e.it) continue;
      const pts = q.closed ? [...q.coarse.pts, { ...q.coarse.pts[0], s: q.coarse.length }] : q.coarse.pts;
      const n = nearestOnPolyline(pts, e.x, e.z);
      const tol = Math.max(1.2, q.road.width * 0.35);
      if (n.d > tol) continue;
      if (!q.closed && (n.s < 3 || n.s > q.coarse.length - 3)) continue;
      if (rank(q.road) > rank(e.it.road) || q.road.width < e.it.road.width * 0.7) continue;
      if (!best || n.d < best.n.d) best = { q, n };
    }
    if (!best) continue;
    e.used = true;
    const { q, n } = best;
    const sin = Math.max(0.35, Math.abs(e.inx * n.tz - e.inz * n.tx));
    const dist = Math.max(0, (q.road.width / 2 - OVERLAP - n.d) / sin);
    trims.push({ c: e, dist, major: q, majorW: q.road.width, sin, P: { x: n.x, z: n.z } });
  }
  for (const t of trims) {
    const it = t.c.it;
    trimLine(it.line, t.c.which, t.dist);
    const roundabout = t.major.plan.kind === 'roundabout';
    it.trim[t.c.which] = {
      dist: t.dist, majorW: t.majorW, inside: OVERLAP / Math.max(0.35, t.sin), sin: t.sin, P: t.P,
      inx: t.c.inx, inz: t.c.inz, major: t.major,
      stop: !roundabout && it.rng() < 0.35,
    };
    t.major.junctions.push({ minor: it, which: t.c.which, P: t.P, inx: t.c.inx, inz: t.c.inz });
  }
}

function paintRange(segs, s0, s1, code) {
  const out = [];
  for (const g of segs) {
    if (g.s1 <= s0 || g.s0 >= s1) {
      out.push(g);
      continue;
    }
    if (g.s0 < s0) out.push({ ...g, s1: s0 });
    out.push({ ...g, s0: Math.max(g.s0, s0), s1: Math.min(g.s1, s1), center: code });
    if (g.s1 > s1) out.push({ ...g, s0: s1 });
  }
  return out;
}

function buildItem(item, ctx) {
  const { plan, rng, road } = item;
  const { heightAt } = ctx;
  const rs = resample(item.line, ctx.step, item.closed);
  item.rs = rs;
  const L = rs.length;
  const w = road.width;
  const top = 0.045 + 0.006 * Math.min(plan.importance, 6);
  item.top = top;
  const curves = curveStretches(rs.pts, 130);
  item.curves = curves;
  const mp = markingPlan(plan, L, curves, rng, item.closed);
  let segs = mp.segs;

  const flares = {};
  for (const which of ['start', 'end']) {
    const t = item.trim[which];
    if (!t) continue;
    const flen = Math.min(7, L * 0.4);
    flares[which] = { amount: Math.min(FLARE[plan.kind] ?? 1.5, w * 0.6), length: flen };
    if (t.major.plan.kind === 'roundabout' && w >= 5.5) {
      const sE = which === 'end' ? L - t.inside : t.inside;
      segs = which === 'end' ? paintRange(segs, sE - 32, L, MARK.centre.none) : paintRange(segs, 0, sE + 32, MARK.centre.none);
    } else if (plan.center) segs = which === 'end' ? paintRange(segs, Math.max(0, L - 16), L, MARK.centre.solid) : paintRange(segs, 0, Math.min(L, 16), MARK.centre.solid);
  }

  const recs = buildSections(rs, segs, flares);
  const trackLanes = w < 4.8 && !plan.oneWay ? 1 : plan.lanes;
  const fr = w >= 6 ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.5, 0, 0.5];
  const cols = fr.map((f) => ({
    at: (rec) => {
      const off = f * (w + 2 * rec.flare);
      return {
        off, y: top, ux: off,
        A: [w, rec.mk.center, rec.mk.edge, trackLanes],
        B: [plan.u, plan.seed, plan.wear, plan.tone],
        C: [rec.flare, 0, 0, 0],
      };
    },
  }));
  addStrip(ctx.asphalt, recs, 0, recs.length - 1, cols, heightAt);

  const sA = item.trim.start ? flares.start.length * 0.7 : 0;
  const sB = item.trim.end ? L - flares.end.length * 0.7 : L + 1;
  let i0 = recs.findIndex((r) => r.s >= sA - 1e-6);
  let i1 = recs.length - 1;
  while (i1 > 0 && recs[i1].s > sB + 1e-6) i1--;
  if (i0 < 0) i0 = 0;
  if (i1 - i0 >= 1) {
    for (const side of [-1, 1]) {
      const sh = side < 0 ? plan.shoulder.l : plan.shoulder.r;
      addStrip(ctx.verge, recs, i0, i1, shoulderColumns(side, sh, w, top, plan, ctx.grassAt), heightAt);
    }
    if (plan.shoulder.l.type === 'island') island(item, rs, recs, ctx);
  }

  const ground = (x, z) => heightAt(x, z) + top + 0.007;
  const wearOf = () => plan.wear * (0.7 + 0.6 * rng());
  for (const a of mp.arrows) arrow(ctx.decals, pointAt(rs.pts, a.s), a.dir, ground, wearOf());
  for (const which of ['start', 'end']) {
    const t = item.trim[which];
    if (!t) continue;
    const dir = which === 'end' ? 1 : -1;
    const sEdge = which === 'end' ? L - t.inside : t.inside;
    const sLine = sEdge - dir * (plan.kind === 'local' ? 1.6 : 2.0);
    const p = pointAt(rs.pts, sLine);
    const b1 = Math.max(0.6, w / 2 - 0.12);
    const ring = t.major.plan.kind === 'roundabout';
    if (!ring && t.stop) stopLine(ctx.decals, p, dir, 0.1, b1, ground, wearOf());
    else giveWay(ctx.decals, p, dir, 0.1, b1, ground, wearOf());
    if (ring && L > 25) {
      zebra(ctx.decals, pointAt(rs.pts, sEdge - dir * 6), w, ground, wearOf(), plan.urban ? 2.5 : 4);
      if (w >= 5.5 && L > 40) {
        const at = (s, a) => {
          const q = pointAt(rs.pts, s);
          const [x, z] = lateral(q, a);
          return [x, ground(x, z), z];
        };
        const sa = Math.min(sEdge - dir * 11, sEdge - dir * 30);
        const sb = Math.max(sEdge - dir * 11, sEdge - dir * 30);
        const s0 = sa;
        const s1 = sb;
        hatchZone(ctx.decals, at, { s0, s1, a0: -0.7, a1: 0, slant: -dir }, wearOf());
        hatchZone(ctx.decals, at, { s0, s1, a0: 0, a1: 0.7, slant: dir }, wearOf());
        for (const a of [-0.78, 0.78]) longLine(ctx.decals, at, s0, s1, a, plan.u * 3, wearOf());
      }
    }
  }
  if (plan.oneWay && plan.lanes >= 2 && L > 130 && !item.closed) {
    for (let k = 0; k < plan.lanes; k++) {
      const a = -w / 2 + ((k + 0.5) * w) / plan.lanes;
      for (const s of [45, 75, 105]) laneArrow(ctx.decals, pointAt(rs.pts, s), 1, a, ground, wearOf());
    }
  }
  if (ctx.furniture && road.style?.signs !== false) addFurniture(item, ctx, mp);
}

function shoulderColumns(side, sh, w, top, plan, grassAt) {
  const W = sh.w;
  const seg = [];
  const mat = sh.type === 'dry' ? 2 : sh.type === 'gravel' ? 0 : 1;
  if (sh.type === 'curb') {
    seg.push([0, top, 0, top + 0.12, 4], [0, top + 0.12, 0.15, top + 0.12, 3], [0.15, top + 0.12, W, top + 0.12, 3], [W, top + 0.12, W, 0.012, 4]);
  } else if (sh.type === 'island') {
    seg.push([0, top, 0, top + 0.13, 4], [0, top + 0.13, 0.25, top + 0.13, 3]);
  } else if (sh.type === 'median') {
    seg.push([-0.12, top - 0.006, W, 0.03, 6]);
  } else {
    seg.push([-0.12, top - 0.006, 0.35, top - 0.022, mat], [0.35, top - 0.022, W, 0.02, mat], [W, 0.02, W + 1.0, 0.012, mat]);
  }
  const list = side > 0 ? seg : seg.slice().reverse().map(([a, b, c, d, m]) => [c, d, a, b, m]);
  const total = sh.type === 'island' ? 0.25 : W;
  const cols = [];
  const mk = (lat, y, m) => ({
    at: (rec) => ({
      off: side * (w / 2 + rec.flare + lat), y, ux: lat,
      A: [Math.max(total, 0.01), m, 0, 0], B: [plan.seed, plan.wear, 0, 0], C: [...grassAt(rec.x, rec.z), 0],
    }),
  });
  list.forEach(([l0, y0, l1, y1, m], i) => {
    cols.push(mk(l0, y0, m));
    const last = mk(l1, y1, m);
    if (i < list.length - 1) last.skipNext = true;
    cols.push(last);
  });
  return cols;
}

function island(item, rs, recs, ctx) {
  const { plan, road } = item;
  const ring = [];
  let cx = 0;
  let cz = 0;
  for (const p of rs.pts) {
    const [x, z] = lateral(p, -(road.width / 2 + 0.25));
    ring.push({ x, z });
    cx += x;
    cz += z;
  }
  const centre = { x: cx / ring.length, z: cz / ring.length };
  addFan(ctx.verge, ring, centre, ctx.heightAt, item.top + 0.13, [9999, 5, 0, 0], [plan.seed, plan.wear, 0, 0], [...ctx.grassAt(centre.x, centre.z), 0]);
  item.island = { ...centre, radius: Math.hypot(ring[0].x - centre.x, ring[0].z - centre.z) };
}

function railPath(rs, side, off, s0, s1, ctx, step = 2) {
  const path = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const p = pointAt(rs.pts, s0 + ((s1 - s0) * i) / n, rs.closed, rs.length);
    const [x, z] = lateral(p, side * off);
    path.push({ x, z, y: ctx.heightAt(x, z), nx: 0, nz: 0 });
  }
  path.forEach((q, i) => {
    const p = pointAt(rs.pts, s0 + ((s1 - s0) * i) / n, rs.closed, rs.length);
    q.nx = -p.tz * side;
    q.nz = p.tx * side;
  });
  return path;
}

function addFurniture(item, ctx, mp) {
  const { plan, rng, rs, road } = item;
  const { fb, sb, heightAt } = ctx;
  const w = road.width;
  const L = rs.length;
  const kind = plan.kind;
  const postColor = COLORS.zinc;

  const place = (s, travel, panels, lat = w / 2 + 1.35) => {
    const p = pointAt(rs.pts, s, rs.closed, L);
    const side = travel;
    const [x, z] = lateral(p, side * lat);
    const fx = -p.tx * travel;
    const fz = -p.tz * travel;
    signStack(sb, fb, heightAt(x, z), x, z, fx, fz, panels, plan.gamma, 1.0, postColor);
  };
  const ok = (s) => item.closed || (s > 6 && s < L - 6);

  const signed = kind === 'rural' || kind === 'regional' || kind === 'national' || kind === 'ramp';
  for (const c of item.curves) {
    if (item.closed || c.rmin >= 110 || c.s1 - c.s0 < 10) continue;
    if (!signed && !(kind === 'local' && c.rmin < 60)) continue;
    for (const travel of [1, -1]) {
      if (plan.oneWay && travel < 0) continue;
      const turn = c.turn * travel;
      const D = rng() < 0.55 ? 150 : rng.pick([80, 100]);
      const s = travel > 0 ? c.s0 - D : c.s1 + D;
      if (!ok(s)) continue;
      const speed = c.rmin < 45 ? 'B14_50' : c.rmin < 70 ? 'B14_70' : 'B14_80';
      const panels = [];
      if (D === 150 && rng() < 0.7) panels.push({ face: 'M2_150' });
      if (rng() < 0.45 || D === 150) panels.push({ face: speed });
      panels.push({ face: rng() < 0.2 && c.s1 - c.s0 > 60 ? 'A1c' : 'A1a', flip: turn > 0 });
      place(s, travel, panels);
    }
    const outside = -c.turn;
    if (plan.guardCurves && !plan.oneWay) {
      const s0 = Math.max(0, c.s0 - 8);
      const s1 = Math.min(L, c.s1 + 8);
      guardrail(fb, railPath(rs, outside, w / 2 + 1.1, s0, s1, ctx), false);
    } else {
      const sp = c.rmin < 60 ? 10 : 14;
      for (let s = Math.max(0, c.s0 - 6); s <= Math.min(L, c.s1 + 6); s += sp) {
        const p = pointAt(rs.pts, s);
        const [x, z] = lateral(p, outside * (w / 2 + 1.4));
        marker(fb, x, heightAt(x, z), z, false);
      }
    }
    if (c.rmin < 45) {
      for (const f of [0.2, 0.5, 0.8]) {
        const p = pointAt(rs.pts, c.s0 + (c.s1 - c.s0) * f);
        const [x, z] = lateral(p, outside * (w / 2 + 1.8));
        chevrons(fb, x, heightAt(x, z), z, -p.tz * -outside, p.tx * -outside, w >= 5.2 ? 0.6 : 0.4);
      }
    }
  }

  for (const side of [-1, 1]) {
    const b = side < 0 ? plan.barrier.l : plan.barrier.r;
    if (!b) continue;
    const off = side < 0 ? w / 2 + 0.65 : w / 2 + 1.1;
    const path = railPath(rs, side, off, 0, L, ctx);
    if (b === 'concrete') concreteBarrier(fb, path);
    else guardrail(fb, path);
  }

  if (!item.closed && L > 90 && road.style?.speed !== false) {
    const speed = kind === 'dual' ? 'B14_110' : kind === 'national' ? rng.pick(['B14_80', 'B14_90']) : kind === 'regional' ? rng.pick(['B14_80', 'B14_90', 'B14_70']) : kind === 'rural' ? 'B14_70' : null;
    if (speed && rng() < 0.8) place(Math.min(25, L * 0.2), 1, [{ face: speed }]);
  }

  if (!item.closed && L > 150 && (kind === 'regional' || kind === 'national') && !plan.oneWay) {
    const p = pointAt(rs.pts, L * rng.range(0.3, 0.7));
    const [x, z] = lateral(p, w / 2 + 1.0);
    borne(fb, x, heightAt(x, z), z, Math.atan2(p.tx, p.tz), kind === 'national' ? COLORS.red : COLORS.yellow);
  }

  for (const which of ['start', 'end']) {
    const t = item.trim[which];
    if (!t) continue;
    const travel = which === 'end' ? 1 : -1;
    const sSign = which === 'end' ? L - 9 : 9;
    if (L > 20) place(sSign, travel, [{ face: t.stop ? 'AB4' : 'AB3a' }]);
    const sEdge = which === 'end' ? L - t.inside : t.inside;
    const p = pointAt(rs.pts, sEdge + (which === 'end' ? -0.6 : 0.6));
    for (const side of [-1, 1]) {
      const [x, z] = lateral(p, side * (w / 2 + (FLARE[kind] ?? 1.5) + 0.5));
      marker(fb, x, heightAt(x, z), z, true);
    }
  }
}

function addPriorityFurniture(item, ctx) {
  const { plan, rs, road, rng } = item;
  if (!item.junctions.length) return;
  const { fb, sb, heightAt } = ctx;
  const w = road.width;
  for (const j of item.junctions) {
    if (plan.kind === 'roundabout') {
      if (!item.island) continue;
      const dx = item.island.x - j.P.x;
      const dz = item.island.z - j.P.z;
      const l = Math.hypot(dx, dz) || 1;
      const x = j.P.x + (dx / l) * (w / 2 + 0.25 + 0.7);
      const z = j.P.z + (dz / l) * (w / 2 + 0.25 + 0.7);
      chevrons(fb, x, heightAt(x, z), z, j.inx, j.inz, 0.6);
      continue;
    }
    if (plan.kind === 'local' || item.road.style?.signs === false) continue;
    const n = nearestOnPolyline(rs.pts, j.P.x, j.P.z);
    for (const travel of [1, -1]) {
      if (plan.oneWay && travel < 0) continue;
      const s = n.s - travel * 80;
      if (s < 6 || s > rs.length - 6 || rng() > 0.7) continue;
      const p = pointAt(rs.pts, s);
      const [x, z] = lateral(p, travel * (w / 2 + 1.35));
      signStack(sb, fb, heightAt(x, z), x, z, -p.tx * travel, -p.tz * travel, [{ face: 'AB2' }], plan.gamma, 1.0, COLORS.zinc);
    }
  }
}
