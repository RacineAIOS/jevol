import { heightAt, baseHeightAt } from '../engine/world.js';
import { LIFT } from '../assets/paths/geometry.js';
import { createRoadNetwork } from '../assets/roads/network.js';
import { createPathNetwork } from '../assets/paths/pathNetwork.js';
import { grassColorAt, linearToSrgb255 } from '../engine/groundColor.js';

export const UNPAVED = new Set(['Track', 'Gravel road', 'Trail', 'Stairs']);
export const ground = (world) => (x, z) => heightAt(world, x, z);
export const draped = (world) => (x, z) => baseHeightAt(world, x, z);

export function createRoads(world, { seed = 1 } = {}) {
  const net = createRoadNetwork({
    roads: world.roads.filter((r) => !UNPAVED.has(r.nature)),
    seed,
    heightAt: draped(world),
    grass: (x, z) => grassColorAt(world, x, z),
  });
  net.group.name = 'roads';
  return net;
}

export function createPaths(world, { seed = 1, quality = 'high' } = {}) {
  const paths = world.roads.filter((r) => UNPAVED.has(r.nature) && r.width >= 0.5 && r.line.length >= 2);
  const sum = [0, 0, 0];
  let n = 0;
  for (const p of paths) {
    for (const [x, y] of p.line) {
      grassColorAt(world, x, -y, 5).forEach((v, k) => { sum[k] += v; });
      n++;
    }
  }
  const mean = n ? sum.map((v) => v / n) : [0.1, 0.14, 0.05];
  const net = createPathNetwork({
    paths,
    roads: world.roads.filter((r) => !UNPAVED.has(r.nature)),
    seed,
    quality,
    heightAt: draped(world),
    groundColor: linearToSrgb255(mean),
    tile: 128,
    onRibbons: (ribbons) => world.surface?.setPaths(ribbons),
    scatterHeightAt: world.surface ? (x, z) => world.surface.heightAt(x, z) - LIFT : undefined,
  });
  net.group.name = 'paths';
  return net;
}
