import { createStreet } from '../street/street.js';
import { createRoadNetwork } from '../roads/network.js';
import { createCourse } from './course.js';
import { mulberry32 } from '../../engine/rng.js';

export const DEFAULT_LANE = [[-45, 112], [-95, 112], [-95, 160], [-140, 160], [-165, 135], [-205, 135], [-205, 195], [-245, 195]];

export function offsetLine(line, off) {
  const dirs = line.slice(1).map(([x, y], i) => { const [px, py] = line[i]; const l = Math.hypot(x - px, y - py); return [(x - px) / l, (y - py) / l]; });
  return line.map(([x, y], i) => {
    if (i === 0 || i === line.length - 1) { const [dx, dy] = dirs[Math.min(i, dirs.length - 1)]; return [x - dy * off, y + dx * off]; }
    const [ax, ay] = dirs[i - 1];
    const [bx, by] = dirs[i];
    const nx = -ay - by;
    const ny = ax + bx;
    const k = off / (1 + ax * bx + ay * by);
    return [x + nx * k, y + ny * k];
  });
}

export function roundedLane(line, radius = 4, step = 1) {
  const pts = [line[0]];
  for (let i = 1; i + 1 < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const [cx, cy] = line[i + 1];
    const la = Math.hypot(bx - ax, by - ay);
    const lc = Math.hypot(cx - bx, cy - by);
    const u = [(bx - ax) / la, (by - ay) / la];
    const v = [(cx - bx) / lc, (cy - by) / lc];
    const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    const cut = Math.min(radius * Math.tan(turn / 2), la / 2, lc / 2);
    const p0 = [bx - u[0] * cut, by - u[1] * cut];
    const p1 = [bx + v[0] * cut, by + v[1] * cut];
    const n = Math.max(2, Math.ceil((turn * radius) / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pts.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * bx + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * by + t * t * p1[1]]);
    }
  }
  pts.push(line.at(-1));
  return pts;
}

function extendLine(line, extend) {
  const d0 = [line[1][0] - line[0][0], line[1][1] - line[0][1]];
  const d1 = [line.at(-1)[0] - line.at(-2)[0], line.at(-1)[1] - line.at(-2)[1]];
  const l0 = Math.hypot(...d0);
  const l1 = Math.hypot(...d1);
  return [[line[0][0] - (d0[0] / l0) * extend, line[0][1] - (d0[1] / l0) * extend], ...line.slice(1, -1),
    [line.at(-1)[0] + (d1[0] / l1) * extend, line.at(-1)[1] + (d1[1] / l1) * extend]];
}

export function laneLoop(line, offset, extend = 0, radius = 4) {
  const ext = extendLine(line, extend);
  const ring = [...offsetLine(ext, -offset), ...offsetLine(ext, offset).reverse()];
  const mid = [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
  return roundedLane([mid, ...ring.slice(1), ring[0], mid], radius).slice(0, -1);
}

function clearLaneGrass(world, line, r = 4) {
  const cls = world.meta.classes.indexOf('road_minor');
  const { size, half } = world;
  const pts = roundedLane(line);
  const R = Math.ceil(r);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let u = 0; u <= len; u += 0.5) {
      const cx = ax + ((bx - ax) * u) / len;
      const cy = ay + ((by - ay) * u) / len;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const row = Math.round(-(cy + dy) + half);
          const col = Math.round(cx + dx + half);
          if (row >= 0 && row < size && col >= 0 && col < size) world.classes[row * size + col] = cls;
        }
      }
    }
  }
  if (world.classTex) world.classTex.needsUpdate = true;
}

const STREET_SIDEWALK = 0.7;
const STREET_EXTEND = 8;
export function createLane({ world, heightAt, quality = 'high' }) {
  const line = DEFAULT_LANE;
  const half = 4;
  clearLaneGrass(world, line, half + STREET_SIDEWALK + 0.5);
  const ext = extendLine(line, STREET_EXTEND);
  const road = createRoadNetwork({
    roads: [{ nature: 'Single carriageway road', width: 2 * half, importance: '5', bridge: false, line: roundedLane(ext, half + STREET_SIDEWALK * 0.97),
      style: { kind: 'local', center: 'T1', edge: 'none' } }],
    seed: 3, heightAt, furniture: false,
  });
  const houses = createStreet({ line, half, heightAt, seed: 5, quality, sidewalk: STREET_SIDEWALK, road: false, extend: STREET_EXTEND, cars: 0, trees: false });
  houses.clearGrass?.(world);
  const tops = [];
  houses.addObstacles({
    box: (x, y, base, top) => { const h = top - heightAt(x, -y); if (h > 4) tops.push(h); },
    cylinder() {},
    wall() {},
  });
  tops.sort((a, b) => a - b);
  const wallHeight = tops.length ? Math.round(tops[Math.floor(tops.length * 0.2)] * 10) / 10 : 6;
  return {
    line, half, wallHeight,
    groups: [road.group, houses.group],
    addObstacles(sink) { houses.addObstacles(sink); },
    update(camera, dt) { houses.update?.(camera, dt); },
    street: houses,
  };
}

const CONTAINER_COLORS = [0x8a3b2a, 0x2f5d8a, 0x3e6b4a, 0xc9a227, 0x7a7d82, 0xb5562a];
const CONTAINER_LEVELS = 5;
const CONTAINER_W = 2.44;
const CONTAINER_L = 6.06;

function laneContainers(line, half) {
  const rng = mulberry32(31);
  const pick = () => CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)];
  const items = [];
  for (const side of [-1, 1]) {
    const wall = offsetLine(line, side * (half + CONTAINER_W / 2));
    for (let i = 0; i + 1 < wall.length; i++) {
      const [ax, ay] = wall[i];
      const [bx, by] = wall[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len / (CONTAINER_L + 0.25)));
      const h = Math.atan2(by - ay, bx - ax);
      for (let k = 0; k < n; k++) {
        const u = n === 1 ? len / 2 : CONTAINER_L / 2 + (k * (len - CONTAINER_L)) / (n - 1);
        const color = pick();
        items.push({ type: 'container', x: ax + Math.cos(h) * u, y: ay + Math.sin(h) * u, headingDeg: (h * 180) / Math.PI,
          color, levels: CONTAINER_LEVELS, levelColors: Array.from({ length: CONTAINER_LEVELS }, pick) });
      }
    }
  }
  return items;
}

export function createContainerLane({ world, heightAt, line }) {
  const half = 4;
  clearLaneGrass(world, line);
  const road = createRoadNetwork({
    roads: [{ nature: 'Single carriageway road', width: 6, importance: '5', bridge: false, line: roundedLane(line), style: { kind: 'local' } }],
    seed: 3, heightAt, furniture: false,
  });
  const containers = createCourse({ items: laneContainers(line, half), heightAt, name: 'container-lane' });
  return {
    line, half,
    groups: [road.group, containers.group],
    addObstacles(sink) { containers.addObstacles(sink); },
  };
}
