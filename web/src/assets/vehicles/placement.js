import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { MODELS } from './data.js';
import { Fleet, carGeometries } from './fleet.js';

export const linearRgb = (rgb) => {
  const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function poseMatrix(x, y, fwd, wb, tr, heightAt, scale = [1, 1, 1], out = new THREE.Matrix4()) {
  const [fx, fy] = fwd;
  const rx = fy;
  const ry = -fx;
  const h = (px, py) => heightAt(px, -py);
  const hf = [h(x + fx * wb / 2 + rx * tr / 2, y + fy * wb / 2 + ry * tr / 2), h(x + fx * wb / 2 - rx * tr / 2, y + fy * wb / 2 - ry * tr / 2)];
  const hb = [h(x - fx * wb / 2 + rx * tr / 2, y - fy * wb / 2 + ry * tr / 2), h(x - fx * wb / 2 - rx * tr / 2, y - fy * wb / 2 - ry * tr / 2)];
  const hF = (hf[0] + hf[1]) / 2;
  const hB = (hb[0] + hb[1]) / 2;
  const hR = (hf[0] + hb[0]) / 2;
  const hL = (hf[1] + hb[1]) / 2;
  const yaw = Math.atan2(fy, fx);
  _e.set(Math.atan2(hL - hR, tr), yaw, Math.atan2(hF - hB, wb), 'YZX');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, (hF + hB) / 2, -y), _q, _s.fromArray(scale));
}

export function createVehiclesAt({ cars = [], seed = 0, heightAt = () => 0 } = {}) {
  const rng = mulberry32(seed * 7919 + 23);
  const fleet = new Fleet();
  const keys = Object.keys(MODELS);
  for (const car of cars) {
    const key = keys.reduce((best, k) => (Math.abs(MODELS[k].L - car.length) < Math.abs(MODELS[best].L - car.length) ? k : best), keys[0]);
    const m = MODELS[key];
    const h = (car.headingDeg * Math.PI) / 180;
    const dir = rng() < 0.5 ? 1 : -1;
    const fwd = [Math.sin(h) * dir, Math.cos(h) * dir];
    const s = [1, 1, 1];
    const tint = [...linearRgb(car.rgb), rng() < 0.3 ? rng.range(0.4, 0.8) : rng.range(0.05, 0.35)];
    fleet.add(key, carGeometries(key), poseMatrix(car.x, car.y, fwd, m.wheelbase, m.W - m.tw, heightAt, s), tint);
  }
  const group = fleet.build('measured-vehicles');
  group.userData.count = cars.length;
  return group;
}
