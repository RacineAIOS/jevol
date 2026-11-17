import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, float, mx_noise_float, mx_fractal_noise_float } from 'three/tsl';
import { buildNoiseData } from './noiseData.js';

const SIZE = 1024;
const CELLS = 128;
let enabled = false;
let noiseTexture = null;

export function setBakedNoise(on) { enabled = !!on; }
function getTexture() {
  if (noiseTexture) return noiseTexture;
  const src = buildNoiseData(SIZE, CELLS);
  const half = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) half[i] = THREE.DataUtils.toHalfFloat(src[i]);
  const t = new THREE.DataTexture(half, SIZE, SIZE, THREE.RGFormat, THREE.HalfFloatType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.name = 'baked-noise';
  t.needsUpdate = true;
  noiseTexture = t;
  return t;
}

const sample = (xy, channel) => {
  const s = texture(getTexture(), xy.div(CELLS));
  return channel === 0 ? s.r : s.g;
};

export function noise2(p) {
  return enabled ? sample(vec2(p), 0) : mx_noise_float(p);
}

export function fractalNoise2(p, octaves = 3, lacunarity = 2, diminish = 0.5) {
  if (!enabled) return mx_fractal_noise_float(vec3(p, 0), octaves, lacunarity, diminish);
  let sum = null; let amplitude = 1; let q = vec2(p);
  for (let i = 0; i < octaves; i++) {
    const term = sample(q, 1).mul(amplitude);
    sum = sum ? sum.add(term) : term;
    amplitude *= diminish;
    q = q.mul(lacunarity);
  }
  return float(sum);
}
