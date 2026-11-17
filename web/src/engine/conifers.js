import * as THREE from 'three/webgpu';
import { mulberry32 } from './rng.js';
import { Builder, addTube } from './treeGen.js';
import { cutoutTexture, FOLIAGE_TEXTURE_SIZE } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

export const CONIFER_SPECIES = {
  scotsPine: { bark: 'rough', foliage: 'pineTuft', barkColor: 0x9a8574, barkTop: 0xdc9461, leafColor: 0xb8c8b2, deadColor: 0x857d74 },
  norwaySpruce: { bark: 'rough', foliage: 'spruceSpray', barkColor: 0x87786a, leafColor: 0xa2b9a0, deadColor: 0x7f766c },
};

export const CONIFER_MODELS = {
  pine: [
    { species: 'scotsPine', form: 'young', height: 6, seeds: 2 },
    { species: 'scotsPine', form: 'middle', height: 14, seeds: 2 },
    { species: 'scotsPine', form: 'mature', height: 23, seeds: 3 },
  ],
  spruce: [
    { species: 'norwaySpruce', form: 'young', height: 6, seeds: 2 },
    { species: 'norwaySpruce', form: 'middle', height: 15, seeds: 2 },
    { species: 'norwaySpruce', form: 'mature', height: 28, seeds: 2 },
  ],
};

export function coniferSizeIndex(classes, h) {
  for (let k = 0; k < classes.length - 1; k++) if (h < Math.sqrt(classes[k].height * classes[k + 1].height)) return k;
  return classes.length - 1;
}

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

export function coniferTexture(kind, seed = 1) {
  const S = FOLIAGE_TEXTURE_SIZE;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.lineCap = 'round';
  if (kind === 'pineTuft') {
    const shoots = 9;
    for (let t = 0; t < shoots; t++) {
      const ang = -Math.PI / 2 + ((t + rnd.range(0.2, 0.8)) / shoots - 0.5) * 2.5;
      const len = rnd.range(0.26, 0.42) * S;
      const x0 = S / 2 + rnd.range(-40, 40);
      const y0 = S * 0.9 + rnd.range(-10, 10);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      ctx.strokeStyle = rgb(96, 70, 48);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      for (let k = 0; k < 230; k++) {
        const f = 0.12 + 0.88 * Math.sqrt(rnd());
        const px = x0 + (x1 - x0) * f;
        const py = y0 + (y1 - y0) * f;
        const na = ang + rnd.sign() * rnd.range(0.3, 0.85);
        const nl = rnd.range(24, 42);
        const g = rnd.range(0.72, 1.18);
        const blue = rnd.range(-8, 10);
        ctx.strokeStyle = rgb(70 * g, 103 * g, (84 + blue) * g);
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        ctx.stroke();
      }
      for (let k = 0; k < 36; k++) {
        const na = ang + rnd.range(-1.4, 1.4);
        const nl = rnd.range(18, 34);
        const g = rnd.range(0.85, 1.2);
        ctx.strokeStyle = rgb(78 * g, 110 * g, 90 * g);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + Math.cos(na) * nl, y1 + Math.sin(na) * nl);
        ctx.stroke();
      }
    }
  } else {
    const x0 = S / 2;
    const y0 = S * 0.96;
    const yTop = S * 0.04;
    const bend = rnd.range(-20, 20);
    const axis = (f) => [x0 + bend * f * f, y0 + (yTop - y0) * f];
    const needles = (xa, ya, xb, yb, n, dark) => {
      const ang = Math.atan2(yb - ya, xb - xa);
      for (let k = 0; k < n; k++) {
        const f = rnd();
        const px = xa + (xb - xa) * f;
        const py = ya + (yb - ya) * f;
        const na = ang + rnd.sign() * rnd.range(0.5, 1.3);
        const nl = rnd.range(9, 16);
        const g = rnd.range(0.75, 1.2) * dark;
        ctx.strokeStyle = rgb(38 * g, 68 * g, 46 * g);
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        ctx.stroke();
      }
    };
    ctx.strokeStyle = rgb(92, 70, 50);
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const [x, y] = axis(k / 16);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const twigs = 22;
    for (let t = 0; t < twigs; t++) {
      const f = 0.04 + 0.94 * (t / twigs);
      const [xa, ya] = axis(f);
      const side = t % 2 ? 1 : -1;
      const len = 0.4 * S * Math.pow(1 - f, 0.75) + 14;
      const ang = -Math.PI / 2 + side * rnd.range(0.85, 1.1);
      const xb = xa + Math.cos(ang) * len;
      const yb = ya + Math.sin(ang) * len;
      ctx.strokeStyle = rgb(84, 64, 46);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.stroke();
      needles(xa, ya, xb, yb, Math.round(len * 1.6), 1);
      needles(xa + (xb - xa) * 0.8, ya + (yb - ya) * 0.8, xb, yb, 14, 1.35);
    }
    const [xt, yt] = axis(1);
    needles(x0, y0, xt, yt, 160, 1.05);
  }
  return cutoutTexture(ctx, S);
}

function trunkPath(rnd, height, r0, rTop, sinuosity, segs) {
  const points = [];
  const radii = [];
  const lean = new THREE.Vector3(rnd.range(-1, 1), 0, rnd.range(-1, 1)).multiplyScalar(0.012);
  const ph1 = rnd.range(0, 6.28);
  const ph2 = rnd.range(0, 6.28);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const wobble = sinuosity * height;
    points.push(new THREE.Vector3(
      lean.x * height * t + Math.sin(t * 5 + ph1) * wobble * t,
      height * t,
      lean.z * height * t + Math.sin(t * 4.1 + ph2) * wobble * t,
    ));
    const flare = 1 + 0.35 * Math.max(0, 1 - t * 14);
    radii.push((r0 + (rTop - r0) * Math.pow(t, 0.85)) * flare);
  }
  return { level: 0, points, radii };
}

function along(path, t) {
  const f = THREE.MathUtils.clamp(t, 0, 1) * (path.points.length - 1);
  const i = Math.min(path.points.length - 2, Math.floor(f));
  const k = f - i;
  return {
    pos: path.points[i].clone().lerp(path.points[i + 1], k),
    radius: path.radii[i] + (path.radii[i + 1] - path.radii[i]) * k,
  };
}

function branchPath(rnd, origin, azimuth, elev, length, r0, segs, curve, gnarl = 0.08) {
  const d = new THREE.Vector3(Math.cos(azimuth) * Math.cos(elev), Math.sin(elev), Math.sin(azimuth) * Math.cos(elev));
  const points = [origin.clone()];
  const radii = [r0];
  for (let s = 1; s <= segs; s++) {
    const f = s / segs;
    d.x += rnd.range(-gnarl, gnarl);
    d.z += rnd.range(-gnarl, gnarl);
    d.y += curve(f) + rnd.range(-gnarl, gnarl) * 0.5;
    d.normalize();
    points.push(points[s - 1].clone().addScaledVector(d, length / segs));
    radii.push(r0 * (1 - 0.7 * f));
  }
  return { level: 1, points, radii };
}

function card(cards, p, a, b, size, normal, shade, aspect = 1) {
  cards.push({ p, a, b, size, normal, shade, aspect });
}

function pineClump(rnd, cards, center, rx, ry, count, cardSize, crown, outward) {
  const shade = { center, rx, ry };
  const dir = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    dir.set(rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1));
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
    dir.normalize();
    if (dir.y < -0.25 && rnd() < 0.65) dir.y = -dir.y;
    const s = rnd.range(0.45, 1);
    const p = center.clone().add(new THREE.Vector3(dir.x * rx * s, dir.y * ry * s, dir.z * rx * s));
    const o = new THREE.Vector3(dir.x, 0, dir.z);
    if (o.lengthSq() < 0.01) o.copy(outward);
    o.normalize().applyAxisAngle(UP, rnd.range(-0.6, 0.6));
    const tilt = THREE.MathUtils.lerp(0.95, 0.2, Math.max(0, dir.y)) * rnd.range(0.6, 1.25);
    const a = o.clone().addScaledVector(UP, tilt).normalize();
    const b = a.clone().cross(UP).normalize().applyAxisAngle(a, rnd.range(-0.45, 0.45));
    const n = p.clone().sub(center).divide(new THREE.Vector3(rx, ry, rx)).normalize().multiplyScalar(0.6)
      .add(p.clone().sub(crown.center).divide(crown.half).normalize().multiplyScalar(0.25))
      .addScaledVector(UP, 0.25).normalize();
    card(cards, p, a, b, cardSize * rnd.range(0.8, 1.2), n, shade);
  }
}

function buildPine(form, height, rnd) {
  const sp = CONIFER_SPECIES.scotsPine;
  const branches = [];
  const dead = [];
  const cards = [];
  const k = height / 23;
  const young = form === 'young';
  const mature = form === 'mature';
  const r0 = young ? 0.012 * height + 0.02 : 0.0085 * height + 0.04;
  const trunk = trunkPath(rnd, height * (young ? 0.98 : 0.95), r0, young ? 0.015 : 0.04, young ? 0.002 : 0.004, young ? 8 : 12);
  branches.push(trunk);
  const crownBase = { young: 0.12, middle: 0.42, mature: 0.6 }[form] * rnd.range(0.94, 1.06);
  const rMax = (young ? 0.3 : mature ? 0.165 : 0.2) * height * rnd.range(0.88, 1.12);
  const crown = {
    center: new THREE.Vector3(0, height * (crownBase + 1) / 2, 0),
    half: new THREE.Vector3(rMax, height * (1 - crownBase) / 2, rMax),
  };
  const profile = (tc) => {
    if (young) return 0.12 + (1 - tc) ** 0.95;
    if (mature) return 0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.2 + tc * 0.85));
    return 1 - 0.82 * tc ** 1.3;
  };

  const golden = 2.39996;
  let az = rnd.range(0, Math.PI * 2);
  const clumpScale = young ? 0.42 : mature ? 1 : 0.78;
  if (young) {
    const whorls = Math.max(5, Math.round(height / 0.62));
    for (let w = 0; w < whorls; w++) {
      const t = crownBase + (0.94 - crownBase) * ((w + rnd.range(0.1, 0.4)) / whorls);
      const tc = (t - crownBase) / (1 - crownBase);
      const { pos, radius } = along(trunk, t / 0.98);
      const n = 4 + rnd.int(2);
      az += rnd.range(0, 1.2);
      for (let b = 0; b < n; b++) {
        const a = az + (b / n) * Math.PI * 2 + rnd.range(-0.3, 0.3);
        const len = rMax * profile(tc) * rnd.range(0.8, 1.1);
        const elev = THREE.MathUtils.degToRad(rnd.range(22, 40));
        const br = branchPath(rnd, pos, a, elev, len, Math.max(0.012, radius * 0.45), 3, () => 0.06, 0.05);
        branches.push(br);
        const tip = br.points[br.points.length - 1];
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        pineClump(rnd, cards, tip.clone().addScaledVector(UP, 0.05), 0.42 * Math.max(0.6, len / 1.2), 0.22, 7, 0.62, crown, out);
        if (len > 0.9) {
          const mid = along(br, 0.5).pos;
          pineClump(rnd, cards, mid.addScaledVector(UP, 0.08), 0.3, 0.18, 4, 0.5, crown, out);
        }
      }
    }
    const top = trunk.points[trunk.points.length - 1];
    for (let c = 0; c < 3; c++) {
      const b = new THREE.Vector3(Math.cos(c * 2.1), 0, Math.sin(c * 2.1));
      card(cards, top.clone().addScaledVector(UP, 0.12), UP.clone(), b, 0.55, b.clone().cross(UP).normalize().addScaledVector(UP, 0.4).normalize(),
        { center: top, rx: 0.3, ry: 0.5 });
    }
  } else {
    const n = mature ? 18 + rnd.int(5) : 20 + rnd.int(6);
    const gap = rnd.range(0, Math.PI * 2);
    for (let b = 0; b < n; b++) {
      const t = crownBase + (0.97 - crownBase) * ((b + rnd.range(0.15, 0.85)) / n);
      const tc = (t - crownBase) / (1 - crownBase);
      const { pos, radius } = along(trunk, t / 0.95);
      az += golden + rnd.range(-0.35, 0.35);
      const sparse = Math.cos(az - gap) > 0.5 ? 0.6 : 1;
      const len = rMax * profile(tc) * rnd.range(0.75, 1.15) * sparse;
      const elevDeg = mature ? THREE.MathUtils.lerp(4, 52, tc) : THREE.MathUtils.lerp(14, 50, tc);
      const elev = THREE.MathUtils.degToRad(elevDeg + rnd.range(-8, 8));
      const br = branchPath(rnd, pos, az, elev, len, Math.max(0.025, radius * 0.42), 5, (f) => (f > 0.5 ? 0.07 : -0.02), 0.09);
      branches.push(br);
      const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const tips = [br.points[br.points.length - 1]];
      const forks = len > 1.6 ? 1 + rnd.int(2) : 0;
      for (let f = 0; f < forks; f++) {
        const ft = rnd.range(0.4, 0.75);
        const fp = along(br, ft);
        const fa = az + rnd.sign() * rnd.range(0.45, 0.9);
        const fork = branchPath(rnd, fp.pos, fa, elev + 0.2, len * rnd.range(0.35, 0.55), Math.max(0.015, fp.radius * 0.55), 3, () => 0.06, 0.08);
        fork.level = 2;
        branches.push(fork);
        tips.push(fork.points[fork.points.length - 1]);
      }
      for (const tip of tips) {
        const rx = clumpScale * Math.max(0.6, Math.min(1.55, 0.6 + len * 0.25)) * rnd.range(0.85, 1.15) * Math.max(0.75, k);
        pineClump(rnd, cards, tip.clone().addScaledVector(UP, rx * 0.12), rx, rx * rnd.range(0.42, 0.58), mature ? 24 : 18, 0.95 * clumpScale + 0.15, crown, out);
      }
      if (len > 1.3) {
        const mid = along(br, rnd.range(0.45, 0.65)).pos;
        const rx = clumpScale * rnd.range(0.55, 0.85);
        pineClump(rnd, cards, mid.addScaledVector(UP, rx * 0.25), rx, rx * 0.5, mature ? 12 : 10, 0.85 * clumpScale + 0.1, crown, out);
      }
    }
    const top = trunk.points[trunk.points.length - 1];
    const rx = mature ? 1.25 : 0.85;
    pineClump(rnd, cards, top.clone().addScaledVector(UP, mature ? 0.1 : 0.3), rx, mature ? rx * 0.45 : rx * 0.75, mature ? 22 : 18, 1.0, crown, new THREE.Vector3(1, 0, 0));
    const stubs = Math.round(height * crownBase * (mature ? 1.2 : 2));
    for (let s = 0; s < stubs; s++) {
      const t = rnd.range(0.25, 1) * crownBase;
      const { pos, radius } = along(trunk, t / 0.95);
      const a = rnd.range(0, Math.PI * 2);
      const len = rnd.range(0.15, 0.5) * (t / crownBase + 0.3);
      const d = new THREE.Vector3(Math.cos(a), rnd.range(-0.25, 0.1), Math.sin(a)).normalize();
      const p0 = pos.clone().addScaledVector(d, radius * 0.8);
      dead.push({ level: 2, points: [p0, p0.clone().addScaledVector(d, len)], radii: [0.022, 0.008] });
    }
  }
  return { sp, branches, dead, cards, crown };
}

function buildSpruce(form, height, rnd) {
  const sp = CONIFER_SPECIES.norwaySpruce;
  const branches = [];
  const dead = [];
  const cards = [];
  const young = form === 'young';
  const mature = form === 'mature';
  const r0 = 0.0085 * height + 0.04;
  const trunk = trunkPath(rnd, height, r0, 0.012, 0.0015, young ? 8 : 14);
  branches.push(trunk);
  const crownBase = { young: 0.05, middle: 0.1, mature: 0.2 }[form] * rnd.range(0.85, 1.15);
  const rBase = (young ? 0.24 : mature ? 0.14 : 0.18) * height * rnd.range(0.9, 1.1);
  const crown = {
    center: new THREE.Vector3(0, height * (crownBase + 1) / 2, 0),
    half: new THREE.Vector3(rBase * 0.7, height * (1 - crownBase) / 2, rBase * 0.7),
  };
  const sizeK = THREE.MathUtils.clamp(height / 22, 0.55, 1.15);
  const whorls = young ? 16 : mature ? 32 : 24;
  let az0 = rnd.range(0, Math.PI * 2);
  for (let w = 0; w < whorls; w++) {
    const t = crownBase + (0.975 - crownBase) * ((w + rnd.range(0.05, 0.4)) / whorls);
    const tc = (t - crownBase) / (1 - crownBase);
    const { pos, radius } = along(trunk, t);
    const n = (young ? 4 : 5) + rnd.int(2);
    az0 += rnd.range(0.4, 1.4);
    for (let b = 0; b < n; b++) {
      const az = az0 + (b / n) * Math.PI * 2 + rnd.range(-0.35, 0.35);
      const len = (rBase * Math.pow(1 - tc, 1.0) + 0.25) * rnd.range(0.82, 1.12);
      const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(young ? 2 : -12, 28, tc) + rnd.range(-6, 6));
      const sag = (young ? 0.03 : 0.07) * (1 - tc);
      const br = branchPath(rnd, pos, az, elev, len, Math.max(0.015, radius * 0.4), 4, (f) => (f < 0.6 ? -sag : sag * 2.2 + 0.03), 0.04);
      branches.push(br);
      const dirAt = (f) => {
        const i = Math.min(br.points.length - 2, Math.floor(f * (br.points.length - 1)));
        return br.points[i + 1].clone().sub(br.points[i]).normalize();
      };
      const topCount = Math.max(2, Math.round(len * (young ? 3.6 : 2.6)));
      for (let c = 0; c < topCount; c++) {
        const f = 0.12 + 0.88 * ((c + rnd.range(0.1, 0.9)) / topCount);
        const p = along(br, f).pos;
        const tan = dirAt(f);
        const a = tan.clone().applyAxisAngle(UP, rnd.range(-0.5, 0.5));
        a.y += rnd.range(0.0, 0.25);
        a.normalize();
        const bb = a.clone().cross(UP).normalize().applyAxisAngle(a, rnd.range(-0.35, 0.35));
        const size = (0.55 + 0.35 * (1 - tc)) * sizeK * rnd.range(0.85, 1.15);
        const nrm = p.clone().sub(crown.center).divide(crown.half).normalize().multiplyScalar(0.55).addScaledVector(UP, 0.45).normalize();
        card(cards, p.clone().addScaledVector(a, size * 0.15), a, bb, size, nrm, { center: pos, rx: len + 0.3, ry: 0.5, layer: true });
      }
      if (!young && tc < 0.8) {
        const hang = Math.max(1, Math.round(len * (mature ? 1.6 : 1.2) * (1 - tc * 0.6)));
        for (let c = 0; c < hang; c++) {
          const f = 0.25 + 0.7 * ((c + rnd.range(0.1, 0.9)) / hang);
          const tan = dirAt(f);
          const flat = new THREE.Vector3(tan.x, 0, tan.z).normalize();
          const size = rnd.range(0.55, 0.85) * sizeK;
          const p = along(br, f).pos.addScaledVector(UP, -size * 0.45);
          const a = new THREE.Vector3(0, -1, 0).addScaledVector(flat, 0.25).add(new THREE.Vector3(rnd.range(-0.1, 0.1), 0, rnd.range(-0.1, 0.1))).normalize();
          const bb = flat.clone().applyAxisAngle(UP, rnd.range(-0.3, 0.3));
          const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
          const nrm = out.multiplyScalar(0.7).addScaledVector(UP, 0.3).normalize();
          card(cards, p, a, bb, size, nrm, { center: pos, rx: len + 0.3, ry: 0.6, layer: true, hang: true });
        }
      }
    }
  }
  const top = trunk.points[trunk.points.length - 1];
  const tipSize = (young ? 0.8 : 1.4) * Math.max(0.8, sizeK);
  for (let c = 0; c < 3; c++) {
    const bb = new THREE.Vector3(Math.cos(c * 1.05 + az0), 0, Math.sin(c * 1.05 + az0));
    card(cards, top.clone().addScaledVector(UP, -tipSize * 0.2), UP.clone(), bb, tipSize, bb.clone().cross(UP).normalize().addScaledVector(UP, 0.5).normalize(),
      { center: top, rx: 0.5, ry: 1, layer: true }, 0.5);
  }
  if (!young) {
    const deadCount = Math.round(height * crownBase * (mature ? 5 : 3));
    for (let s = 0; s < deadCount; s++) {
      const t = rnd.range(0.12, 1) * crownBase;
      const { pos, radius } = along(trunk, t);
      const a = rnd.range(0, Math.PI * 2);
      const len = rnd.range(0.3, 1.1) * (0.4 + t / crownBase);
      const d = new THREE.Vector3(Math.cos(a), rnd.range(-0.35, 0.05), Math.sin(a)).normalize();
      const p0 = pos.clone().addScaledVector(d, radius * 0.8);
      dead.push({ level: 2, points: [p0, p0.clone().addScaledVector(d, len)], radii: [0.018, 0.006] });
    }
  }
  return { sp, branches, dead, cards, crown };
}

const _c = new THREE.Color();

function addCards(builder, cards, crown, leafColor, filter, scale) {
  const base = new THREE.Color(leafColor);
  const rnd = mulberry32(cards.length * 7 + 3);
  const corners = [[-0.5, 0, 0, 0], [0.5, 0, 1, 0], [0.5, 1, 1, 1], [-0.5, 1, 0, 1]];
  const v = new THREE.Vector3();
  const crownBottom = crown.center.y - crown.half.y;
  for (let i = 0; i < cards.length; i++) {
    if (!filter(i)) {
      rnd();
      continue;
    }
    const { p, a, b, normal, shade } = cards[i];
    const size = cards[i].size * scale;
    const width = size * cards[i].aspect;
    const jitter = rnd.range(0.9, 1.1);
    const start = p.clone().addScaledVector(a, -size * 0.5);
    const i0 = builder.pos.length / 3;
    for (const [cb, ca, u, w] of corners) {
      v.copy(start).addScaledVector(b, cb * width).addScaledVector(a, ca * size);
      const up = THREE.MathUtils.clamp((v.y - crownBottom) / (2 * crown.half.y), 0, 1);
      let ao;
      if (shade.layer) {
        const rel = (v.y - shade.center.y) / shade.ry;
        ao = (shade.hang ? 0.7 + 0.18 * THREE.MathUtils.clamp(rel + 1, 0, 1) : 0.86 + 0.22 * THREE.MathUtils.clamp(rel, -1, 1))
          * (0.78 + 0.26 * up);
        const reach = Math.hypot(v.x - shade.center.x, v.z - shade.center.z) / shade.rx;
        ao *= 0.8 + 0.25 * THREE.MathUtils.clamp(reach, 0, 1);
      } else {
        const rx = shade.rx;
        const ry = shade.ry;
        const rel = new THREE.Vector3((v.x - shade.center.x) / rx, (v.y - shade.center.y) / ry, (v.z - shade.center.z) / rx);
        ao = (0.5 + 0.42 * THREE.MathUtils.clamp(rel.y * 0.5 + 0.5, 0, 1) + 0.16 * Math.min(1, rel.length())) * (0.8 + 0.22 * up);
      }
      _c.copy(base).multiplyScalar(ao * jitter);
      builder.vertex(v, normal, u, w, _c);
    }
    builder.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  }
}

function coarse(br) {
  const n = br.points.length - 1;
  const keep = [0, Math.round(n / 2), n];
  return { level: br.level, points: keep.map((i) => br.points[i]), radii: keep.map((i) => br.radii[i]) };
}

export function buildConifer(model, seed) {
  const rnd = mulberry32(seed * 7919 + (model.species === 'scotsPine' ? 31337 : 7331) + model.height * 101);
  const built = model.species === 'scotsPine' ? buildPine(model.form, model.height, rnd) : buildSpruce(model.form, model.height, rnd);
  const { sp, branches, dead, cards, crown } = built;
  let top = 0;
  for (const br of branches) for (const p of br.points) top = Math.max(top, p.y);
  const box = new THREE.Box3();
  for (const c of cards) box.expandByPoint(c.p);
  top = Math.max(top, box.max.y);
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.3, 0.3, 0.3));

  const spruce = model.species === 'norwaySpruce';
  const bark0 = new Builder();
  const leaves0 = new Builder();
  for (const br of branches) addTube(bark0, br, br.level === 0 ? 8 : br.level === 1 && !spruce ? 4 : 3, sp.barkColor, sp.barkTop ?? null, top);
  for (const br of dead) addTube(bark0, br, 3, sp.deadColor, null, top);
  addCards(leaves0, cards, crown, sp.leafColor, () => true, 1);

  const bark1 = new Builder();
  const leaves1 = new Builder();
  for (const br of branches) {
    if (br.level === 0) addTube(bark1, br, 5, sp.barkColor, sp.barkTop, top);
    else if (!spruce && model.form !== 'young') addTube(bark1, coarse(br), 3, sp.barkColor, sp.barkTop, top);
  }
  addCards(leaves1, cards, crown, sp.leafColor, (i) => i % 3 === 0, 1.6);

  return {
    skeleton: { species: model.species, center, half, top, crownRadius: Math.max(half.x, half.z) },
    lods: [
      { bark: bark0.geometry(), leaves: leaves0.geometry() },
      { bark: bark1.geometry(), leaves: leaves1.geometry() },
    ],
    bark: sp.bark,
    foliage: sp.foliage,
  };
}
