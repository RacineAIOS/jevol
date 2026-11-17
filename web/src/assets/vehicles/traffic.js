import * as THREE from 'three/webgpu';
import { MODELS } from './data.js';
import { carGeometries, carMaterial } from './fleet.js';
import { linearRgb, poseMatrix } from './placement.js';

const STEP_M = 0.5;
const LATERAL_MPS2 = 1.6;
const ACCEL_MPS2 = 1.2;
const DIRT = 0.08;

function resample(loop) {
  const closed = [...loop, loop[0]];
  const cum = [0];
  for (let i = 1; i < closed.length; i++) cum.push(cum[i - 1] + Math.hypot(closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]));
  const total = cum.at(-1);
  const n = Math.floor(total / STEP_M);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k * total) / n;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    xs[k] = closed[j][0] + (closed[j + 1][0] - closed[j][0]) * t;
    ys[k] = closed[j][1] + (closed[j + 1][1] - closed[j][1]) * t;
  }
  return { xs, ys, n, step: total / n, length: total };
}

function timeTable({ xs, ys, n, step }, speed) {
  const look = Math.max(1, Math.round(2 / step));
  const heading = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = (k - look + n) % n;
    const b = (k + look) % n;
    heading[k] = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
  }
  const v = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const d = heading[(k + look) % n] - heading[(k - look + n) % n];
    const curvature = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / (2 * look * step);
    v[k] = Math.min(speed, Math.sqrt(LATERAL_MPS2 / Math.max(curvature, 1e-6)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k < 2 * n; k++) v[k % n] = Math.min(v[k % n], Math.sqrt(v[(k - 1) % n] ** 2 + 2 * ACCEL_MPS2 * step));
    for (let k = 2 * n - 2; k >= 0; k--) v[k % n] = Math.min(v[k % n], Math.sqrt(v[(k + 1) % n] ** 2 + 2 * ACCEL_MPS2 * step));
  }
  const time = new Float32Array(n + 1);
  for (let k = 0; k < n; k++) time[k + 1] = time[k] + (2 * step) / (v[k] + v[(k + 1) % n]);
  return time;
}

export function createTraffic({ loop, cars, heightAt, speed = 2.3 }) {
  const path = resample(loop);
  const time = timeTable(path, speed);
  const period = time[path.n];
  const keys = [...new Set(cars.map((c) => c.model))];
  const group = new THREE.Group();
  group.name = 'traffic';
  const slots = [];
  for (const key of keys) {
    const list = cars.filter((c) => c.model === key);
    const geometry = carGeometries(key).near.clone();
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
    geometry.setAttribute('aTint', tint);
    const mesh = new THREE.InstancedMesh(geometry, carMaterial(), list.length);
    mesh.name = `traffic-${key}`;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    list.forEach((car, i) => {
      tint.array.set([...linearRgb(car.rgb), DIRT], i * 4);
      const m = MODELS[key];
      slots.push({ mesh, index: i, wheelbase: m.wheelbase, track: m.W - m.tw, cursor: 0, phase: (cars.indexOf(car) * period) / cars.length });
    });
  }

  const matrix = new THREE.Matrix4();
  const forward = [1, 0];
  const point = [0, 0];
  const at = (s) => {
    const u = (((s / path.step) % path.n) + path.n) % path.n;
    const k = Math.floor(u);
    const t = u - k;
    const k1 = (k + 1) % path.n;
    point[0] = path.xs[k] + (path.xs[k1] - path.xs[k]) * t;
    point[1] = path.ys[k] + (path.ys[k1] - path.ys[k]) * t;
    return point;
  };
  const distanceAt = (slot, t) => {
    if (time[slot.cursor] > t) slot.cursor = 0;
    while (time[slot.cursor + 1] < t) slot.cursor++;
    const k = slot.cursor;
    return (k + (t - time[k]) / (time[k + 1] - time[k])) * path.step;
  };

  let clock = 0;
  function update(dt) {
    clock = (clock + dt) % period;
    for (const slot of slots) {
      const s = distanceAt(slot, (clock + slot.phase) % period);
      const [fx, fy] = at(s + slot.wheelbase / 2);
      const [bx, by] = at(s - slot.wheelbase / 2);
      const len = Math.hypot(fx - bx, fy - by) || 1;
      forward[0] = (fx - bx) / len;
      forward[1] = (fy - by) / len;
      poseMatrix((fx + bx) / 2, (fy + by) / 2, forward, slot.wheelbase, slot.track, heightAt, undefined, matrix);
      slot.mesh.setMatrixAt(slot.index, matrix);
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  update(0);

  return {
    group,
    length: path.length,
    period,
    update,
    positions: () => slots.map((slot) => {
      const s = distanceAt(slot, (clock + slot.phase) % period);
      return at(s).slice();
    }),
  };
}
