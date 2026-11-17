import * as THREE from 'three/webgpu';
import { CLASS_STYLE } from './palette.js';
import { GRASS_TINT, GRASS_LUM } from './terrain.js';
import { SEASON, STRAW } from './season.js';

const FALLBACK = new THREE.Color().setRGB(...CLASS_STYLE.grass.color.map((v) => v / 255), THREE.SRGBColorSpace);
const srgbToLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const linearToSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
const toLinear = (v) => srgbToLinear(v / 255);

const GRASSY = ['grass', 'meadow', 'residential', 'industrial', 'scrub', 'sport'];
let grassyIds = null;

export function grassColorAt(world, x, z, r = 4) {
  const data = world.macro.image.data;
  const { size, half, classes } = world;
  grassyIds ??= new Set(GRASSY.map((n) => world.meta.classes.indexOf(n)).filter((i) => i >= 0));
  let sr = 0, sg = 0, sb = 0, sw = 0;
  for (let dz = -r; dz <= r; dz += 1.5) {
    for (let dx = -r; dx <= r; dx += 1.5) {
      const i = Math.round(x + dx + half);
      const j = Math.round(z + dz + half);
      if (i < 0 || j < 0 || i >= size || j >= size) continue;
      if (!grassyIds.has(classes[j * size + i])) continue;
      const k = (j * size + i) * 4;
      const w = data[k + 3] / 255;
      if (w <= 0) continue;
      sr += toLinear(data[k]) * w;
      sg += toLinear(data[k + 1]) * w;
      sb += toLinear(data[k + 2]) * w;
      sw += w;
    }
  }
  let c = [FALLBACK.r, FALLBACK.g, FALLBACK.b];
  if (sw > 0) {
    const m = [sr / sw, sg / sw, sb / sw];
    const lum = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    const measured = m.map((v) => Math.max(0, (lum + (v - lum) * 1.4) * 0.8));
    c = c.map((v, k) => v + (measured[k] - v) * 0.85);
  }
  c = c.map((v, k) => v * GRASS_TINT[k]);
  if (SEASON.grassDry > 0) {
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const k = Math.min(1.3, Math.max(0.7, lum / GRASS_LUM));
    const w = SEASON.grassDry * 0.9;
    c = c.map((v, i) => v + (STRAW[i] * k - v) * w);
  }
  return c;
}

export function linearToSrgb255(c) {
  return c.map((v) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255));
}
