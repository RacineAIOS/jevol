const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

function bjfinal(a, b, c) {
  c = (c ^ b) >>> 0; c = (c - rotl(b, 14)) >>> 0;
  a = (a ^ c) >>> 0; a = (a - rotl(c, 11)) >>> 0;
  b = (b ^ a) >>> 0; b = (b - rotl(a, 25)) >>> 0;
  c = (c ^ b) >>> 0; c = (c - rotl(b, 16)) >>> 0;
  a = (a ^ c) >>> 0; a = (a - rotl(c, 4)) >>> 0;
  b = (b ^ a) >>> 0; b = (b - rotl(a, 14)) >>> 0;
  c = (c ^ b) >>> 0; c = (c - rotl(b, 24)) >>> 0;
  return c;
}
const hash2 = (x, y) => { const s = (0xdeadbeef + (2 << 2) + 13) >>> 0; return bjfinal((s + x) >>> 0, (s + y) >>> 0, s); };
const hash3 = (x, y, z) => { const s = (0xdeadbeef + (3 << 2) + 13) >>> 0; return bjfinal((s + x) >>> 0, (s + y) >>> 0, (s + z) >>> 0); };

function grad2(hash, x, y) {
  const h = hash & 7; const u = h < 4 ? x : y; const v = 2 * (h < 4 ? y : x);
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
function grad3z0(hash, x, y) {
  const h = hash & 15; const u = h < 8 ? x : y; const v = h < 4 ? y : (h === 12 || h === 14 ? x : 0);
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function mxNoise(x, y, cells, kind = 0) {
  const fx0 = Math.floor(x); const fy0 = Math.floor(y); const fx = x - fx0; const fy = y - fy0;
  const X = ((fx0 % cells) + cells) % cells; const Y = ((fy0 % cells) + cells) % cells;
  const X1 = (X + 1) % cells; const Y1 = (Y + 1) % cells;
  const u = fade(fx); const v = fade(fy);
  let g00; let g10; let g01; let g11; let scale;
  if (kind === 0) {
    g00 = grad2(hash2(X, Y), fx, fy); g10 = grad2(hash2(X1, Y), fx - 1, fy);
    g01 = grad2(hash2(X, Y1), fx, fy - 1); g11 = grad2(hash2(X1, Y1), fx - 1, fy - 1); scale = 0.6616;
  } else {
    g00 = grad3z0(hash3(X, Y, 0), fx, fy); g10 = grad3z0(hash3(X1, Y, 0), fx - 1, fy);
    g01 = grad3z0(hash3(X, Y1, 0), fx, fy - 1); g11 = grad3z0(hash3(X1, Y1, 0), fx - 1, fy - 1); scale = 0.982;
  }
  return scale * ((1 - v) * (g00 * (1 - u) + g10 * u) + v * (g01 * (1 - u) + g11 * u));
}

export function buildNoiseData(size, cells) {
  const out = new Float32Array(size * size * 2); const f = cells / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * f; const y = (j + 0.5) * f; const k = (j * size + i) * 2;
      out[k] = mxNoise(x, y, cells, 0); out[k + 1] = mxNoise(x, y, cells, 1);
    }
  }
  return out;
}
