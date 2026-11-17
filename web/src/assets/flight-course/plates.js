import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';

const PX = 32;
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function toTexture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function parkingTexture(p, rng) {
  const W = Math.round(p.w * PX);
  const H = Math.round(p.d * PX);
  const [c, g] = canvasOf(W, H);
  g.fillStyle = rgb(92, 92, 90);
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H * 0.04; i++) {
    const v = 70 + rng() * 55;
    g.fillStyle = rgb(v, v, v * 0.98, 0.6);
    g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  for (let i = 0; i < 10; i++) {
    g.fillStyle = rgb(60, 60, 60, 0.25);
    g.fillRect(rng() * W, rng() * H, (2 + rng() * 5) * PX, (1 + rng() * 2) * PX);
  }
  const b = p.bays;
  if (b) {
    const lw = 0.12 * PX;
    const line = (x0, y0, x1, y1) => {
      g.fillStyle = rgb(232, 232, 226, 0.88);
      g.fillRect(Math.min(x0, x1) * PX - lw / 2, (p.d - Math.max(y0, y1)) * PX - lw / 2, Math.abs(x1 - x0) * PX + lw, Math.abs(y1 - y0) * PX + lw);
    };
    for (const row of b.rows) {
      for (let k = 0; k <= b.count; k++) line(b.u0 + k * b.width, row.v0, b.u0 + k * b.width, row.v1);
      line(b.u0, row.back, b.u0 + b.count * b.width, row.back);
      for (let k = 0; k < b.count; k++) {
        if (rng() < 0.5) continue;
        const cx = (b.u0 + (k + 0.5) * b.width) * PX;
        const cy = (p.d - (row.v0 + row.v1) / 2 + (rng() - 0.5)) * PX;
        for (let j = 0; j < 14; j++) {
          g.fillStyle = rgb(45, 45, 42, 0.05 + rng() * 0.06);
          g.beginPath();
          g.ellipse(cx + (rng() - 0.5) * 0.6 * PX, cy + (rng() - 0.5) * 1.2 * PX, (0.1 + rng() * 0.25) * PX, (0.1 + rng() * 0.35) * PX, rng() * 3, 0, 6.3);
          g.fill();
        }
      }
    }
    for (let i = 0; i < W * H * 0.004; i++) {
      g.fillStyle = rgb(92, 92, 90, 0.7);
      g.fillRect(rng() * W, rng() * H, 2 + rng() * 3, 2 + rng() * 3);
    }
  }
  g.strokeStyle = rgb(96, 88, 70, 0.6);
  g.lineWidth = 0.3 * PX;
  g.strokeRect(0, 0, W, H);
  return toTexture(c, false);
}

function gravelTexture(rng) {
  const S = 512;
  const [c, g] = canvasOf(S, S);
  g.fillStyle = rgb(128, 116, 96);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = rgb(92, 80, 62, 0.25);
    g.beginPath();
    g.ellipse(rng() * S, rng() * S, 30 + rng() * 80, 20 + rng() * 50, rng() * 3, 0, 6.3);
    g.fill();
  }
  for (let i = 0; i < 26000; i++) {
    const v = rng();
    g.fillStyle = rgb(110 + v * 90, 102 + v * 80, 86 + v * 70, 0.9);
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  for (let i = 0; i < 260; i++) {
    const v = 150 + rng() * 70;
    g.fillStyle = rgb(v, v * 0.95, v * 0.88);
    g.beginPath();
    g.ellipse(rng() * S, rng() * S, 1.5 + rng() * 2.5, 1 + rng() * 2, rng() * 3, 0, 6.3);
    g.fill();
  }
  const t = toTexture(c, true);
  t.userData.tile = 8;
  return t;
}

function concreteTexture(rng) {
  const S = 512;
  const [c, g] = canvasOf(S, S);
  g.fillStyle = rgb(170, 168, 160);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 16000; i++) {
    const v = 140 + rng() * 60;
    g.fillStyle = rgb(v, v, v * 0.97, 0.5);
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
  for (let i = 0; i < 8; i++) {
    g.fillStyle = rgb(90, 84, 70, 0.12 + rng() * 0.1);
    g.beginPath();
    g.ellipse(rng() * S, rng() * S, 20 + rng() * 60, 10 + rng() * 40, rng() * 3, 0, 6.3);
    g.fill();
  }
  g.fillStyle = rgb(70, 70, 66, 0.8);
  for (const v of [0, S / 2]) { g.fillRect(v, 0, 3, S); g.fillRect(0, v, S, 3); }
  const t = toTexture(c, true);
  t.userData.tile = 6;
  return t;
}

function plateGeometry(p, heightAt, lift) {
  const h = (p.headingDeg * Math.PI) / 180;
  const ux = [Math.cos(h), Math.sin(h)];
  const vx = [-Math.sin(h), Math.cos(h)];
  const nu = Math.max(1, Math.ceil(p.w));
  const nv = Math.max(1, Math.ceil(p.d));
  const tile = p.tile ?? 0;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const lu = (i / nu) * p.w;
      const lv = (j / nv) * p.d;
      const x = p.x + ux[0] * (lu - p.w / 2) + vx[0] * (lv - p.d / 2);
      const y = p.y + ux[1] * (lu - p.w / 2) + vx[1] * (lv - p.d / 2);
      pos.push(x, heightAt(x, -y) + lift, -y);
      uv.push(tile ? lu / tile : lu / p.w, tile ? lv / tile : lv / p.d);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function paintClass(world, p, cls) {
  const ci = world.meta.classes.indexOf(cls);
  if (ci < 0) return;
  const { size, half } = world;
  const h = (p.headingDeg * Math.PI) / 180;
  const r = Math.hypot(p.w, p.d) / 2 + 1;
  for (let y = Math.floor(p.y - r); y <= p.y + r; y++) {
    for (let x = Math.floor(p.x - r); x <= p.x + r; x++) {
      const dx = x - p.x;
      const dy = y - p.y;
      const lu = dx * Math.cos(h) + dy * Math.sin(h);
      const lv = -dx * Math.sin(h) + dy * Math.cos(h);
      if (Math.abs(lu) > p.w / 2 + 0.5 || Math.abs(lv) > p.d / 2 + 0.5) continue;
      const row = Math.round(-y + half);
      const col = Math.round(x + half);
      if (row >= 0 && row < size && col >= 0 && col < size) world.classes[row * size + col] = ci;
    }
  }
}

const CLASS = { parking: 'paved', gravel: 'bare', concrete: 'paved' };
const LIFT = { parking: 0.06, gravel: 0.045, concrete: 0.075 };

export function createPlates({ world, heightAt, plates }) {
  const group = new THREE.Group();
  group.name = 'farm-surfaces';
  const rng = mulberry32(17);
  let gravel = null;
  let concrete = null;
  world.surface?.addQuiet?.(plates.map((p) => ({ x: p.x, y: p.y, r: Math.hypot(p.w, p.d) / 2 })));
  for (const p of plates) {
    let map;
    if (p.kind === 'parking') map = parkingTexture(p, rng);
    else if (p.kind === 'gravel') map = gravel ??= gravelTexture(rng);
    else map = concrete ??= concreteTexture(rng);
    const geo = plateGeometry({ ...p, tile: map.userData.tile ?? 0 }, heightAt, LIFT[p.kind]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ map, roughness: p.kind === 'parking' ? 0.9 : 0.97, metalness: 0 }));
    mesh.name = `surface-${p.kind}`;
    mesh.receiveShadow = true;
    mesh.userData.noShadow = true;
    group.add(mesh);
    paintClass(world, p, CLASS[p.kind]);
  }
  if (world.classTex) world.classTex.needsUpdate = true;
  return { group, info: () => `${plates.length} ground surfaces` };
}
