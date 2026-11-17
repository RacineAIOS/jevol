import * as THREE from 'three/webgpu';
import { Batch, mesh, countTriangles } from './util.js';
import { mulberry32 } from '../../engine/rng.js';

const PALETTES = [
  { w: 0.42, mast: [0.6, 0.61, 0.62], name: 'galvanized' },
  { w: 0.36, mast: [0.8, 0.81, 0.8], name: 'light grey' },
  { w: 0.14, mast: [0.2, 0.21, 0.22], name: 'anthracite grey' },
  { w: 0.08, mast: [0.28, 0.35, 0.3], name: 'grey green' },
];

const v = (x, y, z) => new THREE.Vector3(x, y, z);

function addLamp(b, rnd, { x, z, ground, ux, uz, model, height, palette, sides }) {
  const mastBatch = b.mast(palette.mast);
  const P = (dx, y, dz = 0) => v(x + ux * dx - uz * dz, ground + y, z + uz * dx + ux * dz);
  const yaw = Math.atan2(ux, uz);
  const r0 = rnd.range(0.075, 0.1);
  const r1 = rnd.range(0.045, 0.058);
  const mastSides = sides;
  mastBatch.bar(v(x, ground, z), v(x, ground + height, z), r0, r1, mastSides, true);
  mastBatch.bar(v(x, ground, z), v(x, ground + 0.45, z), r0 + 0.03, r0 + 0.012, mastSides);
  const head = b.head;
  const lens = b.lens;

  const cobra = (dir, reach, rise, len, wid) => {
    const top = height - 0.15;
    const a = P(0, top);
    const e = P(dir * reach, top + rise);
    mastBatch.bar(a, e, 0.04, 0.032, 6);
    const cx = x + ux * dir * (reach + len * 0.3);
    const cz = z + uz * dir * (reach + len * 0.3);
    const cy = ground + top + rise + 0.03;
    head.box(cx, cy, cz, wid, 0.16, len, yaw);
    head.box(cx + ux * dir * len * 0.05, cy + 0.1, cz + uz * dir * len * 0.05, wid * 0.7, 0.07, len * 0.7, yaw);
    lens.box(cx, cy - 0.085, cz, wid * 0.8, 0.02, len * 0.85, yaw);
  };

  switch (model) {
    case 'cobra':
      cobra(1, rnd.range(1.1, 1.6), rnd.range(0.25, 0.45), 0.8, 0.32);
      break;
    case 'led': {
      cobra(1, rnd.range(0.8, 1.2), rnd.range(0.15, 0.3), rnd.range(0.95, 1.2), 0.3);
      break;
    }
    case 'bracket': {
      const R = rnd.range(1.0, 1.4);
      const top = height - 0.9;
      let prev = P(0, top);
      for (let i = 1; i <= 8; i++) {
        const t = (i / 8) * (Math.PI / 2);
        const p = P(R * (1 - Math.cos(t)), top + R * Math.sin(t) * 0.9);
        mastBatch.bar(prev, p, 0.045 - i * 0.002, 0.045 - (i + 1) * 0.002, 6);
        prev = p;
      }
      const tip = prev;
      head.bar(v(tip.x - ux * 0.05, tip.y - 0.12, tip.z - uz * 0.05), v(tip.x + ux * 0.6, tip.y - 0.12, tip.z + uz * 0.6), 0.14, 0.14, 8, true);
      lens.bar(v(tip.x + ux * 0.1, tip.y - 0.24, tip.z + uz * 0.1), v(tip.x + ux * 0.5, tip.y - 0.24, tip.z + uz * 0.5), 0.09, 0.09, 6, true);
      break;
    }
    case 'double': {
      const reach = rnd.range(1.0, 1.4);
      cobra(1, reach, 0.3, 0.8, 0.32);
      cobra(-1, reach, 0.3, 0.8, 0.32);
      break;
    }
    case 'floodlights': {
      const top = height;
      mastBatch.bar(P(0, top - 0.3, -1.2), P(0, top - 0.3, 1.2), 0.04, 0.04, 6);
      for (const k of [-0.85, 0, 0.85]) {
        const c = P(0.3, top - 0.5, k);
        head.box(c.x, c.y, c.z, 0.5, 0.18, 0.4, yaw);
        const l = P(0.58, top - 0.58, k);
        lens.box(l.x, l.y, l.z, 0.04, 0.16, 0.34, yaw);
      }
      break;
    }
    case 'lantern':
    default: {
      const c = P(0, height);
      head.bar(v(c.x, c.y, c.z), v(c.x, c.y + 0.06, c.z), 0.3, 0.3, 10, true);
      head.bar(v(c.x, c.y + 0.06, c.z), v(c.x, c.y + 0.28, c.z), 0.3, 0.08, 10, true);
      lens.bar(v(c.x, c.y - 0.34, c.z), v(c.x, c.y, c.z), 0.2, 0.26, 10, true);
      break;
    }
  }
}

function pickPalette(rnd) {
  let r = rnd() * PALETTES.reduce((s, p) => s + p.w, 0);
  for (const p of PALETTES) {
    r -= p.w;
    if (r <= 0) return p;
  }
  return PALETTES[0];
}

const HEIGHT = {
  cobra: [8.5, 10], led: [8.5, 10], bracket: [6.5, 8.5], double: [9, 10.5], floodlights: [13, 17], lantern: [3.8, 5],
};

function along(line, spacing, start, rnd, jitter) {
  const out = [];
  let s = 0;
  let next = start;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 1e-6) continue;
    const ux = (bx - ax) / d;
    const uy = (by - ay) / d;
    while (next <= s + d) {
      const t = next - s;
      out.push({ x: ax + ux * t, y: ay + uy * t, ux, uy });
      next += spacing * (1 + jitter * (rnd() * 2 - 1));
    }
    s += d;
  }
  return out;
}

export function createStreetLamps({ lines = [], points = [], seed = 0, heightAt = () => 0, quality = 'high' }) {
  const rnd = mulberry32(seed + 31);
  const sides = quality === 'low' ? 6 : 8;
  const masts = new Map();
  const batches = {
    mast: (c) => {
      const k = c.join(',');
      if (!masts.has(k)) masts.set(k, { color: c, batch: new Batch() });
      return masts.get(k).batch;
    },
    head: new Batch(),
    lens: new Batch(),
  };
  let count = 0;
  const placed = [];
  const place = ({ x, y, dirX, dirY, model, height }) => {
    const m = model ?? rnd.pick(['cobra', 'cobra', 'led', 'bracket']);
    const [h0, h1] = HEIGHT[m];
    const H = height ?? rnd.range(h0, h1);
    addLamp(batches, rnd, { x, z: -y, ground: heightAt(x, -y), ux: dirX, uz: -dirY, model: m, height: H, palette: pickPalette(rnd), sides });
    count++;
    placed.push({ x: +x.toFixed(2), y: +y.toFixed(2), model: m, height: +H.toFixed(2) });
  };

  for (const L of lines) {
    const line = L.line;
    const spacing = L.spacing ?? 36;
    const offset = L.offset ?? (L.width ? L.width / 2 + 1.5 : 5);
    const models = Array.isArray(L.model) ? L.model : L.model ? [L.model] : null;
    const modelOf = () => (models ? rnd.pick(models) : undefined);
    const spots = along(line, spacing, L.start ?? spacing / 2, rnd, L.jitter ?? 0.04);
    spots.forEach((s, i) => {
      const left = { x: -s.uy, y: s.ux };
      const which = L.side ?? 'right';
      const list = which === 'both' ? [1, -1] : which === 'alternate' ? [i % 2 ? 1 : -1] : [which === 'left' ? 1 : -1];
      for (const k of list) {
        place({ x: s.x + left.x * k * offset, y: s.y + left.y * k * offset, dirX: -left.x * k, dirY: -left.y * k, model: modelOf(), height: L.height });
      }
    });
  }
  for (const P of points) {
    const hd = ((P.heading ?? rnd() * 360) * Math.PI) / 180;
    place({ x: P.x, y: P.y, dirX: Math.sin(hd), dirY: Math.cos(hd), model: P.model, height: P.height });
  }

  const group = new THREE.Group();
  group.name = 'street-lamps';
  const std = (o) => new THREE.MeshStandardNodeMaterial(o);
  for (const { color, batch } of masts.values()) {
    const g = batch.build();
    if (g.attributes.position) group.add(mesh(g, std({ color: new THREE.Color(...color), roughness: 0.5, metalness: 0.45 }), { name: 'lamp-poles' }));
  }
  const gh = batches.head.build();
  if (gh.attributes.position) group.add(mesh(gh, std({ color: new THREE.Color(0.5, 0.52, 0.53), roughness: 0.45, metalness: 0.5 }), { name: 'lamp-heads' }));
  const gl = batches.lens.build();
  if (gl.attributes.position) group.add(mesh(gl, std({ color: new THREE.Color(0.72, 0.76, 0.76), roughness: 0.15, metalness: 0.1 }), { name: 'lamp-glass', noShadow: true }));
  group.userData.stats = { count };
  group.userData.lamps = placed;
  return { group, update() {}, info: () => `street lamps: ${count}, ${countTriangles(group)} triangles`, count };
}
