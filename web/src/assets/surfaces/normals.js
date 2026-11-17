import * as THREE from 'three/webgpu';
import {
  positionWorld, normalWorld, cameraPosition, texture, vec2, vec3, float, abs, max, mix, step, smoothstep, length, normalize, dot,
  cameraViewMatrix, vec4, fract, exp, fwidth, dFdx, dFdy,
} from 'three/tsl';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}models/surfaces/`;

export const SETS = {
  'smooth-concrete': { cell: 0, tile: [2, 1], mean: [0.4817, 0.4817, 0.4817], rough: 0.516 },
  'board-formed-concrete': { cell: 1, tile: [2, 2], mean: [0.2074, 0.1966, 0.1769], rough: 0.822 },
  rubble: { cell: 2, tile: [2, 2], mean: [0.291, 0.2416, 0.1916], rough: 0.857 },
  'rough-wood': { cell: 3, tile: [0.5, 0.5], mean: [0.153, 0.1284, 0.1009], rough: 0.51 },
};
const ATLAS = 2048;
const CELL_PAD = 32;
const CELL_IN = 960;

export const SURFACE_DETAIL_LEVEL = 1;
export const SURFACE_DETAIL = true;

let atlas = null;
export function surfaceTextures(name) {
  if (name && !SETS[name]) throw new Error(`surfaces: unknown set ${name}`);
  if (atlas) return atlas;
  const loader = new THREE.TextureLoader();
  const make = (file, srgb) => {
    const t = loader.load(BASE + file);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };
  atlas = { color: make('surfaces_color_2k.jpg', true), nr: make('surfaces_nr_2k.jpg', false) };
  return atlas;
}

function sampleTile(tex, set, uvT, custom) {
  if (custom) return texture(tex, uvT);
  const k = CELL_IN / ATLAS;
  const origin = vec2((set.cell % 2) * 0.5, Math.floor(set.cell / 2) * 0.5).add(CELL_PAD / ATLAS);
  return texture(tex, origin.add(fract(uvT).mul(k))).grad(dFdx(uvT).mul(k), dFdy(uvT).mul(k));
}

export function projectionFrame({ position = positionWorld, normal = normalWorld, axis = 'auto' } = {}) {
  const n = normalize(normal);
  const an = abs(n);
  const wY = axis === 'y' ? float(1) : step(max(an.x, an.z), an.y);
  const wX = float(1).sub(wY).mul(step(an.z, an.x));
  const wZ = float(1).sub(wY).sub(wX);
  const p = position;
  const coord = vec2(p.x.mul(wY.add(wZ)).add(p.z.mul(wX)), p.z.mul(wY).add(p.y.mul(wX.add(wZ))));
  const T0 = vec3(wY.add(wZ), 0, wX);
  const B0 = vec3(0, wX.add(wZ), wY);
  const T = normalize(T0.sub(n.mul(dot(n, T0))).add(vec3(1e-5, 0, 0)));
  const Bp = B0.sub(n.mul(dot(n, B0)));
  const B = normalize(Bp.sub(T.mul(dot(T, Bp))).add(vec3(0, 1e-5, 0)));
  return { n, T, B, coord };
}

export const slopeToPerturb = (frame, dhdu, dhdv) => frame.T.mul(dhdu).add(frame.B.mul(dhdv)).negate();

export const seamDistance = (coord, period, phase = 0) => fract(coord.div(period).add(phase).add(0.5)).sub(0.5).mul(period);

export function lipSlope(s, w, hgt) {
  const q = s.div(w);
  const visible = float(1).sub(smoothstep(0.25, 0.6, fwidth(s).div(w)));
  return q.mul((-2 * hgt) / w).mul(exp(q.mul(q).negate())).mul(visible);
}

export function distanceFade(near = 12, far = 60, position = positionWorld) {
  return float(1).sub(smoothstep(near, far, length(position.sub(cameraPosition))));
}

export function projected(name, { scale = 1, strength = 1, fade = [12, 60], second = 0.4, frame = null, offset = null, axis = 'auto', swap = false, position = positionWorld, normal = normalWorld, custom = null } = {}) {
  const set = custom ?? SETS[name];
  const tex = custom ?? surfaceTextures(name);
  const f0 = frame ?? projectionFrame({ position, normal, axis });
  const f = swap ? { ...f0, T: f0.B, B: f0.T, coord: f0.coord.yx } : f0;
  const c0 = offset ? f.coord.add(offset) : f.coord;
  const uvA = c0.div(vec2(set.tile[0] * scale, set.tile[1] * scale));
  const ca = sampleTile(tex.color, set, uvA, custom).rgb;
  const na = sampleTile(tex.nr, set, uvA, custom).rgb;
  let albedo = ca;
  let rough = na.z;
  let xy = na.xy.mul(2).sub(1);
  if (second > 0) {
    const ratio = 3.7;
    const cr = Math.cos(0.54);
    const sr = Math.sin(0.54);
    const uvB = vec2(c0.x.mul(cr).sub(c0.y.mul(sr)), c0.x.mul(sr).add(c0.y.mul(cr)))
      .div(vec2(set.tile[0] * scale * ratio, set.tile[1] * scale * ratio)).add(vec2(0.37, 0.61));
    const cb = sampleTile(tex.color, set, uvB, custom).rgb;
    const nb = sampleTile(tex.nr, set, uvB, custom).rgb;
    const t = nb.xy.mul(2).sub(1);
    const xyB = vec2(t.x.mul(cr).add(t.y.mul(sr)), t.x.mul(-sr).add(t.y.mul(cr)));
    albedo = mix(ca, cb, second);
    rough = mix(na.z, nb.z, second);
    xy = mix(xy, xyB, second);
  }
  const near = fade ? distanceFade(fade[0], fade[1], position) : float(1);
  const k = near.mul(strength * SURFACE_DETAIL_LEVEL);
  const z = max(float(1).sub(dot(xy, xy)), 0.09).sqrt();
  const perturb = f.T.mul(xy.x).add(f.B.mul(xy.y)).div(z).mul(k);
  return { albedo: albedo.div(vec3(...set.mean)), rough, perturb, near, frame: f };
}

export function finish(perturb, normal = normalWorld) {
  return normalize(cameraViewMatrix.mul(vec4(normalize(normalize(normal).add(perturb)), 0)).xyz);
}
