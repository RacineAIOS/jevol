import { createObstacleField } from '../engine/obstacles.js';
import { addTreeObstacles } from '../engine/treeObstacles.js';
import { heightAt } from '../engine/world.js';

export function createObstacleSource({ world, sites, trees = true }) {
  return createObstacleField((sink) => {
    sites.addObstacles?.(sink);
    if (trees) addTreeObstacles(sink, world, (x, z) => heightAt(world, x, z));
  });
}
