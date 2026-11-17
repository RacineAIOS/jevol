import { clamp, rank } from './util.js';

export const MARK = {
  centre: { none: 0, T1: 1, solid: 2, double: 3, T3: 4 },
  edge: { none: 0, solid: 1, T3: 2, right: 3 },
};

const U = { local: 0.05, rural: 0.05, regional: 0.05, national: 0.06, dual: 0.075, roundabout: 0.05, ramp: 0.06 };

export function classify(road) {
  const w = road.width;
  const imp = rank(road);
  if (road.nature === 'Roundabout') return 'roundabout';
  if (road.nature === 'Dual carriageway road') return 'dual';
  if (road.nature === 'Ramp') return 'ramp';
  if (w < 3.8) return 'local';
  if (w < 5) return imp <= 3 ? 'regional' : 'rural';
  if (w < 6.5) return 'regional';
  return 'national';
}

export function planRoad(road, rng, o = {}) {
  const kind = o.kind ?? classify(road);
  const w = road.width;
  const imp = rank(road);
  const oneWay = kind === 'dual' || kind === 'roundabout' || kind === 'ramp';
  const lanes = oneWay ? clamp(Math.round(w / 3.25), 1, 4) : 2;
  let u = U[kind];
  if (kind === 'regional' && imp <= 3) u = 0.06;

  let center = MARK.centre.none;
  if (kind === 'regional' || kind === 'national') center = MARK.centre.T1;
  else if (oneWay && lanes > 1) center = MARK.centre.T1;
  if (w < 4.8 && !oneWay) center = MARK.centre.none;
  if (o.center !== undefined) center = MARK.centre[o.center] ?? o.center;

  let edge = MARK.edge.none;
  const r = rng();
  if (kind === 'local') edge = r < 0.3 ? MARK.edge.right : MARK.edge.none;
  else if (kind === 'rural') edge = r < 0.35 ? MARK.edge.right : r < 0.6 ? MARK.edge.solid : MARK.edge.none;
  else if (kind === 'regional') edge = r < 0.75 ? MARK.edge.solid : r < 0.9 ? MARK.edge.T3 : MARK.edge.none;
  else if (kind === 'roundabout') edge = w >= 5 ? MARK.edge.right : MARK.edge.none;
  else edge = MARK.edge.solid;
  if (o.edge !== undefined) edge = MARK.edge[o.edge] ?? o.edge;

  const wearRange = {
    local: [0.5, 0.95], rural: [0.35, 0.85], regional: [0.15, 0.75], national: [0.1, 0.5],
    dual: [0.05, 0.4], roundabout: [0.1, 0.5], ramp: [0.1, 0.5],
  }[kind];
  const wear = o.wear ?? rng.range(wearRange[0], wearRange[1]);
  const tone = clamp(0.5 * wear + 0.5 * rng(), 0, 1);

  const urban = !!o.urban;
  const side = (right) => {
    if (urban) return { type: 'curb', w: right ? 1.8 : 1.8 };
    const type = rng() < 0.65 ? 'grass' : 'dry';
    const base = kind === 'national' || kind === 'dual' ? [2.2, 3.4] : kind === 'local' ? [1.4, 2.2] : [1.6, 2.8];
    return { type, w: rng.range(base[0], base[1]) };
  };
  const shoulder = { l: side(false), r: side(true) };
  const barrier = { l: null, r: null };
  if (kind === 'dual') {
    shoulder.l = { type: 'median', w: o.median ? o.median / 2 : 1.3 };
    barrier.l = rng() < 0.75 ? 'rail' : 'concrete';
    if (o.urban) shoulder.r = { type: 'curb', w: 1.6 };
  }
  if (kind === 'roundabout') shoulder.l = { type: 'island', w: 0 };
  if (kind === 'ramp') barrier.r = rng() < 0.5 ? 'rail' : null;
  if (o.barrier) Object.assign(barrier, o.barrier);

  return {
    kind, width: w, importance: imp, oneWay, lanes, u, center, edge, wear, tone,
    seed: Math.floor(rng() * 1000) + 0.5, shoulder, barrier, urban,
    guardCurves: kind !== 'local' && rng() < 0.35,
    gamma: w < 5 ? 'small' : 'normal',
  };
}

export function markingPlan(plan, length, curves, rng, closed = false) {
  const segs = [];
  const arrows = [];
  const continuous = [];
  if (plan.center === MARK.centre.T1 && !plan.oneWay && !closed) {
    const radius = plan.kind === 'national' ? 160 : 130;
    const L = plan.importance <= 3 ? 117 : 78;
    const zones = curves.filter((c) => c.rmin < radius).map((c) => ({ s0: Math.max(0, c.s0 - 12), s1: Math.min(length, c.s1 + 12) }));
    for (const z of zones) {
      const last = continuous[continuous.length - 1];
      if (last && z.s0 - last.s1 < 2 * 13 + 26) last.s1 = z.s1;
      else continuous.push({ ...z });
    }
    const cont = plan.kind === 'national' && rng() < 0.5 ? MARK.centre.double : MARK.centre.solid;
    const edgeCode = plan.edge;
    let at = 0;
    const push = (s0, s1, center) => {
      if (s1 - s0 > 0.01) segs.push({ s0, s1, center, edge: edgeCode });
    };
    for (let i = 0; i < continuous.length; i++) {
      const z = continuous[i];
      const prevEnd = i > 0 ? continuous[i - 1].s1 : 0;
      const nextStart = i + 1 < continuous.length ? continuous[i + 1].s0 : length;
      const a0 = Math.max(prevEnd, z.s0 - L);
      push(at, a0, plan.center);
      push(a0, z.s0, MARK.centre.T3);
      push(z.s0, z.s1, cont);
      const a1 = Math.min(nextStart, z.s1 + L);
      push(z.s1, a1, MARK.centre.T3);
      at = a1;
      if (z.s0 - a0 >= 13 + 4) for (const d of [13, 39, 78]) if (z.s0 - d >= a0 - 1) arrows.push({ s: z.s0 - d, dir: 1 });
      if (a1 - z.s1 >= 13 + 4) for (const d of [13, 39, 78]) if (z.s1 + d <= a1 + 1) arrows.push({ s: z.s1 + d, dir: -1 });
    }
    push(at, length, plan.center);
    if (!continuous.length) return { segs: [{ s0: 0, s1: length, center: plan.center, edge: plan.edge }], arrows, continuous };
    return { segs, arrows, continuous };
  }
  return { segs: [{ s0: 0, s1: length, center: plan.center, edge: plan.edge }], arrows, continuous };
}
