import * as THREE from 'three/webgpu';
import { createWear } from './wear.js';

export async function loadWorld(base = '/data') {
  const meta = await (await fetch(`${base}/meta.json`)).json();
  const size = meta.size;

  const [heightBuf, classImg, buildings, treeBuf, roads] = await Promise.all([
    fetch(`${base}/${meta.height.file}`).then((r) => r.arrayBuffer()),
    loadImageData(`${base}/classmap.png`),
    fetch(`${base}/buildings.json`).then((r) => r.json()),
    fetch(`${base}/${meta.trees.file}`).then((r) => r.arrayBuffer()),
    fetch(`${base}/roads.json`).then((r) => r.json()),
  ]);

  const raw = new Uint16Array(heightBuf);
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] * meta.height.scale;

  const classes = new Uint8Array(size * size);
  for (let i = 0; i < classes.length; i++) classes[i] = classImg.data[i * 4];

  const [macroImg, fieldsImg] = await Promise.all([
    loadImageData(`${base}/${meta.macro.file}`),
    loadImageData(`${base}/${meta.fields.file}`),
  ]);
  const macro = new THREE.DataTexture(new Uint8Array(macroImg.data.buffer), size, size, THREE.RGBAFormat);
  macro.colorSpace = THREE.SRGBColorSpace;
  macro.magFilter = THREE.LinearFilter;
  macro.minFilter = THREE.LinearMipmapLinearFilter;
  macro.generateMipmaps = true;
  macro.needsUpdate = true;
  const fields = new THREE.DataTexture(new Uint8Array(fieldsImg.data.buffer), size, size, THREE.RGBAFormat);
  fields.magFilter = THREE.NearestFilter;
  fields.minFilter = THREE.NearestFilter;
  fields.generateMipmaps = false;
  fields.needsUpdate = true;

  let wear = null;
  if (meta.wear) {
    const [imageA, imageB] = await Promise.all([loadImageData(`${base}/${meta.wear.a.file}`), loadImageData(`${base}/${meta.wear.b.file}`)]);
    wear = createWear(meta.wear, imageA, imageB);
  }

  return {
    meta,
    wear,
    macro,
    fields,
    size,
    half: size / 2,
    hmin: meta.height.min,
    heights,
    classes,
    buildings,
    roads,
    trees: new Float32Array(treeBuf),
  };
}

async function loadImageData(url) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export function heightAtPixel(world, i, j) {
  const n = world.size;
  i = Math.min(n - 1, Math.max(0, i));
  j = Math.min(n - 1, Math.max(0, j));
  return world.heights[j * n + i];
}

export function heightAt(world, x, z) {
  return world.surface ? world.surface.heightAt(x, z) : baseHeightAt(world, x, z);
}

export function baseHeightAt(world, x, z) {
  const fx = x + world.half - 0.5;
  const fz = z + world.half - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const h00 = heightAtPixel(world, i, j);
  const h10 = heightAtPixel(world, i + 1, j);
  const h01 = heightAtPixel(world, i, j + 1);
  const h11 = heightAtPixel(world, i + 1, j + 1);
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}
