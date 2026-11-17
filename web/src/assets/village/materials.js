import * as THREE from 'three/webgpu';
import {
  attribute, uv, normalWorld, cameraViewMatrix, vec2, vec3, vec4, float,
  mix, min, max, abs, cross, floor, fract, sin, cos, dot, normalize, step, smoothstep, fwidth, length,
  mx_noise_float, mx_fractal_noise_float, mx_cell_noise_float, mx_worley_noise_vec2,
} from 'three/tsl';
import { SURFACE_DETAIL, projected, projectionFrame, slopeToPerturb, seamDistance, lipSlope, finish, distanceFade } from '../surfaces/normals.js';
import { uvFrame, swappedFrame } from './relief.js';

const detailFade = (coord, period) => float(1).sub(smoothstep(0.25, 0.6, fwidth(coord).div(period)));
const hash3 = (a, b, c) => mx_cell_noise_float(vec3(a, b, c));
const luma = (c) => dot(c, vec3(0.299, 0.587, 0.114));

function joint(coord, period, width) {
  const f = fract(coord.div(period));
  const d = min(f, f.oneMinus()).mul(period);
  const w = fwidth(coord);
  const line = float(1).sub(smoothstep(width.sub(w), width.add(w), d));
  return mix(line, width.mul(2).div(period), float(1).sub(detailFade(coord, period)));
}

function tiltedNormal(dx, dy) {
  const n = normalWorld;
  const t = normalize(vec3(n.z, 0, n.x.negate()).add(vec3(1e-5, 0, 0)));
  const b = normalize(cross(n, t));
  const tilted = normalize(n.add(t.mul(dx)).add(b.mul(dy)));
  return normalize(cameraViewMatrix.mul(vec4(tilted, 0)).xyz);
}

const grayOf = (c, k) => mix(c, vec3(luma(c)).mul(vec3(1.0, 1.0, 1.03)), k);

function wallWeather(color, h, top, seed, u, strength = 1) {
  const splash = float(1).sub(smoothstep(0.0, 0.55, h)).mul(0.38);
  let c = mix(color, color.mul(vec3(0.62, 0.58, 0.5)), splash.mul(strength));
  const streak = smoothstep(0.1, 0.65, mx_noise_float(vec3(u.mul(2.0), h.mul(0.1), seed.add(7)))).mul(smoothstep(top.sub(2.2), top, h));
  c = c.mul(float(1).sub(streak.mul(0.14).mul(strength)));
  return c.mul(float(1).sub(smoothstep(top.sub(0.4), top, h).mul(0.12).mul(strength)));
}

export function logMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const seed = info.x;
  const top = info.y;
  const wear = info.w;
  const rowH = 0.2;
  const hh = h.div(rowH);
  const row = floor(hh);
  const f = fract(hh);
  const fade = detailFade(h, rowH);
  const groove = float(1).sub(min(smoothstep(0.0, 0.16, f), smoothstep(1.0, 0.84, f)));
  const rowTone = hash3(row, float(0), seed).sub(0.5).mul(0.3);
  const segLen = 3.1;
  const off = hash3(row, float(5), seed).mul(segLen);
  const butt = joint(u.add(off), segLen, float(0.004)).mul(0.7);
  const fr = SURFACE_DETAIL ? uvFrame(u, h) : null;
  const wood = SURFACE_DETAIL ? projected('rough-wood', { frame: fr, swap: true, offset: vec2(seed.mul(7.3), seed.mul(3.1)), fade: [8, 45], second: 0.3 }) : null;
  const fibre = SURFACE_DETAIL ? wood.albedo.x.sub(1).mul(0.14) : mx_noise_float(vec3(u.mul(1.3), h.mul(30), seed)).mul(0.16).mul(detailFade(h, 0.04));
  const check = SURFACE_DETAIL ? float(0) : smoothstep(0.66, 0.82, mx_noise_float(vec3(u.mul(0.6), h.mul(11), seed.add(3)))).mul(0.45).mul(detailFade(h, 0.1));
  const sun = mx_fractal_noise_float(vec3(u.mul(0.25), h.mul(0.3), seed), 2, 2, 0.5).mul(0.5).add(0.5);
  let color = grayOf(base, wear.mul(float(0.3).add(sun.mul(0.5))));
  color = color.mul(float(1).add(rowTone).add(fibre)).mul(float(1).sub(groove.mul(0.55).mul(fade)).sub(butt).sub(check));
  material.colorNode = wallWeather(color, h, top, seed, u, 0.8);
  if (SURFACE_DETAIL) {
    const bulge = f.mul(2).sub(1).mul(-0.45).mul(fade);
    const grooveV = lipSlope(seamDistance(h, rowH), 0.014, -0.02);
    const grooveU = lipSlope(seamDistance(u.add(off), segLen), 0.004, -0.012);
    material.normalNode = finish(slopeToPerturb(fr, grooveU, bulge.add(grooveV)).add(wood.perturb.mul(1.3)));
    material.roughnessNode = float(0.9).add(wood.rough.sub(0.51).mul(0.4));
  } else {
    material.normalNode = tiltedNormal(float(0), f.sub(0.5).mul(1.3).mul(fade));
  }
  return material;
}

export function boardMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const seed = info.x;
  const top = info.y;
  const flag = info.z;
  const wear = info.w;
  const is = (k) => step(abs(flag.sub(k)), 0.5);
  const fr = SURFACE_DETAIL ? uvFrame(u, h) : null;
  const wood = SURFACE_DETAIL ? projected('rough-wood', { frame: swappedFrame(fr, is(1)), offset: vec2(seed.mul(5.1), seed.mul(2.3)), fade: [8, 45], second: 0.3 }) : null;
  const grain = SURFACE_DETAIL ? wood.albedo.x.sub(1).mul(0.1) : mx_noise_float(vec3(u.mul(1.6), h.mul(42), seed)).mul(0.1).mul(detailFade(h, 0.03));
  const grainV = SURFACE_DETAIL ? wood.albedo.x.sub(1).mul(0.1) : mx_noise_float(vec3(u.mul(60), h.mul(1.1), seed)).mul(0.1).mul(detailFade(u, 0.03));

  const pitchV = 0.15;
  const cv = floor(u.div(pitchV));
  const fv = fract(u.div(pitchV));
  const dV = min(fv, fv.oneMinus()).mul(pitchV);
  const batten = float(1).sub(smoothstep(0.022, 0.026, dV));
  const battenEdge = smoothstep(0.019, 0.023, dV).mul(float(1).sub(smoothstep(0.024, 0.032, dV)));
  const boardV = hash3(cv, float(0), seed).sub(0.5).mul(0.12);
  const vertical = float(1).add(boardV).add(grainV).sub(battenEdge.mul(0.4).mul(detailFade(u, pitchV))).add(batten.mul(0.05));

  const pitchH = 0.12;
  const rh = floor(h.div(pitchH));
  const fh = fract(h.div(pitchH));
  const lap = float(1).sub(smoothstep(0.0, 0.14, fh).mul(0.5)).mul(float(0.9).add(fh.mul(0.14)));
  const butt = joint(u.add(hash3(rh, float(2), seed).mul(3.6)), 3.6, float(0.003)).mul(0.45);
  const lapped = mix(float(0.86), lap.mul(float(1).add(hash3(rh, float(1), seed).sub(0.5).mul(0.1))).add(grain).sub(butt), detailFade(h, pitchH));

  const pitchR = 0.15;
  const cr = floor(u.div(pitchR));
  const dR = fract(u.div(pitchR)).mul(pitchR);
  const gap = float(1).sub(smoothstep(0.0, 0.01, dR)).add(smoothstep(0.14, 0.15, dR));
  const rough = float(1).add(hash3(cr, float(4), seed).sub(0.5).mul(0.4)).add(grainV.mul(1.5)).sub(gap.mul(0.5).mul(detailFade(u, pitchR)));

  const pattern = is(0).mul(vertical).add(is(1).mul(lapped)).add(is(2).mul(rough));
  const stretch = mix(vec3(u.mul(2.6), h.mul(0.9), seed.add(1)), vec3(u.mul(0.9), h.mul(2.6), seed.add(1)), is(1));
  const chipN = mx_fractal_noise_float(stretch, 3, 2, 0.5).mul(0.5).add(0.5);
  const lowBias = float(1).sub(smoothstep(0.0, 1.4, h)).mul(0.25);
  const chip = smoothstep(0.66, 0.74, chipN.add(wear.mul(0.2).sub(0.1)).add(lowBias));
  const bareWood = base.mul(vec3(0.62, 0.58, 0.52)).add(vec3(0.08, 0.075, 0.07)).mul(float(0.85).add(grain.mul(2)));
  const painted = base.mul(pattern);
  const color = mix(painted, bareWood.mul(pattern), chip.mul(float(1).sub(is(2))).mul(0.9));
  material.colorNode = wallWeather(color, h, top, seed, u, 1);
  if (SURFACE_DETAIL) {
    const warp = hash3(cv, float(3), seed).sub(0.5).mul(0.08);
    const batU = lipSlope(seamDistance(u, pitchV), 0.03, 0.012).mul(detailFade(u, pitchV)).add(warp.mul(float(1).sub(batten)));
    const lapV = lipSlope(seamDistance(h, pitchH), 0.009, -0.016).add(-0.16).mul(detailFade(h, pitchH));
    const gapU = lipSlope(seamDistance(u, pitchR), 0.011, -0.02).mul(detailFade(u, pitchR));
    const du = is(0).mul(batU).add(is(2).mul(gapU));
    const dv = is(1).mul(lapV);
    const woodK = mix(float(0.5), float(1), chip.max(is(2)));
    material.roughnessNode = mix(float(0.8), float(0.95), chip).add(wood.rough.sub(0.51).mul(0.3));
    material.normalNode = finish(slopeToPerturb(fr, du, dv).add(wood.perturb.mul(woodK)));
  } else {
    material.roughnessNode = mix(float(0.8), float(0.95), chip);
  }
  return material;
}

export function masonryMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const seed = info.x;
  const top = info.y;
  const flag = info.z;
  const wear = info.w;
  const row = floor(h.div(0.075));
  const shifted = u.add(row.mod(2).mul(0.125));
  const col = floor(shifted.div(0.25));
  const j1 = hash3(col, row, seed);
  const j2 = hash3(col.add(41), row, seed);
  const tone = mix(float(0.86), float(1.1), j1);
  const dark = mix(float(1), float(0.72), step(0.93, j2));
  const redTint = mix(vec3(1.0), vec3(1.2, 0.9, 0.78), step(0.6, j2));
  const kind = step(0.5, flag);
  const fr = SURFACE_DETAIL ? uvFrame(u, h) : null;
  const skin = SURFACE_DETAIL ? projected('smooth-concrete', { frame: fr, scale: 0.3, offset: vec2(seed.mul(3.7), seed.mul(1.9)), fade: [6, 30], second: 0 }) : null;
  const grit = SURFACE_DETAIL ? skin.albedo.x.sub(1).mul(0.12) : mx_noise_float(vec3(u, h, seed).mul(34)).mul(0.08).mul(detailFade(u, 0.05));
  const brick = base.mul(mix(vec3(1), redTint, kind)).mul(tone).mul(dark).mul(float(1).add(grit));
  const m = max(joint(h, 0.075, float(0.005)), joint(shifted, 0.25, float(0.005)));
  const mortar = mix(vec3(0.5, 0.5, 0.47), vec3(0.45, 0.43, 0.4), kind);
  let color = mix(brick, mortar, m.mul(0.9));
  const damp = float(1).sub(smoothstep(0.0, 0.9, h)).mul(mx_noise_float(vec3(u.mul(1.3), h.mul(2), seed)).mul(0.5).add(0.6));
  const moss = smoothstep(0.55, 0.8, damp).mul(wear);
  color = mix(color, color.mul(vec3(0.62, 0.62, 0.55)), damp.mul(0.5));
  color = mix(color, vec3(0.2, 0.26, 0.1), moss.mul(0.55).mul(float(1).sub(kind)));
  const bloom = smoothstep(0.55, 0.78, mx_noise_float(vec3(u.mul(0.9), h.mul(0.7), seed.add(9)))).mul(0.14).mul(wear);
  color = mix(color, vec3(0.8), bloom.mul(float(1).sub(kind)));
  const rain = smoothstep(0.3, 0.7, mx_noise_float(vec3(u.mul(3), h.mul(0.12), seed.add(5)))).mul(smoothstep(top.sub(2.6), top, h)).mul(0.2);
  color = color.mul(float(1).sub(rain)).mul(float(1).sub(smoothstep(top.sub(0.3), top, h).mul(0.1)));
  material.colorNode = color;
  if (SURFACE_DETAIL) {
    const bed = lipSlope(seamDistance(h, 0.075), 0.01, -0.009);
    const head = lipSlope(seamDistance(shifted, 0.25), 0.01, -0.009);
    const tilt = float(1).sub(m);
    const near = distanceFade(4, 24);
    const du = head.add(j1.sub(0.5).mul(0.22).mul(tilt).mul(near));
    const dv = bed.add(j2.sub(0.5).mul(0.22).mul(tilt).mul(near));
    material.roughnessNode = mix(float(0.93), float(1), m).add(skin.rough.sub(0.516).mul(0.3));
    material.normalNode = finish(slopeToPerturb(fr, du, dv).add(skin.perturb.mul(1.2)));
  }
  return material;
}

export function plinthMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const seed = info.x;
  const flag = info.z;
  const wear = info.w;
  const cells = mx_worley_noise_vec2(vec3(u.mul(3.2), h.mul(4.2), seed));
  const edge = smoothstep(0.0, 0.1, cells.y.sub(cells.x));
  const cellTone = hash3(floor(u.mul(3.2)), floor(h.mul(4.2)), seed).sub(0.5).mul(0.5);
  const stone = base.mul(float(0.85).add(cellTone)).mul(mix(float(0.55), float(1), edge));
  const clouds = mx_fractal_noise_float(vec3(u.mul(0.9), h.mul(0.9), seed), 3, 2, 0.5).mul(0.14);
  const crack = smoothstep(0.78, 0.86, mx_noise_float(vec3(u.mul(2.4), h.mul(0.7), seed.add(2)))).mul(0.35).mul(detailFade(u, 0.05));
  const fr = SURFACE_DETAIL ? uvFrame(u, h) : null;
  const skin = SURFACE_DETAIL ? projected('smooth-concrete', { frame: fr, scale: 0.6, offset: vec2(seed.mul(2.9), seed.mul(4.1)), fade: [8, 40], second: 0.3 }) : null;
  const rock = SURFACE_DETAIL ? projected('rubble', { frame: fr, scale: 0.45, offset: vec2(seed.mul(1.7), seed.mul(3.3)), fade: [6, 30], second: 0 }) : null;
  const grit = SURFACE_DETAIL ? skin.albedo.x.sub(1).mul(0.14) : mx_noise_float(vec3(u, h, seed).mul(30)).mul(0.08).mul(detailFade(u, 0.05));
  const concrete = base.mul(float(1).add(clouds).add(grit)).mul(float(1).sub(crack));
  let color = mix(concrete, stone, step(0.5, flag));
  const damp = float(1).sub(smoothstep(0.0, 0.5, h.max(0))).mul(0.5);
  color = mix(color, color.mul(vec3(0.6, 0.62, 0.52)), damp.mul(wear.add(0.4)));
  if (SURFACE_DETAIL) {
    const isStone = step(0.5, flag);
    color = color.mul(mix(float(1), rock.albedo, isStone.mul(0.5)));
    material.colorNode = color;
    const gr = fr.grad(edge.mul(0.03));
    const joints = slopeToPerturb(fr, gr.x, gr.y).mul(distanceFade(3, 18));
    material.roughnessNode = float(0.95).add(mix(skin.rough.sub(0.516), rock.rough.sub(0.857), isStone).mul(0.3));
    material.normalNode = finish(mix(skin.perturb.mul(0.7), rock.perturb.mul(1.2).add(joints), isStone));
  } else {
    material.colorNode = color;
  }
  return material;
}

export function plasterMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const seed = info.x;
  const top = info.y;
  const flag = info.z;
  const wear = info.w;
  const is = (k) => step(abs(flag.sub(k)), 0.5);
  const clouds = mx_fractal_noise_float(vec3(u.mul(0.5), h.mul(0.5), seed), 3, 2, 0.5).mul(0.12);
  const fr = SURFACE_DETAIL ? uvFrame(u, h) : null;
  const skin = SURFACE_DETAIL ? projected('smooth-concrete', { frame: fr, scale: 0.7, offset: vec2(seed.mul(2.3), seed.mul(5.7)), fade: [8, 40], second: 0.3 }) : null;
  const roughcast = SURFACE_DETAIL ? projected('rubble', { frame: fr, scale: 0.12, offset: vec2(seed.mul(0.7), seed.mul(0.3)), fade: [10, 45], second: 0.5 }) : null;
  const fine = SURFACE_DETAIL ? skin.albedo.x.sub(1).mul(0.5) : mx_noise_float(vec3(u, h, seed).mul(55)).mul(detailFade(u, 0.02));
  const coarse = SURFACE_DETAIL ? roughcast.albedo.x.sub(1).mul(1.1) : mx_noise_float(vec3(u, h, seed.add(1)).mul(140)).mul(detailFade(u, 0.008));
  const smooth = float(1).add(clouds).add(fine.mul(0.03));
  const gravel = float(1).add(clouds).add(fine.mul(0.1)).add(coarse.mul(0.12));
  const tp = 0.11;
  const tcol = floor(u.div(tp));
  const trow = floor(h.div(tp));
  const tile = float(1).add(hash3(tcol, trow, seed).sub(0.5).mul(0.14)).mul(float(1).sub(joint(u, tp, float(0.0025)).max(joint(h, tp, float(0.0025))).mul(0.45)));
  let color = base.mul(is(0).mul(smooth).add(is(1).mul(gravel)).add(is(2).mul(tile)));
  const crack = smoothstep(0.8, 0.88, mx_noise_float(vec3(u.mul(1.6), h.mul(0.9), seed.add(2)))).mul(0.18).mul(float(1).sub(is(2))).mul(detailFade(u, 0.05));
  const streak = smoothstep(0.35, 0.75, mx_noise_float(vec3(u.mul(4), h.mul(0.15), seed.add(5)))).mul(smoothstep(top.sub(4.5), top, h)).mul(0.14).mul(wear.add(0.3));
  const splash = float(1).sub(smoothstep(0.0, 0.6, h)).mul(0.35);
  color = color.mul(float(1).sub(crack).sub(streak));
  color = mix(color, color.mul(vec3(0.6, 0.57, 0.5)), splash);
  material.colorNode = color.mul(float(1).sub(smoothstep(top.sub(0.3), top, h).mul(0.1)));
  material.roughnessNode = mix(float(0.92), float(0.3), is(2));
  if (SURFACE_DETAIL) {
    const tilt = distanceFade(3, 20);
    const tu = lipSlope(seamDistance(u, tp), 0.0035, -0.004).add(hash3(tcol, trow, seed.add(2)).sub(0.5).mul(0.06).mul(tilt));
    const tv = lipSlope(seamDistance(h, tp), 0.0035, -0.004).add(hash3(tcol, trow, seed.add(3)).sub(0.5).mul(0.06).mul(tilt));
    const fine3 = skin.perturb.mul(0.4).mul(is(0)).add(roughcast.perturb.mul(1.1).mul(is(1)));
    material.roughnessNode = mix(float(0.92), float(0.3), is(2)).add(skin.rough.sub(0.516).mul(0.2).mul(is(0)));
    material.normalNode = finish(slopeToPerturb(fr, tu.mul(is(2)), tv.mul(is(2))).add(fine3));
  }
  return material;
}

export function roofMaterial(type) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const v = p.y;
  const seed = info.x;
  const mossAmount = info.y;
  const wear = info.w;
  const sheetW = type === 'fiber' ? 1.1 : 1.0;
  const sheetL = type === 'fiber' ? 1.75 : 3.0;
  const sh = floor(u.div(sheetW));
  const sv = floor(v.div(sheetL).add(hash3(sh, float(2), seed)));
  const tone = hash3(sh, sv, seed).sub(0.5);
  const lapLine = joint(v.add(hash3(sh, float(2), seed).mul(sheetL)), sheetL, float(0.012)).mul(0.5);
  let color;
  let dx;
  const fr = SURFACE_DETAIL ? uvFrame(u, v) : null;
  const skin = SURFACE_DETAIL && type === 'fiber' ? projected('smooth-concrete', { frame: fr, scale: 0.5, offset: vec2(seed.mul(1.9), seed.mul(2.7)), fade: [10, 50], second: 0.3 }) : null;
  if (type === 'fiber') {
    const period = 0.177;
    const phase = u.div(period).mul(Math.PI * 2);
    const fadeW = float(1).sub(smoothstep(0.08, 0.2, fwidth(u).div(period)));
    dx = sin(phase).mul(0.85).mul(fadeW);
    const trough = cos(phase).mul(0.5).add(0.5);
    const stain = mx_fractal_noise_float(vec3(u.mul(0.6), v.mul(0.4), seed), 3, 2, 0.5).mul(0.5).add(0.5);
    const black = smoothstep(0.5, 0.8, mx_noise_float(vec3(u.mul(2.4), v.mul(0.22), seed.add(4)))).mul(0.4);
    const lichen = smoothstep(0.62, 0.85, mx_noise_float(vec3(u.mul(1.7), v.mul(1.9), seed.add(6)))).mul(0.5);
    const moss = smoothstep(0.5, 0.9, mx_noise_float(vec3(u.mul(0.8), v.mul(0.9), seed.add(8))).mul(0.5).add(0.5).mul(mossAmount.mul(1.1))).mul(trough.mul(0.5).add(0.5));
    color = base.mul(float(1).add(tone.mul(0.16)).sub(stain.mul(0.18)).sub(black).sub(lapLine).add(trough.mul(0.05).mul(fadeW)));
    color = mix(color, vec3(0.56, 0.58, 0.44).mul(base.x.mul(1.5)), lichen.mul(mossAmount).mul(0.3));
    color = mix(color, vec3(0.1, 0.15, 0.06), moss.mul(0.5).mul(float(1).sub(smoothstep(0.0, 6.0, v)).mul(0.6).add(0.4)));
    material.roughness = 0.88;
  } else {
    const period = 0.2;
    const f = fract(u.div(period));
    const fadeW = float(1).sub(smoothstep(0.08, 0.2, fwidth(u).div(period)));
    const rise = smoothstep(0.08, 0.2, f).sub(smoothstep(0.3, 0.42, f));
    const fall = smoothstep(0.58, 0.7, f).sub(smoothstep(0.8, 0.92, f));
    dx = rise.sub(fall).mul(1.1).mul(fadeW);
    const rust = smoothstep(0.55, 0.85, mx_fractal_noise_float(vec3(u.mul(0.7), v.mul(0.5), seed), 3, 2, 0.5).mul(0.5).add(0.5).add(wear.mul(0.3).sub(0.15)));
    const streak = smoothstep(0.35, 0.7, mx_noise_float(vec3(u.mul(2.6), v.mul(0.18), seed.add(3)))).mul(0.14);
    color = base.mul(float(1).add(tone.mul(0.1)).sub(lapLine).sub(streak));
    color = mix(color, vec3(0.2, 0.1, 0.06), rust.mul(wear).mul(0.45));
    const moss = smoothstep(0.55, 0.85, mx_noise_float(vec3(u.mul(0.6), v.mul(0.8), seed.add(8)))).mul(mossAmount).mul(0.5);
    color = mix(color, vec3(0.14, 0.2, 0.08), moss);
    material.roughness = 0.5;
    material.metalness = 0.25;
  }
  material.colorNode = color;
  if (SURFACE_DETAIL) {
    const lapU = lipSlope(seamDistance(u, sheetW), 0.03, 0.008).mul(detailFade(u, sheetW));
    const lapV = lipSlope(seamDistance(v.add(hash3(sh, float(2), seed).mul(sheetL)), sheetL), 0.025, 0.012);
    if (skin) {
      material.roughnessNode = float(0.88).add(skin.rough.sub(0.516).mul(0.3));
      material.normalNode = finish(slopeToPerturb(fr, dx.add(lapU), lapV).add(skin.perturb.mul(0.6)));
    } else {
      material.normalNode = finish(slopeToPerturb(fr, dx.add(lapU), lapV));
    }
  } else {
    material.normalNode = tiltedNormal(dx, float(0));
  }
  return material;
}

export function solidMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const v = p.y;
  const kind = info.z;
  const seed = info.w;
  const is = (k) => step(abs(kind.sub(k)), 0.5);
  const near = float(1).sub(smoothstep(0.02, 0.07, fwidth(u).add(fwidth(v))));
  const nA = mx_noise_float(vec3(u.mul(2), v.mul(2), seed));
  const frame = SURFACE_DETAIL ? projectionFrame() : null;
  const offs = SURFACE_DETAIL ? vec2(seed.mul(3.1), seed.mul(1.3)) : null;
  const grainT = SURFACE_DETAIL ? projected('rough-wood', { frame, offset: offs, fade: [6, 30], second: 0 }) : null;
  const concT = SURFACE_DETAIL ? projected('smooth-concrete', { frame, offset: offs, scale: 0.5, fade: [6, 30], second: 0 }) : null;
  const nB = SURFACE_DETAIL ? null : mx_noise_float(vec3(u.mul(2.5), v.mul(34), seed.add(1)));
  const nC = SURFACE_DETAIL ? null : mx_noise_float(vec3(u.mul(24), v.mul(24), seed.add(2)));
  const wood = SURFACE_DETAIL
    ? float(1).add(grainT.albedo.x.sub(1).mul(0.22)).add(nA.mul(0.1)).sub(joint(u, 0.14, float(0.003)).mul(0.35).mul(is(1)))
    : float(1).add(nB.mul(0.22).mul(near)).add(nA.mul(0.1)).sub(joint(u, 0.14, float(0.003)).mul(0.35).mul(is(1)));
  const metal = SURFACE_DETAIL ? float(1).sub(smoothstep(0.4, 0.8, nA).mul(0.22)) : float(1).sub(smoothstep(0.4, 0.8, nA).mul(0.22)).add(nB.mul(0.06));
  const paint = SURFACE_DETAIL
    ? float(1).add(nA.mul(0.08)).add(grainT.albedo.x.sub(1).mul(0.08))
    : float(1).add(nA.mul(0.08)).sub(smoothstep(0.35, 0.7, nC).mul(0.14).mul(near));
  const conc = SURFACE_DETAIL
    ? float(1).add(nA.mul(0.2)).add(concT.albedo.x.sub(1).mul(0.14))
    : float(1).add(nA.mul(0.2)).add(nC.mul(0.08).mul(near));
  const factor = float(1)
    .add(is(1).mul(wood.sub(1)))
    .add(is(2).mul(metal.sub(1)))
    .add(is(5).mul(paint.sub(1)))
    .add(is(6).mul(conc.sub(1)));
  material.colorNode = base.mul(factor);
  material.roughnessNode = info.x;
  material.metalnessNode = info.y;
  if (SURFACE_DETAIL) {
    material.normalNode = finish(grainT.perturb.mul(is(1).add(is(5).mul(0.35))).add(concT.perturb.mul(0.8).mul(is(6))));
  }
  return material;
}

export function organicMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const v = p.y;
  const kind = info.z;
  const seed = info.w;
  const is = (k) => step(abs(kind.sub(k)), 0.5);
  const near = float(1).sub(smoothstep(0.02, 0.07, fwidth(u).add(fwidth(v))));
  const soil = float(0.8).add(mx_fractal_noise_float(vec3(u.mul(9), v.mul(9), seed), 2, 2, 0.5).mul(0.5));
  const leaf = float(0.75).add(mx_noise_float(vec3(u.mul(14), v.mul(14), seed)).mul(0.7));
  const twigA = smoothstep(0.1, 0.55, mx_noise_float(vec3(u.mul(4), v.mul(52), seed)).abs());
  const twigB = smoothstep(0.1, 0.55, mx_noise_float(vec3(u.mul(36), v.mul(7), seed.add(3))).abs());
  const twig = float(0.45).add(twigA.mul(0.35)).add(twigB.mul(0.3));
  const feather = float(1).add(mx_noise_float(vec3(u.mul(50), v.mul(14), seed)).mul(0.1).mul(near));
  const factor = float(1)
    .add(is(3).mul(soil.sub(1)))
    .add(is(7).mul(leaf.sub(1)))
    .add(is(4).mul(twig.sub(1)))
    .add(is(8).mul(feather.sub(1)));
  material.colorNode = base.mul(factor);
  material.roughnessNode = info.x;
  return material;
}

export function logEndsMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const v = p.y;
  const seed = info.w;
  const lp = 0.125;
  const lrow = floor(v.div(lp * 0.866));
  const lu = u.add(lrow.mod(2).mul(lp * 0.5));
  const lcell = vec2(fract(lu.div(lp)).sub(0.5).mul(lp), fract(v.div(lp * 0.866)).sub(0.5).mul(lp * 0.866));
  const ldist = length(lcell);
  const lid = hash3(floor(lu.div(lp)), lrow, seed);
  const inside = float(1).sub(smoothstep(0.052, 0.058, ldist));
  const rim = smoothstep(0.04, 0.052, ldist).mul(inside);
  const rings = cos(ldist.mul(150).add(lid.mul(6))).mul(0.08).add(0.92);
  const lfade = float(1).sub(smoothstep(0.02, 0.05, fwidth(u)));
  const ends = mix(float(0.8), mix(float(0.12), rings.mul(float(0.8).add(lid.mul(0.4))).mul(float(1).sub(rim.mul(0.5))), inside), lfade);
  material.colorNode = base.mul(ends);
  return material;
}

export function glassMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.0 });
  const info = attribute('info', 'vec4');
  const p = uv();
  const seed = info.x;
  const curtain = info.y;
  const sky = mix(vec3(0.05, 0.065, 0.075), vec3(0.14, 0.17, 0.2), smoothstep(0.0, 1.0, p.y));
  const room = sky.mul(float(1).sub(p.y.mul(0.2)));
  const lace = float(0.72).add(sin(p.x.mul(40).add(mx_noise_float(vec3(p.y.mul(3), seed, 0)).mul(2))).mul(0.1)).add(mx_noise_float(vec3(p.x.mul(8), p.y.mul(8), seed)).mul(0.06));
  const cover = smoothstep(curtain.sub(0.85), curtain.sub(0.8), p.y.oneMinus().sub(0.12)).mul(step(0.01, curtain));
  const cloth = vec3(0.62, 0.6, 0.54).mul(lace);
  material.colorNode = mix(room, cloth, cover.mul(0.9));
  material.roughnessNode = mix(float(0.06), float(0.85), cover);
  return material;
}

export function meshMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide });
  const base = attribute('color', 'vec3');
  const p = uv();
  const pitch = 0.05;
  const a = p.x.add(p.y).div(pitch);
  const b = p.x.sub(p.y).div(pitch);
  const d = min(min(fract(a), fract(a).oneMinus()), min(fract(b), fract(b).oneMinus())).mul(pitch);
  const wireW = 0.0016;
  const aa = fwidth(p.x).add(fwidth(p.y)).mul(0.5);
  const line = float(1).sub(smoothstep(float(wireW).sub(aa), float(wireW).add(aa), d));
  const avg = float(wireW * 4 / pitch);
  const fade = smoothstep(0.35, 0.8, aa.div(pitch));
  const cover = mix(line, avg, fade);
  material.colorNode = base;
  material.opacityNode = cover;
  material.alphaToCoverage = true;
  material.transparent = false;
  return material;
}

export function decalMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const seed = info.x;
  const kind = info.y;
  const d = length(max(abs(p.sub(0.5)).sub(0.28), 0)).mul(1);
  const n = mx_fractal_noise_float(vec3(p.x.mul(7), p.y.mul(7), seed), 3, 2, 0.5).mul(0.12);
  const edge = float(1).sub(smoothstep(0.02, 0.2, d.add(n)));
  const grain = mx_noise_float(vec3(p.x.mul(160), p.y.mul(160), seed)).mul(0.14);
  const patchy = mx_noise_float(vec3(p.x.mul(14), p.y.mul(14), seed.add(1))).mul(0.12);
  const stones = step(0.5, kind).mul(float(1).sub(step(1.5, kind)));
  material.colorNode = base.mul(float(1).add(grain.mul(float(1).add(stones))).add(patchy));
  material.opacityNode = edge.mul(mix(float(0.92), float(0.8), stones));
  return material;
}

export const makeMaterials = () => {
  const solid = solidMaterial();
  return {
  log: logMaterial(),
  board: boardMaterial(),
  masonry: masonryMaterial(),
  plaster: plasterMaterial(),
  plinth: plinthMaterial(),
  roofFiber: roofMaterial('fiber'),
  roofMetal: roofMaterial('metal'),
  solid,
  fence: solid,
  organic: organicMaterial(),
  logs: logEndsMaterial(),
  glass: glassMaterial(),
  mesh: meshMaterial(),
  decal: decalMaterial(),
  };
};

export const NO_SHADOW = new Set(['glass', 'mesh', 'decal']);

let shared = null;
export function sharedMaterials() {
  return (shared ??= makeMaterials());
}
