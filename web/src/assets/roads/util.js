import * as THREE from 'three/webgpu';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function resample(line, step, closed = false) {
  const v = line.map(([x, y]) => new THREE.Vector3(x, 0, -y));
  if (closed && v.length > 1 && v[0].distanceTo(v[v.length - 1]) < 0.01) v.pop();
  const curve = new THREE.CatmullRomCurve3(v, closed, 'centripetal');
  const length = curve.getLength();
  const n = Math.max(1, Math.ceil(length / step));
  const raw = curve.getSpacedPoints(n);
  if (closed) raw.pop();
  const pts = raw.map((p, i) => ({ x: p.x, z: p.z, tx: 0, tz: 0, s: (i * length) / n, k: 0 }));
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const a = pts[closed ? (i + m - 1) % m : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    pts[i].tx = dx;
    pts[i].tz = dz;
  }
  for (let i = 0; i < m; i++) {
    const a = pts[closed ? (i + m - 1) % m : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
    if (!closed && (i === 0 || i === m - 1)) continue;
    const ds = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const cross = a.tx * b.tz - a.tz * b.tx;
    const dot = a.tx * b.tx + a.tz * b.tz;
    pts[i].k = -Math.atan2(cross, dot) / ds;
  }
  return { pts, length, closed };
}

export function nearestOnPolyline(pts, x, z) {
  let best = { d: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const l = Math.sqrt(l2);
      best = { d, s: a.s + t * (b.s - a.s), x: px, z: pz, tx: dx / l, tz: dz / l, i };
    }
  }
  return best;
}

export function curveStretches(pts, radius, gap = 25) {
  const out = [];
  let cur = null;
  for (const p of pts) {
    const tight = Math.abs(p.k) > 1 / radius;
    if (tight) {
      const turn = p.k > 0 ? 1 : -1;
      if (cur && (cur.turn === turn || p.s - cur.s1 < 1)) {
        cur.s1 = p.s;
        cur.rmin = Math.min(cur.rmin, 1 / Math.abs(p.k));
      } else {
        if (cur) out.push(cur);
        cur = { s0: p.s, s1: p.s, rmin: 1 / Math.abs(p.k), turn };
      }
    } else if (cur && p.s - cur.s1 > gap) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function pointAt(pts, s, closed = false, total = 0) {
  if (closed && total) s = ((s % total) + total) % total;
  s = clamp(s, 0, pts[pts.length - 1].s);
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[Math.min(hi, pts.length - 1)];
  const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  let tx = a.tx + (b.tx - a.tx) * t;
  let tz = a.tz + (b.tz - a.tz) * t;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz, s, k: a.k + (b.k - a.k) * t };
}

export const lateral = (p, off) => [p.x - p.tz * off, p.z + p.tx * off];

export const rank = (road) => Number.parseInt(road.importance, 10) || 5;
