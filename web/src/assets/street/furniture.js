import { Frame, box, post, planBox, DEG, sub, len, lin } from './geom.js';
import { TRIM, RAILING } from './materials.js';

const tv = (pattern, rough, metal, seed = 0) => [[pattern, rough, metal, seed]];

export function wheelieBin(ctx, x, y, z, a, body, lid, seed) {
  const b = ctx.buf('trim');
  const W = 0.58, Dp = 0.73, H = 1.055;
  const tx = Math.cos(a), ty = Math.sin(a);
  planBox(b, x, y, a, Dp - 0.04, W - 0.04, z + 0.06, z + H - 0.06, body, tv(TRIM.plain, 0.6, 0, seed), 'fsntlr');
  planBox(b, x + tx * 0.02, y + ty * 0.02, a, Dp, W, z + H - 0.06, z + H, lid, tv(TRIM.plain, 0.5, 0, seed), 'fsntlr');
  const nx = -ty, ny = tx;
  for (const sgn of [-1, 1]) post(b, x - tx * (Dp / 2 - 0.1) + nx * sgn * 0.26, y - ty * (Dp / 2 - 0.1) + ny * sgn * 0.26, 0.1, z, z + 0.2, lin([20, 20, 20]), tv(TRIM.plain, 0.8, 0, seed), 6);
  ctx.box(x, y, z - 0.1, z + H, Dp, W, a / DEG);
}

export function bench(ctx, x, y, z, a, seed, wood = lin([128, 86, 52])) {
  const b = ctx.buf('trim');
  const L = 1.8;
  const tx = Math.cos(a + Math.PI / 2), ty = Math.sin(a + Math.PI / 2);
  const ox = x - tx * L / 2, oy = y - ty * L / 2;
  const f = new Frame(ox, oy, tx, ty, z);
  const iron = lin([34, 36, 38]);
  const iv = tv(TRIM.metal, 0.6, 0.5, seed);
  const wv = tv(TRIM.planks, 0.75, 0, seed);
  for (const u of [0.15, L - 0.15]) {
    box(b, f, u - 0.03, u + 0.03, 0, 0.42, -0.25, 0.22, iron, iv, 'fslrt');
    box(b, f, u - 0.03, u + 0.03, 0.42, 0.85, -0.3, -0.24, iron, iv, 'fslr');
  }
  for (let k = 0; k < 3; k++) box(b, f, 0, L, 0.42, 0.46, 0.18 - k * 0.15 - 0.12, 0.18 - k * 0.15, wood, wv, 'fstb');
  for (let k = 0; k < 2; k++) box(b, f, 0, L, 0.55 + k * 0.16, 0.66 + k * 0.16, -0.31, -0.27, wood, wv, 'fst');
  const [cx, cy] = f.plan(L / 2, -0.04);
  ctx.box(cx, cy, z - 0.1, z + 0.86, L, 0.55, Math.atan2(ty, tx) / DEG);
}

export function bollard(ctx, x, y, z, color, seed) {
  const b = ctx.buf('trim');
  post(b, x, y, 0.045, z, z + 0.98, color, tv(TRIM.metal, 0.5, 0.4, seed), 8, false);
  post(b, x, y, 0.046, z + 0.98, z + 1.06, lin([224, 224, 218]), tv(TRIM.plain, 0.4, 0, seed), 8, false);
  post(b, x, y, 0.045, z + 1.06, z + 1.1, color, tv(TRIM.metal, 0.5, 0.4, seed), 8, true);
  ctx.cylinder(x, y, z - 0.1, z + 1.1, 0.05);
}

export function treeGrate(ctx, x, y, z, a, seed) {
  planBox(ctx.buf('trim'), x, y, a, 1.2, 1.2, z - 0.02, z + 0.012, lin([40, 38, 36]), tv(TRIM.louvers, 0.7, 0.5, seed), 't');
}

export function fenceLine(ctx, line, fence, openings, z, seed) {
  const wallBuf = ctx.buf('wall:render');
  const railing = ctx.buf('railing');
  const hedge = ctx.buf('hedge');
  let s0 = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const L = len(sub(b, a));
    if (L < 0.05) continue;
    const zz = Math.min(z(a), z(b));
    const f = Frame.from(a, b, zz);
    const cuts = openings.map((o) => [o.u0 - s0, o.u1 - s0, o]).filter(([u0, u1]) => u1 > 0 && u0 < L);
    const spans = [];
    let u = 0;
    for (const [u0, u1] of cuts.sort((p, q) => p[0] - q[0])) {
      if (u0 > u + 0.05) spans.push([u, Math.max(u, u0)]);
      u = Math.max(u, u1);
    }
    if (u < L - 0.05) spans.push([u, L]);
    const heading = Math.atan2(f.ty, f.tx) / DEG;
    for (const [u0, u1] of spans) {
      const w = fence.wall;
      if (w > 0) box(wallBuf, f, u0, u1, -0.3, w, -0.1, 0.1, fence.wallColor, [[u1 - u0, w, seed, 0]], 'fstlr');
      if (fence.kind !== null && fence.height > w + 0.05) {
        const h0 = w > 0 ? w : 0.02;
        const h = fence.height - h0;
        const v = [[fence.kind, h, seed, 0]];
        railing.quad(f.p(u0, h0, 0), f.p(u1, h0, 0), f.p(u1, h0 + h, 0), f.p(u0, h0 + h, 0), [[u0, 0], [u1, 0], [u1, h], [u0, h]], fence.color, v, f.out);
        if (fence.kind === RAILING.rigid || fence.kind === RAILING.torsion) {
          const n = Math.max(1, Math.round((u1 - u0) / 2.5));
          for (let k = 0; k <= n; k++) box(ctx.buf('trim'), f, u0 + ((u1 - u0) * k) / n - 0.03, u0 + ((u1 - u0) * k) / n + 0.03, h0 - 0.02, h0 + h + 0.05, -0.03, 0.03, fence.color, tv(TRIM.metal, 0.5, 0.3, seed), 'fslrt');
        }
      }
      if (fence.hedge > 0) box(hedge, f, u0 + 0.1, u1 - 0.1, -0.1, fence.hedge, -0.85, -0.15, fence.hedgeColor, [[seed, 0, 0, 0]], 'fstlr');
      const [cx, cy] = f.plan((u0 + u1) / 2, fence.hedge > 0 ? -0.35 : 0);
      const top = Math.max(fence.height, fence.wall, fence.hedge);
      if (top > 0.3) ctx.box(cx, cy, zz - 0.2, zz + top, u1 - u0, fence.hedge > 0 ? 0.9 : 0.2, heading);
    }
    for (const [u0, u1, o] of cuts) {
      const c0 = Math.max(0, u0), c1 = Math.min(L, u1);
      if (o.gate !== null && o.gate !== undefined) {
        const h = Math.max(1.1, fence.height - 0.05);
        railing.quad(f.p(c0, 0.06, -0.05), f.p(c1, 0.06, -0.05), f.p(c1, h, -0.05), f.p(c0, h, -0.05), [[c0, 0], [c1, 0], [c1, h - 0.06], [c0, h - 0.06]], o.gateColor ?? fence.color, [[o.gate, h - 0.06, seed, 0]], f.out);
        const [cx, cy] = f.plan((c0 + c1) / 2, -0.05);
        ctx.box(cx, cy, zz - 0.2, zz + h, c1 - c0, 0.1, heading);
      }
      if (fence.wall > 0 || fence.height > 1.2) {
        const ph = Math.max(fence.height, fence.wall) + 0.15;
        for (const uc of [c0, c1]) {
          if (uc <= 0.01 || uc >= L - 0.01) continue;
          box(wallBuf, f, uc - 0.2, uc + 0.2, -0.3, ph, -0.2, 0.2, fence.wallColor, [[0.4, ph, seed, 0]], 'fstlr');
          const [px, py] = f.plan(uc, 0);
          ctx.box(px, py, zz - 0.2, zz + ph, 0.4, 0.4, heading);
        }
      }
    }
    s0 += L;
  }
}
