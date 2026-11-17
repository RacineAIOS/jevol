import { attribute, screenCoordinate, fract, dot, vec2, float, select } from 'three/tsl';

export const LOD_FADE_ATTRIBUTE = 'lodFade';

const ditherNoise = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));

export function lodFadeMask() {
  const v = attribute(LOD_FADE_ATTRIBUTE, 'float');
  return select(v.lessThanEqual(1), ditherNoise.lessThan(v), ditherNoise.greaterThanEqual(v.sub(1)));
}

export function lodContributions(dist, edges, widths, out) {
  out.length = 0;
  const last = edges.length - 1;
  for (let k = 0; k <= last; k++) {
    const lo = edges[k] - widths[k];
    const hi = k === last ? edges[k] : edges[k] + widths[k];
    if (dist < lo) {
      out.push(k, 1);
      return out;
    }
    if (dist < hi) {
      const t = (dist - lo) / (hi - lo);
      out.push(k, 1 + t);
      if (k < last) out.push(k + 1, t);
      return out;
    }
  }
  return out;
}
