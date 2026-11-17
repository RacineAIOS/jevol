import * as THREE from 'three/webgpu';
import { MeshBuilder, STYLE } from './mesh.js';
import { SHAPES } from './data.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);

function topAt(top, t) {
  for (let i = 1; i < top.length; i++) {
    if (t <= top[i][0] + 1e-9) {
      const [t0, h0] = top[i - 1];
      const [t1, h1] = top[i];
      return lerp(h0, h1, t1 === t0 ? 1 : (t - t0) / (t1 - t0));
    }
  }
  return top[top.length - 1][1];
}
function kindAt(top, t) {
  for (let i = 1; i < top.length; i++) if (t <= top[i][0] + 1e-9) return top[i][2];
  return top[top.length - 1][2];
}

export function buildCar(model, lod = 'near') {
  const sh = SHAPES[model.shape];
  const { L, W, H } = model;
  const near = lod === 'near';
  const mb = new MeshBuilder();

  const ts = new Set([0, 1]);
  for (const [t] of sh.top) ts.add(t);
  for (const [a, b] of sh.glass) {
    ts.add(a);
    ts.add(b);
  }
  if (near) for (const t of [0.03, 0.1, 0.9, 0.97, 0.5]) ts.add(t);
  const T = [...ts].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.004);

  const rings = T.map((t) => {
    const x = (t - 0.5) * L;
    const end = Math.min(t, 1 - t);
    const wm = (W / 2) * (0.86 + 0.14 * smooth(clamp01(end / 0.08)));
    const ytop = topAt(sh.top, t) * H;
    const ybelt = Math.min(ytop, sh.belt * H);
    const yb = model.gc + (end < 0.09 ? 0.17 * (1 - smooth(end / 0.09)) : 0);
    const k = clamp01((ytop - ybelt) / (0.2 * H));
    const wt = wm * lerp(0.97, sh.roofK, k);
    const wb = wm * 0.9;
    const sill = Math.min(yb + 0.14, ybelt);
    return {
      t, x, ytop, ybelt, wm, wt,
      p: (near
        ? [[-wb, yb], [-wm, sill], [-wm, ybelt], [-wt, ytop], [wt, ytop], [wm, ybelt], [wm, sill], [wb, yb]]
        : [[-wm, yb], [-wm, ybelt], [-wt, ytop], [wt, ytop], [wm, ybelt], [wm, yb]]
      ).map(([z, y]) => new THREE.Vector3(x, y, z)),
    };
  });
  const NR = rings[0].p.length;

  const nrm = rings.map(() => Array.from({ length: NR }, () => new THREE.Vector3()));
  const quads = [];
  const centerOf = (i) => rings[i].p.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / NR);
  for (let i = 0; i < rings.length - 1; i++) {
    const c0 = centerOf(i);
    const c1 = centerOf(i + 1);
    const tm = (rings[i].t + rings[i + 1].t) / 2;
    for (let k = 0; k < NR; k++) {
      const k2 = (k + 1) % NR;
      const a = rings[i].p[k];
      const b = rings[i].p[k2];
      const c = rings[i + 1].p[k2];
      const d = rings[i + 1].p[k];
      const mid = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
      const hint = mid.sub(c0.clone().add(c1).multiplyScalar(0.5));
      let st = STYLE.paint;
      const upper = rings[i].ytop - rings[i].ybelt > 0.04 || rings[i + 1].ytop - rings[i + 1].ybelt > 0.04;
      const kk = near ? k : [1, 2, 3, 4, 5, 7][k] ?? -1;
      if (kk === 2 || kk === 4) {
        const inWin = sh.glass.some(([a0, b0]) => tm > a0 && tm < b0);
        if (inWin && upper) st = STYLE.glass;
      } else if (kk === 3) {
        const kd = kindAt(sh.top, tm);
        st = kd === 'g' ? STYLE.glass : kd === 'b' ? STYLE.bed : STYLE.paint;
      } else if (kk === 7 || kk === -1) st = STYLE.under;
      quads.push({ i, k, a, b, c, d, hint, st });
      const fn = b.clone().sub(a).cross(d.clone().sub(a));
      const fn2 = c.clone().sub(b).cross(d.clone().sub(b));
      const n = fn.add(fn2);
      if (n.dot(hint) < 0) n.negate();
      for (const [ii, jj] of [[i, k], [i, k2], [i + 1, k2], [i + 1, k]]) nrm[ii][jj].add(n);
    }
  }
  for (const row of nrm) for (const n of row) n.normalize();

  for (const q of quads) {
    const { i, k, a, b, c, d, hint, st } = q;
    const k2 = (k + 1) % NR;
    if (a.distanceToSquared(b) < 1e-8 && d.distanceToSquared(c) < 1e-8) continue;
    const useSmooth = sh.smooth && near;
    const nA = useSmooth ? nrm[i][k] : undefined;
    const nB = useSmooth ? nrm[i][k2] : undefined;
    const nC = useSmooth ? nrm[i + 1][k2] : undefined;
    const nD = useSmooth ? nrm[i + 1][k] : undefined;
    mb.tri(a, b, c, st, hint, nA, nB, nC);
    mb.tri(a, c, d, st, hint, nA, nC, nD);
  }
  for (const [idx, dir] of [[0, -1], [rings.length - 1, 1]]) {
    const ctr = centerOf(idx);
    const hint = new THREE.Vector3(dir, 0, 0);
    for (let k = 0; k < NR; k++) mb.tri(ctr, rings[idx].p[k], rings[idx].p[(k + 1) % NR], STYLE.paint, hint);
  }

  mb.box([0, 0.06, 0], [L * 0.78, 0.04, W * 0.74], STYLE.under);

  const xr = L / 2 - model.overhang - model.wheelbase;
  const xf = L / 2 - model.overhang;
  const zw = W / 2 - model.tw / 2 + 0.012;

  if (near) {
    for (const x of [xr, xf]) for (const sd of [-1, 1]) mb.wheel([x, model.r, sd * zw], model.r, model.tw, sd, 10);
    const nose = rings[rings.length - 1];
    const tail = rings[0];
    const hz = W * 0.37;
    for (const s of [-1, 1]) {
      mb.box([L / 2 - 0.02, nose.ytop + 0.1, s * hz], [0.06, 0.1, 0.34], STYLE.head);
      const tH = model.shape === 'van' || model.shape === 'panel' ? 0.5 : 0.16;
      mb.box([-L / 2 + 0.02, tail.ytop - 0.08 - tH / 2, s * (W / 2 - 0.1)], [0.06, tH, 0.1], STYLE.tail);
    }
    mb.box([L / 2 - 0.01, nose.ytop - 0.1, 0], [0.05, 0.12, 0.46], STYLE.trim);
    mb.box([L / 2 - 0.02, 0.5, 0], [0.06, 0.11, 0.52], STYLE.plate);
    mb.box([-L / 2 + 0.02, Math.min(tail.ytop - 0.3, 0.62), 0], [0.06, 0.11, 0.52], STYLE.plate);
    const mx = (sh.top.filter((p) => p[2] === 'g').pop()[0] - 0.5) * L - 0.05;
    const belt = sh.belt * H;
    for (const s of [-1, 1]) mb.box([mx, belt + 0.1, s * (W / 2 + 0.08)], [0.12, 0.13, 0.2], STYLE.paint);
    if (sh.rails) for (const s of [-1, 1]) mb.box([-0.1, H + 0.04, s * (W * 0.34)], [L * 0.5, 0.04, 0.04], STYLE.trim);
  } else {
    for (const x of [xr, xf]) {
      for (const s of [-1, 1]) mb.box([x, model.r, s * zw], [model.r * 1.7, model.r * 2, model.tw], STYLE.tyre);
    }
  }
  return mb.build();
}
