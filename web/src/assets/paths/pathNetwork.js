import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { pickKind, kindParams } from './kinds.js';
import { buildRibbons, smoothAxis, ScatterBuffers, scatterAlong, LIFT, ACROSS } from './geometry.js';
import { createPathMaterial, createScatterMaterial } from './materials.js';

const DENSITY = { low: 0.35, medium: 0.7, high: 1 };
const linear = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).toArray();

export function createPathNetwork({
  paths, roads = [], seed = 1, heightAt = () => 0, groundColor = [86, 100, 50], quality = 'high', sunDir = [0.5, -0.5], tile = 0,
  onRibbons, scatterHeightAt,
}) {
  const rng = mulberry32(seed);
  const density = DENSITY[quality] ?? 1;
  const items = paths
    .filter((p) => p.width >= 0.5 && p.line.length >= 2)
    .map((p, i) => ({ ...p, seed: Math.floor(rng() * 900) + 7 + i * 0.37 }))
    .sort((a, b) => a.width - b.width);
  for (const it of items) {
    const prng = mulberry32(Math.floor(it.seed * 1000));
    prng.range = (a, b) => a + (b - a) * prng();
    prng.pick = (l) => l[Math.floor(prng() * l.length)];
    prng.sign = () => (prng() < 0.5 ? -1 : 1);
    it.prng = prng;
    it.name = it.variant ?? pickKind(it.nature, it.width, prng);
    it.k = kindParams(it.name, it.width, prng);
  }
  const roadAxes = roads.map((r) => ({ width: r.width, axis: smoothAxis(r.line) }));
  const ribbons = buildRibbons(items, roadAxes, heightAt);
  onRibbons?.(ribbons);

  const attr = { pos: [], geo: [], soil: [], stone: [], wear: [], form: [], end: [], idx: [] };
  const scatter = new ScatterBuffers();
  const kinds = [];
  for (const rb of ribbons) {
    const it = rb.item;
    const prng = it.prng;
    const k = it.k;
    kinds.push(it.name);
    const soil = linear(k.soil).map((v) => v * 0.85);
    const stone = linear(k.stone).map((v) => v * 0.85);
    const base = attr.pos.length / 3;
    attr.pos.push(...rb.pos);
    attr.geo.push(...rb.geo);
    const nv = rb.pos.length / 3;
    for (let v = 0; v < nv; v++) {
      const row = Math.floor(v / ACROSS);
      attr.soil.push(...soil, rb.dJ[row]);
      attr.end.push(rb.dFree[row], rb.dig[v]);
      attr.stone.push(...stone, k.stoneDensity + (k.site ? 4 : 0));
      attr.wear.push(k.rutOff, k.rutDepth, k.wet, k.dryness);
      attr.form.push(k.strip, k.encroach, k.wobble, k.stoneSize);
    }
    for (const i of rb.idx) attr.idx.push(base + i);
    scatterAlong(scatter, rb, k, scatterHeightAt ?? heightAt, prng, density);
  }

  const group = new THREE.Group();
  group.name = 'paths';
  const g = new THREE.BufferGeometry();
  const f = (a, n) => new THREE.Float32BufferAttribute(a, n);
  g.setAttribute('position', f(attr.pos, 3));
  g.setAttribute('aGeo', f(attr.geo, 4));
  g.setAttribute('aSoil', f(attr.soil, 4));
  g.setAttribute('aStone', f(attr.stone, 4));
  g.setAttribute('aWear', f(attr.wear, 4));
  g.setAttribute('aForm', f(attr.form, 4));
  g.setAttribute('aEnd', f(attr.end, 2));
  g.setIndex(attr.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const surface = new THREE.Mesh(g, createPathMaterial({ groundColor, sunDir }));
  surface.name = 'paths-surface';
  surface.frustumCulled = false;
  surface.renderOrder = 2;
  surface.userData.noShadow = true;
  surface.receiveShadow = true;
  group.add(surface);

  const scatterMaterial = createScatterMaterial();
  const tiles = [];
  for (const [key, part] of splitScatter(scatter, tile)) {
    const bits = new THREE.Mesh(part.geometry(), scatterMaterial);
    bits.name = tile ? `paths-grass-pebbles-${key}` : 'paths-grass-pebbles';
    bits.frustumCulled = tile > 0;
    bits.userData.noShadow = true;
    bits.receiveShadow = true;
    group.add(bits);
    tiles.push(bits);
  }
  const reach = 120 + tile * 0.75;
  const update = (camera) => {
    if (!tile) return;
    for (const t of tiles) t.visible = t.geometry.boundingSphere.center.distanceTo(camera.position) < reach;
  };

  const triangles = attr.idx.length / 3 + scatter.pos.length / 9;
  return {
    group,
    update,
    kinds,
    ribbons,
    info: () => `paths: ${items.length} lines, ${triangles.toFixed(0)} triangles (${scatter.tufts} tufts, ${scatter.stones} pebbles), variants ${[...new Set(kinds)].join(' ')}`,
    triangles,
    scatter,
    lift: LIFT,
  };
}

function splitScatter(scatter, tile) {
  if (!tile) return new Map([['0', scatter]]);
  const parts = new Map();
  const n = scatter.pos.length / 9;
  for (let t = 0; t < n; t++) {
    const r = t * 12;
    const key = `${Math.floor(scatter.root[r] / tile)}_${Math.floor(scatter.root[r + 2] / tile)}`;
    let part = parts.get(key);
    if (!part) {
      part = new ScatterBuffers();
      parts.set(key, part);
    }
    for (const [src, dst, size] of [[scatter.pos, part.pos, 9], [scatter.nor, part.nor, 9], [scatter.col, part.col, 9], [scatter.root, part.root, 12]]) {
      for (let k = 0; k < size; k++) dst.push(src[t * size + k]);
    }
  }
  return parts;
}
