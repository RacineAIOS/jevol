import { valueNoise } from './rng.js';

const PROFILES = {
  none: { broad: 0, low: 0, mid: 0, fine: 0, micro: 0, tuft: 0, crease: 0 },
  lawn: { broad: 0.006, low: 0.008, mid: 0.008, fine: 0.005, micro: 0.003, tuft: 0.006, crease: 0.003 },
  grass: { broad: 0.015, low: 0.02, mid: 0.024, fine: 0.016, micro: 0.007, tuft: 0.035, crease: 0.014 },
  shortGrass: { broad: 0.012, low: 0.018, mid: 0.02, fine: 0.014, micro: 0.007, tuft: 0.02, crease: 0.012 },
  bare: { broad: 0.015, low: 0.02, mid: 0.03, fine: 0.026, micro: 0.012, tuft: 0, crease: 0.026 },
  forest: { broad: 0.02, low: 0.025, mid: 0.03, fine: 0.016, micro: 0.007, tuft: 0.02, crease: 0.014 },
  scrub: { broad: 0.02, low: 0.025, mid: 0.035, fine: 0.018, micro: 0.008, tuft: 0.04, crease: 0.016 },
};

export const DEFAULT_SCALE = 2.5 / 3;
export const WEAR_RUT_DEPTH = 0.05;
const RUT_GAIN = 2 / 3;
const RUT_MAX = 0.1;

const PROFILE_OF_CLASS = {
  grass: 'grass', meadow: 'grass', industrial: 'grass', residential: 'lawn', sport: 'lawn',
  crop: 'bare', bare: 'bare', forest_broadleaf: 'forest', forest_conifer: 'forest', forest_mixed: 'forest', scrub: 'scrub',
};

const PROFILE_OF_ZONE = { grass: 'shortGrass', bare: 'bare', dry: 'grass' };

const CROP_PROFILES = {
  wheat: [0.012, 0.012, 0.008, 0.005, 0.003, 0, 0, 0.008, 0.17],
  maize: [0.012, 0.015, 0.012, 0.006, 0.003, 0, 0, 0.035, 0.75],
  rapeseed: [0.012, 0.015, 0.01, 0.006, 0.003, 0, 0, 0.012, 0.42],
  plough: [0.015, 0.02, 0.03, 0.02, 0.012, 0, 0.03, 0.045, 0.42],
  stubble: [0.012, 0.015, 0.012, 0.01, 0.006, 0.01, 0.01, 0.008, 0.2],
  mown: [0.012, 0.016, 0.012, 0.008, 0.004, 0.012, 0.004, 0, 1],
};

const FURROW = { amplitude: 0.035, period: 1.5 };
const TALUS = { from: 9, to: 18, rill: 0.04, terrace: 0.02 };
const ROAD_QUIET = [1.5, 3];
const PATH = { lift: 0.07, edgeDrop: 0.035, under: 0.005 };
const QUIET_FADE = 1.5;
const CELL = 8;

const KEYS = ['broad', 'low', 'mid', 'fine', 'micro', 'tuft', 'crease'];
export const COARSE_CUTOFF = 0.5;
const TAN = (deg) => Math.tan((deg * Math.PI) / 180);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function rutDig(a, s, { rutOff, rutDepth, hw, dJ, seed }) {
  if (rutOff < 0.01 || rutDepth <= 0) return 0;
  const width = rutOff * 0.22 + 0.06;
  const d = Math.abs(a) - rutOff;
  const shape = Math.exp(-(d * d) / (width * width));
  const variation = valueNoise(s * 0.12, seed * 7.3, 811) * 0.7 + 0.4;
  const inside = 1 - smooth(hw - 0.35, hw, Math.abs(a));
  return Math.min(RUT_MAX, shape * variation * smooth(0.5, 3.5, dJ) * inside * rutDepth * RUT_GAIN);
}

function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export function createGroundSurface({ size, half, heights, classes, classNames, seed = 1, scale = DEFAULT_SCALE, fields = null, wear = null }) {
  const profiles = Object.fromEntries(Object.entries(PROFILES).map(([name, p]) => [name, KEYS.map((k) => p[k] * scale)]));
  const byClass = classNames.map((name) => profiles[PROFILE_OF_CLASS[name] ?? 'none']);
  const cropClass = classNames.indexOf('crop');
  const cropOf = [];
  const cropPeriod = [];
  if (fields) {
    for (const [name, code] of Object.entries(fields.types)) {
      const p = CROP_PROFILES[name];
      if (!p) continue;
      cropOf[code] = [...KEYS.map((k, i) => p[i] * scale), p[7] * scale];
      cropPeriod[code] = p[8];
    }
  }
  const cells = Math.ceil(size / CELL);
  const roadIndex = new Array(cells * cells).fill(null);
  const pathIndex = new Array(cells * cells).fill(null);
  const quietIndex = new Array(cells * cells).fill(null);
  let zones = [];

  const at = (i, j) => heights[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))];

  function baseAt(x, z) {
    const fx = x + half - 0.5;
    const fz = z + half - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const row = (jj) => cubic(at(i - 1, jj), at(i, jj), at(i + 1, jj), at(i + 2, jj), tx);
    return cubic(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
  }

  function addToIndex(index, segment, reach) {
    const x0 = Math.floor((Math.min(segment.ax, segment.bx) - reach + half) / CELL);
    const x1 = Math.floor((Math.max(segment.ax, segment.bx) + reach + half) / CELL);
    const z0 = Math.floor((Math.min(segment.az, segment.bz) - reach + half) / CELL);
    const z1 = Math.floor((Math.max(segment.az, segment.bz) + reach + half) / CELL);
    for (let j = Math.max(0, z0); j <= Math.min(cells - 1, z1); j++) {
      for (let i = Math.max(0, x0); i <= Math.min(cells - 1, x1); i++) {
        (index[j * cells + i] ??= []).push(segment);
      }
    }
  }

  const cellOf = (index, x, z) => {
    const i = Math.floor((x + half) / CELL);
    const j = Math.floor((z + half) / CELL);
    return i < 0 || j < 0 || i >= cells || j >= cells ? null : index[j * cells + i];
  };

  function project(s, x, z) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
    return { t, d: Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) };
  }

  function roadAt(x, z) {
    const list = cellOf(roadIndex, x, z);
    if (!list) return { lift: 0, keep: 1 };
    let lift = 0;
    let keep = 1;
    for (const s of list) {
      const { d } = project(s, x, z);
      const edge = d - s.hw;
      keep = Math.min(keep, smooth(ROAD_QUIET[0], ROAD_QUIET[1], edge));
      lift = Math.max(lift, s.top * (1 - smooth(0, 0.6, edge)));
    }
    return { lift, keep };
  }

  function pathAt(x, z) {
    const list = cellOf(pathIndex, x, z);
    if (!list) return { lift: 0, keep: 1 };
    let best = null;
    let bestEdge = Infinity;
    for (const s of list) {
      const { t, d } = project(s, x, z);
      const hw = s.hw0 + (s.hw1 - s.hw0) * t;
      if (d - hw < bestEdge) {
        bestEdge = d - hw;
        best = { s, t, d, hw };
      }
    }
    if (!best || bestEdge >= 1.5) return { lift: 0, keep: 1 };
    const { s, t, d, hw } = best;
    const keep = smooth(0, 1.2, bestEdge);
    let lift = PATH.lift - PATH.edgeDrop * smooth(0, 0.5, bestEdge) - PATH.under;
    lift *= 1 - smooth(0.5, 1.5, bestEdge);
    const along = s.s0 + (s.s1 - s.s0) * t;
    const dJ = s.dJ0 + (s.dJ1 - s.dJ0) * t;
    lift -= rutDig(d, along, { rutOff: s.rutOff, rutDepth: s.rutDepth, hw, dJ, seed: s.seed });
    return { lift, keep };
  }

  function quietAt(x, z) {
    const list = cellOf(quietIndex, x, z);
    if (!list) return 1;
    let keep = 1;
    for (const q of list) keep = Math.min(keep, smooth(0, QUIET_FADE, Math.hypot(x - q.ax, z - q.az) - q.r));
    return keep;
  }

  function detailAt(x, z, cutoff = 0) {
    const quietKeep = quietAt(x, z);
    const road = roadAt(x, z);
    const path = pathAt(x, z);
    const keep = quietKeep * road.keep * path.keep;
    const carried = road.lift + path.lift;
    if (keep <= 0) return carried;

    const fx = x + half - 0.5;
    const fz = z + half - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const cls = (ii, jj) => byClass[classes[Math.min(size - 1, Math.max(0, jj)) * size + Math.min(size - 1, Math.max(0, ii))]];
    const pix = fields
      ? (ii, jj) => {
        const k = Math.min(size - 1, Math.max(0, jj)) * size + Math.min(size - 1, Math.max(0, ii));
        const code = classes[k] === cropClass ? Math.round(fields.data[k * 4 + 2] / fields.step) : 0;
        return cropOf[code] ?? [...byClass[classes[k]], 0];
      }
      : cls;
    const c00 = pix(i, j);
    const c10 = pix(i + 1, j);
    const c01 = pix(i, j + 1);
    const c11 = pix(i + 1, j + 1);
    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;
    let broad = c00[0] * w00 + c10[0] * w10 + c01[0] * w01 + c11[0] * w11;
    let low = c00[1] * w00 + c10[1] * w10 + c01[1] * w01 + c11[1] * w11;
    let mid = c00[2] * w00 + c10[2] * w10 + c01[2] * w01 + c11[2] * w11;
    let fine = c00[3] * w00 + c10[3] * w10 + c01[3] * w01 + c11[3] * w11;
    let micro = c00[4] * w00 + c10[4] * w10 + c01[4] * w01 + c11[4] * w11;
    let tuft = c00[5] * w00 + c10[5] * w10 + c01[5] * w01 + c11[5] * w11;
    let crease = c00[6] * w00 + c10[6] * w10 + c01[6] * w01 + c11[6] * w11;

    let furrow = 0;
    for (const zone of zones) {
      if (x < zone.x0 || x > zone.x1 || z < zone.z0 || z > zone.z1) continue;
      const w = smooth(0, 3, Math.min(x - zone.x0, zone.x1 - x, z - zone.z0, zone.z1 - z));
      broad += (zone.profile[0] - broad) * w;
      low += (zone.profile[1] - low) * w;
      mid += (zone.profile[2] - mid) * w;
      fine += (zone.profile[3] - fine) * w;
      micro += (zone.profile[4] - micro) * w;
      tuft += (zone.profile[5] - tuft) * w;
      crease += (zone.profile[6] - crease) * w;
      furrow = Math.max(furrow, zone.furrow * w);
    }

    let rowAmp = 0;
    let rowPeriod = 1;
    let rowAngle = 0;
    if (fields) {
      rowAmp = c00[7] * w00 + c10[7] * w10 + c01[7] * w01 + c11[7] * w11;
      if (rowAmp > 0) {
        const k = Math.min(size - 1, Math.max(0, Math.round(fz))) * size + Math.min(size - 1, Math.max(0, Math.round(fx)));
        const code = Math.round(fields.data[k * 4 + 2] / fields.step);
        rowPeriod = cropPeriod[code] ?? 0;
        rowAngle = (fields.data[k * 4] * Math.PI) / 255;
      }
    }

    const ax = x * 0.8 - z * 0.6;
    const az = x * 0.6 + z * 0.8;
    const bx = x * 0.3 + z * 0.954;
    const bz = -x * 0.954 + z * 0.3;
    let h = 0;
    if (broad) h += broad * 2 * (valueNoise(bx / 5, bz / 5, seed + 8) - 0.5);
    if (low) h += low * 2 * (valueNoise(x / 2.2, z / 2.2, seed + 1) - 0.5);
    if (mid) h += mid * 2 * (valueNoise(ax / 0.7, az / 0.7, seed + 2) - 0.5);
    if (cutoff <= 0.22) {
      if (fine) h += fine * 2 * (valueNoise(bx / 0.22, bz / 0.22, seed + 3) - 0.5);
      if (micro) h += micro * 2 * (valueNoise(x / 0.12, z / 0.12, seed + 4) - 0.5);
      if (crease) h += crease * (0.5 - 2 * Math.abs(valueNoise(az / 0.35, ax / 0.35, seed + 9) - 0.5));
    }
    if (tuft) h += tuft * smooth(0.5, 0.95, valueNoise(ax / 0.45, az / 0.45, seed + 5));
    if (furrow) h += furrow * Math.sin((x * Math.PI * 2) / FURROW.period);
    if (rowAmp > 0 && rowPeriod > 0 && (cutoff <= 0.22 || rowPeriod >= COARSE_CUTOFF)) {
      const across = -z * Math.cos(rowAngle) - x * Math.sin(rowAngle);
      h += rowAmp * Math.sin((across * Math.PI * 2) / rowPeriod);
    }

    const e = 1;
    const gx = (baseAt(x + e, z) - baseAt(x - e, z)) / (2 * e);
    const gz = (baseAt(x, z + e) - baseAt(x, z - e)) / (2 * e);
    const slope = Math.hypot(gx, gz);
    if (slope > TAN(TALUS.from)) {
      const w = smooth(TAN(TALUS.from), TAN(TALUS.to), slope);
      const ux = gx / slope;
      const uz = gz / slope;
      const down = x * ux + z * uz;
      const across = -x * uz + z * ux;
      h += w * scale * TALUS.rill * 2 * (valueNoise(across / 0.4, down / 2.5, seed + 6) - 0.5);
      h += w * scale * TALUS.terrace * 2 * (valueNoise(across / 3, down / 0.35, seed + 7) - 0.5);
    }
    if (wear) h -= wear.rutAt(x, z) * WEAR_RUT_DEPTH;
    return h * keep + carried;
  }

  return {
    baseAt,
    detailAt,
    heightAt: (x, z) => baseAt(x, z) + detailAt(x, z),

    setRoads(roads) {
      for (const road of roads) {
        const top = 0.045 + 0.006 * Math.min(Number(road.importance) || 0, 6);
        for (let k = 0; k + 1 < road.line.length; k++) {
          const [ax, ay] = road.line[k];
          const [bx, by] = road.line[k + 1];
          const hw = Number(road.width) / 2;
          addToIndex(roadIndex, { ax, az: -ay, bx, bz: -by, hw, top }, hw + ROAD_QUIET[1]);
        }
      }
    },

    setPaths(ribbons) {
      for (const rb of ribbons) {
        const { axis, along, hwEff, dJ, item } = rb;
        for (let k = 0; k + 1 < axis.length; k++) {
          addToIndex(pathIndex, {
            ax: axis[k][0], az: axis[k][1], bx: axis[k + 1][0], bz: axis[k + 1][1],
            hw0: hwEff[k], hw1: hwEff[k + 1], s0: along[k], s1: along[k + 1], dJ0: dJ[k], dJ1: dJ[k + 1],
            rutOff: item.k.rutOff, rutDepth: item.k.rutDepth, seed: item.seed,
          }, Math.max(hwEff[k], hwEff[k + 1]) + 1.5);
        }
      }
    },

    setZones(list) {
      zones = list.map((zone) => ({
        x0: zone.x[0] - 3, x1: zone.x[1] + 3, z0: -zone.y[1] - 3, z1: -zone.y[0] + 3,
        profile: profiles[PROFILE_OF_ZONE[zone.kind] ?? 'grass'],
        furrow: zone.kind === 'bare' ? FURROW.amplitude * scale : 0,
      }));
    },

    addQuiet(list) {
      for (const { x, y, r } of list) {
        addToIndex(quietIndex, { ax: x, az: -y, bx: x, bz: -y, r }, r + QUIET_FADE);
      }
    },
  };
}
