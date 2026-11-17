import * as THREE from 'three/webgpu';
import {
  attribute, uv, positionWorld, normalWorld, cameraViewMatrix, vec3, vec4, float,
  mix, min, max, abs, cross, floor, fract, normalize, step, smoothstep, fwidth,
  mx_noise_float, mx_fractal_noise_float, mx_cell_noise_float,
} from 'three/tsl';
import { wallMaterial, roofMaterial, glassMaterial, trimMaterial, TRIM } from '../../engine/buildingMaterials.js';

export { TRIM };
export const GROUND = { carriageway: 0, blacktop: 1, slabs: 2, setts: 3, concrete: 4 };
export const GARDEN = { lawn: 0, gravel: 1, dirt: 2, paving: 3 };
export const RAILING = { rigid: 0, bars: 1, slats: 2, torsion: 3 };

const detailFade = (coord, period) => float(1).sub(smoothstep(0.25, 0.6, fwidth(coord).div(period)));
const hash3 = (a, b, c) => mx_cell_noise_float(vec3(a, b, c));

function joint(coord, period, width) {
  const f = fract(coord.div(period));
  const d = min(f, f.oneMinus()).mul(period);
  const w = fwidth(coord);
  const line = float(1).sub(smoothstep(float(width).sub(w), float(width).add(w), d));
  return mix(line, float((width * 2) / period), float(1).sub(detailFade(coord, period)));
}

function tiltedNormal(dx, dy) {
  const n = normalWorld;
  const t = normalize(vec3(n.z, 0, n.x.negate()).add(vec3(1e-5, 0, 0)));
  const b = normalize(cross(n, t));
  return normalize(cameraViewMatrix.mul(vec4(normalize(n.add(t.mul(dx)).add(b.mul(dy))), 0)).xyz);
}

const is = (v, k) => step(abs(v.sub(k)), 0.5);

export function groundMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0 });
  const info = attribute('info', 'vec4');
  const p = uv();
  const s = p.x;
  const kind = info.x;
  const isRoad = is(kind, 0);
  const lat = mix(p.y, info.y.sub(abs(p.y)), isRoad);
  const seed = info.z;
  const wear = info.w;
  const xz = positionWorld.xz;
  const blotch = mx_fractal_noise_float(vec3(xz.mul(0.13), seed), 3, 2, 0.5);
  const grain = mx_noise_float(vec3(xz.mul(11), seed)).mul(detailFade(xz.x, 0.06));

  const cs = floor(s.div(4.3));
  const cl = floor(p.y.div(1.9));
  const wobble = mx_noise_float(vec3(xz.mul(1.7), seed.add(9))).mul(0.06);
  const patch = step(float(0.965).sub(wear.mul(0.05)).add(wobble), hash3(cs, cl, seed));
  let road = vec3(0.064, 0.064, 0.067).mul(float(1).add(blotch.mul(0.22)).add(grain.mul(0.1)));
  road = mix(road, road.mul(mix(float(0.8), float(1.12), hash3(cs, cl, seed.add(3)))), patch);
  const dirt = smoothstep(0.9, 0.25, lat).mul(0.25);
  road = mix(road, vec3(0.085, 0.078, 0.068), dirt);
  const gutter = step(lat, 0.25);
  const gutterColor = vec3(0.24, 0.235, 0.22).mul(float(1).add(blotch.mul(0.15)).sub(joint(s, 1.0, 0.004).mul(0.35)));
  road = mix(road, gutterColor, gutter);

  const walk = vec3(0.105, 0.104, 0.102).mul(float(1).add(blotch.mul(0.18)).add(grain.mul(0.12)));
  const slabTone = hash3(floor(s.div(0.5)), floor(lat.div(0.5)), seed).sub(0.5).mul(0.12);
  const slabs = vec3(0.33, 0.315, 0.29).mul(float(1).add(slabTone).add(blotch.mul(0.1)))
    .mul(float(1).sub(max(joint(s, 0.5, 0.004), joint(lat, 0.5, 0.004)).mul(0.45)));
  const row = floor(lat.div(0.1));
  const ss = s.add(row.mod(2).mul(0.1));
  const settTone = hash3(floor(ss.div(0.2)), row, seed).sub(0.5).mul(0.22);
  const setts = vec3(0.26, 0.23, 0.2).mul(float(1).add(settTone).add(blotch.mul(0.12)))
    .mul(float(1).sub(max(joint(ss, 0.2, 0.003), joint(lat, 0.1, 0.003)).mul(0.5)));
  const concrete = vec3(0.3, 0.295, 0.28).mul(float(1).add(blotch.mul(0.12)).add(grain.mul(0.06))).mul(float(1).sub(joint(s, 2.0, 0.005).mul(0.4)));

  const color = road.mul(is(kind, 0)).add(walk.mul(is(kind, 1))).add(slabs.mul(is(kind, 2))).add(setts.mul(is(kind, 3))).add(concrete.mul(is(kind, 4)));
  m.colorNode = color;
  m.roughnessNode = mix(float(0.92), float(0.82), is(kind, 2).add(is(kind, 4)));
  return m;
}

export function gardenMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const info = attribute('info', 'vec4');
  const kind = info.x;
  const seed = info.z;
  const xz = positionWorld.xz;
  const patches = mx_fractal_noise_float(vec3(xz.mul(0.09), seed), 3, 2, 0.5);
  const fine = mx_noise_float(vec3(xz.mul(7), seed)).mul(detailFade(xz.x, 0.08));
  const lawn = mix(vec3(0.085, 0.13, 0.04), vec3(0.15, 0.18, 0.06), smoothstep(-0.35, 0.45, patches)).mul(float(1).add(fine.mul(0.12)));
  const gravel = vec3(0.36, 0.33, 0.28).mul(float(1).add(fine.mul(0.2)).add(patches.mul(0.1)));
  const soil = vec3(0.12, 0.09, 0.065).mul(float(1).add(fine.mul(0.2)));
  const flag = hash3(floor(xz.x.div(0.6)), floor(xz.y.div(0.4)), seed).sub(0.5).mul(0.2);
  const paving = vec3(0.4, 0.37, 0.32).mul(float(1).add(flag)).mul(float(1).sub(max(joint(xz.x, 0.6, 0.006), joint(xz.y, 0.4, 0.006)).mul(0.5)));
  m.colorNode = lawn.mul(is(kind, 0)).add(gravel.mul(is(kind, 1))).add(soil.mul(is(kind, 2))).add(paving.mul(is(kind, 3)));
  return m;
}

export function railingMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide, alphaToCoverage: true, transparent: false });
  m.alphaTest = 0.5;
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const u = p.x;
  const h = p.y;
  const kind = info.x;
  const top = info.y;
  const bar = (coord, period, width) => {
    const f = fract(coord.div(period));
    const d = min(f, f.oneMinus()).mul(period);
    const w = fwidth(coord).max(1e-4);
    const line = float(1).sub(smoothstep(float(width).sub(w), float(width).add(w), d));
    return mix(line, float((width * 2) / period).mul(1.6).min(1), float(1).sub(detailFade(coord, period)));
  };
  const rails = max(step(h, 0.05), step(top.sub(0.05), h));
  const rigid = max(max(bar(u, 0.055, 0.0025), bar(h, 0.2, 0.0025)), rails);
  const bars = max(bar(u, 0.12, 0.008), max(step(abs(h.sub(0.12)), 0.025), step(top.sub(0.06), h)));
  const slats = float(1).sub(bar(h, 0.14, 0.01));
  const da = u.add(h);
  const db = u.sub(h);
  const twist = max(max(bar(da, 0.07, 0.0016), bar(db, 0.07, 0.0016)), rails);
  m.opacityNode = rigid.mul(is(kind, 0)).add(bars.mul(is(kind, 1))).add(slats.mul(is(kind, 2))).add(twist.mul(is(kind, 3)));
  const tone = float(1).add(mx_noise_float(vec3(u.mul(2), h.mul(2), info.z)).mul(0.06));
  m.colorNode = base.mul(tone).mul(mix(float(1), float(0.82).add(fract(h.div(0.14)).mul(0.25)), is(kind, 2)));
  return m;
}

export function hedgeMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const base = attribute('color', 'vec3');
  const pw = positionWorld;
  const leaf = mx_noise_float(pw.mul(9)).mul(detailFade(pw.x, 0.08));
  const clumps = mx_fractal_noise_float(pw.mul(1.6), 3, 2, 0.5);
  const holes = smoothstep(0.35, 0.65, mx_noise_float(pw.mul(3.3).add(7)));
  m.colorNode = base.mul(float(1).add(leaf.mul(0.25)).add(clumps.mul(0.25))).mul(float(1).sub(holes.mul(0.4)));
  m.normalNode = tiltedNormal(mx_noise_float(pw.mul(6)).mul(0.6), mx_noise_float(pw.mul(6).add(3)).mul(0.6));
  return m;
}

export function zincMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.35 });
  const base = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = uv();
  const seed = info.x;
  const f = fract(p.x.div(0.5));
  const fade = float(1).sub(smoothstep(0.05, 0.12, fwidth(p.x).div(0.5)));
  const rib = smoothstep(0.0, 0.03, f).sub(smoothstep(0.03, 0.06, f)).mul(fade);
  const sheet = hash3(floor(p.x.div(0.5)), floor(p.y.div(3)), seed).sub(0.5).mul(0.08);
  m.colorNode = base.mul(float(1).add(sheet).add(mx_noise_float(vec3(p.x.mul(0.4), p.y.mul(0.4), seed)).mul(0.05)));
  m.normalNode = tiltedNormal(rib.mul(1.2), float(0));
  return m;
}

const cache = new Map();
export function material(key) {
  if (cache.has(key)) return cache.get(key);
  let m;
  if (key.startsWith('wall:')) m = wallMaterial(key.slice(5));
  else if (key.startsWith('roof:')) m = key === 'roof:zinc' ? zincMaterial() : roofMaterial(key.slice(5));
  else if (key === 'glass') m = glassMaterial();
  else if (key === 'trim') m = trimMaterial();
  else if (key === 'ground') m = groundMaterial();
  else if (key === 'garden') m = gardenMaterial();
  else if (key === 'railing') m = railingMaterial();
  else if (key === 'hedge') m = hedgeMaterial();
  else throw new Error(`unknown material: ${key}`);
  m.name = `street-${key}`;
  cache.set(key, m);
  return m;
}
