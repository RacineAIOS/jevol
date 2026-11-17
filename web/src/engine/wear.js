import * as THREE from 'three/webgpu';
import { WEAR_RUT_DEPTH } from './groundSurface.js';
import { texture, vec2, vec3, float, mix, smoothstep, clamp, fwidth } from 'three/tsl';
import { noise2 } from './fastNoise.js';

const lin = (r, g, b) => [r, g, b].map((v) => (v / 255) ** 2.2);
export const WEAR_COLORS = {
  sand: lin(206, 156, 100),
  gravel: lin(176, 168, 152),
  earth: lin(116, 84, 56),
  dryEarth: lin(150, 118, 80),
  burnLight: lin(186, 154, 94),
  burnDark: lin(132, 102, 62),
};

function dataTexture(image) {
  const tex = new THREE.DataTexture(new Uint8Array(image.data.buffer), image.width, image.height, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function grassTexture(imageA, imageB) {
  const { width: wb, height: hb } = imageB;
  const wa = imageA.width;
  const a = imageA.data;
  const b = imageB.data;
  const out = new Uint8Array(wb * hb * 4);
  const ramp = (lo, hi, x) => {
    const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < hb; j++) {
    for (let i = 0; i < wb; i++) {
      const ka = ((2 * j) * wa + 2 * i) * 4;
      const kb = (j * wb + i) * 4;
      const kc = ka + wa * 4;
      const rut = Math.max(a[ka], a[ka + 4], a[kc], a[kc + 4]) / 255;
      const mineral = (a[ka + 1] + a[ka + 5] + a[kc + 1] + a[kc + 5]) / 1020;
      const dry = (b[kb] - 128) / 127;
      const poor = b[kb + 1] / 255;
      const mow = (b[kb + 2] - 128) / 127;
      const burn = Math.max(0, dry);
      const lush = Math.max(0, -dry);
      const density = (1 - 0.92 * ramp(0.12, 0.7, mineral)) * (1 - 0.93 * Math.min(1, rut * 1.6)) * (1 - 0.55 * poor) * (1 - 0.12 * burn);
      const height = (1 - 0.45 * burn) * (1 + 0.3 * lush) * (1 - 0.25 * Math.max(0, mow));
      out[kb] = Math.round(density * 255);
      out[kb + 1] = Math.round((height / 1.5) * 255);
      out[kb + 2] = b[kb];
      out[kb + 3] = b[kb + 2];
    }
  }
  const tex = new THREE.DataTexture(out, wb, hb, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createWear(info, imageA, imageB) {
  const [x0, x1] = info.x;
  const [y0, y1] = info.y;
  const z0 = -y1;
  const res = info.a.resolution;
  const { width: w, height: h } = imageA;
  const data = imageA.data;
  const at = (i, j) => data[(j * w + i) * 4];
  return {
    a: dataTexture(imageA),
    b: dataTexture(imageB),
    grass: grassTexture(imageA, imageB),
    x0, z0, spanX: x1 - x0, spanZ: y1 - y0,
    rutAt(x, z) {
      const fx = (x - x0) / res - 0.5;
      const fz = (z - z0) / res - 0.5;
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= w - 1 || j >= h - 1) return 0;
      const tx = fx - i;
      const tz = fz - j;
      return ((at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz) / 255;
    },
  };
}

export function wearSample(world, xz) {
  const wear = world.wear;
  const uvw = vec2(xz.x.sub(wear.x0).div(wear.spanX), xz.y.sub(wear.z0).div(wear.spanZ));
  const a = texture(wear.a, uvw);
  const b = texture(wear.b, uvw);
  const signed = (v) => v.sub(128 / 255).mul(255 / 127);
  return {
    uvw, a, rut: a.r, mineral: a.g, sand: a.b, dry: signed(b.r), poor: b.g, mow: signed(b.b),
    rutWide: texture(wear.a, uvw).level(float(2.7)).r,
  };
}

export function wearNoise(xz) {
  const v = (f) => float(1).sub(smoothstep(0.35, 0.9, fwidth(xz.x.mul(f))));
  const va = v(0.42);
  const vb = v(1.7);
  const a = noise2(xz.mul(0.42)).mul(va);
  const b = noise2(xz.mul(1.7).add(11.3)).mul(vb);
  return { n: clamp(a.mul(0.6).add(b.mul(0.45)).mul(0.9).add(0.5), 0, 1), w: mix(float(0.9), float(0.14), va.mul(vb.mul(0.5).add(0.5))) };
}

export function wearMask(amount, noise) {
  return clamp(amount.mul(1.25).sub(noise.n).div(noise.w).add(0.5), 0, 1).mul(smoothstep(0, 0.06, amount));
}

export function wearGrassTint(color, s, noise, burnNoise) {
  const burn = clamp(s.dry, 0, 1);
  const lush = clamp(s.dry.negate(), 0, 1);
  const burnMask = wearMask(burn, { n: burnNoise, w: noise.w });
  const burnColor = mix(vec3(...WEAR_COLORS.burnDark), vec3(...WEAR_COLORS.burnLight), clamp(noise.n.mul(1.4).sub(0.2), 0, 1));
  let c = mix(color, burnColor, burnMask.mul(0.88));
  c = mix(c, c.mul(vec3(0.8, 1.14, 0.7)), lush.mul(0.85));
  return c.mul(vec3(1, 1, 1).add(vec3(0.23, 0.2, 0.06).mul(s.mow)));
}

export function wearTerrain(world, color, xz, { grassLike, notPaved }) {
  const s = wearSample(world, xz);
  const noise = wearNoise(xz);
  const burnNoise = float(1).sub(noise.n);
  const on = notPaved;
  let c = mix(color, wearGrassTint(color, s, noise, burnNoise), grassLike.mul(on));
  const poorMask = wearMask(s.poor, { n: float(1).sub(noise.n), w: noise.w });
  c = mix(c, vec3(...WEAR_COLORS.dryEarth).mul(noise.n.mul(0.5).add(0.75)), poorMask.mul(0.6).mul(on));
  const mineralMask = wearMask(s.mineral, noise).mul(on);
  const speckle = noise2(xz.mul(53)).mul(float(1).sub(smoothstep(0.002, 0.008, fwidth(xz.x))));
  const mineralColor = mix(vec3(...WEAR_COLORS.gravel), vec3(...WEAR_COLORS.sand), s.sand)
    .mul(noise.n.mul(0.5).add(0.78)).mul(float(1).add(speckle.mul(mix(float(0.2), float(0.07), s.sand))));
  c = mix(c, mineralColor, mineralMask);
  const earthColor = vec3(...WEAR_COLORS.earth).mul(noise.n.mul(0.6).add(0.7));
  const halo = wearMask(s.rutWide.mul(3.2), noise).mul(0.6);
  c = mix(c, earthColor, clamp(s.rut.mul(1.5), 0, 1).mul(0.9).max(halo).mul(on));
  return { color: c, relief: s.rut.mul(-WEAR_RUT_DEPTH), cover: mineralMask.max(clamp(s.rut.mul(1.5), 0, 1).max(halo).mul(on)) };
}

export function wearGrass(world, xz) {
  const wear = world.wear;
  const g = texture(wear.grass, vec2(xz.x.sub(wear.x0).div(wear.spanX), xz.y.sub(wear.z0).div(wear.spanZ)));
  const s = { dry: g.b.sub(128 / 255).mul(255 / 127), mow: g.a.sub(128 / 255).mul(255 / 127) };
  return { density: g.r, height: g.g.mul(1.5), tint: (color) => wearGrassTint(color, s, { n: float(0.5), w: float(0.3) }, float(0.5)) };
}
