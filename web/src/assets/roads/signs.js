import * as THREE from 'three/webgpu';

const CELL = 256;
const ATLAS = 1024;

export const FACES = {
  B14_50: { cell: 0, shape: 'disc' }, B14_70: { cell: 1, shape: 'disc' }, B14_80: { cell: 2, shape: 'disc' },
  B14_90: { cell: 3, shape: 'disc' }, B14_110: { cell: 4, shape: 'disc' }, B14_30: { cell: 14, shape: 'disc' },
  A1a: { cell: 5, shape: 'tri' }, A1c: { cell: 6, shape: 'tri' },
  AB1: { cell: 7, shape: 'tri' }, AB2: { cell: 8, shape: 'tri' }, AB3a: { cell: 9, shape: 'triDown' },
  AB4: { cell: 10, shape: 'oct' }, AB6: { cell: 11, shape: 'diamond' },
  M2_150: { cell: 12, sub: 0, shape: 'panel' }, M2_300: { cell: 12, sub: 1, shape: 'panel' }, M2_500: { cell: 12, sub: 2, shape: 'panel' },
};
const BACK = 13;

export const GAMMA = {
  normal: { tri: 1.0, disc: 0.85, oct: 0.8, diamond: 0.7, panel: 0.85 },
  small: { tri: 0.7, disc: 0.65, oct: 0.6, diamond: 0.5, panel: 0.65 },
};

const SHAPE_BOX = { tri: [1, 0.866], triDown: [1, 0.866], disc: [1, 1], oct: [1, 1], diamond: [1, 1], panel: [1, 0.294] };

function cellRect(face) {
  const f = FACES[face];
  const col = f.cell % 4;
  const row = Math.floor(f.cell / 4);
  if (f.shape === 'panel') return { x: col * CELL, y: row * CELL + f.sub * 85, w: CELL, h: 75 };
  return { x: col * CELL, y: row * CELL, w: CELL, h: CELL };
}

let atlasTexture = null;

export function signAtlas() {
  if (atlasTexture) return atlasTexture;
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8c9094';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  const bx = (BACK % 4) * CELL;
  const by = Math.floor(BACK / 4) * CELL;
  const g = ctx.createLinearGradient(bx, by, bx + CELL, by + CELL);
  g.addColorStop(0, '#9a9ea2');
  g.addColorStop(1, '#85898d');
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, CELL, CELL);
  for (const face of Object.keys(FACES)) drawFace(ctx, face);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture = tex;
  return tex;
}

const RED = '#b3121a';
const BLACK = '#141414';

function polyPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function roundedFill(ctx, pts, color, radius) {
  polyPath(ctx, pts);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function begin(ctx, face) {
  const r = cellRect(face);
  const [bw, bh] = SHAPE_BOX[FACES[face].shape];
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.translate(r.x + r.w / 2, r.y + r.h);
  ctx.scale(r.w / bw, -r.h / bh);
  return { r, bw, bh };
}

const triPts = (k, cy = 0.2887) => [[-0.5, 0], [0.5, 0], [0, 0.866]].map(([x, y]) => [x * k + 0, cy + (y - cy) * k]);

function triangleSign(ctx, face, drawIcon, down = false) {
  const { bh } = begin(ctx, face);
  if (down) {
    ctx.translate(0, bh);
    ctx.scale(1, -1);
  }
  const R = 0.035;
  roundedFill(ctx, triPts(0.985), '#f4f4f0', R * 0.6);
  roundedFill(ctx, triPts(0.955), RED, R * 0.5);
  roundedFill(ctx, triPts(0.955 - 0.31), '#fbfbf8', R * 0.2);
  if (drawIcon) {
    if (down) {
      ctx.scale(1, -1);
      ctx.translate(0, -bh);
    }
    drawIcon(ctx);
  }
  ctx.restore();
}

function arrowHead(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.75);
  ctx.lineTo(-size * 0.6, -size * 0.75);
  ctx.closePath();
  ctx.fillStyle = BLACK;
  ctx.fill();
  ctx.restore();
}

function bentArrow(ctx, mirror = 1) {
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.062;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(-0.08 * mirror, 0.14);
  ctx.lineTo(-0.08 * mirror, 0.3);
  ctx.quadraticCurveTo(-0.08 * mirror, 0.455, 0.05 * mirror, 0.455);
  ctx.lineTo(0.1 * mirror, 0.455);
  ctx.stroke();
  arrowHead(ctx, 0.14 * mirror, 0.455, mirror > 0 ? 0 : Math.PI, 0.075);
}

function sArrow(ctx) {
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.055;
  ctx.beginPath();
  ctx.moveTo(-0.05, 0.13);
  ctx.lineTo(-0.05, 0.22);
  ctx.quadraticCurveTo(-0.05, 0.3, 0.04, 0.3);
  ctx.quadraticCurveTo(0.13, 0.3, 0.13, 0.36);
  ctx.lineTo(0.13, 0.4);
  ctx.stroke();
  arrowHead(ctx, 0.13, 0.46, Math.PI / 2, 0.07);
  ctx.beginPath();
  ctx.moveTo(-0.17, 0.18);
  ctx.stroke();
}

function drawFace(ctx, face) {
  const f = FACES[face];
  if (face === 'A1a') triangleSign(ctx, face, (c) => bentArrow(c, 1));
  else if (face === 'A1c') triangleSign(ctx, face, sArrow);
  else if (face === 'AB1') {
    triangleSign(ctx, face, (c) => {
      c.fillStyle = BLACK;
      c.fillRect(-0.03, 0.1, 0.06, 0.4);
      c.fillRect(-0.2, 0.26, 0.4, 0.06);
    });
  } else if (face === 'AB2') {
    triangleSign(ctx, face, (c) => {
      c.fillStyle = BLACK;
      c.fillRect(-0.04, 0.1, 0.08, 0.3);
      arrowHead(c, 0, 0.44, Math.PI / 2, 0.1);
      c.fillRect(-0.2, 0.2, 0.16, 0.035);
      c.fillRect(0.04, 0.2, 0.16, 0.035);
    });
  } else if (face === 'AB3a') triangleSign(ctx, face, null, true);
  else if (f.shape === 'disc') {
    const { r } = begin(ctx, face);
    ctx.fillStyle = '#f4f4f0';
    ctx.beginPath();
    ctx.arc(0, 0.5, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(0, 0.5, 0.488, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbfbf8';
    ctx.beginPath();
    ctx.arc(0, 0.5, 0.488 - 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = BLACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = face.split('_')[1];
    const size = label.length > 2 ? 0.34 * r.w : 0.46 * r.w;
    ctx.font = `bold ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + size * 0.04);
    ctx.restore();
  } else if (face === 'AB4') {
    const { r } = begin(ctx, face);
    const oct = (k) => Array.from({ length: 8 }, (_, i) => {
      const a = (i + 0.5) * (Math.PI / 4);
      return [Math.cos(a) * 0.5 * k / Math.cos(Math.PI / 8), 0.5 + Math.sin(a) * 0.5 * k / Math.cos(Math.PI / 8)];
    });
    roundedFill(ctx, oct(1), '#f4f4f0', 0.004);
    roundedFill(ctx, oct(0.975), RED, 0.004);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#f7f7f4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${0.34 * r.w}px Arial, Helvetica, sans-serif`;
    ctx.fillText('STOP', r.x + r.w / 2, r.y + r.h / 2 + 4);
    ctx.strokeStyle = '#f7f7f4';
    ctx.lineWidth = 0.012 * r.w;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * (Math.PI / 4);
      const px = r.x + r.w / 2 + Math.cos(a) * 0.5 * 0.9 / Math.cos(Math.PI / 8) * r.w;
      const py = r.y + r.h / 2 - Math.sin(a) * 0.5 * 0.9 / Math.cos(Math.PI / 8) * r.h;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  } else if (face === 'AB6') {
    const { r } = begin(ctx, face);
    const dia = (k) => [[0, 0.5 - 0.5 * k], [0.5 * k, 0.5], [0, 0.5 + 0.5 * k], [-0.5 * k, 0.5]];
    roundedFill(ctx, dia(1), '#f4f4f0', 0.01);
    roundedFill(ctx, dia(0.96), BLACK, 0.01);
    roundedFill(ctx, dia(0.9), '#f4f4f0', 0.005);
    roundedFill(ctx, dia(0.75), '#e8b717', 0.005);
    ctx.restore();
    void r;
  } else if (f.shape === 'panel') {
    const r = cellRect(face);
    ctx.save();
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 5;
    ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
    ctx.fillStyle = BLACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 50px "Arial Narrow", Arial, Helvetica, sans-serif';
    ctx.fillText(face.split('_')[1] + ' m', r.x + r.w / 2, r.y + r.h / 2 + 3);
    ctx.restore();
  }
}

function outline(shape) {
  switch (shape) {
    case 'tri': return [[-0.5, 0], [0.5, 0], [0, 0.866]];
    case 'triDown': return [[-0.5, 0.866], [0, 0], [0.5, 0.866]];
    case 'disc': return Array.from({ length: 28 }, (_, i) => [Math.cos((i / 28) * Math.PI * 2) * 0.5, 0.5 + Math.sin((i / 28) * Math.PI * 2) * 0.5]);
    case 'oct': return Array.from({ length: 8 }, (_, i) => [Math.cos((i + 0.5) * Math.PI / 4) * 0.5 / Math.cos(Math.PI / 8), 0.5 + Math.sin((i + 0.5) * Math.PI / 4) * 0.5 / Math.cos(Math.PI / 8)]);
    case 'diamond': return [[0, 0], [0.5, 0.5], [0, 1], [-0.5, 0.5]];
    default: return [[-0.5, 0], [0.5, 0], [0.5, 0.294], [-0.5, 0.294]];
  }
}

export class SignBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.triangles = 0;
  }

  add(face, x, y, z, fx, fz, scale, flip = false) {
    const f = FACES[face];
    const rect = cellRect(face);
    const [bw, bh] = SHAPE_BOX[f.shape];
    const rx = -(-fz);
    const rz = -fx;
    const pts = outline(f.shape);
    const back = { x: (BACK % 4) * CELL, y: Math.floor(BACK / 4) * CELL, w: CELL, h: CELL };
    for (const side of [1, -1]) {
      const b = this.pos.length / 3;
      for (const [px, py] of pts) {
        const lx = side * px * scale;
        const ly = py * scale;
        const off = side * 0.004;
        this.pos.push(x + rx * lx + fx * off, y + ly, z + rz * lx + fz * off);
        this.nor.push(fx * side, 0, fz * side);
        let tx = (px + bw / 2) / bw;
        const ty = py / bh;
        if (flip) tx = 1 - tx;
        const r = side > 0 ? rect : back;
        const u = (r.x + tx * r.w) / ATLAS;
        const v = 1 - (r.y + (1 - ty) * r.h) / ATLAS;
        this.uv.push(u, v);
      }
      for (let i = 1; i < pts.length - 1; i++) {
        if (side > 0) this.idx.push(b, b + i, b + i + 1);
        else this.idx.push(b, b + i + 1, b + i);
      }
      this.triangles += pts.length - 2;
    }
    return { width: f.shape === 'tri' || f.shape === 'triDown' ? scale : scale * bw, height: scale * bh };
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export function signStack(signs, furn, ground, x, z, fx, fz, panels, gamma, bottom = 1.0, color) {
  const g = GAMMA[gamma];
  let y = ground + bottom;
  const gap = 0.03;
  for (const p of panels) {
    const shape = FACES[p.face].shape;
    const key = shape === 'triDown' ? 'tri' : shape;
    const scale = g[key];
    const { height } = signs.add(p.face, x + fx * 0.045, y, z + fz * 0.045, fx, fz, scale, p.flip);
    y += height + gap;
  }
  furn.cyl(x, ground - 0.4, z, 0.03, y - gap - ground + 0.4 + 0.04, 8, color, 0.5, 0.8);
}
