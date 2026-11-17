const SPEEDS = [-1.5, 0.0, 1.5, 3.0];
const RAD = Math.PI / 180;
const TURNS = [60 * RAD, 30 * RAD, 0, -30 * RAD, -60 * RAD];
const CLIMBS = [-1.5, -0.75, 0.0, 0.75, 1.5];
const SIDES = [-1, 0, 1];
const SIGMA = { speed: 0.7, turn: 14 * RAD, climb: 0.35, side: 0.35 };

function linspace(lo, hi, n) {
  const step = (hi - lo) / (n - 1);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = lo + i * step;
  v[n - 1] = hi;
  return v;
}

const CACHE = new Map();
function kernel(centres, sigma, lo, hi, n = 121) {
  const key = `${centres}|${sigma}|${lo}|${hi}|${n}`;
  if (!CACHE.has(key)) {
    const vs = linspace(lo, hi, n);
    const logq = vs.map(() => 0);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const q = centres.map((c) => Math.exp(-0.5 * ((c - vs[i]) / sigma) ** 2));
      const s = q.reduce((a, b) => a + b, 0);
      rows.push(q.map((x) => Math.log(x / s + 1e-12)));
    }
    CACHE.set(key, { vs, rows, logq });
  }
  return CACHE.get(key);
}

function mlAxis(p, centres, sigma, lo, hi) {
  const { vs, rows } = kernel(centres, sigma, lo, hi);
  let best = -Infinity;
  let at = 0;
  for (let i = 0; i < vs.length; i++) {
    let s = 0;
    for (let k = 0; k < p.length; k++) s += rows[i][k] * p[k];
    if (s > best) { best = s; at = i; }
  }
  return vs[at];
}

const argmax = (p) => p.reduce((b, x, i) => (x > p[b] ? i : b), 0);

export function decodeStep(pMove, pAlt, pSide, { sideMode = 'argmax', speedDead = 0.4, keepTau = null, altMode = 'argmax' } = {}) {
  const ns = SPEEDS.length;
  const nt = TURNS.length;
  const speed = new Array(ns).fill(0);
  const turn = new Array(nt).fill(0);
  for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) { speed[i] += pMove[i * nt + j]; turn[j] += pMove[i * nt + j]; }
  let forward = mlAxis(speed, SPEEDS, SIGMA.speed, SPEEDS[0], SPEEDS[ns - 1]);
  let yaw = mlAxis(turn, TURNS, SIGMA.turn, Math.min(...TURNS), Math.max(...TURNS));
  const up = altMode === 'argmax' ? CLIMBS[argmax(pAlt)] : mlAxis(pAlt, CLIMBS, SIGMA.climb, CLIMBS[0], CLIMBS[CLIMBS.length - 1]);
  if (keepTau != null && turn[2] >= keepTau) yaw = 0;
  if (Math.abs(forward) < speedDead) forward = 0;
  let right = 0;
  if (pSide) {
    if (sideMode === 'argmax') right = SIDES[argmax(pSide)];
    else if (sideMode === 'expect') right = pSide.reduce((a, x, i) => a + x * SIDES[i], 0);
    else right = mlAxis(pSide, SIDES, SIGMA.side, -1, 1);
  }
  return { forward, yaw, up, right };
}

export function softmax(scores) {
  const m = Math.max(...scores);
  const e = Array.from(scores, (x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}
