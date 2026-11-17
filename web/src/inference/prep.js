export const W = 672;
export const H = 504;
export const RH = 512;
const MH = 16;
const MW = 21;

export function patches(rgb, table) {
  const { prec, taps, first, w } = table;
  const half = 1 << (prec - 1);
  const r = new Uint8Array(RH * W * 3);
  for (let o = 0; o < RH; o++) {
    const f = first[o];
    const wo = w[o];
    for (let x = 0; x < W * 3; x++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += wo[k] * rgb[(f + k) * W * 3 + x];
      const v = (acc + half) >> prec;
      r[o * W * 3 + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  const out = new Float32Array(MH * MW * 4 * 768);
  let at = 0;
  for (let bh = 0; bh < MH; bh++) {
    for (let bw = 0; bw < MW; bw++) {
      for (let mh = 0; mh < 2; mh++) {
        for (let mw = 0; mw < 2; mw++) {
          const y0 = (bh * 2 + mh) * 16;
          const x0 = (bw * 2 + mw) * 16;
          for (let c = 0; c < 3; c++) {
            for (let py = 0; py < 16; py++) {
              const row = (y0 + py) * W * 3;
              for (let px = 0; px < 16; px++) out[at++] = (r[row + (x0 + px) * 3 + c] - 127.5) / 127.5;
            }
          }
        }
      }
    }
  }
  return out;
}
