import * as THREE from 'three/webgpu';
import { mulberry32, valueNoise, hash2 } from './rng.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function wrapped(size, x, y, fn) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      if (x + dx > -size * 0.3 && x + dx < size * 1.3 && y + dy > -size * 0.3 && y + dy < size * 1.3) fn(x + dx, y + dy);
    }
  }
}

export const FOLIAGE_TEXTURE_SIZE = 512;

export function foliageTexture(kind, seed = 1) {
  const S = FOLIAGE_TEXTURE_SIZE;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  const cx = S / 2;

  if (kind === 'needle' || kind === 'spruce') {
    const twigs = kind === 'needle' ? 7 : 5;
    for (let t = 0; t < twigs; t++) {
      const ang = -Math.PI / 2 + rnd.range(-1.1, 1.1);
      const len = rnd.range(0.32, 0.46) * S;
      const x0 = cx + rnd.range(-30, 30);
      const y0 = S * 0.92;
      ctx.strokeStyle = rgb(80, 60, 40);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const count = kind === 'needle' ? 170 : 300;
      for (let k = 0; k < count; k++) {
        const f = rnd.range(0.1, 1);
        const px = x0 + (x1 - x0) * f;
        const py = y0 + (y1 - y0) * f;
        const side = rnd.sign();
        const na = ang + side * rnd.range(0.5, 1.1) + (kind === 'spruce' ? 0.25 : 0);
        const nl = kind === 'needle' ? rnd.range(34, 60) : rnd.range(16, 26);
        const g = rnd.range(0.75, 1.15);
        ctx.strokeStyle = kind === 'needle' ? rgb(85 * g, 120 * g, 80 * g) : rgb(60 * g, 105 * g, 70 * g);
        ctx.lineWidth = kind === 'needle' ? 3 : 3.4;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        ctx.stroke();
      }
    }
  } else {
    const small = kind === 'small';
    const willow = kind === 'willow';
    ctx.strokeStyle = rgb(85, 70, 50);
    ctx.lineWidth = 4;
    const twigs = [];
    for (let t = 0; t < 6; t++) {
      const ang = -Math.PI / 2 + rnd.range(-1.2, 1.2);
      const len = rnd.range(0.25, 0.42) * S;
      const x0 = cx + rnd.range(-20, 20);
      const y0 = S * 0.9;
      twigs.push([x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(twigs[t][2], twigs[t][3]);
      ctx.stroke();
    }
    const count = small ? 260 : willow ? 300 : 130;
    for (let k = 0; k < count; k++) {
      const [x0, y0, x1, y1] = twigs[rnd.int(twigs.length)];
      const f = rnd.range(0.2, 1.05);
      const px = x0 + (x1 - x0) * f + rnd.range(-25, 25);
      const py = y0 + (y1 - y0) * f + rnd.range(-25, 25);
      const len = small ? rnd.range(16, 24) : willow ? rnd.range(30, 44) : rnd.range(30, 46);
      const wid = small ? len * 0.62 : willow ? len * 0.18 : len * 0.45;
      const ang = willow ? Math.PI / 2 + rnd.range(-0.35, 0.35) : rnd.range(0, Math.PI * 2);
      const g = rnd.range(0.7, 1.2);
      const y = rnd.range(-12, 12);
      const base = small ? [95, 130, 55] : willow ? [110, 135, 75] : [70, 100, 42];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = rgb((base[0] + y) * g, base[1] * g, (base[2] - y * 0.5) * g);
      ctx.beginPath();
      ctx.ellipse(0, len / 2, wid / 2, len / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgb(base[0] * g * 1.25, base[1] * g * 1.2, base[2] * g * 1.1, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, len - 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  return cutoutTexture(ctx, S);
}

export function cutoutTexture(ctx, S) {
  const src = ctx.getImageData(0, 0, S, S).data;
  const mean = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] > 200) {
      mean[0] += src[i];
      mean[1] += src[i + 1];
      mean[2] += src[i + 2];
      n++;
    }
  }
  for (let k = 0; k < 3; k++) mean[k] /= Math.max(1, n);
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const row = (S - 1 - y) * S * 4;
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const o = row + x * 4;
      const a = src[i + 3];
      for (let k = 0; k < 3; k++) out[o + k] = a > 0 ? src[i + k] : mean[k];
      out[o + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function barkTexture(kind) {
  const W = 256;
  const H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(kind === 'birch' ? 7 : 3);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      let v;
      if (kind === 'birch') {
        v = 225 + 25 * (valueNoise(x / 20, y / 6) - 0.5);
      } else {
        const n = valueNoise(x / 9 + 3 * valueNoise(x / 40, y / 80), y / 70);
        v = 95 + 120 * Math.pow(n, 1.6) + 18 * (valueNoise(x / 2, y / 2) - 0.5);
      }
      img.data[p] = v;
      img.data[p + 1] = v * 0.97;
      img.data[p + 2] = v * 0.93;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (kind === 'birch') {
    for (let k = 0; k < 90; k++) {
      const x = rnd.range(0, W);
      const y = rnd.range(0, H);
      const w = rnd.range(10, 60);
      ctx.fillStyle = rgb(40, 38, 36, rnd.range(0.5, 0.9));
      wrapped(W, x, y, (px, py) => ctx.fillRect(px, py, w, rnd.range(1.5, 5)));
    }
  }
  return toTexture(c);
}

export const GROUND_TILE_METERS = 3;

const detailCache = new Map();

export function groundDetailArray(classNames) {
  const key = classNames.join(',');
  if (!detailCache.has(key)) detailCache.set(key, buildGroundDetailArray(classNames));
  return detailCache.get(key);
}

function buildGroundDetailArray(classNames) {
  const S = 256;
  const data = new Uint8Array(S * S * 4 * classNames.length);
  classNames.forEach((name, layer) => {
    const c = canvas(S);
    const ctx = c.getContext('2d');
    drawGround(ctx, S, name, mulberry32(layer * 97 + 13));
    const px = ctx.getImageData(0, 0, S, S).data;
    const mean = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) mean[k] += px[i + k];
    for (let k = 0; k < 3; k++) mean[k] /= S * S;
    const out = data.subarray(layer * S * S * 4, (layer + 1) * S * S * 4);
    for (let i = 0; i < px.length; i += 4) {
      for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, (px[i + k] * 128) / Math.max(mean[k], 1));
      out[i + 3] = 255;
    }
  });
  const tex = new THREE.DataArrayTexture(data, S, S, classNames.length);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function noiseFill(ctx, S, fn) {
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = (y * S + x) * 4;
      const [r, g, b] = fn(x, y);
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function tileNoise(x, y, cell, S, seed) {
  const n = S / cell;
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const h = (i, j) => valueNoise(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
}

function strokes(ctx, S, rnd, count, { len, width, color, angle = null }) {
  for (let k = 0; k < count; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = angle === null ? rnd() * Math.PI * 2 : angle + rnd.range(-0.4, 0.4);
    const l = len * rnd.range(0.6, 1.3);
    ctx.strokeStyle = color(rnd);
    ctx.lineWidth = width;
    wrapped(S, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      ctx.stroke();
    });
  }
}

function blobs(ctx, S, rnd, count, { size, color }) {
  for (let k = 0; k < count; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rx = size * rnd.range(0.5, 1.4);
    const ry = rx * rnd.range(0.5, 1);
    const a = rnd() * Math.PI;
    ctx.fillStyle = color(rnd);
    wrapped(S, x, y, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, a, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

const grey = (lo, hi) => (rnd) => {
  const v = rnd.range(lo, hi);
  return rgb(v, v, v);
};

function drawGround(ctx, S, name, rnd) {
  const seed = Math.floor(rnd() * 1000);
  const soil = (x, y) => {
    const n = 0.6 * tileNoise(x, y, 32, S, seed) + 0.4 * tileNoise(x, y, 4, S, seed + 1);
    const v = 100 + 80 * n;
    return [v, v * 0.92, v * 0.8];
  };
  switch (name) {
    case 'grass':
    case 'meadow':
    case 'residential':
    case 'sport':
    case 'industrial': {
      noiseFill(ctx, S, (x, y) => {
        const n = tileNoise(x, y, 64, S, seed);
        const v = 90 + 60 * n;
        return [v * 0.95, v, v * 0.7];
      });
      if (name === 'sport') {
        ctx.fillStyle = rgb(255, 255, 255, 0.12);
        ctx.fillRect(0, 0, S / 2, S);
      }
      const n = name === 'meadow' ? 5000 : 7000;
      strokes(ctx, S, rnd, n, {
        len: name === 'meadow' ? 9 : 5,
        width: 1.3,
        color: (r) => {
          const v = r.range(0.6, 1.25);
          const dry = name === 'industrial' ? r.range(0.15, 0.4) : r.range(0, 0.15);
          return rgb(120 * v * (1 + dry), 150 * v, 70 * v * (1 - dry * 0.3));
        },
      });
      if (name === 'meadow') {
        blobs(ctx, S, rnd, 60, { size: 1.6, color: (r) => r.pick([rgb(240, 240, 230), rgb(235, 210, 60), rgb(200, 170, 220)]) });
      }
      if (name === 'industrial') blobs(ctx, S, rnd, 400, { size: 2, color: grey(110, 190) });
      break;
    }
    case 'crop': {
      noiseFill(ctx, S, soil);
      const rowPx = S / (GROUND_TILE_METERS / 0.15);
      for (let x = 0; x < S; x += rowPx) {
        for (let k = 0; k < 120; k++) {
          const y = rnd() * S;
          const v = rnd.range(0.8, 1.2);
          ctx.strokeStyle = rgb(215 * v, 190 * v, 130 * v);
          ctx.lineWidth = 1.5;
          wrapped(S, x + rnd.range(-2, 2), y, (px, py) => {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + rnd.range(-3, 3), py + rnd.range(-8, 8));
            ctx.stroke();
          });
        }
      }
      strokes(ctx, S, rnd, 1500, { len: 6, width: 1, color: (r) => rgb(225 * r.range(0.8, 1.1), 200 * r.range(0.8, 1.1), 140) });
      break;
    }
    case 'forest_broadleaf':
    case 'forest_mixed':
    case 'forest_conifer':
    case 'scrub': {
      noiseFill(ctx, S, (x, y) => {
        const v = soil(x, y);
        return [v[0] * 0.7, v[1] * 0.65, v[2] * 0.55];
      });
      const leaf = (r) => {
        const v = r.range(0.6, 1.3);
        return r() < 0.7 ? rgb(130 * v, 90 * v, 50 * v) : rgb(150 * v, 120 * v, 60 * v);
      };
      blobs(ctx, S, rnd, name === 'forest_conifer' ? 600 : 2200, { size: 4, color: leaf });
      if (name !== 'forest_broadleaf') strokes(ctx, S, rnd, 1500, { len: 7, width: 1, color: (r) => rgb(150 * r.range(0.7, 1.1), 110, 70) });
      strokes(ctx, S, rnd, 120, { len: 20, width: 1.6, color: (r) => rgb(70 * r.range(0.8, 1.2), 55, 40) });
      if (name === 'scrub') strokes(ctx, S, rnd, 2500, { len: 6, width: 1.2, color: (r) => rgb(90 * r.range(0.7, 1.2), 120, 55) });
      break;
    }
    case 'road_major':
    case 'paved':
    case 'building': {
      noiseFill(ctx, S, (x, y) => {
        const v = 120 + 30 * (tileNoise(x, y, 64, S, seed) - 0.5) + 45 * (hash2(x, y, seed) - 0.5);
        return [v, v, v * 1.02];
      });
      blobs(ctx, S, rnd, 900, { size: 1.2, color: grey(150, 220) });
      if (name === 'paved') {
        ctx.fillStyle = rgb(60, 60, 60, 0.5);
        for (let k = 0; k < 2; k++) {
          ctx.fillRect((k * S) / 2, 0, 2, S);
          ctx.fillRect(0, (k * S) / 2, S, 2);
        }
      }
      blobs(ctx, S, rnd, 8, { size: 18, color: () => rgb(40, 40, 40, 0.15) });
      break;
    }
    case 'road_minor':
    case 'bare': {
      noiseFill(ctx, S, soil);
      blobs(ctx, S, rnd, name === 'road_minor' ? 1800 : 500, {
        size: 2.2,
        color: (r) => {
          const v = r.range(120, 220);
          return rgb(v, v * 0.95, v * 0.85);
        },
      });
      break;
    }
    case 'railway': {
      noiseFill(ctx, S, () => [90, 85, 80]);
      blobs(ctx, S, rnd, 2500, {
        size: 3.5,
        color: (r) => {
          const v = r.range(70, 170);
          return rgb(v, v * 0.95, v * 0.9);
        },
      });
      break;
    }
    case 'water':
    default:
      noiseFill(ctx, S, (x, y) => {
        const v = 128 + 10 * (tileNoise(x, y, 64, S, seed) - 0.5);
        return [v, v, v];
      });
  }
}
