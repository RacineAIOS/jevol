import * as THREE from 'three/webgpu';
import { attribute, positionWorld, positionView, normalView, positionLocal, cameraPosition, time, vec2, vec3, float, mix, abs, sign, floor, fract, sin, cos, dot, length, normalize, cross, smoothstep, step, exp, sqrt, max, min, fwidth, distance, mx_noise_float, mx_fractal_noise_float, mx_worley_noise_vec2 } from 'three/tsl';
import { VERGE_GREEN, VERGE_DRY } from './geometry.js';

const srgb = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

function reliefNormal(height) {
  const sx = positionView.dFdx();
  const sy = positionView.dFdy();
  const n = normalView;
  const r1 = cross(sy, n);
  const r2 = cross(n, sx);
  const det = dot(sx, r1);
  const grad = sign(det).mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)));
  return normalize(abs(det).mul(n).sub(grad));
}

function stoneLayer(wp, cell, rot, density, offset, sun) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const q = vec2(wp.x.mul(c).sub(wp.y.mul(s)), wp.x.mul(s).add(wp.y.mul(c))).div(cell);
  const sd = vec2(sun[0] * c - sun[1] * s, sun[0] * s + sun[1] * c);
  const id = floor(q);
  const f = fract(q).sub(0.5);
  const h1 = hash21(id.add(offset));
  const h2 = hash21(id.add(offset + 17.3));
  const h3 = hash21(id.add(offset + 41.1));
  const h4 = hash21(id.add(offset + 3.7));
  const ctr = vec2(h1, h2).sub(0.5).mul(0.3);
  const rel = f.sub(ctr);
  const r = length(rel);
  const rad = h3.mul(0.14).add(0.2);
  const aa = fwidth(q.x);
  const present = step(h4, density);
  const m = float(1).sub(smoothstep(rad.sub(0.07), rad, r)).mul(present);
  const shRel = rel.add(sd.mul(rad.mul(0.55)));
  const shadow = float(1).sub(smoothstep(rad.mul(0.8), rad.mul(1.15), length(shRel))).mul(present).mul(float(1).sub(m));
  const dome = sqrt(max(float(0), float(1).sub(r.div(rad).mul(r.div(rad))))).mul(m);
  const lit = dot(rel.div(rad), sd).clamp(-1, 1);
  const fade = float(1).sub(smoothstep(0.3, 0.8, aa));
  return { m, dome, lit, shadow, tint: h3, fade, cell, avg: density };
}

export function createPathMaterial({ groundColor, sunDir = [0.5, -0.5] }) {
  const sl = Math.hypot(sunDir[0], sunDir[1]) || 1;
  const sun = [sunDir[0] / sl, sunDir[1] / sl];
  const g = attribute('aGeo', 'vec4');
  const A = attribute('aSoil', 'vec4');
  const B = attribute('aStone', 'vec4');
  const C = attribute('aWear', 'vec4');
  const D = attribute('aForm', 'vec4');
  const across = g.x;
  const along = g.y;
  const hw = g.z;
  const seed = g.w;
  const aa = abs(across);
  const side = step(0, across).mul(2).sub(1);
  const site = step(2, B.w);
  const stoneDens = B.w.sub(site.mul(4));
  const wp = positionWorld.xz;

  const ground = vec3(...srgb(groundColor).toArray());
  const green = vec3(...srgb(VERGE_GREEN).toArray());
  const dry = vec3(...srgb(VERGE_DRY).toArray());
  const verge = mix(green, dry, C.w);

  const n1 = mx_noise_float(vec3(along.mul(0.2), seed.add(side.mul(5.3)), 0.0));
  const n2 = mx_noise_float(vec3(along.mul(0.8), seed.add(side.mul(9.1)), 3.0));
  const pn = mx_fractal_noise_float(vec3(wp.mul(0.7), seed.mul(0.1)), 3, 2.0, 0.5);
  const pf = mx_noise_float(vec3(wp.mul(4.0), seed));
  const enc = D.y;
  const d = aa.sub(hw).add(n1.mul(D.z)).add(n2.mul(D.z.mul(0.35))).add(pn.mul(0.4).mul(enc)).add(pf.mul(0.12));
  const cover = float(1).sub(smoothstep(-0.25, 0.3, d));

  const junc = smoothstep(0.5, 3.5, A.w);
  const rutOff = C.x;
  const rw = rutOff.mul(0.22).add(0.04);
  const rutVar = mx_noise_float(vec3(along.mul(0.12), seed, 7.0)).mul(0.35).add(0.75);
  const dr = aa.sub(rutOff.mul(n1.mul(0.06).add(1)));
  const rutShape = exp(dr.mul(dr).div(rw.mul(rw)).negate()).mul(step(0.01, rutOff));
  const inside = float(1).sub(smoothstep(hw.sub(0.35), hw, aa));
  const rut = rutShape.mul(rutVar).mul(junc).mul(inside);

  const sn = mx_fractal_noise_float(vec3(wp.mul(1.6), seed.add(3.0)), 2, 2.0, 0.5);
  const stripEdge = aa.sub(D.x.mul(sn.mul(0.35).add(1)));
  const strip = float(1).sub(smoothstep(-0.12, 0.12, stripEdge)).mul(step(0.01, D.x)).mul(junc)
    .mul(smoothstep(-0.45, 0.1, sn.add(0.2)));

  const low = mx_fractal_noise_float(vec3(wp.mul(0.35), seed), 3, 2.0, 0.5);
  const soil = A.xyz;
  let col = soil.mul(low.mul(0.18).add(1)).mul(mix(float(1), float(0.82).sub(site.mul(0.22)), rut.mul(0.85)));
  const stoneCol = B.xyz;
  const density = stoneDens.mul(float(1).sub(rut.mul(0.6)));
  const cell = D.w;
  const L = [
    stoneLayer(wp, cell, 0.3, density, 0, sun),
    stoneLayer(wp, cell.mul(2.6), 1.1, density.mul(0.55), 11, sun),
    stoneLayer(wp, cell.mul(7.0), 2.0, density.mul(0.13), 23, sun),
  ];
  let height = rut.mul(C.y).negate();
  let spill = float(0);
  for (const l of L) {
    const shade = l.tint.mul(0.3).add(0.85).mul(l.lit.mul(0.18).add(1.0)).mul(l.dome.mul(0.15).add(0.9));
    col = mix(col, col.mul(0.7), l.shadow.mul(l.fade).mul(0.5));
    col = mix(col, stoneCol.mul(shade), l.m.mul(l.fade));
    col = mix(col, mix(soil, stoneCol.mul(0.8), 0.5), l.avg.mul(float(1).sub(l.fade)).mul(0.5));
    height = height.add(l.dome.mul(l.fade).mul(l.cell).mul(0.08));
    spill = max(spill, l.m.mul(l.fade).mul(float(1).sub(smoothstep(0.1, 1.0, d))));
  }
  height = height.add(low.mul(0.004));

  const big = mx_fractal_noise_float(vec3(wp.mul(0.06), seed.add(31)), 3, 2.0, 0.5);
  const mid = mx_noise_float(vec3(wp.mul(0.45), seed.add(37)));
  const edgeDist = smoothstep(0.4, 1.0, aa.div(hw));
  const tone = big.mul(1.1).add(mid.mul(0.12));
  col = col.mul(float(1).add(site.mul(tone)));
  const ochre = smoothstep(-0.05, 0.3, big.add(mid.mul(0.3))).mul(site);
  col = mix(col, soil.mul(vec3(0.78, 0.6, 0.42)), ochre.mul(0.42));
  const dirtyEdge = edgeDist.mul(mid.mul(0.6).add(0.7)).mul(site);
  col = mix(col, soil.mul(vec3(0.72, 0.62, 0.5)), dirtyEdge.mul(0.75));
  const lane = float(1).sub(smoothstep(0.1, 0.5, abs(aa.sub(rutOff.mul(1.0)).sub(0.0)))).mul(site).mul(step(0.01, rutOff));
  col = col.mul(float(1).sub(lane.mul(rut.oneMinus()).mul(mid.mul(0.1).add(0.1))));

  const stripCol = mix(verge.mul(float(0.8).add(pf.mul(0.2))), soil, 0.15);
  col = mix(col, stripCol, strip);

  const wet = C.z;
  const fb = mx_fractal_noise_float(vec3(wp.mul(0.8), seed.add(11.0)), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const puddle = smoothstep(0.58, 0.8, fb.add(rut.mul(0.22)).add(wet.mul(0.35)).sub(0.35))
    .mul(step(0.05, wet)).mul(cover).mul(float(1).sub(strip));
  const wetPuddle = puddle.mul(float(1).sub(site));
  col = mix(col, soil.mul(0.6), wetPuddle.mul(0.85));
  col = col.mul(mix(float(1), float(0.8), rut.mul(wet)));
  const dryPud = puddle.mul(site);
  const wv = mx_worley_noise_vec2(wp.mul(7.0).add(seed));
  const cracks = float(1).sub(smoothstep(0.0, 0.07, wv.y.sub(wv.x)));
  const silt = soil.mul(vec3(0.86, 0.84, 0.82)).mul(float(1).sub(cracks.mul(0.4)));
  const rim = smoothstep(0.02, 0.2, dryPud).mul(float(1).sub(smoothstep(0.2, 0.55, dryPud)));
  col = mix(col, silt, smoothstep(0.15, 0.6, dryPud).mul(0.85));
  col = col.mul(float(1).sub(rim.mul(0.18)));

  const fringeCol = mix(ground, soil.mul(mix(vec3(1, 1, 1), vec3(0.62, 0.5, 0.38), site)), float(0.3).add(site.mul(0.45)));
  const fringe = float(1).sub(smoothstep(0.0, float(1.15).sub(site.mul(0.6)), d)).mul(0.55);
  const endFade = smoothstep(0.0, 5.0, attribute('aEnd', 'vec2').x.add(n1.mul(1.5)).add(pn.mul(1.2)));
  const alpha = max(max(cover, fringe), spill.mul(0.9)).mul(endFade);
  const surface = mix(fringeCol, col, max(cover, spill));

  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 0, roughness: 1 });
  material.colorNode = surface;
  material.opacityNode = alpha;
  material.roughnessNode = mix(float(0.93), float(0.3), wetPuddle);
  material.specularIntensityNode = mix(float(0.15), float(0.55), wetPuddle);
  material.normalNode = reliefNormal(height.mul(float(1).sub(wetPuddle)));
  const near = float(1).sub(smoothstep(12.0, 24.0, distance(cameraPosition, positionLocal)));
  const dig = attribute('aEnd', 'vec2').y.mul(near);
  const edgeDrop = smoothstep(hw, hw.add(0.5), aa).mul(0.035);
  material.positionNode = positionLocal.sub(vec3(0, min(dig, float(0.065)).add(edgeDrop), 0));
  material.transparent = true;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  return material;
}

export function createScatterMaterial() {
  const root = attribute('aRoot', 'vec4');
  const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  const k = float(1).sub(smoothstep(root.w.mul(0.55), root.w, distance(cameraPosition, root.xyz)));
  const h = positionLocal.y.sub(root.y);
  const gust = sin(time.mul(1.6).add(root.x.mul(0.4)).add(root.z.mul(0.3))).mul(0.5).add(0.6);
  const sway = h.mul(h).mul(gust).mul(0.25);
  const rel = positionLocal.sub(root.xyz);
  material.positionNode = root.xyz.add(rel.mul(k)).add(vec3(sway, 0, sway.mul(0.4)).mul(k));
  material.colorNode = attribute('color', 'vec3');
  return material;
}
