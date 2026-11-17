import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../engine/rng.js';

const LOGO_URL = '/textures/racine/racine-wordmark-black.svg';
const LOGO_RATIO = 7488 / 1189;
const TAGLINE = 'Bringing AI into the physical world';

function posterTexture() {
  const W = 4096;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = (logo) => {
    g.fillStyle = '#f4f3ef';
    g.fillRect(0, 0, W, H);
    const rng = mulberry32(7);
    for (let i = 0; i < 9000; i++) {
      const v = 225 + rng() * 25;
      g.fillStyle = `rgba(${v | 0},${v | 0},${(v - 4) | 0},0.35)`;
      g.fillRect(rng() * W, rng() * H, 2, 2);
    }
    g.fillStyle = 'rgba(120,118,110,0.18)';
    for (let k = 1; k < 8; k++) g.fillRect((k * W) / 8 - 1, 0, 2, H);
    g.fillRect(0, H / 2 - 1, W, 2);
    if (logo) {
      const lw = W * 0.74;
      const lh = lw / LOGO_RATIO;
      g.drawImage(logo, (W - lw) / 2, H * 0.36 - lh / 2, lw, lh);
    }
    g.fillStyle = '#2a2a2a';
    g.font = `500 ${Math.round(H * 0.105)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TAGLINE, W / 2, H * 0.78);
    tex.needsUpdate = true;
  };
  paint(null);
  const img = new Image();
  img.onload = () => paint(img);
  img.onerror = () => console.warn('[billboard] logo not found:', LOGO_URL);
  img.src = LOGO_URL;
  return tex;
}

export const POSTER_GAP = 0.04;
export function billboardParts({ width = 30, height = 7.5, clearance = 4 } = {}) {
  const legOff = width * 0.3;
  const legSides = width > 20 ? [-1, 0, 1] : [-1, 1];
  const legW = width > 20 ? 0.8 : 0.4;
  const frameT = 0.25;
  const top = clearance + height;
  const legBack = -0.35;
  const boxes = [];
  const box = (name, sx, sy, sz, cx, cy, cz) => boxes.push({ name, size: [sx, sy, sz], at: [cx, cy, cz] });
  for (const s of legSides) {
    box(`foot ${s}`, legW, top + 0.6, legW, s * legOff, (top + 0.6) / 2 - 0.6, legBack - legW / 2);
    const zs = legBack, ze = -frameT / 2 - POSTER_GAP - 0.03;
    box(`leg ${s}`, 0.16, 0.16, zs - ze < 0 ? ze - zs : 0.01, s * legOff, clearance + height * 0.55, (zs + ze) / 2);
  }
  box('housing', width + 0.3, height + 0.3, frameT, 0, clearance + height / 2, 0);
  box('front walkway', width, 0.05, 0.8, 0, clearance - 0.25, frameT / 2 + 0.45);
  box('back walkway', width, 0.05, 0.8, 0, clearance - 0.25, -frameT / 2 - 0.45);
  for (const sz of [-1, 1]) for (const k of [-1, 0, 1]) box(`post ${sz} ${k}`, 0.04, 1.0, 0.04, k * (width / 2 - 0.3), clearance + 0.275, sz * 0.93);
  for (const sz of [-1, 1]) box(`smooth ${sz}`, width, 0.04, 0.04, 0, clearance + 0.79, sz * 0.955);
  const posters = [
    { name: 'front poster', at: [0, clearance + height / 2, frameT / 2 + POSTER_GAP], normal: [0, 0, 1], size: [width, height] },
    { name: 'back poster', at: [0, clearance + height / 2, -frameT / 2 - POSTER_GAP], normal: [0, 0, -1], size: [width, height] },
  ];
  return { boxes, posters, legOff, legSides, legW, frameT };
}

export function createBillboard({ x, y, normalDeg = -90, heightAt, width = 30, height = 7.5, clearance = 4 }) {
  const th = (normalDeg * Math.PI) / 180;
  const n = [Math.cos(th), Math.sin(th)];
  const u = [-n[1], n[0]];
  const { legOff, legSides, legW } = billboardParts({ width, height, clearance });
  const legs = legSides.map((s) => [x + u[0] * s * legOff, y + u[1] * s * legOff]);
  const base = Math.min(heightAt(x, -y), ...legs.map(([lx, ly]) => heightAt(lx, -ly)));
  const top = clearance + height;

  const parts = billboardParts({ width, height, clearance });
  const steel = parts.boxes.map((b) => new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]).translate(b.at[0], b.at[1], b.at[2]));
  const steelGeo = mergeGeometries(steel, false);
  steel.forEach((s) => s.dispose());

  const tex = posterTexture();
  const [pf, pb] = parts.posters;
  const front = new THREE.PlaneGeometry(width, height).translate(pf.at[0], pf.at[1], pf.at[2]);
  const back = new THREE.PlaneGeometry(width, height).rotateY(Math.PI).translate(pb.at[0], pb.at[1], pb.at[2]);
  const posterGeo = mergeGeometries([front, back], false);
  front.dispose();
  back.dispose();

  const group = new THREE.Group();
  group.name = 'panel-racine';
  const steelMesh = new THREE.Mesh(steelGeo, new THREE.MeshStandardNodeMaterial({ color: 0x5d6166, roughness: 0.55, metalness: 0.6 }));
  steelMesh.name = 'panel-steel';
  const posterMesh = new THREE.Mesh(posterGeo, new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.75, metalness: 0 }));
  posterMesh.name = 'panel-poster';
  group.add(steelMesh, posterMesh);
  group.rotation.y = Math.atan2(n[0], -n[1]);
  group.position.set(x, base, -y);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const axisDeg = normalDeg + 90;
  return {
    group,
    addObstacles(sink) {
      for (const [lx, ly] of legs) sink.box(lx - n[0] * (0.35 + legW / 2), ly - n[1] * (0.35 + legW / 2), base - 0.3, base + top + 0.1, legW + 0.05, legW + 0.05, axisDeg);
      sink.box(x, y, base + clearance - 0.25, base + top + 0.2, width + 0.4, 2.2, axisDeg);
    },
    info: () => `panel ${width} x ${height} m, poster bottom at ${clearance} m`,
  };
}
