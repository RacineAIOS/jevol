import { mulberry32 } from '../../engine/rng.js';
import { buildCube70 } from './cube70.js';
import { sharedMaterials, NO_SHADOW } from './materials.js';
import { CellSet } from './kit.js';
import { buildWoodHouse, buildBarn } from './houses.js';
import { buildFence } from './fences.js';
import { buildBusShelter, buildWaterTower, buildSilo, buildWoodPile, buildWell, buildBench, buildMailbox, buildGarden } from './props.js';
import { createConcretePoles, createStorkNests } from './poles.js';

export { createConcretePoles, createStorkNests };

const mixSeed = (a, b) => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 12)) >>> 0;
};

const PROPS = {
  busShelter: buildBusShelter,
  'water-tower': buildWaterTower,
  silo: buildSilo,
  firewood: buildWoodPile,
  well: buildWell,
  bench: buildBench,
  mailbox: buildMailbox,
  vegetableGarden: buildGarden,
};

export function createVillage({ houses = [], fences = [], props = [], heightAt = () => 0, quality = 'high', seed = 1 } = {}) {
  const materials = sharedMaterials();
  const cells = new CellSet(128);
  const obstacles = [];
  const entries = [];
  houses.forEach((h, i) => {
    const s = mixSeed(seed, h.seed ?? i);
    const spec = { ...h, seed: s };
    const B = cells.at(h.x, h.y);
    let r;
    if (h.kind === 'wood') r = buildWoodHouse(B, spec, heightAt);
    else if (h.kind === 'brick-barn') r = buildBarn(B, spec, heightAt, true);
    else if (h.kind === 'wood-barn') r = buildBarn(B, spec, heightAt, false);
    else if (h.kind === 'cube70') r = buildCube70(B, spec, heightAt);
    else throw new Error(`village: unknown house kind "${h.kind}"`);
    obstacles.push(r);
    entries.push({ kind: h.kind, ...r });
  });
  props.forEach((p, i) => {
    const fn = PROPS[p.kind];
    if (!fn) throw new Error(`village: unknown object "${p.kind}"`);
    const rnd = mulberry32(mixSeed(seed + 77, p.seed ?? i));
    const r = fn(cells.at(p.x, p.y), p, heightAt, rnd);
    if (!r.ground) obstacles.push(r);
    entries.push({ kind: p.kind, ...r });
  });
  fences.forEach((f, i) => {
    if (!f.line?.length) return;
    buildFence(cells.at(f.line[0][0], f.line[0][1]), f, heightAt, mixSeed(seed + 33, f.seed ?? i));
  });

  const group = cells.toGroup('village', materials, NO_SHADOW);
  let triangles = group.userData.triangles;
  let meshes = group.userData.meshes;

  return {
    group,
    update() {},
    info: () => `village: ${entries.length} objects, ${meshes} meshes, ${(triangles / 1000).toFixed(1)} k triangles`,
    addObstacles(sink) {
      for (const o of obstacles) {
        if (o.cyl) sink.cylinder?.(o.x, o.y, o.base, o.top, o.r);
        else sink.box(o.x, o.y, o.base, o.top, o.w, o.d, -o.heading);
      }
    },
    stats: { get triangles() { return triangles; }, get meshes() { return meshes; }, objects: entries },
  };
}
