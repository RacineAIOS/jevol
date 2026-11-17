import * as THREE from 'three/webgpu';
import { attribute, positionWorld, positionView, vec3, float, mix, fract, min, max, abs, length, smoothstep, fwidth, mx_noise_float, instanceColor } from 'three/tsl';

const std = (o) => new THREE.MeshStandardNodeMaterial(o);

const near = () => float(1).sub(smoothstep(18, 70, positionView.z.negate()));

const footprint = (p) => fwidth(p.x).add(fwidth(p.y)).add(fwidth(p.z));

function line(coord, period, width, px) {
  const f = fract(coord.div(period));
  const d = min(f, f.oneMinus()).mul(period);
  const l = float(1).sub(smoothstep(float(width).sub(px), float(width).add(px), d));
  const cover = float(width * 2).div(period);
  return mix(l, cover, smoothstep(0.25, 0.6, px.div(period)));
}

export function solidMaterial() {
  const m = std({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const col = attribute('color', 'vec3');
  const info = attribute('info', 'vec4');
  const p = positionWorld;
  const kind = info.z;
  const is = (k) => float(1).sub(min(abs(kind.sub(k)), 1));
  const nr = near();
  const grain = mx_noise_float(vec3(p.x.mul(55), p.y.mul(3.5), p.z.mul(55))).mul(0.16).mul(nr);
  const patch = mx_noise_float(p.mul(2.7));
  const flake = mx_noise_float(p.mul(24));
  const low = float(1).sub(smoothstep(0.05, 0.75, p.y.sub(info.w)));
  const dirty = low.mul(smoothstep(-0.3, 0.5, mx_noise_float(p.mul(3.1)))).mul(is(2).oneMinus()).mul(is(3).oneMinus()).mul(is(5).oneMinus());
  const wood = col.mul(float(1).add(grain).add(patch.mul(0.12)));
  const galv = col.mul(float(1).add(patch.mul(0.1)).add(flake.mul(0.05).mul(nr)));
  const paint = col.mul(float(1).add(patch.mul(0.08)));
  const straw = smoothstep(0.62, 0.78, flake.add(mx_noise_float(p.mul(60)).mul(0.3)).mul(nr));
  const manureBase = mix(vec3(0.07, 0.05, 0.032), vec3(0.1, 0.073, 0.045), smoothstep(-0.5, 0.6, patch));
  const manure = mix(manureBase, vec3(0.2, 0.15, 0.075), straw.mul(0.3));
  let c = col;
  c = mix(c, wood, is(2));
  c = mix(c, galv, is(1));
  c = mix(c, paint, is(4));
  c = mix(c, manure, is(3));
  c = mix(c, vec3(0.1, 0.075, 0.05), dirty.mul(0.6));
  m.colorNode = c;
  m.roughnessNode = mix(info.x, float(0.92), dirty.mul(0.5)).add(is(3).mul(0.0));
  m.metalnessNode = info.y.mul(float(1).sub(dirty.mul(0.8)));
  return m;
}

export function postMaterial() {
  const m = std({ roughness: 0.9, metalness: 0 });
  const p = positionWorld;
  const nr = near();
  const fibre = mx_noise_float(vec3(p.x.mul(70), p.y.mul(4), p.z.mul(70))).mul(0.18).mul(nr);
  const split = mx_noise_float(vec3(p.x.mul(9), p.y.mul(1.2), p.z.mul(9))).mul(0.12);
  const moss = smoothstep(0.1, 0.5, mx_noise_float(p.mul(1.7))).mul(float(1).sub(smoothstep(0.1, 0.8, p.y.mul(0.9))));
  const base = vec3(0.2, 0.135, 0.075).mul(float(1).add(fibre).add(split));
  m.colorNode = mix(base, vec3(0.1, 0.12, 0.06), moss.mul(0.35));
  return m;
}

export function decalMaterial() {
  const m = std({ roughness: 0.55, metalness: 0, transparent: true, depthWrite: false });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  const q = attribute('uv', 'vec2');
  const c = attribute('color', 'vec3');
  const p = positionWorld;
  const rim = length(q).add(mx_noise_float(vec3(p.x.mul(0.9), p.z.mul(0.9), 3)).mul(0.28));
  const body = float(1).sub(smoothstep(0.35, 1.0, rim));
  const tone = mx_noise_float(vec3(p.x.mul(2.6), p.z.mul(2.6), 7)).mul(0.5).add(0.5);
  const wet = smoothstep(0.55, 0.85, tone).mul(float(1).sub(c.g)).mul(smoothstep(0.1, 0.45, rim.oneMinus()));
  const mud = mix(vec3(0.085, 0.058, 0.036), vec3(0.05, 0.035, 0.024), wet);
  const dung = mix(vec3(0.07, 0.05, 0.03), vec3(0.14, 0.11, 0.06), tone.mul(0.7));
  m.colorNode = mix(mud, dung, c.g);
  m.roughnessNode = mix(float(0.95), float(0.18), wet);
  m.opacityNode = body.mul(c.r).mul(smoothstep(0.0, 0.2, body));
  return m;
}

const lp = () => attribute('position', 'vec3');
const ln = () => attribute('normal', 'vec3');

export function roundBaleMaterial() {
  const m = std({ roughness: 0.96, metalness: 0 });
  const P = lp();
  const N = ln();
  const nr = near();
  const px = footprint(P);
  const r = length(P.yz);
  const ux = P.y.div(r.max(0.01));
  const uz = P.z.div(r.max(0.01));
  const endMask = smoothstep(0.5, 0.85, abs(N.x));
  const stalk = mx_noise_float(vec3(ux.mul(2.6), uz.mul(2.6), P.x.mul(46)));
  const clump = mx_noise_float(vec3(ux.mul(1.3), uz.mul(1.3), P.x.mul(4.5)));
  const side = float(1).add(stalk.mul(0.22).mul(nr)).add(clump.mul(0.16));
  const ring = fract(r.mul(21).add(mx_noise_float(vec3(P.y.mul(5), P.z.mul(5), 2)).mul(0.9)));
  const fibreFace = mx_noise_float(vec3(P.y.mul(55), P.z.mul(55), 3)).mul(0.2).mul(nr);
  const face = float(1).add(ring.sub(0.5).mul(0.14).mul(nr)).add(fibreFace).sub(smoothstep(0.2, 0.0, r).mul(0.3));
  const base = vec3(0.31, 0.23, 0.08);
  let color = base.mul(mix(side, face, endMask));
  const ang = P.z.atan(P.y).div(6.2831853).mul(90);
  const period = 0.0454;
  const net = max(line(ang.mul(period).add(P.x), period, 0.0035, px), line(ang.mul(period).sub(P.x), period, 0.0035, px));
  const netMask = float(1).sub(endMask).mul(float(1).sub(smoothstep(0.54, 0.58, abs(P.x))));
  color = mix(color, vec3(0.62, 0.62, 0.56), net.mul(netMask).mul(0.8));
  color = color.mul(float(1).sub(smoothstep(0.58, 0.66, r).mul(endMask).mul(0.25)));
  m.colorNode = color;
  return m;
}

export function wrappedBaleMaterial() {
  const m = std({ roughness: 0.38, metalness: 0 });
  const P = lp();
  const nr = near();
  const px = footprint(P);
  const r = length(P.yz);
  const ux = P.y.div(r.max(0.01));
  const uz = P.z.div(r.max(0.01));
  const ang = P.z.atan(P.y).div(6.2831853);
  const seam = line(P.x.add(ang.mul(0.25)), 0.25, 0.004, px);
  const wrinkle = mx_noise_float(vec3(ux.mul(5), uz.mul(5), P.x.mul(12))).mul(0.5).add(0.5);
  const faceWrinkle = mx_noise_float(vec3(P.y.mul(7), P.z.mul(7), 4)).mul(0.5).add(0.5);
  const endMask = smoothstep(0.5, 0.85, abs(ln().x));
  const w = mix(wrinkle, faceWrinkle, endMask);
  m.colorNode = vec3(float(0.8).add(w.mul(0.3).mul(nr)).sub(seam.mul(0.1)));
  m.roughnessNode = float(0.3).add(w.mul(0.25));
  return m;
}

export function squareBaleMaterial({ length: L, height: H, depth: D, ties, flake }) {
  const m = std({ roughness: 0.97, metalness: 0 });
  const P = lp();
  const N = ln();
  const nr = near();
  const px = footprint(P);
  const endMask = smoothstep(0.5, 0.85, abs(N.x));
  const stalk = mx_noise_float(vec3(P.x.mul(3.2), P.y.mul(70), P.z.mul(70)));
  const cut = mx_noise_float(vec3(P.y.mul(110), P.z.mul(110), 1));
  const clump = mx_noise_float(vec3(P.x.mul(1.6), P.y.mul(5), P.z.mul(5)));
  const sideTone = float(1).add(stalk.mul(0.2).mul(nr)).add(clump.mul(0.15));
  const endTone = float(1.12).add(cut.mul(0.28).mul(nr)).add(clump.mul(0.1));
  const lit = line(P.x.add(mx_noise_float(vec3(P.x.mul(7), P.y.mul(5), 5)).mul(0.03)), flake, 0.004, px).mul(float(1).sub(endMask)).mul(0.28);
  const base = vec3(0.33, 0.24, 0.08);
  let color = base.mul(mix(sideTone, endTone, endMask)).mul(float(1).sub(lit));
  const edge = max(max(smoothstep(L / 2 - 0.05, L / 2, abs(P.x)), smoothstep(H / 2 - 0.03, H / 2, abs(P.y))), smoothstep(D / 2 - 0.03, D / 2, abs(P.z)));
  color = color.mul(float(1).sub(edge.mul(0.16)));
  let tie = float(0);
  for (const t of ties) tie = max(tie, float(1).sub(smoothstep(0.004, 0.0075, abs(P.x.sub(t)))));
  tie = tie.mul(float(1).sub(endMask));
  const pick = fract(instanceColor.g.mul(53.7));
  const twine = mix(mix(vec3(0.62, 0.26, 0.05), vec3(0.08, 0.14, 0.4), smoothstep(0.34, 0.36, pick)), vec3(0.6, 0.57, 0.45), smoothstep(0.68, 0.7, pick));
  m.colorNode = mix(color, twine, tie.mul(0.9));
  return m;
}
