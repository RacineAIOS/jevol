const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22,
  29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120,
  101, 72, 92, 95, 98, 112, 100, 103, 99];
const STD_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99];

function qtable(base, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  return Int32Array.from(base, (b) => Math.max(1, Math.min(255, Math.floor((b * scale + 50) / 100))));
}

const SCALEBITS = 16;
const ONE_HALF = 1 << (SCALEBITS - 1);
const FIXC = (x) => Math.floor(x * (1 << SCALEBITS) + 0.5);

const IDCT_LIMIT = (() => {
  const t = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    if (i < 128) t[i] = i + 128;
    else if (i < 512) t[i] = 255;
    else if (i < 896) t[i] = 0;
    else t[i] = i - 896;
  }
  return t;
})();

const CR_R = new Int32Array(256);
const CB_B = new Int32Array(256);
const CR_G = new Int32Array(256);
const CB_G = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  const x = i - 128;
  CR_R[i] = (FIXC(1.402) * x + ONE_HALF) >> SCALEBITS;
  CB_B[i] = (FIXC(1.772) * x + ONE_HALF) >> SCALEBITS;
  CR_G[i] = -FIXC(0.71414) * x;
  CB_G[i] = -FIXC(0.34414) * x + ONE_HALF;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

const CONST_BITS = 13;
const PASS1_BITS = 2;
const F_0_298 = 2446, F_0_390 = 3196, F_0_541 = 4433, F_0_765 = 6270, F_0_899 = 7373, F_1_175 = 9633, F_1_501 = 12299,
  F_1_847 = 15137, F_1_961 = 16069, F_2_053 = 16819, F_2_562 = 20995, F_3_072 = 25172;
const descale = (x, n) => (x + (1 << (n - 1))) >> n;

function fdct(d) {
  for (let r = 0; r < 64; r += 8) {
    const tmp0 = d[r] + d[r + 7], tmp7 = d[r] - d[r + 7];
    const tmp1 = d[r + 1] + d[r + 6], tmp6 = d[r + 1] - d[r + 6];
    const tmp2 = d[r + 2] + d[r + 5], tmp5 = d[r + 2] - d[r + 5];
    const tmp3 = d[r + 3] + d[r + 4], tmp4 = d[r + 3] - d[r + 4];
    const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
    d[r] = (tmp10 + tmp11) << PASS1_BITS;
    d[r + 4] = (tmp10 - tmp11) << PASS1_BITS;
    let z1 = (tmp12 + tmp13) * F_0_541;
    d[r + 2] = descale(z1 + tmp13 * F_0_765, CONST_BITS - PASS1_BITS);
    d[r + 6] = descale(z1 + tmp12 * -F_1_847, CONST_BITS - PASS1_BITS);
    z1 = tmp4 + tmp7;
    let z2 = tmp5 + tmp6, z3 = tmp4 + tmp6, z4 = tmp5 + tmp7;
    const z5 = (z3 + z4) * F_1_175;
    const t4 = tmp4 * F_0_298, t5 = tmp5 * F_2_053, t6 = tmp6 * F_3_072, t7 = tmp7 * F_1_501;
    z1 *= -F_0_899; z2 *= -F_2_562; z3 *= -F_1_961; z4 *= -F_0_390;
    z3 += z5; z4 += z5;
    d[r + 7] = descale(t4 + z1 + z3, CONST_BITS - PASS1_BITS);
    d[r + 5] = descale(t5 + z2 + z4, CONST_BITS - PASS1_BITS);
    d[r + 3] = descale(t6 + z2 + z3, CONST_BITS - PASS1_BITS);
    d[r + 1] = descale(t7 + z1 + z4, CONST_BITS - PASS1_BITS);
  }
  for (let c = 0; c < 8; c++) {
    const tmp0 = d[c] + d[c + 56], tmp7 = d[c] - d[c + 56];
    const tmp1 = d[c + 8] + d[c + 48], tmp6 = d[c + 8] - d[c + 48];
    const tmp2 = d[c + 16] + d[c + 40], tmp5 = d[c + 16] - d[c + 40];
    const tmp3 = d[c + 24] + d[c + 32], tmp4 = d[c + 24] - d[c + 32];
    const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
    d[c] = descale(tmp10 + tmp11, PASS1_BITS);
    d[c + 32] = descale(tmp10 - tmp11, PASS1_BITS);
    let z1 = (tmp12 + tmp13) * F_0_541;
    d[c + 16] = descale(z1 + tmp13 * F_0_765, CONST_BITS + PASS1_BITS);
    d[c + 48] = descale(z1 + tmp12 * -F_1_847, CONST_BITS + PASS1_BITS);
    z1 = tmp4 + tmp7;
    let z2 = tmp5 + tmp6, z3 = tmp4 + tmp6, z4 = tmp5 + tmp7;
    const z5 = (z3 + z4) * F_1_175;
    const t4 = tmp4 * F_0_298, t5 = tmp5 * F_2_053, t6 = tmp6 * F_3_072, t7 = tmp7 * F_1_501;
    z1 *= -F_0_899; z2 *= -F_2_562; z3 *= -F_1_961; z4 *= -F_0_390;
    z3 += z5; z4 += z5;
    d[c + 56] = descale(t4 + z1 + z3, CONST_BITS + PASS1_BITS);
    d[c + 40] = descale(t5 + z2 + z4, CONST_BITS + PASS1_BITS);
    d[c + 24] = descale(t6 + z2 + z3, CONST_BITS + PASS1_BITS);
    d[c + 8] = descale(t7 + z1 + z4, CONST_BITS + PASS1_BITS);
  }
}

const WS = new Int32Array(64);
function idct(coef, out, off, stride) {
  for (let c = 0; c < 8; c++) {
    let z2 = coef[c + 16], z3 = coef[c + 48];
    let z1 = (z2 + z3) * F_0_541;
    const tmp2a = z1 + z3 * -F_1_847, tmp3a = z1 + z2 * F_0_765;
    z2 = coef[c]; z3 = coef[c + 32];
    const tmp0a = (z2 + z3) << CONST_BITS, tmp1a = (z2 - z3) << CONST_BITS;
    const tmp10 = tmp0a + tmp3a, tmp13 = tmp0a - tmp3a, tmp11 = tmp1a + tmp2a, tmp12 = tmp1a - tmp2a;
    let tmp0 = coef[c + 56], tmp1 = coef[c + 40], tmp2 = coef[c + 24], tmp3 = coef[c + 8];
    z1 = tmp0 + tmp3; z2 = tmp1 + tmp2; z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * F_1_175;
    tmp0 *= F_0_298; tmp1 *= F_2_053; tmp2 *= F_3_072; tmp3 *= F_1_501;
    z1 *= -F_0_899; z2 *= -F_2_562; z3 *= -F_1_961; z4 *= -F_0_390;
    z3 += z5; z4 += z5;
    tmp0 += z1 + z3; tmp1 += z2 + z4; tmp2 += z2 + z3; tmp3 += z1 + z4;
    const n = CONST_BITS - PASS1_BITS;
    WS[c] = descale(tmp10 + tmp3, n); WS[c + 56] = descale(tmp10 - tmp3, n);
    WS[c + 8] = descale(tmp11 + tmp2, n); WS[c + 48] = descale(tmp11 - tmp2, n);
    WS[c + 16] = descale(tmp12 + tmp1, n); WS[c + 40] = descale(tmp12 - tmp1, n);
    WS[c + 24] = descale(tmp13 + tmp0, n); WS[c + 32] = descale(tmp13 - tmp0, n);
  }
  const n = CONST_BITS + PASS1_BITS + 3;
  for (let r = 0; r < 64; r += 8) {
    let z2 = WS[r + 2], z3 = WS[r + 6];
    let z1 = (z2 + z3) * F_0_541;
    const tmp2a = z1 + z3 * -F_1_847, tmp3a = z1 + z2 * F_0_765;
    const tmp0a = (WS[r] + WS[r + 4]) << CONST_BITS, tmp1a = (WS[r] - WS[r + 4]) << CONST_BITS;
    const tmp10 = tmp0a + tmp3a, tmp13 = tmp0a - tmp3a, tmp11 = tmp1a + tmp2a, tmp12 = tmp1a - tmp2a;
    let tmp0 = WS[r + 7], tmp1 = WS[r + 5], tmp2 = WS[r + 3], tmp3 = WS[r + 1];
    z1 = tmp0 + tmp3; z2 = tmp1 + tmp2; z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * F_1_175;
    tmp0 *= F_0_298; tmp1 *= F_2_053; tmp2 *= F_3_072; tmp3 *= F_1_501;
    z1 *= -F_0_899; z2 *= -F_2_562; z3 *= -F_1_961; z4 *= -F_0_390;
    z3 += z5; z4 += z5;
    tmp0 += z1 + z3; tmp1 += z2 + z4; tmp2 += z2 + z3; tmp3 += z1 + z4;
    const o = off + (r >> 3) * stride;
    out[o] = IDCT_LIMIT[descale(tmp10 + tmp3, n) & 1023];
    out[o + 7] = IDCT_LIMIT[descale(tmp10 - tmp3, n) & 1023];
    out[o + 1] = IDCT_LIMIT[descale(tmp11 + tmp2, n) & 1023];
    out[o + 6] = IDCT_LIMIT[descale(tmp11 - tmp2, n) & 1023];
    out[o + 2] = IDCT_LIMIT[descale(tmp12 + tmp1, n) & 1023];
    out[o + 5] = IDCT_LIMIT[descale(tmp12 - tmp1, n) & 1023];
    out[o + 3] = IDCT_LIMIT[descale(tmp13 + tmp0, n) & 1023];
    out[o + 4] = IDCT_LIMIT[descale(tmp13 - tmp0, n) & 1023];
  }
}

function reciprocals(qt) {
  const f = new Float64Array(64), c = new Float64Array(64), p = new Float64Array(64);
  for (let k = 0; k < 64; k++) {
    const d = qt[k] * 8;
    const b = 31 - Math.clz32(d);
    let r = 16 + b;
    let fq = Math.floor(2 ** r / d);
    const fr = 2 ** r % d;
    let cc = Math.floor(d / 2);
    if (fr === 0) { fq = Math.floor(fq / 2); r--; } else if (fr <= Math.floor(d / 2)) cc++; else fq++;
    f[k] = fq; c[k] = cc; p[k] = 2 ** r;
  }
  return { f, c, p };
}

function planeRoundtrip(plane, width, height, qt) {
  const rec = reciprocals(qt);
  const blk = new Int32Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = (by + y) * width + bx;
        for (let x = 0; x < 8; x++) blk[y * 8 + x] = plane[row + x] - 128;
      }
      fdct(blk);
      for (let k = 0; k < 64; k++) {
        const t = blk[k];
        const q = Math.floor(((t < 0 ? -t : t) + rec.c[k]) * rec.f[k] / rec.p[k]);
        blk[k] = (t < 0 ? -q : q) * qt[k];
      }
      idct(blk, plane, by * width + bx, width);
    }
  }
}

const TABLES = new Map();

export function roundtrip444(rgba, width, height, quality = 90, channels = 4) {
  if (width % 8 || height % 8) throw new Error('roundtrip444: width and height must be multiples of 8');
  if (!TABLES.has(quality)) TABLES.set(quality, [qtable(STD_LUMA, quality), qtable(STD_CHROMA, quality)]);
  const [ql, qc] = TABLES.get(quality);
  const n = width * height;
  const Y = new Uint8Array(n), Cb = new Uint8Array(n), Cr = new Uint8Array(n);
  const yr = FIXC(0.299), yg = FIXC(0.587), yb = FIXC(0.114), cbr = FIXC(0.16874), cbg = FIXC(0.33126), half = FIXC(0.5),
    crg = FIXC(0.41869), crb = FIXC(0.08131), off = (128 << SCALEBITS) + ONE_HALF - 1;
  for (let i = 0, p = 0; i < n; i++, p += channels) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    Y[i] = (yr * r + yg * g + yb * b + ONE_HALF) >> SCALEBITS;
    Cb[i] = (-cbr * r - cbg * g + half * b + off) >> SCALEBITS;
    Cr[i] = (half * r - crg * g - crb * b + off) >> SCALEBITS;
  }
  planeRoundtrip(Y, width, height, ql);
  planeRoundtrip(Cb, width, height, qc);
  planeRoundtrip(Cr, width, height, qc);
  const out = new Uint8Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const y = Y[i], cb = Cb[i], cr = Cr[i];
    out[p] = clamp255(y + CR_R[cr]);
    out[p + 1] = clamp255(y + ((CB_G[cb] + CR_G[cr]) >> SCALEBITS));
    out[p + 2] = clamp255(y + CB_B[cb]);
  }
  return out;
}
