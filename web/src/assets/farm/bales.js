import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { frameAt } from './solids.js';
import { roundBaleMaterial, wrappedBaleMaterial, squareBaleMaterial } from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const R_MODEL = 0.66;
const W_MODEL = 1.2;
export const SMALL = { l: 0.91, h: 0.36, d: 0.46 };
export const BIG = { l: 2.4, h: 0.9, d: 1.2 };

const HAY_TINTS = [[0.72, 1.06, 0.62], [0.92, 1.0, 0.7], [1.08, 1.0, 0.8], [1.0, 0.92, 0.78], [0.8, 0.8, 0.72]];
const STRAW_TINTS = [[1.35, 1.3, 1.15], [1.22, 1.2, 1.1], [1.1, 1.0, 0.85], [0.98, 0.93, 0.82]];
const FILMS = [[0.7, 0.7, 0.68], [0.05, 0.2, 0.07], [0.025, 0.025, 0.027], [0.16, 0.38, 0.1], [0.5, 0.48, 0.48]];

function roundGeometry(quality) {
  const seg = quality === 'low' ? 14 : 24;
  const R = R_MODEL;
  const h = W_MODEL / 2;
  const profile = [[0, -h], [R - 0.06, -h], [R - 0.015, -h + 0.04], [R, -h + 0.14], [R + 0.004, 0], [R, h - 0.14], [R - 0.015, h - 0.04], [R - 0.06, h], [0, h]];
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.rotateZ(-Math.PI / 2);
  return g;
}

const kindOf = (kind, rng) => {
  const k = String(kind ?? '').toLowerCase();
  let shape;
  if (/wrap|silage/.test(k)) shape = 'wrapped';
  else if (/big|prism|large/.test(k)) shape = 'big';
  else if (/square|small/.test(k)) shape = 'small';
  else if (/round/.test(k)) shape = 'round';
  else {
    const r = rng();
    shape = r < 0.42 ? 'round' : r < 0.62 ? 'wrapped' : r < 0.84 ? 'small' : 'big';
  }
  const straw = /straw/.test(k) ? true : /hay/.test(k) ? false : rng() < 0.4;
  return { shape, straw };
};

export function createBales(list, { heightAt, quality = 'high', seed = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'rural-bales';
  const blobs = [];
  const points = [];
  const sets = { round: [], wrapped: [], small: [], big: [] };
  let count = 0;

  const put = (set, wx, wy, wz, quat, scale, rgb) => {
    sets[set].push({ p: new THREE.Vector3(wx, wy, wz), q: quat, s: scale, c: new THREE.Color(rgb[0], rgb[1], rgb[2]) });
    count++;
  };

  (list ?? []).forEach((b, i) => {
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return;
    const rng = mulberry32((seed * 7919 + i * 104729 + 17) >>> 0);
    const { shape, straw } = kindOf(b.kind, rng);
    const heading = Number.isFinite(b.headingDeg) ? b.headingDeg : rng() * 360;
    const f = frameAt(b.x, b.y, heading, heightAt);
    const tints = straw ? STRAW_TINTS : HAY_TINTS;
    const lotTint = tints[Math.floor(rng() * tints.length)];
    const tint = () => lotTint.map((v) => v * (0.94 + rng() * 0.12));
    const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(UP, f.yaw + a);
    const ground = (u, w) => f.h(u, w);
    const levels = Math.max(1, Math.min(4, Math.round(b.levels ?? 0))) || 0;
    points.push([b.x, -b.y]);

    if (shape === 'round' || shape === 'wrapped') {
      const wrapped = shape === 'wrapped';
      const dia = wrapped ? 1.2 + rng() * 0.1 : [1.25, 1.4, 1.5, 1.7][Math.floor(rng() * 4)];
      const width = wrapped ? 1.2 : rng() < 0.7 ? 1.2 : 1.5;
      const R = dia / 2;
      const sc = new THREE.Vector3(width / W_MODEL, R / R_MODEL, R / R_MODEL);
      const set = wrapped ? 'wrapped' : 'round';
      const film = FILMS[Math.floor(rng() * FILMS.length)];
      const col = () => (wrapped ? film : tint());
      const standing = wrapped && rng() < 0.35;
      const stackLevels = b.levels === undefined ? (rng() < 0.22 ? 2 : 1) : levels;
      if (standing) {
        const n = stackLevels > 1 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const [wx, wz] = f.world(0, 0);
          const q = yawQ(rng() * 6).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
          put(set, wx, ground(0, 0) + width / 2 + k * width - 0.02, wz, q, new THREE.Vector3(R / R_MODEL, width / W_MODEL, R / R_MODEL), col());
        }
        blobs.push({ x: b.x, y: b.y, length: dia + 0.6, width: dia + 0.6, headingDeg: heading, strength: 0.2 });
      } else if (stackLevels >= 2) {
        for (const w of [-R, R]) {
          const [wx, wz] = f.world(0, w);
          put(set, wx, ground(0, w) + R * 0.97, wz, yawQ(0), sc, col());
        }
        const [tx, tz] = f.world(0, 0);
        const top = stackLevels >= 3 || rng() < 0.7;
        if (top) put(set, tx, ground(0, 0) + R * 0.97 + R * 1.64, tz, yawQ(0.02), sc, col());
        blobs.push({ x: b.x, y: b.y, length: width + 0.8, width: 4 * R + 0.4, headingDeg: heading, strength: 0.25 });
      } else {
        const [wx, wz] = f.world(0, 0);
        put(set, wx, ground(0, 0) + R * 0.97, wz, yawQ(0), sc, col());
        blobs.push({ x: b.x, y: b.y, length: width + 0.5, width: dia + 0.4, headingDeg: heading, strength: 0.15 });
      }
      return;
    }

    const big = shape === 'big';
    const dim = big ? BIG : SMALL;
    const depth = big ? [0.9, 1.2][Math.floor(rng() * 2)] : dim.d;
    const set = big ? 'big' : 'small';
    const base = b.levels === undefined ? (rng() < 0.6 ? 1 + Math.floor(rng() * 3) : 1) : levels;
    const wallBase = base <= 1 ? 1 : base;
    const alongN = big ? 1 : 2 + Math.floor(rng() * 2);
    const sc = new THREE.Vector3(1, 1, depth / dim.d);
    for (let L = 0; L < wallBase; L++) {
      const cols = wallBase - L;
      for (let c = 0; c < cols; c++) {
        for (let a = 0; a < alongN; a++) {
          const u = (a - (alongN - 1) / 2) * (dim.l + 0.01) + (L % 2) * 0.3 * (big ? 0 : 1) + (rng() - 0.5) * 0.04;
          const w = (c - (cols - 1) / 2) * (depth + 0.01) + (rng() - 0.5) * 0.04;
          const [wx, wz] = f.world(u, w);
          const y = ground(0, 0) + dim.h / 2 + L * dim.h - 0.01;
          put(set, wx, y, wz, yawQ((rng() - 0.5) * 0.06), sc.clone(), tint());
        }
      }
    }
    blobs.push({ x: b.x, y: b.y, length: alongN * dim.l + 0.6, width: wallBase * depth + 0.6, headingDeg: heading, strength: wallBase > 1 ? 0.3 : 0.15 });
  });

  const defs = {
    round: () => [new THREE.Mesh(roundGeometry(quality), roundBaleMaterial()), 'round'],
    wrapped: () => [new THREE.Mesh(roundGeometry(quality), wrappedBaleMaterial()), 'wrapped'],
    small: () => [new THREE.Mesh(new THREE.BoxGeometry(SMALL.l, SMALL.h, SMALL.d), squareBaleMaterial({ length: SMALL.l, height: SMALL.h, depth: SMALL.d, ties: [-0.24, 0.24], flake: 0.11 })), 'small'],
    big: () => [new THREE.Mesh(new THREE.BoxGeometry(BIG.l, BIG.h, BIG.d), squareBaleMaterial({ length: BIG.l, height: BIG.h, depth: BIG.d, ties: [-0.85, -0.3, 0.3, 0.85], flake: 0.2 })), 'big'],
  };
  const m4 = new THREE.Matrix4();
  for (const [name, items] of Object.entries(sets)) {
    if (!items.length) continue;
    const [base] = defs[name]();
    const im = new THREE.InstancedMesh(base.geometry, base.material, items.length);
    items.forEach((it, k) => {
      m4.compose(it.p, it.q, it.s);
      im.setMatrixAt(k, m4);
      im.setColorAt(k, it.c);
    });
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = `bales-${name}`;
    group.add(im);
  }
  return { group, blobs, points, count };
}
