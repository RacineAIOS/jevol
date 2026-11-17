import { createCourse, COLORS } from '../assets/flight-course/course.js';
import { createLane, createContainerLane, laneLoop } from '../assets/flight-course/lane.js';
import { createBillboard } from '../assets/flight-course/billboard.js';
import { createPlates } from '../assets/flight-course/plates.js';
import { createVehiclesAt, createTraffic } from '../assets/vehicles/index.js';
import { createRuralDecor } from '../assets/farm/index.js';
import { createVillage } from '../assets/village/index.js';
import { createBench } from './bench.js';
import { ground } from './common.js';

const { magenta, cyan, orange } = COLORS;

const OBJECTS = [
  { name: 'red car', x: 122.25, y: -24.5, radius: 2.3 },
  { name: 'white van', x: 132.25, y: -13.5, radius: 2.4 },
  { name: 'yellow car', x: 144.75, y: -24.5, radius: 2.2 },
  { name: 'blue container', x: 139, y: -40, radius: 3.3 },
  { name: 'tractor', x: 121, y: -38, radius: 2.6 },
  { name: 'round hay bales', x: 152.5, y: -11, radius: 2.8 },
];
const STARTS = [[133, -68], [99, -32], [168, -58], [134, 16]];
const CONTAINER_LANE = [[-35, 50], [-85, 50], [-110, 25], [-150, 25], [-150, 60], [-200, 60], [-225, 35], [-225, -5]];
const LANE_MISSIONS = ['Follow the street between the houses.', 'Fly along the street.', 'Follow the street between the buildings.'];

const ROAD_TOP_M = 0.075;
const TRAFFIC = [
  { model: 'compactA', rgb: [196, 22, 22] },
  { model: 'sedan', rgb: [24, 70, 190] },
  { model: 'cityCarA', rgb: [238, 238, 234] },
  { model: 'suvS', rgb: [236, 196, 22] },
  { model: 'compactB', rgb: [30, 140, 60] },
  { model: 'estate', rgb: [18, 18, 20] },
];

const FIRST_Y = -200;
const SPACING_M = 45;
const OFFSETS_M = [0, 6, -5, 8, -8, 4, -10, 6, 0];
const ARCHES = OFFSETS_M.map((x, i) => ({ x, y: FIRST_Y + i * SPACING_M }));
const ARCH_COLORS = [0xd42020, 0x1f5fd6, 0xf2c818, 0x1f9e3a, 0xff7a1a, 0x8a3fd1, 0xff5fb8, 0xf2f2ee, 0x1d1f23];
const ARCH_ITEMS = ARCHES.map((arch, i) => {
  const from = ARCHES[Math.max(0, i - 1)];
  const to = ARCHES[Math.min(ARCHES.length - 1, i + 1)];
  return { type: 'arch', ...arch, headingDeg: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI, color: ARCH_COLORS[i], solid: true, strip: false, timed: true };
});

const FARM = {
  houses: [
    { kind: 'wood', x: 116, y: 3, headingDeg: 180, width: 11, depth: 8, recipe: 'ochre-siding' },
    { kind: 'brick-barn', x: 104, y: -12, headingDeg: 90, width: 14, depth: 10 },
    { kind: 'wood-barn', x: 161, y: 0, headingDeg: 180, width: 16, depth: 10 },
    { kind: 'wood-barn', x: 110, y: -53, headingDeg: 0, width: 14, depth: 8 },
  ],
  props: [
    { kind: 'firewood', x: 108.5, y: 5, headingDeg: 90 },
    { kind: 'vegetableGarden', x: 113, y: 13, headingDeg: 0 },
  ],
  fences: [
    [[101, -49], [101, -38]], [[101, -26], [101, -20]],
    [[103, -59], [124, -59]], [[140, -59], [156, -59]],
  ],
  manure: [{ x: 108, y: -43, headingDeg: 90 }],
  plates: [
    { kind: 'gravel', x: 128, y: -38.25, w: 48, d: 21.5, headingDeg: 0 },
    { kind: 'gravel', x: 112, y: -12, w: 6, d: 14, headingDeg: 0 },
    { kind: 'gravel', x: 116, y: -5.5, w: 3, d: 9, headingDeg: 0 },
    { kind: 'gravel', x: 160, y: -9, w: 16, d: 8, headingDeg: 0 },
    { kind: 'gravel', x: 150, y: -20, w: 6, d: 16, headingDeg: 0 },
    { kind: 'parking', x: 131, y: -19, w: 32, d: 17, headingDeg: 0,
      bays: { u0: 1, count: 12, width: 2.5, rows: [{ v0: 0.5, v1: 5.5, back: 0.5 }, { v0: 11.5, v1: 16.5, back: 16.5 }] } },
    { kind: 'concrete', x: 139, y: -40, w: 11, d: 6, headingDeg: 30 },
  ],
};
const FARM_TRACK = { nature: 'Track', width: 3.5, importance: '5', bridge: false, line: [[126, -324.96], [127, -282], [124, -205], [126.5, -125], [125, -78], [126, -49]] };
const ACCESS_ROAD = { nature: 'Single carriageway road', width: 5, importance: '5', bridge: false, line: [[-18.5, -330.74], [-18.5, -260], [-18.5, -182]] };
const CLUB_PARKING = { kind: 'gravel', x: -27, y: -193, w: 11, d: 12, headingDeg: 0 };
const BILLBOARD = { x: -30, y: -184, normalDeg: -65 };
const CORNER_BILLBOARDS = [[262, 235], [-262, 235], [-262, -235], [262, -235]].map(([x, y]) => ({ x, y, normalDeg: (Math.atan2(-y, -x) * 180) / Math.PI }));
const FENCE_BLOCKERS = FARM.fences.map(([[ax, ay], [bx, by]]) => ({ x: (ax + bx) / 2, y: (ay + by) / 2, w: Math.hypot(bx - ax, by - ay), d: 0.3, heading: Math.atan2(by - ay, bx - ax), height: 1.25 }));
const MANURE_BLOCKERS = FARM.manure.map((m) => ({ x: m.x, y: m.y, w: 7, d: 5, heading: ((90 - m.headingDeg) * Math.PI) / 180, height: 1.6 }));

const PADS = [
  { type: 'pad', x: -30, y: -206, color: orange },
  { type: 'pad', x: -48, y: -190, color: cyan },
  { type: 'pad', x: -24, y: -224, color: magenta },
];

function paintAlong(world, line, r, cls) {
  const { size, half } = world;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let s = 0; s <= len; s += 0.5) {
      const cx = ax + ((bx - ax) * s) / len;
      const cy = ay + ((by - ay) * s) / len;
      for (let dy = -Math.ceil(r); dy <= r; dy++) {
        for (let dx = -Math.ceil(r); dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const row = Math.round(-(cy + dy) + half);
          const col = Math.round(cx + dx + half);
          if (row >= 0 && row < size && col >= 0 && col < size) world.classes[row * size + col] = cls;
        }
      }
    }
  }
}

function clearTreesAlong(world, roads) {
  const stride = world.meta.trees.stride;
  const src = world.trees;
  const dist = (x, y, line) => {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
  const keep = [];
  for (let o = 0; o < src.length; o += stride) {
    if (!roads.some((r) => dist(src[o], src[o + 1], r.line) < r.width / 2 + 1 + 0.6 * src[o + 4])) keep.push(o);
  }
  if (keep.length === src.length / stride) return;
  const out = new Float32Array(keep.length * stride);
  keep.forEach((o, k) => out.set(src.subarray(o, o + stride), k * stride));
  world.trees = out;
}

export const flightField = {
  season: 'summer',
  ambient: 0.3,
  gpu: { bakedNoise: true },
  spawn: [4, 92, -120],

  clearGround(world) {
    world.roads.push(ACCESS_ROAD, FARM_TRACK);
    const cls = world.meta.classes.indexOf('road_minor');
    for (const road of [ACCESS_ROAD, FARM_TRACK]) paintAlong(world, road.line, road.width / 2 + 0.5, cls);
    clearTreesAlong(world, [ACCESS_ROAD, FARM_TRACK]);
  },

  createSites(world, { quality = 'high' } = {}) {
    const heightAt = ground(world);
    const byName = Object.fromEntries(OBJECTS.map((o) => [o.name, o]));
    const container = byName['blue container'];
    const lane = createLane({ world, heightAt, quality });
    const containerLane = createContainerLane({ world, heightAt, line: CONTAINER_LANE });
    const course = createCourse({ items: [...PADS, { type: 'container', x: container.x, y: container.y, headingDeg: 30, color: 0x1f5fd6 }, ...ARCH_ITEMS], heightAt });
    const cars = [
      { ...byName['red car'], headingDeg: 0, length: 4.0, rgb: [196, 22, 22] },
      { ...byName['white van'], headingDeg: 0, length: 4.49, rgb: [238, 238, 234] },
      { ...byName['yellow car'], headingDeg: 0, length: 4.3, rgb: [236, 196, 22] },
    ];
    const vehicles = createVehiclesAt({ cars, seed: 7, heightAt });
    const traffic = createTraffic({ loop: laneLoop(lane.line, lane.half / 2, 4), cars: TRAFFIC, heightAt: (x, z) => heightAt(x, z) + ROAD_TOP_M });
    const tractor = byName.tractor;
    const bales = byName['round hay bales'];
    const rural = createRuralDecor({
      tractors: [{ x: tractor.x, y: tractor.y, headingDeg: -30, kind: 'plain' }],
      bales: [[-1.4, 0], [1.4, 0], [0, 1.6], [0, -1.6]].map(([dx, dy]) => ({ x: bales.x + dx, y: bales.y + dy, headingDeg: 0, kind: 'round hay' })),
      fences: FARM.fences.map((line) => ({ kind: 'rails', line })),
      manure: FARM.manure,
    }, { heightAt, quality, seed: 5, decals: false });
    const farm = createVillage({ houses: FARM.houses, props: FARM.props, heightAt, quality, seed: 11 });
    const plates = createPlates({ world, heightAt, plates: [...FARM.plates, CLUB_PARKING] });
    const billboards = [BILLBOARD, ...CORNER_BILLBOARDS].map((b) => createBillboard({ ...b, heightAt }));
    let bench = null;
    return {
      groups: [course.group, ...lane.groups, ...containerLane.groups, vehicles, traffic.group, rural.group, farm.group, plates.group, ...billboards.map((b) => b.group)],
      addObstacles(sink) {
        course.addObstacles(sink);
        lane.addObstacles(sink);
        containerLane.addObstacles(sink);
        farm.addObstacles(sink);
        for (const b of billboards) b.addObstacles(sink);
        for (const c of cars) sink.cylinder(c.x, c.y, heightAt(c.x, -c.y) - 0.3, heightAt(c.x, -c.y) + 1.9, c.radius);
        sink.cylinder(tractor.x, tractor.y, heightAt(tractor.x, -tractor.y) - 0.3, heightAt(tractor.x, -tractor.y) + 2.8, 2.2);
        sink.cylinder(bales.x, bales.y, heightAt(bales.x, -bales.y) - 0.3, heightAt(bales.x, -bales.y) + 1.6, 2.6);
        for (const b of [...FENCE_BLOCKERS, ...MANURE_BLOCKERS]) sink.box(b.x, b.y, heightAt(b.x, -b.y) - 0.3, heightAt(b.x, -b.y) + b.height, b.w, b.d, (b.heading * 180) / Math.PI);
      },
      start(sim) {
        bench = createBench({ robotView: sim.robots, pilot: sim.policy, objects: OBJECTS, starts: STARTS, line: lane.line, laneMissions: LANE_MISSIONS });
        sim.bench = bench;
        sim.traffic = traffic;
      },
      update(camera, dt) {
        rural.update(camera);
        lane.update(camera, dt);
        if (dt > 0) traffic.update(dt);
      },
    };
  },
};
