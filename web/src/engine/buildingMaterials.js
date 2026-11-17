import * as THREE from 'three/webgpu';
import { attribute, uv, positionWorld, normalWorld, cameraPosition, cameraViewMatrix, vec3, vec4, float, mix, min, max, abs, cross, floor, fract, sin, cos, dot, normalize, select, step, smoothstep, clamp, fwidth, mx_noise_float, mx_fractal_noise_float, mx_cell_noise_float } from 'three/tsl';

function detailFade(coord, period) {
  return float(1).sub(smoothstep(0.25, 0.6, fwidth(coord).div(period)));
}

function joint(coord, period, width) {
  const f = fract(coord.div(period));
  const d = min(f, f.oneMinus()).mul(period);
  const w = fwidth(coord);
  const line = float(1).sub(smoothstep(width.sub(w), width.add(w), d));
  return mix(line, width.mul(2).div(period), float(1).sub(detailFade(coord, period)));
}

function ribs(coord, period) {
  const f = fract(coord.div(period));
  const rise = smoothstep(0.0, 0.04, f).sub(smoothstep(0.06, 0.1, f));
  const fall = smoothstep(0.2, 0.24, f).sub(smoothstep(0.26, 0.3, f));
  const fade = float(1).sub(smoothstep(0.06, 0.15, fwidth(coord).div(period)));
  return rise.sub(fall).mul(fade);
}

const hash3 = (a, b, c) => mx_cell_noise_float(vec3(a, b, c));
const luma = (c) => dot(c, vec3(0.299, 0.587, 0.114));

function tiltedNormal(dx, dy) {
  const n = normalWorld;
  const t = normalize(vec3(n.z, 0, n.x.negate()).add(vec3(1e-5, 0, 0)));
  const b = normalize(cross(n, t));
  const tilted = normalize(n.add(t.mul(dx)).add(b.mul(dy)));
  return normalize(cameraViewMatrix.mul(vec4(tilted, 0)).xyz);
}

export function wallMaterial(type) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const segLen = info.x;
  const top = info.y;
  const seed = info.z;
  const quoins = step(10, info.w);
  const plinth = info.w.sub(quoins.mul(10));

  let color = base;
  let dx = float(0);

  if (type === 'render') {
    const grain = mx_noise_float(vec3(u, h, seed).mul(22)).mul(0.07).mul(detailFade(u, 0.05));
    const blotch = mx_fractal_noise_float(vec3(u.mul(0.35), h.mul(0.5), seed), 3, 2, 0.5).mul(0.1);
    color = base.mul(float(1).add(grain).add(blotch));
  } else if (type === 'stone') {
    const wobble = mx_noise_float(vec3(u.mul(3), h.mul(3), seed)).mul(0.035);
    const hw = h.add(wobble);
    const rowH = 0.24;
    const row = floor(hw.div(rowH));
    const rowLen = hash3(row, seed, 1).mul(0.3).add(0.32);
    const uw = u.add(wobble).add(hash3(row, seed, 2).mul(0.6));
    const col = floor(uw.div(rowLen));
    const fx = fract(uw.div(rowLen));
    const fy = fract(hw.div(rowH));
    const d = min(min(fx, fx.oneMinus()).mul(rowLen), min(fy, fy.oneMinus()).mul(rowH));
    const fade = detailFade(u, 0.25);
    const mortarWidth = hash3(col, row, seed).mul(0.012).add(0.012);
    const mortar = float(1).sub(smoothstep(mortarWidth, mortarWidth.add(0.01), d)).mul(fade);
    const tone = hash3(col, row, seed.add(9)).sub(0.5).mul(0.35).add(mx_noise_float(vec3(u, h, seed).mul(13)).mul(0.07));
    const bulge = mix(float(0.92), smoothstep(0.0, 0.07, d).mul(0.18).add(0.82), fade);
    const stone = base.mul(float(1).add(tone)).mul(bulge);
    const lime = mix(base, vec3(0.66, 0.62, 0.54), 0.6);
    color = mix(stone, lime, mortar.mul(0.85));
  } else if (type === 'brick') {
    const row = floor(h.div(0.075));
    const shifted = u.add(row.mod(2).mul(0.115));
    const col = floor(shifted.div(0.23));
    const jitter = hash3(col, row, seed);
    const brick = base.mul(mix(float(0.78), float(1.18), jitter)).mul(float(1).add(mx_noise_float(vec3(u, h, seed).mul(30)).mul(0.06)));
    const m = max(joint(h, 0.075, float(0.005)), joint(shifted, 0.23, float(0.005)));
    color = mix(brick, vec3(0.42, 0.4, 0.36), m);
  } else if (type === 'ashlar') {
    const row = floor(h.div(0.36));
    const shifted = u.add(row.mod(2).mul(0.3));
    const col = floor(shifted.div(0.62));
    const jitter = hash3(col, row, seed).sub(0.5).mul(0.16);
    const stone = base.mul(float(1).add(jitter).add(mx_noise_float(vec3(u, h, seed).mul(6)).mul(0.07)));
    const m = max(joint(h, 0.36, float(0.006)), joint(shifted, 0.62, float(0.006)));
    color = mix(stone, base.mul(0.78), m);
  } else if (type === 'metal') {
    dx = ribs(u, 0.25).mul(0.8);
    const panel = hash3(floor(u.div(1.0)), float(0), seed).sub(0.5).mul(0.05);
    color = base.mul(float(1).add(panel).add(mx_noise_float(vec3(u.mul(0.3), h.mul(0.3), seed)).mul(0.05)));
    material.roughness = 0.55;
    material.metalness = 0.15;
  } else if (type === 'wood') {
    const board = floor(u.div(0.14));
    const jitter = hash3(board, float(0), seed).sub(0.5).mul(0.3);
    const fibre = mx_noise_float(vec3(u.mul(40), h.mul(1.5), seed)).mul(0.1).mul(detailFade(u, 0.03));
    const gap = joint(u, 0.14, float(0.006));
    color = mix(base.mul(float(1).add(jitter).add(fibre)), base.mul(0.35), gap);
    color = color.mul(float(1).sub(smoothstep(1.2, 0, h).mul(0.15)));
  } else if (type === 'concrete') {
    const m = max(joint(h, 3.0, float(0.008)), joint(u, 2.5, float(0.008))).mul(0.5);
    const tone = mx_fractal_noise_float(vec3(u.mul(0.5), h.mul(0.5), seed), 3, 2, 0.5).mul(0.07);
    color = base.mul(float(1).add(tone)).mul(float(1).sub(m.mul(0.4)));
  }

  if (type === 'render' || type === 'stone') {
    const course = floor(h.div(0.33));
    const blockLen = select(course.mod(2).lessThan(0.5), float(0.55), float(0.32));
    const fromCorner = min(u, segLen.sub(u));
    const inQuoin = step(fromCorner, blockLen).mul(quoins).mul(step(plinth, h));
    const quoinColor = vec3(0.6, 0.56, 0.47).mul(float(1).add(hash3(course, floor(u.div(1.5)), seed).sub(0.5).mul(0.12)));
    const quoinJoint = max(joint(h, 0.33, float(0.006)), float(1).sub(smoothstep(0.0, 0.012, abs(fromCorner.sub(blockLen)))));
    color = mix(color, mix(quoinColor, quoinColor.mul(0.7), quoinJoint), inQuoin);
  }

  const plinthColor = mix(vec3(luma(base)), base, 0.4).mul(0.62);
  const inPlinth = step(h, plinth).mul(step(0.01, plinth));
  const plinthTone = float(1).add(mx_noise_float(vec3(u, h, seed).mul(4)).mul(0.08));
  color = mix(color, plinthColor.mul(plinthTone), inPlinth);
  color = color.mul(float(1).sub(smoothstep(0.05, 0, abs(h.sub(plinth))).mul(0.25).mul(step(0.01, plinth))));

  const splash = smoothstep(0.7, 0.0, h).mul(float(0.35).add(mx_noise_float(vec3(u.mul(3), h.mul(3), seed)).mul(0.25)));
  color = mix(color, color.mul(vec3(0.62, 0.58, 0.5)), splash);
  const streak = smoothstep(0.1, 0.6, mx_noise_float(vec3(u.mul(2.2), h.mul(0.08), seed.add(7)))).mul(smoothstep(top.sub(3.5), top, h));
  color = color.mul(float(1).sub(streak.mul(0.18)));
  color = color.mul(float(1).sub(smoothstep(top.sub(0.7), top, h).mul(0.3)));

  material.colorNode = color;
  if (type === 'metal') material.normalNode = tiltedNormal(dx, float(0));
  return material;
}

export function roofMaterial(type) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const v = p.y;
  const seed = info.x;
  const mossAmount = info.y;
  const skylightSpacing = info.z;

  let color = base;
  let dx = float(0);
  let dy = float(0);

  const tiles = (row, width, stagger, jitterAmount) => {
    const r = floor(v.div(row));
    const shifted = u.add(stagger ? r.mod(2).mul(width / 2) : float(0));
    const c = floor(shifted.div(width));
    const fv = fract(v.div(row));
    const fadeV = detailFade(v, row);
    const jitter = hash3(c, r, seed);
    const odd = step(0.965, hash3(c.add(17), r, seed));
    const tone = mix(float(1 - jitterAmount), float(1 + jitterAmount), jitter).mul(mix(float(1), float(0.72), odd));
    const shade = float(1).sub(smoothstep(0.78, 0.97, fv).mul(0.5)).mul(float(0.88).add(fv.oneMinus().mul(0.16)));
    const side = joint(shifted, width, float(0.006)).mul(0.35);
    const fade = fadeV;
    return {
      color: base.mul(mix(float(0.86), tone.mul(shade).mul(float(1).sub(side)), fade)),
      tilt: smoothstep(0.75, 1.0, fv).mul(-0.6).add(0.12).mul(fade),
      across: fract(shifted.div(width)),
      fade: detailFade(u, width),
    };
  };

  if (type === 'tile') {
    const t = tiles(0.34, 0.21, false, 0.1);
    color = t.color;
    dy = t.tilt;
    dx = sin(t.across.mul(Math.PI * 4)).mul(0.35).mul(t.fade);
  } else if (type === 'flatTile') {
    const t = tiles(0.1, 0.17, true, 0.2);
    color = t.color;
    dy = t.tilt.mul(0.6);
  } else if (type === 'slate') {
    const t = tiles(0.16, 0.25, true, 0.08);
    color = t.color;
    dy = t.tilt.mul(0.5);
    material.roughness = 0.6;
  } else if (type === 'steel') {
    dx = ribs(u, 0.333).mul(0.9);
    const plate = hash3(floor(u.div(1.0)), floor(v.div(6)), seed).sub(0.5).mul(0.06);
    color = base.mul(float(1).add(plate));
    const spacing = skylightSpacing.max(1);
    const sky = step(fract(u.div(spacing)), float(1).div(spacing)).mul(step(0.5, skylightSpacing)).mul(step(1.5, v));
    color = mix(color, vec3(0.62, 0.64, 0.6), sky);
    material.roughness = 0.5;
    material.metalness = 0.2;
  } else if (type === 'fiber') {
    const fade = detailFade(u, 0.177);
    dx = cos(u.mul((2 * Math.PI) / 0.177)).mul(0.45).mul(fade);
    const spots = smoothstep(0.75, 0.9, mx_noise_float(vec3(u.mul(4), v.mul(4), seed)));
    color = mix(base, vec3(0.32, 0.31, 0.27), spots.mul(0.5));
  } else if (type === 'membrane') {
    const gravel = mx_noise_float(vec3(u, v, seed).mul(40)).mul(0.12).mul(detailFade(u, 0.03));
    const seam = joint(u, 1.0, float(0.01)).mul(0.25);
    const puddle = smoothstep(0.55, 0.75, mx_fractal_noise_float(vec3(u.mul(0.12), v.mul(0.12), seed), 3, 2, 0.5)).mul(0.25);
    color = base.mul(float(1).add(gravel).sub(seam).sub(puddle));
  }

  const north = clamp(normalWorld.z.negate().mul(2).add(0.5), 0, 1);
  const clusters = mx_fractal_noise_float(vec3(u.mul(0.4), v.mul(0.6), seed.add(3)), 2, 2, 0.5);
  const spots = mx_noise_float(vec3(u.mul(3.5), v.mul(3.5), seed.add(5)));
  const nearEave = smoothstep(4, 0, v).mul(0.3).add(0.7);
  const moss = smoothstep(0.35, 0.75, spots.add(clusters).add(mossAmount.mul(0.3)).sub(0.2))
    .mul(mossAmount).mul(float(0.35).add(north.mul(0.65))).mul(nearEave);
  const lichen = mix(vec3(0.2, 0.21, 0.1), vec3(0.45, 0.43, 0.32), mx_noise_float(vec3(u, v, seed).mul(7)).mul(0.5).add(0.5));
  color = mix(color, lichen.mul(luma(base).mul(1.5).add(0.5)), moss.mul(0.4));
  const streak = mx_noise_float(vec3(u.mul(1.5), v.mul(0.1), seed.add(11))).mul(0.08);
  color = color.mul(float(1).sub(streak));

  material.colorNode = color;
  material.normalNode = tiltedNormal(dx, dy);
  return material;
}

export function glassMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.05, metalness: 0, ior: 1.8 });
  const frameColor = attribute('color', 'vec3');
  const glass = attribute('glass', 'vec4');
  const room = attribute('room', 'vec4');
  const p = uv();
  const w = glass.x;
  const h = glass.y;
  const seed = glass.z;
  const type = glass.w;
  const lx = p.x.mul(w);
  const ly = p.y.mul(h);

  const border = select(type.equal(2), float(0.05), float(0.065));
  const edge = min(min(lx, w.sub(lx)), min(ly, h.sub(ly)));
  let frame = step(edge, border);
  const twoLeaves = step(type, 1.5).mul(step(0.7, w));
  frame = max(frame, step(abs(lx.sub(w.mul(0.5))), 0.045).mul(twoLeaves));
  const pane = h.div(3);
  const muntin = step(abs(fract(ly.div(pane).add(0.5)).sub(0.5)).mul(pane), 0.014).mul(step(0.5, type)).mul(step(type, 1.5));
  frame = max(frame, muntin);
  const bays = max(floor(w.div(1.4).add(0.5)), 1);
  const bayWidth = w.div(bays);
  const mullion = step(abs(fract(lx.div(bayWidth).add(0.5)).sub(0.5)).mul(bayWidth), 0.035).mul(step(1.5, type)).mul(step(type, 2.5));
  frame = max(frame, mullion);

  const closed = room.z;
  const shutter = step(h.mul(closed.oneMinus()), ly).mul(step(0.01, closed));
  const slat = fract(ly.div(0.045));
  const shutterColor = frameColor.mul(float(0.85).add(slat.mul(0.15)).mul(float(1).sub(joint(ly, 0.045, float(0.003)).mul(0.4))));

  const n = normalWorld;
  const t = normalize(vec3(n.z, 0, n.x.negate()).add(vec3(1e-5, 0, 0)));
  const view = normalize(positionWorld.sub(cameraPosition));
  const dir = vec3(dot(view, t), view.y, dot(view, n).negate().max(0.02));
  const sill = room.x;
  const depth = room.y;
  const x0 = float(-0.8);
  const x1 = w.add(0.8);
  const y0 = sill.negate();
  const y1 = float(2.5).sub(sill);
  const safe = (d) => select(abs(d).lessThan(1e-4), float(1e-4), d);
  const tx = select(dir.x.greaterThan(0), x1, x0).sub(lx).div(safe(dir.x));
  const ty = select(dir.y.greaterThan(0), y1, y0).sub(ly).div(safe(dir.y));
  const tz = depth.div(dir.z);
  const tHit = min(min(tx, ty), tz);
  const hit = vec3(lx, ly, 0).add(dir.mul(tHit));
  const isBack = step(tz, min(tx, ty));
  const isFlat = step(ty, min(tx, tz)).mul(isBack.oneMinus());
  const isFloor = isFlat.mul(step(dir.y, 0));
  const isCeiling = isFlat.mul(step(0, dir.y));
  const isSide = float(1).sub(isBack).sub(isFlat).max(0);

  const r1 = hash3(seed, 1, 0);
  const r2 = hash3(seed, 2, 0);
  const r3 = hash3(seed, 3, 0);
  const wallTint = mix(vec3(0.78, 0.74, 0.66), vec3(r1, r2, r3).mul(0.5).add(0.45), 0.35);
  const floorColor = mix(vec3(0.32, 0.2, 0.11), vec3(0.62, 0.6, 0.56), step(0.6, r2));
  let inside = wallTint.mul(isBack.add(isSide)).add(floorColor.mul(isFloor)).add(vec3(0.82).mul(isCeiling));
  const furnitureX = hash3(seed, 4, 0).mul(w);
  const sofa = isBack.mul(step(hit.y, y0.add(0.85))).mul(step(abs(hit.x.sub(furnitureX)), 0.9));
  const cupboard = isSide.mul(step(hit.y, y0.add(1.9))).mul(step(depth.mul(0.45), hit.z)).mul(step(hit.z, depth.mul(0.8))).mul(step(0.5, r3));
  const furnitureColor = mix(vec3(0.18, 0.12, 0.08), vec3(r3, r1, r2).mul(0.35), 0.5);
  inside = mix(inside, furnitureColor, max(sofa, cupboard));
  const corner = min(
    min(min(hit.x.sub(x0), x1.sub(hit.x)).add(isSide.mul(9)), min(hit.y.sub(y0), y1.sub(hit.y)).add(isFlat.mul(9))),
    depth.sub(hit.z).add(isBack.mul(9)),
  );
  const ao = smoothstep(0.0, 0.6, corner).mul(0.45).add(0.55);
  const daylight = mix(float(0.1), float(0.28), hash3(seed, 5, 0)).mul(float(1).sub(hit.z.div(depth).mul(0.55)));
  inside = inside.mul(daylight).mul(ao);

  const curtain = room.w;
  const folds = sin(lx.mul(38)).mul(0.08).add(0.92);
  const sheer = step(0.5, curtain).mul(step(curtain, 1.5)).mul(0.7);
  const drape = step(1.5, curtain).mul(max(step(lx, w.mul(0.22)), step(w.mul(0.78), lx)));
  const curtainAlpha = max(sheer, drape);
  const curtainColor = select(drape.greaterThan(0.5), vec3(r2, r3, r1).mul(0.4).add(0.25), vec3(0.62, 0.62, 0.6)).mul(folds);

  const opaque = max(frame, shutter);
  const glassColor = mix(vec3(0.0), curtainColor.mul(0.45), curtainAlpha);
  material.colorNode = select(frame.greaterThan(0.5), frameColor, select(shutter.greaterThan(0.5), shutterColor, glassColor));
  material.emissiveNode = inside.mul(curtainAlpha.oneMinus()).mul(opaque.oneMinus());
  material.roughnessNode = mix(float(0.04), float(0.55), opaque);
  material.emissiveNode = material.emissiveNode.mul(step(type, 2.5));
  return material;
}

export const TRIM = { plain: 0, planks: 1, louvers: 2, garage: 3, rollup: 4, solar: 5, metal: 6 };

export function trimMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const v = p.y;
  const pattern = info.x;
  const seed = info.w;
  const is = (k) => step(abs(pattern.sub(k)), 0.5);

  const noise = mx_noise_float(vec3(u, v, seed).mul(8)).mul(0.05);
  const planks = float(1).sub(joint(u, 0.13, float(0.005)).mul(0.55)).mul(float(1).add(hash3(floor(u.div(0.13)), seed, 0).sub(0.5).mul(0.12)));
  const louvers = float(0.78).add(fract(v.div(0.06)).mul(0.3)).mul(float(1).sub(joint(v, 0.06, float(0.004)).mul(0.5)));
  const garage = float(1).sub(joint(v, 0.5, float(0.012)).mul(0.5)).mul(float(1).sub(joint(v, 0.1, float(0.004)).mul(0.15)));
  const rollup = float(0.85).add(fract(v.div(0.08)).mul(0.2)).mul(float(1).sub(joint(v, 0.08, float(0.004)).mul(0.4)));
  const cells = max(joint(u, 0.165, float(0.004)), joint(v, 0.165, float(0.004)));
  const solar = mix(vec3(0.03, 0.05, 0.1), vec3(0.55, 0.57, 0.6), cells);

  const factor = float(1)
    .add(is(TRIM.plain).mul(0))
    .add(is(TRIM.planks).mul(planks.sub(1)))
    .add(is(TRIM.louvers).mul(louvers.sub(1)))
    .add(is(TRIM.garage).mul(garage.sub(1)))
    .add(is(TRIM.rollup).mul(rollup.sub(1)))
    .add(noise);
  material.colorNode = mix(base.mul(factor), solar, is(TRIM.solar));
  material.roughnessNode = info.y;
  material.metalnessNode = info.z;
  return material;
}
