import { Buf, Frame, box, planBox, DEG, sub, add, mul, unit, left, len, offsetLine, insetPolygon, triangulate, lin, scale, mixc } from './geom.js';
import { TRIM } from './materials.js';
import { mulberry32 } from '../../engine/rng.js';

export const PALETTE = {
  plaster: [[236, 230, 216], [222, 205, 175], [214, 200, 176], [222, 184, 120], [214, 170, 140], [196, 194, 188],
    [210, 208, 200], [226, 196, 180], [205, 150, 110], [200, 205, 180], [232, 220, 196], [188, 176, 160]],
  villaPlaster: [[238, 232, 220], [228, 214, 190], [222, 208, 184], [214, 204, 190], [230, 220, 205], [206, 196, 178]],
  brick: [[150, 70, 50], [126, 62, 45], [170, 88, 58], [190, 150, 104], [140, 80, 60], [160, 100, 70]],
  stone: [[176, 160, 135], [160, 148, 128], [190, 175, 150]],
  size: [[214, 204, 182], [222, 212, 190], [200, 190, 168]],
  concrete: [[172, 170, 162], [150, 148, 142], [196, 192, 182]],
  wood: [[140, 105, 75], [118, 112, 104], [160, 120, 84], [96, 78, 62]],
  shutter: [[235, 235, 230], [190, 192, 190], [62, 65, 68], [150, 175, 140], [56, 86, 66], [110, 130, 150], [150, 160, 185],
    [112, 42, 46], [150, 42, 36], [130, 90, 60], [210, 196, 166], [96, 120, 110]],
  joinery: [[240, 240, 236], [240, 240, 236], [240, 240, 236], [56, 62, 66], [56, 62, 66], [118, 80, 52], [150, 152, 150]],
  door: [[80, 52, 34], [40, 58, 82], [112, 42, 46], [56, 62, 66], [56, 86, 66], [150, 110, 70], [230, 228, 222], [24, 26, 28]],
  tile: [[160, 76, 52], [118, 66, 46], [142, 92, 70], [172, 98, 64], [104, 58, 44]],
  slate: [[64, 68, 76], [74, 78, 86], [56, 60, 66]],
  zinc: [[128, 136, 140], [112, 118, 122]],
  terrace: [[84, 84, 82], [128, 124, 116], [104, 102, 98]],
  shopfront: [[34, 36, 38], [56, 62, 66], [180, 182, 180], [40, 56, 50], [70, 40, 34]],
  store: [[150, 40, 36], [46, 74, 60], [60, 70, 100], [200, 180, 140], [90, 92, 96], [180, 120, 50]],
  sill: [[214, 206, 188], [196, 192, 184], [226, 222, 214]],
};
const pick = (rng, list) => lin(list[Math.floor(rng() * list.length)]);

export class Ctx {
  constructor(heightAt) {
    this.bufs = new Map();
    this.obstacles = [];
    this.heightAt = heightAt;
    this.count = { buildings: 0, windows: 0 };
    this.kinds = {};
  }

  buf(key) {
    if (!this.bufs.has(key)) this.bufs.set(key, new Buf(key === 'glass' ? ['glass', 'room'] : ['info']));
    return this.bufs.get(key);
  }

  ground(p) {
    return this.heightAt(p[0], -p[1]);
  }

  box(x, y, base, top, length, width, headingDeg) {
    this.obstacles.push(['box', x, y, base, top, length, width, headingDeg]);
  }

  cylinder(x, y, base, top, r) {
    this.obstacles.push(['cylinder', x, y, base, top, r]);
  }
}

const trimVals = (pattern, rough, metal, seed) => [[pattern, rough, metal, seed]];

function wallWithHoles(ctx, f, L, hb, ht, holes, wall) {
  const buf = ctx.buf(wall.key);
  const vals = [[L, wall.top, wall.seed, wall.plinth + (wall.quoins ? 10 : 0)]];
  const hs = [hb, ht];
  for (const o of holes) hs.push(Math.max(hb, Math.min(ht, o.h0)), Math.max(hb, Math.min(ht, o.h1)));
  const breaks = [...new Set(hs.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const out = f.out;
  for (let i = 0; i + 1 < breaks.length; i++) {
    const b0 = breaks[i];
    const b1 = breaks[i + 1];
    if (b1 - b0 < 1e-4) continue;
    const cuts = holes.filter((o) => o.h0 <= b0 + 1e-4 && o.h1 >= b1 - 1e-4).map((o) => [o.u0, o.u1]).sort((a, b) => a[0] - b[0]);
    let u = 0;
    const spans = [];
    for (const [c0, c1] of cuts) {
      if (c0 > u + 1e-4) spans.push([u, c0]);
      u = Math.max(u, c1);
    }
    if (u < L - 1e-4) spans.push([u, L]);
    for (const [u0, u1] of spans) {
      buf.quad(f.p(u0, b0), f.p(u1, b0), f.p(u1, b1), f.p(u0, b1), [[u0, b0], [u1, b0], [u1, b1], [u0, b1]], wall.color, vals, out);
    }
  }
}

function reveals(ctx, f, o, depth, wall, faces = 'lrtb') {
  const buf = ctx.buf(wall.key);
  const vals = [[1, wall.top, wall.seed, 0]];
  const { u0, u1, h0, h1 } = o;
  const al = f.along;
  const back = [-al[0], 0, -al[2]];
  if (faces.includes('l')) buf.quad(f.p(u0, h0, 0), f.p(u0, h0, -depth), f.p(u0, h1, -depth), f.p(u0, h1, 0), [[u0, h0], [u0 + depth, h0], [u0 + depth, h1], [u0, h1]], wall.color, vals, al);
  if (faces.includes('r')) buf.quad(f.p(u1, h0, -depth), f.p(u1, h0, 0), f.p(u1, h1, 0), f.p(u1, h1, -depth), [[u1, h0], [u1 + depth, h0], [u1 + depth, h1], [u1, h1]], wall.color, vals, back);
  if (faces.includes('t')) buf.quad(f.p(u0, h1, 0), f.p(u0, h1, -depth), f.p(u1, h1, -depth), f.p(u1, h1, 0), [[u0, h1], [u0, h1 + depth], [u1, h1 + depth], [u1, h1]], wall.color, vals, [0, -1, 0]);
  if (faces.includes('b')) buf.quad(f.p(u0, h0, -depth), f.p(u0, h0, 0), f.p(u1, h0, 0), f.p(u1, h0, -depth), [[u0, h0], [u0, h0 + depth], [u1, h0 + depth], [u1, h0]], wall.color, vals, [0, 1, 0]);
}

function glassQuad(ctx, f, u0, u1, h0, h1, w, frame, glass, room) {
  ctx.buf('glass').quad(f.p(u0, h0, w), f.p(u1, h0, w), f.p(u1, h1, w), f.p(u0, h1, w), [[0, 0], [1, 0], [1, 1], [0, 1]], frame,
    [[u1 - u0, h1 - h0, glass[0], glass[1]], room], f.out);
  ctx.count.windows++;
}

function railing(ctx, f, u0, u1, h, w, color, seed, height = 1.0) {
  const buf = ctx.buf('trim');
  const v = trimVals(TRIM.metal, 0.5, 0.4, seed);
  box(buf, f, u0, u1, h + height - 0.04, h + height, w - 0.04, w, color, v);
  box(buf, f, u0, u1, h + 0.08, h + 0.11, w - 0.03, w - 0.01, color, v, 'fst');
  const n = Math.max(2, Math.round((u1 - u0) / 0.11));
  for (let k = 0; k <= n; k++) {
    const u = u0 + ((u1 - u0) * k) / n;
    box(buf, f, u - 0.01, u + 0.01, h + 0.08, h + height - 0.04, w - 0.03, w - 0.01, color, v, 'fslr');
  }
}

function windowAt(ctx, f, o, wall, s) {
  const rng = s.rng;
  const depth = s.depth ?? 0.2;
  reveals(ctx, f, o, depth, wall);
  const seed = Math.floor(rng() * 1000);
  const shut = s.shutters;
  const closedCasements = shut === 'casements' && rng() < 0.12;
  const rollClosed = shut === 'rolling' ? (rng() < 0.25 ? rng() * 0.9 : rng() < 0.3 ? 1 : 0) : 0;
  if (closedCasements) {
    box(ctx.buf('trim'), f, o.u0, o.u1, o.h0, o.h1, -depth + 0.02, -depth + 0.06, s.shutterColor, trimVals(s.shutterPattern, 0.7, 0, seed), 'f');
  } else {
    glassQuad(ctx, f, o.u0, o.u1, o.h0, o.h1, -depth + 0.06, s.frame, [seed, s.glassType ?? 0],
      [o.sill ?? 0.95, 3.5 + rng() * 2, rollClosed, rng() < 0.45 ? 1 : rng() < 0.4 ? 2 : 0]);
  }
  const trim = ctx.buf('trim');
  if (s.sill && !o.door) box(trim, f, o.u0 - 0.05, o.u1 + 0.05, o.h0 - 0.06, o.h0, -0.02, 0.05, s.sill, trimVals(TRIM.plain, 0.85, 0, seed));
  if (s.surround) {
    const c = s.surround;
    const v = trimVals(TRIM.plain, 0.85, 0, seed);
    const k = 0.14;
    box(trim, f, o.u0 - k, o.u0, o.h0, o.h1 + k, 0, 0.03, c, v, 'flrt');
    box(trim, f, o.u1, o.u1 + k, o.h0, o.h1 + k, 0, 0.03, c, v, 'flrt');
    box(trim, f, o.u0, o.u1, o.h1, o.h1 + k, 0, 0.03, c, v, 'ft');
  }
  if (shut === 'casements' && !closedCasements) {
    const half = (o.u1 - o.u0) / 2;
    const v = trimVals(s.shutterPattern, 0.7, 0, seed);
    box(trim, f, o.u0 - half - (s.surround ? 0.14 : 0), o.u0 - (s.surround ? 0.14 : 0), o.h0, o.h1, 0.01, 0.045, s.shutterColor, v, 'flr');
    box(trim, f, o.u1 + (s.surround ? 0.14 : 0), o.u1 + half + (s.surround ? 0.14 : 0), o.h0, o.h1, 0.01, 0.045, s.shutterColor, v, 'flr');
  }
  if (shut === 'rolling' && s.shutterBox) box(trim, f, o.u0, o.u1, o.h1 - 0.22, o.h1, -depth + 0.02, -depth + 0.07, s.frame, trimVals(TRIM.plain, 0.6, 0, seed), 'fb');
  if (o.juliet) railing(ctx, f, o.u0, o.u1, o.h0, 0.06, s.railColor, seed);
}

function doorAt(ctx, f, o, wall, s) {
  const depth = 0.22;
  reveals(ctx, f, o, depth, wall);
  const seed = Math.floor(s.rng() * 1000);
  const transom = o.h1 - o.h0 > 2.45 ? 0.4 : 0;
  const trim = ctx.buf('trim');
  if (s.glassDoor) {
    glassQuad(ctx, f, o.u0, o.u1, o.h0, o.h1, -depth + 0.05, s.frame, [seed, 2], [0, 6, 0, 0]);
  } else {
    box(trim, f, o.u0, o.u1, o.h0, o.h1 - transom, -depth, -depth + 0.05, s.doorColor, trimVals(s.doorPattern ?? TRIM.planks, 0.6, 0, seed), 'f');
    if (transom) glassQuad(ctx, f, o.u0, o.u1, o.h1 - transom, o.h1, -depth + 0.05, s.doorColor, [seed, 0], [0, 3, 0, 0]);
  }
  if (o.h0 > 0.05) box(trim, f, o.u0 - 0.15, o.u1 + 0.15, -0.3, o.h0, 0, 0.35, s.stepColor ?? lin([170, 166, 158]), trimVals(TRIM.plain, 0.9, 0, seed), 'ftlr');
}

function garageAt(ctx, f, o, wall, s) {
  reveals(ctx, f, o, 0.15, wall, 'lrt');
  box(ctx.buf('trim'), f, o.u0, o.u1, o.h0, o.h1, -0.15, -0.1, s.garageColor, trimVals(s.rng() < 0.6 ? TRIM.garage : TRIM.rollup, 0.55, 0.2, Math.floor(s.rng() * 1000)), 'f');
}

function shopAt(ctx, f, o, wall, s) {
  const rng = s.rng;
  const seed = Math.floor(rng() * 1000);
  const depth = 0.25;
  reveals(ctx, f, o, depth, wall);
  const trim = ctx.buf('trim');
  const frame = s.shopFrame;
  box(trim, f, o.u0, o.u1, o.h0, o.h0 + 0.45, -depth, -depth + 0.06, frame, trimVals(TRIM.plain, 0.5, 0.3, seed), 'ft');
  glassQuad(ctx, f, o.u0, o.u1, o.h0 + 0.45, o.h1, -depth + 0.04, frame, [seed, 2], [0.45, 5 + rng() * 3, rng() < 0.1 ? 0.7 : 0, 0]);
  box(trim, f, o.u0 - 0.1, o.u1 + 0.1, o.h1 + 0.05, o.h1 + 0.6, 0, 0.06, s.fascia, trimVals(TRIM.plain, 0.5, 0.1, seed), 'fltb'.concat('r'));
  if (s.awning) {
    const reach = 1.2;
    const c = s.awningColor;
    const v = trimVals(rng() < 0.5 ? TRIM.planks : TRIM.plain, 0.9, 0, seed);
    const b = trim;
    const z1 = o.h1 + 0.05;
    const z0 = o.h1 - 0.45;
    const P = (u, h, w) => f.p(u, h, w);
    b.quad(P(o.u0, z0, reach), P(o.u1, z0, reach), P(o.u1, z1, 0.06), P(o.u0, z1, 0.06), [[o.u0, 0], [o.u1, 0], [o.u1, 1.3], [o.u0, 1.3]], c, v);
    b.quad(P(o.u0, z1, 0.06), P(o.u1, z1, 0.06), P(o.u1, z0, reach), P(o.u0, z0, reach), [[o.u0, 0], [o.u1, 0], [o.u1, 1.3], [o.u0, 1.3]], scale(c, 0.6), v);
    b.quad(P(o.u0, z0 - 0.22, reach), P(o.u1, z0 - 0.22, reach), P(o.u1, z0, reach), P(o.u0, z0, reach), [[o.u0, 0], [o.u1, 0], [o.u1, 0.2], [o.u0, 0.2]], c, v, f.out);
    const [x, y] = f.plan((o.u0 + o.u1) / 2, reach / 2);
    ctx.box(x, y, f.z0 + z0 - 0.25, f.z0 + z1, o.u1 - o.u0, reach, Math.atan2(f.ty, f.tx) / DEG);
  }
}

function placeOpening(ctx, f, o, wall, s) {
  if (o.type === 'door') doorAt(ctx, f, o, wall, s);
  else if (o.type === 'garage') garageAt(ctx, f, o, wall, s);
  else if (o.type === 'shop') shopAt(ctx, f, o, wall, s);
  else if (o.type === 'flush') glassQuad(ctx, f, o.u0, o.u1, o.h0, o.h1, 0.02, s.frame, [Math.floor(s.rng() * 1000), 0], [0.95, 3, s.rng() < 0.3 ? 1 : 0, s.rng() < 0.5 ? 1 : 0]);
  else windowAt(ctx, f, o, wall, s);
}

function buildWall(ctx, f, L, hb, ht, openings, wall, s) {
  wallWithHoles(ctx, f, L, hb, ht, openings.filter((o) => o.type !== 'flush'), wall);
  for (const o of openings) placeOpening(ctx, f, o, wall, s);
}

function roofPlane(ctx, key, pts, eaveA, eaveB, color, seed, moss) {
  const buf = ctx.buf(key);
  const d = unit([eaveB[0] - eaveA[0], -(eaveB[2] - eaveA[2])]);
  const uvOf = (p) => {
    const rel = [p[0] - eaveA[0], -(p[2] - eaveA[2])];
    const u = rel[0] * d[0] + rel[1] * d[1];
    const across = Math.abs(-rel[0] * d[1] + rel[1] * d[0]);
    return [u, Math.hypot(across, p[1] - eaveA[1])];
  };
  const vals = [[seed, moss, 0, 0]];
  if (pts.length === 3) buf.tri(pts[0], pts[1], pts[2], pts.map(uvOf), color, vals);
  else buf.quad(pts[0], pts[1], pts[2], pts[3], pts.map(uvOf), color, vals);
}

function gableRoof(ctx, f, L, D, hE, pitch, ov, overSide, roof, wall, trimColor, seed) {
  const t = Math.tan(pitch * DEG);
  const hR = hE + (D / 2) * t;
  const he = hE - ov * t;
  const P = (u, h, w) => f.p(u, h, w);
  const a = -overSide;
  const b = L + overSide;
  const moss = roof.moss;
  roofPlane(ctx, roof.key, [P(a, he, ov), P(b, he, ov), P(b, hR, -D / 2), P(a, hR, -D / 2)], P(a, he, ov), P(b, he, ov), roof.color, seed, moss);
  roofPlane(ctx, roof.key, [P(b, he, -D - ov), P(a, he, -D - ov), P(a, hR, -D / 2), P(b, hR, -D / 2)], P(b, he, -D - ov), P(a, he, -D - ov), roof.color, seed + 1, moss);
  const wb = ctx.buf(wall.key);
  const vals = [[D, hR, wall.seed, 0]];
  const al = f.along;
  wb.tri(P(0, hE, -D), P(0, hE, 0), P(0, hR, -D / 2), [[0, hE], [D, hE], [D / 2, hR]], wall.color, vals, [-al[0], 0, -al[2]]);
  wb.tri(P(L, hE, 0), P(L, hE, -D), P(L, hR, -D / 2), [[0, hE], [D, hE], [D / 2, hR]], wall.color, vals, al);
  const tb = ctx.buf('trim');
  const tv = trimVals(TRIM.plain, 0.8, 0, seed);
  for (const [w0, w1] of [[0, ov], [-D - ov, -D]]) {
    const hh = w0 === 0 ? [hE, he] : [he, hE];
    tb.quad(P(a, hh[0], w0), P(b, hh[0], w0), P(b, hh[1], w1), P(a, hh[1], w1), [[0, 0], [1, 0], [1, 1], [0, 1]], trimColor, tv, [0, -1, 0]);
  }
  box(tb, f, a, b, he - 0.16, he, ov - 0.02, ov + 0.03, trimColor, tv, 'fb');
  box(tb, f, a, b, he - 0.16, he, -D - ov - 0.03, -D - ov + 0.02, trimColor, tv, 'sb');
  const ridgeColor = scale(roof.color, 0.8);
  box(tb, f, a, b, hR - 0.06, hR + 0.1, -D / 2 - 0.13, -D / 2 + 0.13, ridgeColor, trimVals(TRIM.plain, 0.85, 0, seed), 'fst');
  const zinc = lin([150, 154, 156]);
  const zv = trimVals(TRIM.metal, 0.5, 0.5, seed);
  box(tb, f, a, b, he - 0.18, he - 0.06, ov, ov + 0.13, zinc, zv, 'fbt');
  box(tb, f, L - 0.35, L - 0.25, -0.2, he - 0.12, 0.03, 0.12, zinc, zv, 'flr');
  return hR;
}

function hipRoof(ctx, f, L, D, hE, pitch, ov, roof, trimColor, seed) {
  const t = Math.tan(pitch * DEG);
  const he = hE - ov * t;
  const L2 = L + 2 * ov;
  const D2 = D + 2 * ov;
  const P = (u, h, w) => f.p(u, h, w);
  const u0 = -ov, u1 = L + ov, w0 = ov, w1 = -D - ov;
  const k = Math.min(L2, D2) / 2;
  const hR = he + k * t;
  const moss = roof.moss;
  if (L2 >= D2) {
    const r0 = u0 + k, r1 = u1 - k, wm = (w0 + w1) / 2;
    roofPlane(ctx, roof.key, [P(u0, he, w0), P(u1, he, w0), P(r1, hR, wm), P(r0, hR, wm)], P(u0, he, w0), P(u1, he, w0), roof.color, seed, moss);
    roofPlane(ctx, roof.key, [P(u1, he, w1), P(u0, he, w1), P(r0, hR, wm), P(r1, hR, wm)], P(u1, he, w1), P(u0, he, w1), roof.color, seed + 1, moss);
    roofPlane(ctx, roof.key, [P(u1, he, w0), P(u1, he, w1), P(r1, hR, wm)], P(u1, he, w0), P(u1, he, w1), roof.color, seed + 2, moss);
    roofPlane(ctx, roof.key, [P(u0, he, w1), P(u0, he, w0), P(r0, hR, wm)], P(u0, he, w1), P(u0, he, w0), roof.color, seed + 3, moss);
    box(ctx.buf('trim'), f, r0, r1, hR - 0.05, hR + 0.09, wm - 0.12, wm + 0.12, scale(roof.color, 0.8), trimVals(TRIM.plain, 0.85, 0, seed), 'fstlr');
  } else {
    const um = (u0 + u1) / 2, r0 = w0 - k, r1 = w1 + k;
    roofPlane(ctx, roof.key, [P(u0, he, w0), P(u1, he, w0), P(um, hR, r0)], P(u0, he, w0), P(u1, he, w0), roof.color, seed, moss);
    roofPlane(ctx, roof.key, [P(u1, he, w1), P(u0, he, w1), P(um, hR, r1)], P(u1, he, w1), P(u0, he, w1), roof.color, seed + 1, moss);
    roofPlane(ctx, roof.key, [P(u1, he, w0), P(u1, he, w1), P(um, hR, r1), P(um, hR, r0)], P(u1, he, w0), P(u1, he, w1), roof.color, seed + 2, moss);
    roofPlane(ctx, roof.key, [P(u0, he, w1), P(u0, he, w0), P(um, hR, r0), P(um, hR, r1)], P(u0, he, w1), P(u0, he, w0), roof.color, seed + 3, moss);
  }
  const tb = ctx.buf('trim');
  const tv = trimVals(TRIM.plain, 0.8, 0, seed);
  const ring = [[0, 0], [L, 0], [L, -D], [0, -D]];
  const ringO = [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tb.quad(P(ring[i][0], hE, ring[i][1]), P(ring[j][0], hE, ring[j][1]), P(ringO[j][0], he, ringO[j][1]), P(ringO[i][0], he, ringO[i][1]), [[0, 0], [1, 0], [1, 1], [0, 1]], trimColor, tv, [0, -1, 0]);
  }
  const zinc = lin([150, 154, 156]);
  const zv = trimVals(TRIM.metal, 0.5, 0.5, seed);
  box(tb, f, u0, u1, he - 0.18, he - 0.04, w0, w0 + 0.12, zinc, zv, 'fbtlr');
  box(tb, f, u0, u1, he - 0.18, he - 0.04, w1 - 0.12, w1, zinc, zv, 'sbtlr');
  box(tb, f, L - 0.3, L - 0.2, -0.2, he - 0.1, 0.03, 0.12, zinc, zv, 'flr');
  return hR;
}

function flatRoof(ctx, poly, zRoof, zTop, wall, membrane, coping, seed, equip = 0) {
  const inner = insetPolygon(poly, 0.22);
  const tris = triangulate(inner);
  const rng = mulberry32(seed + 77);
  const big = tris.map(([a, b, c]) => [inner[a], inner[b], inner[c]]).filter(([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2 > 6);
  for (let i = 0; i < equip && big.length; i++) {
    const [a, b, c] = big[Math.floor(rng() * big.length)];
    const w0 = rng(), w1 = rng() * (1 - w0);
    const p = [a[0] * w0 + b[0] * w1 + c[0] * (1 - w0 - w1), a[1] * w0 + b[1] * w1 + c[1] * (1 - w0 - w1)];
    const l = 0.8 + rng() * 0.9, w = 0.6 + rng() * 0.6, h = 0.5 + rng() * 0.7;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    planBox(ctx.buf('trim'), p[0], p[1], ang, l, w, zRoof, zRoof + h, lin([150, 152, 150]), trimVals(TRIM.metal, 0.5, 0.4, seed + i), 'fsntlr');
  }
  const rb = ctx.buf('roof:membrane');
  const rv = [[seed, 0.15, 0, 0]];
  for (let [a, b, c] of tris) {
    const P = (q) => [q[0], zRoof, -q[1]];
    const area = (inner[b][0] - inner[a][0]) * (inner[c][1] - inner[a][1]) - (inner[b][1] - inner[a][1]) * (inner[c][0] - inner[a][0]);
    if (area < 0) [b, c] = [c, b];
    rb.tri(P(inner[a]), P(inner[b]), P(inner[c]), [inner[a], inner[b], inner[c]], membrane, rv, [0, 1, 0]);
  }
  const wb = ctx.buf(wall.key);
  const tb = ctx.buf('trim');
  const tv = trimVals(TRIM.metal, 0.6, 0.3, seed);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = inner[i], b = inner[j];
    const l = len(sub(b, a));
    wb.quad([b[0], zRoof, -b[1]], [a[0], zRoof, -a[1]], [a[0], zTop, -a[1]], [b[0], zTop, -b[1]], [[0, 0], [l, 0], [l, zTop - zRoof], [0, zTop - zRoof]], wall.color, [[l, zTop, wall.seed, 0]]);
    const o0 = poly[i], o1 = poly[j];
    const e = 0.04;
    tb.quad([o0[0], zTop + e, -o0[1]], [o1[0], zTop + e, -o1[1]], [b[0], zTop + e, -b[1]], [a[0], zTop + e, -a[1]], [[0, 0], [l, 0], [l, 0.2], [0, 0.2]], coping, tv, [0, 1, 0]);
    const f = Frame.from(o0, o1, 0);
    const lo = len(sub(o1, o0));
    tb.quad(f.p(0, zTop - 0.06, 0.03), f.p(lo, zTop - 0.06, 0.03), f.p(lo, zTop + e, 0.03), f.p(0, zTop + e, 0.03), [[0, 0], [lo, 0], [lo, 0.1], [0, 0.1]], coping, tv, f.out);
  }
}

function styleOf(rng, kind) {
  const r = rng();
  let wallKey, color, quoins = false, plinth = 0.6;
  if (kind === 'villa') {
    wallKey = r < 0.82 ? 'wall:render' : r < 0.92 ? 'wall:stone' : 'wall:brick';
    color = wallKey === 'wall:render' ? pick(rng, PALETTE.villaPlaster) : wallKey === 'wall:stone' ? pick(rng, PALETTE.stone) : pick(rng, PALETTE.brick);
    plinth = rng() < 0.6 ? 0.45 : 0;
  } else if (kind === 'block' || kind === 'angle') {
    wallKey = r < 0.55 ? 'wall:render' : r < 0.75 ? 'wall:brick' : r < 0.88 ? 'wall:concrete' : 'wall:ashlar';
    color = { 'wall:render': PALETTE.plaster, 'wall:brick': PALETTE.brick, 'wall:concrete': PALETTE.concrete, 'wall:ashlar': PALETTE.size }[wallKey];
    color = pick(rng, color);
    plinth = rng() < 0.5 ? 0.8 : 0.3;
  } else {
    wallKey = r < 0.58 ? 'wall:render' : r < 0.78 ? 'wall:brick' : r < 0.88 ? 'wall:stone' : r < 0.95 ? 'wall:ashlar' : 'wall:wood';
    color = { 'wall:render': PALETTE.plaster, 'wall:brick': PALETTE.brick, 'wall:stone': PALETTE.stone, 'wall:ashlar': PALETTE.size, 'wall:wood': PALETTE.wood }[wallKey];
    color = pick(rng, color);
    quoins = wallKey === 'wall:render' && rng() < 0.3;
    plinth = rng() < 0.7 ? 0.5 + rng() * 0.4 : 0;
  }
  const modern = wallKey === 'wall:concrete' || wallKey === 'wall:wood' || rng() < 0.25;
  const frame = modern ? (rng() < 0.7 ? lin([56, 62, 66]) : lin([240, 240, 236])) : pick(rng, PALETTE.joinery);
  const shutters = modern ? (rng() < 0.8 ? 'rolling' : null) : rng() < 0.68 ? 'casements' : rng() < 0.8 ? 'rolling' : null;
  return {
    rng, kind, modern,
    wall: { key: wallKey, color, seed: Math.floor(rng() * 1000), plinth, quoins, top: 10 },
    frame,
    shutters,
    shutterColor: pick(rng, PALETTE.shutter),
    shutterPattern: rng() < 0.6 ? TRIM.louvers : TRIM.planks,
    shutterBox: rng() < 0.3,
    railColor: rng() < 0.6 ? lin([30, 32, 34]) : rng() < 0.5 ? frame : lin([60, 70, 64]),
    sill: (wallKey === 'wall:wood' || wallKey === 'wall:concrete') ? null : pick(rng, PALETTE.sill),
    surround: !modern && wallKey === 'wall:render' && rng() < 0.35 ? pick(rng, PALETTE.sill) : null,
    doorColor: pick(rng, PALETTE.door),
    doorPattern: rng() < 0.5 ? TRIM.planks : TRIM.plain,
    garageColor: rng() < 0.5 ? lin([236, 236, 232]) : pick(rng, PALETTE.door),
    shopFrame: pick(rng, PALETTE.shopfront),
    fascia: pick(rng, PALETTE.shopfront),
    awning: rng() < 0.45,
    awningColor: pick(rng, PALETTE.store),
    band: !modern && rng() < 0.5 ? pick(rng, PALETTE.sill) : null,
    glassType: !modern && rng() < 0.3 ? 1 : 0,
    glassDoor: (kind === 'block' || kind === 'angle') && rng() < 0.6,
  };
}

function bays(L, pitch, margin) {
  const k = Math.max(1, Math.round((L - 2 * margin) / pitch));
  if (L - 2 * margin < 0.9) return [];
  return Array.from({ length: k }, (_, i) => margin + ((L - 2 * margin) * (i + 0.5)) / k);
}

function band(ctx, f, u0, u1, h0, h1, w, color, seed, faces = 'ftb') {
  box(ctx.buf('trim'), f, u0, u1, h0, h1, 0, w, color, trimVals(TRIM.plain, 0.85, 0, seed), faces);
}

function backWindows(levels, L, margin, wWin, hWin) {
  const out = [];
  for (const z of levels) for (const u of bays(L, 3, margin)) out.push({ type: 'flush', u0: u - wWin / 2, u1: u + wWin / 2, h0: z + 0.95, h1: z + 0.95 + hWin });
  return out;
}

function levelsOf(n, h0, hf, step) {
  const z = [step];
  for (let i = 1; i < n; i++) z.push(step + h0 + (i - 1) * hf);
  return { z, top: step + h0 + (n - 1) * hf };
}

function baseOf(ctx, poly, front, lift) {
  const zg = Math.max(...front.map((p) => ctx.ground(p))) + lift;
  const zmin = Math.min(...poly.map((p) => ctx.ground(p)));
  return { zg, hb: zmin - zg - 0.4 };
}

function rectObstacle(ctx, f, L, D, base, top) {
  const [x, y] = f.plan(L / 2, -D / 2);
  ctx.box(x, y, base - 0.5, top, L + 0.1, D + 0.1, Math.atan2(f.ty, f.tx) / DEG);
}

function chimney(ctx, f, u, w, h0, h1, color, seed) {
  box(ctx.buf('trim'), f, u - 0.3, u + 0.3, h0, h1, w - 0.25, w + 0.25, color, trimVals(TRIM.plain, 0.9, 0, seed), 'fslrt');
  box(ctx.buf('trim'), f, u - 0.36, u + 0.36, h1, h1 + 0.08, w - 0.31, w + 0.31, scale(color, 0.85), trimVals(TRIM.plain, 0.9, 0, seed), 'fslrt');
}

export function townHouse(ctx, { A, B, D, seed, lift, opts = {} }) {
  const rng = mulberry32(seed);
  const s = styleOf(rng, 'town-house');
  const t = unit(sub(B, A));
  const L = len(sub(B, A));
  const k = left(t);
  const poly = [A, B, add(B, mul(k, D)), add(A, mul(k, D))];
  const { zg, hb } = baseOf(ctx, poly, [A, B], lift);
  const n = opts.floors ?? (rng() < 0.55 ? 2 : 3);
  const step = rng() < 0.5 ? 0.17 : 0.02;
  const { z, top } = levelsOf(n, 2.9 + rng() * 0.2, 2.75 + rng() * 0.15, step);
  const flat = opts.roof ? opts.roof === 'flat' : (s.modern && rng() < 0.6) || rng() < 0.12;
  const hE = top + (flat ? 0.9 : 0.35);
  s.wall.top = hE;
  const f = Frame.from(A, B, zg);
  const wWin = 0.85 + rng() * 0.35;
  const hWin = 1.3 + rng() * 0.3;
  const centers = bays(L, 2.2 + rng() * 0.5, 0.75);
  const openings = [];
  const doorBay = rng() < 0.5 ? 0 : centers.length - 1;
  const garage = L > 6.3 && centers.length >= 2 && rng() < 0.3;
  const garageBay = garage ? (doorBay === 0 ? centers.length - 1 : 0) : -1;
  const french = rng() < 0.35;
  centers.forEach((u, i) => {
    if (i === doorBay) {
      const dw = 0.9 + rng() * 0.1;
      openings.push({ type: 'door', u0: u - dw / 2, u1: u + dw / 2, h0: z[0], h1: z[0] + (rng() < 0.5 ? 2.2 : 2.6), door: true });
    } else if (i === garageBay) {
      const gw = Math.min(2.4, L - 3.2);
      const uc = Math.max(gw / 2 + 0.3, Math.min(L - gw / 2 - 0.3, u));
      openings.push({ type: 'garage', u0: uc - gw / 2, u1: uc + gw / 2, h0: 0, h1: 2.05 });
    } else {
      openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[0] + 0.95, h1: z[0] + 0.95 + hWin, sill: 0.95 });
    }
    for (let j = 1; j < n; j++) {
      const fr = french && j === 1;
      openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[j] + (fr ? 0.05 : 0.95), h1: z[j] + (fr ? 2.2 : 0.95 + hWin), sill: fr ? 0.05 : 0.95, juliet: fr, door: fr });
    }
  });
  buildWall(ctx, f, L, hb, hE, openings, s.wall, s);
  if (s.band) for (let j = 1; j < n; j++) band(ctx, f, 0, L, z[j] - 0.18, z[j] - 0.02, 0.05, s.band, seed);
  const C = add(B, mul(k, D));
  const Dp = add(A, mul(k, D));
  const back = Frame.from(C, Dp, zg);
  buildWall(ctx, Frame.from(B, C, zg), D, hb, hE, [], s.wall, s);
  buildWall(ctx, back, L, hb, hE, backWindows(z.slice(1), L, 0.8, 0.8, 1.2), s.wall, s);
  buildWall(ctx, Frame.from(Dp, A, zg), D, hb, hE, [], s.wall, s);
  let roofTop = hE;
  const trimColor = s.modern ? lin([70, 72, 74]) : lin([214, 208, 196]);
  if (flat) {
    flatRoof(ctx, poly, zg + top + 0.15, zg + hE, s.wall, pick(rng, PALETTE.terrace), lin([170, 172, 172]), seed);
  } else {
    const slate = rng() < 0.3;
    const roof = { key: slate ? 'roof:slate' : rng() < 0.5 ? 'roof:tile' : 'roof:flatTile', color: slate ? pick(rng, PALETTE.slate) : pick(rng, PALETTE.tile), moss: rng() * 0.6 };
    if (!s.modern) band(ctx, f, 0, L, hE - 0.28, hE - 0.02, 0.18, s.band ?? lin([214, 206, 188]), seed, 'fb');
    roofTop = gableRoof(ctx, f, L, D, hE, 33 + rng() * 12, 0.35, opts.overSide ?? 0, roof, s.wall, trimColor, seed);
    if (rng() < 0.55) chimney(ctx, f, rng() < 0.5 ? 0.45 : L - 0.45, -D / 2 - 0.4, roofTop - 1.2, roofTop + 0.7, s.wall.key === 'wall:brick' ? s.wall.color : lin([180, 170, 156]), seed);
  }
  rectObstacle(ctx, f, L, D, zg, zg + roofTop + 0.3);
  ctx.count.buildings++;
  return { top: zg + roofTop, poly, floors: n, roof: flat ? 'terrace' : 'gable', wall: s.wall.key };
}

export function block(ctx, { A, B, D, seed, lift, opts = {} }) {
  const rng = mulberry32(seed);
  const s = styleOf(rng, 'block');
  const t = unit(sub(B, A));
  const L = len(sub(B, A));
  const k = left(t);
  const poly = [A, B, add(B, mul(k, D)), add(A, mul(k, D))];
  const { zg, hb } = baseOf(ctx, poly, [A, B], lift);
  const n = opts.floors ?? 4 + Math.floor(rng() * 3);
  const shop = opts.shop ?? rng() < 0.5;
  const h0 = shop ? 3.6 + rng() * 0.4 : 3.0;
  const hf = 2.8 + rng() * 0.15;
  const roofKind = opts.roof ?? (rng() < 0.55 ? 'flat' : rng() < 0.55 ? 'attic' : 'gable');
  const nMain = roofKind === 'attic' ? n - 1 : n;
  const { z, top } = levelsOf(nMain, h0, hf, 0.02);
  const hE = top + (roofKind === 'gable' ? 0.4 : 1.0);
  s.wall.top = hE;
  const f = Frame.from(A, B, zg);
  const centers = bays(L, 2.8 + rng() * 0.6, 0.9);
  const balcony = rng() < 0.3 ? 'none' : rng() < 0.45 ? 'balconies' : rng() < 0.55 ? 'continuous' : 'loggias';
  const wWin = 1.1 + rng() * 0.3;
  const hWin = 1.45 + rng() * 0.2;
  const openings = [];
  const hall = Math.floor(rng() * centers.length);
  centers.forEach((u, i) => {
    if (i === hall) openings.push({ type: 'door', u0: u - 0.75, u1: u + 0.75, h0: z[0], h1: z[0] + 2.5, door: true });
    else if (shop) {
      const half = Math.min(1.4, (centers.length > 1 ? centers[1] - centers[0] : L - 1.8) / 2 - 0.3);
      openings.push({ type: 'shop', u0: u - half, u1: u + half, h0: 0.02, h1: Math.min(h0 - 0.75, 3.0) });
    } else openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[0] + 1.0, h1: z[0] + 1.0 + hWin, sill: 1.0 });
  });
  const loggiaBays = new Set(centers.map((_, i) => i).filter((i) => i % 2 === (rng() < 0.5 ? 0 : 1)));
  for (let j = 1; j < nMain; j++) {
    centers.forEach((u, i) => {
      if (balcony === 'loggias' && loggiaBays.has(i)) {
        openings.push({ type: 'loggia', u0: u - 1.25, u1: u + 1.25, h0: z[j], h1: z[j] + hf - 0.3 });
      } else {
        const fr = balcony === 'balconies' || balcony === 'continuous';
        openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[j] + (fr ? 0.03 : 0.95), h1: z[j] + (fr ? 2.18 : 0.95 + hWin), sill: fr ? 0.03 : 0.95, door: fr, juliet: !fr && rng() < 0.15 });
      }
    });
  }
  const walls = openings.filter((o) => o.type !== 'loggia');
  wallWithHoles(ctx, f, L, hb, hE, openings, s.wall);
  for (const o of walls) placeOpening(ctx, f, o, s.wall, s);
  const solid = rng() < 0.5;
  for (const o of openings.filter((q) => q.type === 'loggia')) {
    reveals(ctx, f, o, 1.4, s.wall);
    const backF = new Frame(...f.plan(o.u0, -1.4), f.tx, f.ty, zg);
    const bw = o.u1 - o.u0;
    const fw = Math.min(2.1, bw - 0.5);
    const fu0 = (bw - fw) / 2;
    wallWithHoles(ctx, backF, bw, o.h0, o.h1, [{ u0: fu0, u1: fu0 + fw, h0: o.h0 + 0.03, h1: o.h0 + 2.18 }], s.wall);
    glassQuad(ctx, backF, fu0, fu0 + fw, o.h0 + 0.03, o.h0 + 2.18, 0, s.frame, [Math.floor(rng() * 1000), 0], [0, 4, rng() < 0.3 ? 0.6 : 0, rng() < 0.5 ? 1 : 0]);
    if (solid) box(ctx.buf(s.wall.key), f, o.u0, o.u1, o.h0, o.h0 + 1.0, -0.2, 0, s.wall.color, [[1, hE, s.wall.seed, 0]], 'fst');
    else railing(ctx, f, o.u0, o.u1, o.h0, -0.02, s.railColor, seed);
  }
  const deep = 0.8;
  const slab = lin([196, 194, 188]);
  const heading = Math.atan2(f.ty, f.tx) / DEG;
  if (balcony === 'balconies' || balcony === 'continuous') {
    for (let j = 1; j < nMain; j++) {
      const spans = balcony === 'continuous' ? [[0.3, L - 0.3]] : centers.map((u) => [u - 1.2, u + 1.2]);
      for (const [u0, u1] of spans) {
        box(ctx.buf('trim'), f, u0, u1, z[j] - 0.16, z[j], 0, deep, slab, trimVals(TRIM.plain, 0.85, 0, seed), 'ftblr');
        const glassRail = s.modern && rng() < 0.5;
        if (glassRail) box(ctx.buf('trim'), f, u0, u1, z[j], z[j] + 1.0, deep - 0.04, deep, lin([120, 132, 136]), trimVals(TRIM.plain, 0.15, 0.6, seed), 'fslrt');
        else railing(ctx, f, u0, u1, z[j], deep, s.railColor, seed);
        const [x, y] = f.plan((u0 + u1) / 2, deep / 2);
        ctx.box(x, y, zg + z[j] - 0.2, zg + z[j] + 1.05, u1 - u0, deep, heading);
      }
    }
  }
  band(ctx, f, 0, L, z[1] - 0.25, z[1] - 0.05, 0.08, s.band ?? lin([200, 196, 188]), seed);
  const C = add(B, mul(k, D));
  const Dp = add(A, mul(k, D));
  buildWall(ctx, Frame.from(B, C, zg), D, hb, hE, [], s.wall, s);
  buildWall(ctx, Frame.from(C, Dp, zg), L, hb, hE, backWindows(z, L, 1, 1.1, 1.4), s.wall, s);
  buildWall(ctx, Frame.from(Dp, A, zg), D, hb, hE, [], s.wall, s);
  let roofTop = hE;
  const coping = lin([176, 178, 178]);
  const membrane = pick(rng, PALETTE.terrace);
  if (roofKind === 'gable') {
    const slate = rng() < 0.4;
    const roof = { key: slate ? 'roof:slate' : 'roof:tile', color: slate ? pick(rng, PALETTE.slate) : pick(rng, PALETTE.tile), moss: rng() * 0.4 };
    band(ctx, f, 0, L, hE - 0.32, hE - 0.02, 0.22, s.band ?? lin([210, 204, 192]), seed, 'fb');
    roofTop = gableRoof(ctx, f, L, D, hE, 30 + rng() * 10, 0.4, 0, roof, s.wall, lin([200, 196, 188]), seed);
    for (let c = 0; c < 2; c++) if (rng() < 0.7) chimney(ctx, f, L * (0.2 + 0.6 * c), -D / 2 - 0.6, roofTop - 1.5, roofTop + 0.8, lin([170, 160, 150]), seed + c);
  } else {
    flatRoof(ctx, poly, zg + top + 0.2, zg + hE, s.wall, membrane, coping, seed, roofKind === 'attic' ? 0 : 1 + Math.floor(rng() * 3));
    if (roofKind === 'attic') {
      const r = 1.8;
      const A2 = add(A, mul(k, r));
      const B2 = add(B, mul(k, r));
      const fa = Frame.from(A2, B2, zg + top + 0.2);
      const ha = hf + 0.6;
      const w2 = { ...s.wall, key: rng() < 0.5 ? 'wall:render' : s.wall.key, color: rng() < 0.5 ? lin([200, 202, 200]) : s.wall.color, top: ha };
      const ao = bays(L, 3, 1).map((u) => ({ type: 'window', u0: u - 0.9, u1: u + 0.9, h0: 0.03, h1: 2.18, sill: 0.03, door: true }));
      buildWall(ctx, fa, L, 0, ha, ao, w2, { ...s, shutters: 'rolling', sill: null, surround: null });
      const D2 = D - r;
      const C2 = add(B2, mul(k, D2));
      const Dp2 = add(A2, mul(k, D2));
      buildWall(ctx, new Frame(B2[0], B2[1], k[0], k[1], zg + top + 0.2), D2, 0, ha, [], w2, s);
      buildWall(ctx, Frame.from(C2, Dp2, zg + top + 0.2), L, 0, ha, [], w2, s);
      buildWall(ctx, Frame.from(Dp2, A2, zg + top + 0.2), D2, 0, ha, [], w2, s);
      flatRoof(ctx, [A2, B2, C2, Dp2], zg + top + 0.2 + ha - 0.25, zg + top + 0.2 + ha, w2, membrane, coping, seed + 5);
      railing(ctx, f, 0.25, L - 0.25, top + 0.2, -0.1, s.railColor, seed);
      roofTop = top + 0.2 + ha;
    }
  }
  rectObstacle(ctx, f, L, D, zg, zg + roofTop + 0.3);
  ctx.count.buildings++;
  return { top: zg + roofTop, poly, floors: n, shop, balcony, roof: roofKind, wall: s.wall.key };
}

export function villa(ctx, { A, B, D, seed, lift, opts = {} }) {
  const rng = mulberry32(seed);
  const s = styleOf(rng, 'villa');
  const t = unit(sub(B, A));
  const L = len(sub(B, A));
  const k = left(t);
  const poly = [A, B, add(B, mul(k, D)), add(A, mul(k, D))];
  const { zg, hb } = baseOf(ctx, poly, [A, B], lift);
  const n = opts.floors ?? (rng() < 0.55 ? 1 : 2);
  const step = 0.3 + rng() * 0.3;
  const { z, top } = levelsOf(n, 2.7, 2.7, step);
  const hE = top + 0.25;
  s.wall.top = hE;
  const f = Frame.from(A, B, zg);
  const centers = bays(L, 2.4 + rng() * 0.6, 0.9);
  const doorBay = Math.floor(rng() * centers.length);
  const garage = opts.garage ?? (n === 1 ? false : rng() < 0.4);
  const garageBay = garage ? (doorBay === centers.length - 1 ? 0 : centers.length - 1) : -1;
  const wWin = 1.0 + rng() * 0.2;
  const openings = [];
  centers.forEach((u, i) => {
    if (i === doorBay) openings.push({ type: 'door', u0: u - 0.45, u1: u + 0.45, h0: z[0], h1: z[0] + 2.15, door: true });
    else if (i === garageBay) openings.push({ type: 'garage', u0: Math.max(0.4, u - 1.2), u1: Math.min(L - 0.4, u + 1.2), h0: 0, h1: 2.0 });
    else openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[0] + (rng() < 0.25 ? 0.05 : 0.95), h1: z[0] + 2.15, sill: 0.95 });
    for (let j = 1; j < n; j++) openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[j] + 0.95, h1: z[j] + 2.15, sill: 0.95 });
  });
  buildWall(ctx, f, L, hb, hE, openings, s.wall, s);
  const C = add(B, mul(k, D));
  const Dp = add(A, mul(k, D));
  const sideOpen = (Lw) => z.flatMap((zz) => bays(Lw, 3.2, 1.2).map((u) => ({ type: 'window', u0: u - 0.5, u1: u + 0.5, h0: zz + 0.95, h1: zz + 2.15, sill: 0.95 })));
  buildWall(ctx, Frame.from(B, C, zg), D, hb, hE, sideOpen(D), s.wall, s);
  buildWall(ctx, Frame.from(C, Dp, zg), L, hb, hE, sideOpen(L), s.wall, s);
  buildWall(ctx, Frame.from(Dp, A, zg), D, hb, hE, rng() < 0.5 ? sideOpen(D) : [], s.wall, s);
  const du = centers[doorBay];
  if (rng() < 0.5) box(ctx.buf('trim'), f, du - 0.8, du + 0.8, z[0] + 2.35, z[0] + 2.45, 0, 0.9, s.frame, trimVals(TRIM.plain, 0.5, 0.2, seed), 'ftblr');
  const roof = { key: rng() < 0.75 ? 'roof:tile' : 'roof:flatTile', color: pick(rng, PALETTE.tile), moss: rng() * 0.7 };
  if (rng() < 0.12) Object.assign(roof, { key: 'roof:slate', color: pick(rng, PALETTE.slate) });
  const trimColor = rng() < 0.6 ? lin([236, 234, 228]) : lin([120, 90, 64]);
  const roofTop = rng() < 0.55 ? hipRoof(ctx, f, L, D, hE, 30 + rng() * 10, 0.45, roof, trimColor, seed)
    : gableRoof(ctx, f, L, D, hE, 35 + rng() * 10, 0.45, 0.35, roof, s.wall, trimColor, seed);
  if (rng() < 0.6) chimney(ctx, f, L * (0.25 + rng() * 0.5), -D / 2 - 0.5, roofTop - 1.2, roofTop + 0.6, lin([200, 194, 182]), seed);
  rectObstacle(ctx, f, L, D, zg, zg + roofTop + 0.3);
  ctx.count.buildings++;
  return { top: zg + roofTop, poly, floors: n, wall: s.wall.key };
}

export function angle(ctx, { path, back = null, D, seed, lift, opts = {} }) {
  const rng = mulberry32(seed);
  const s = styleOf(rng, 'angle');
  back = back ?? offsetLine(path, D).reverse();
  const poly = [...path, ...back];
  const { zg, hb } = baseOf(ctx, poly, path, lift);
  const n = opts.floors ?? 3 + Math.floor(rng() * 3);
  const shop = opts.shop ?? rng() < 0.6;
  const h0 = shop ? 3.7 : 3.0;
  const hf = 2.8 + rng() * 0.15;
  const { z, top } = levelsOf(n, h0, hf, 0.02);
  const hE = top + 1.0;
  s.wall.top = hE;
  const wWin = 1.1 + rng() * 0.25;
  const hWin = 1.45 + rng() * 0.2;
  const juliets = rng() < 0.4;
  let doorDone = false;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const L = len(sub(b, a));
    if (L < 0.05) continue;
    const f = Frame.from(a, b, zg);
    const centers = bays(L, 3.0, 0.8);
    const openings = [];
    centers.forEach((u, c) => {
      if (!doorDone && L > 4 && c === centers.length - 1) {
        doorDone = true;
        openings.push({ type: 'door', u0: u - 0.7, u1: u + 0.7, h0: z[0], h1: z[0] + 2.5, door: true });
      } else if (shop) {
        openings.push({ type: 'shop', u0: u - Math.min(1.3, L / 2 - 0.4), u1: u + Math.min(1.3, L / 2 - 0.4), h0: 0.02, h1: 3.0 });
      } else openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[0] + 1.0, h1: z[0] + 1.0 + hWin, sill: 1.0 });
      for (let j = 1; j < n; j++) {
        const fr = juliets && j < n - 1;
        openings.push({ type: 'window', u0: u - wWin / 2, u1: u + wWin / 2, h0: z[j] + (fr ? 0.05 : 0.95), h1: z[j] + (fr ? 2.2 : 0.95 + hWin), sill: fr ? 0.05 : 0.95, juliet: fr, door: fr });
      }
    });
    buildWall(ctx, f, L, hb, hE, openings.filter((o) => o.u1 - o.u0 > 0.5), s.wall, s);
    band(ctx, f, 0, L, z[1] - 0.25, z[1] - 0.05, 0.08, s.band ?? lin([200, 196, 188]), seed);
    if (!s.modern) band(ctx, f, 0, L, hE - 0.3, hE - 0.05, 0.15, s.band ?? lin([210, 204, 192]), seed);
    const [x, y] = f.plan(L / 2, -D / 2);
    ctx.box(x, y, zg - 0.5, zg + hE + 0.3, L + 0.2, D + 0.2, Math.atan2(f.ty, f.tx) / DEG);
  }
  for (let i = path.length - 1; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = len(sub(b, a));
    if (L < 0.05) continue;
    const f = Frame.from(a, b, zg);
    const isBack = i >= path.length && i < poly.length - 1;
    buildWall(ctx, f, L, hb, hE, isBack ? backWindows(z, L, 1, 1.0, 1.4) : [], s.wall, s);
  }
  flatRoof(ctx, poly, zg + top + 0.2, zg + hE, s.wall, pick(rng, PALETTE.terrace), lin([176, 178, 178]), seed, 1 + Math.floor(rng() * 3));
  ctx.count.buildings++;
  return { top: zg + hE, poly, floors: n, shop, wall: s.wall.key, color: s.wall.color.map((v) => +v.toFixed(3)), shutters: s.shutters };
}

export { pick, styleOf, mixc };
