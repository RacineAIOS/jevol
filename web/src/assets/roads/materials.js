import * as THREE from 'three/webgpu';
import {
  attribute, uv, positionWorld, vec2, vec3, float, mix, min, max, abs, floor, fract, sin, dot, step, length,
  smoothstep, clamp, fwidth, mx_noise_float, mx_fractal_noise_float, mx_worley_noise_vec2,
} from 'three/tsl';

const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const nz = (p, k, seed) => mx_noise_float(vec3(p.mul(k), seed));

function lineCov(d, hw, px) {
  const h = float(hw);
  const edge = clamp(h.sub(abs(d)).div(px.mul(0.7)).add(0.5), 0, 1);
  return edge.mul(min(float(1), h.mul(2).div(px.mul(1.4))));
}

function dashCov(s, period, on) {
  const f = s.div(period);
  const w = max(fwidth(f), 1e-5);
  const onFrac = float(on / period);
  const ph = fract(f);
  const sq = smoothstep(0, w, ph).mul(float(1).sub(smoothstep(onFrac.sub(w), onFrac, ph)));
  return mix(sq, onFrac, smoothstep(0.15, 0.4, w));
}

const indicator = (code, k) => max(float(0), float(1).sub(abs(code.sub(k))));

export const PAINT = vec3(0.66, 0.66, 0.63);

export function asphaltMaterial({ worn = false } = {}) {
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const A = attribute('rdA', 'vec4');
  const B = attribute('rdB', 'vec4');
  const C = attribute('rdC', 'vec4');
  const width = A.x;
  const centre = floor(A.y.add(0.5));
  const edgeCode = floor(A.z.add(0.5));
  const lanes = max(floor(A.w.add(0.5)), 1);
  const u = B.x;
  const seed = B.y;
  const wear = worn ? B.z.add(0.0) : B.z;
  const tone = B.w;
  const flare = C.x;
  const across = uv().x;
  const along = uv().y;
  const wp = positionWorld.xz;
  const fw = fwidth(wp);
  const px = max(max(fw.x, fw.y), 1e-4);
  const half = width.mul(0.5);

  const fresh = vec3(0.078, 0.074, 0.066);
  const old = vec3(0.275, 0.258, 0.232);
  const warm = nz(wp, 0.02, seed.add(21)).mul(0.012);
  let col = mix(fresh, old, tone).add(vec3(warm, warm.mul(0.5), warm.mul(-0.8)));
  const fadeFine = float(1).sub(smoothstep(0.02, 0.06, px));
  const fadeMid = float(1).sub(smoothstep(0.1, 0.45, px));
  const nBig = mx_fractal_noise_float(vec3(wp.mul(0.11), seed), 2, 2, 0.5);
  const nMid = nz(wp, 3.5, seed.add(3));
  const nFine = nz(wp, 46, seed.add(7));
  const nGrain = nz(wp, 150, seed.add(8));
  col = col.mul(float(1).add(nBig.mul(0.2)).add(nMid.mul(0.12).mul(fadeMid)).add(nFine.mul(0.24).mul(fadeFine)).add(nGrain.mul(0.17).mul(fadeFine)));

  const laneW = width.div(lanes);
  const q = across.add(half).div(laneW);
  const off = fract(q).sub(0.5).mul(laneW);
  const trackD = abs(abs(off).sub(0.8));
  const trackVar = float(0.7).add(nz(vec2(along, 0), 0.07, seed.add(2)).mul(0.3));
  const track = float(1).sub(smoothstep(0.12, 0.4, trackD)).mul(trackVar);
  const midStrip = float(1).sub(smoothstep(0.0, 0.3, abs(off)));
  const laneEdge = smoothstep(1.15, 1.6, abs(off));
  col = col.mul(float(1).sub(track.mul(float(0.13).add(wear.mul(0.2)))));
  col = col.mul(float(1).sub(midStrip.mul(0.05)));
  col = col.mul(float(1).add(laneEdge.mul(0.1)));
  const bleedZone = smoothstep(0.35, 0.65, nz(vec2(along, 0), 0.05, seed.add(70)).mul(0.5).add(0.5).add(wear.mul(0.35)).sub(0.2));
  const bleed = track.mul(bleedZone).mul(smoothstep(0.1, 0.5, wear.add(tone.mul(0.3))));
  col = col.mul(float(1).sub(bleed.mul(0.28)));
  const narrow = step(lanes, 1.5).mul(step(width, 4.8));
  col = mix(col, vec3(0.13, 0.13, 0.09), narrow.mul(midStrip).mul(wear).mul(0.45));

  const zone2 = nz(wp, 0.13, seed.add(10)).mul(0.5).add(0.5);
  const m2 = smoothstep(zone2.sub(0.1), zone2.add(0.1), wear.sub(0.3).mul(1.2)).mul(float(0.35).add(track.mul(0.65)));
  const wv = mx_worley_noise_vec2(wp.mul(3.2).add(seed));
  const dAlley = wv.y.sub(wv.x).mul(0.5).div(3.2);
  const crackFade = float(1).sub(smoothstep(0.03, 0.14, px));
  const sYc = along.add(seed.mul(5.3));
  const tci = floor(sYc.div(6.5));
  const th1 = hash21(vec2(tci, seed.add(1)));
  const tpos = tci.mul(6.5).add(hash21(vec2(tci, seed.add(2))).mul(6.0)).add(nz(vec2(across, tci), 1.1, seed.add(3)).mul(0.12));
  const a0 = hash21(vec2(tci, seed.add(4))).mul(width).sub(half);
  const aLen = hash21(vec2(tci, seed.add(5))).mul(2.8).add(0.8);
  const aMask = smoothstep(a0, a0.add(0.15), across).mul(float(1).sub(smoothstep(a0.add(aLen), a0.add(aLen).add(0.15), across)));
  const cTrans = lineCov(sYc.sub(tpos), worn ? 0.007 : 0.0045, px).mul(aMask).mul(step(th1, wear.mul(0.9).add(0.1)));
  const lw = floor(q);
  const lOff = off.sub(hash21(vec2(lw, seed.add(6))).sub(0.5).mul(0.9)).sub(nz(vec2(along, lw), 0.17, seed.add(7)).mul(0.1));
  const lMask = smoothstep(0.1, 0.35, nz(vec2(along, lw), 0.045, seed.add(8)).mul(0.5).add(0.5).add(wear.mul(0.4)).sub(0.5));
  const cLong = lineCov(lOff.sub(0.9), worn ? 0.0065 : 0.004, px).mul(lMask).mul(smoothstep(0.15, 0.5, wear));
  const crack = max(max(lineCov(dAlley, 0.0028, px).mul(m2), cTrans), cLong).mul(crackFade);
  col = col.mul(float(1).sub(crack.mul(0.72)));

  const sealPos = hash21(vec2(seed, 9.1)).sub(0.5).mul(width).mul(0.5).add(nz(vec2(along, 0), 0.07, seed.add(11)).mul(0.28));
  const sealRuns = smoothstep(0.1, 0.35, nz(vec2(along, 0), 0.03, seed.add(12)).mul(0.5).add(0.5).add(wear.mul(0.5)).sub(0.45));
  const seal = lineCov(across.sub(sealPos), 0.016, px).mul(sealRuns).mul(smoothstep(0.2, 0.5, wear));
  col = mix(col, vec3(0.018), seal.mul(0.85));

  const sY = along.add(seed.mul(13.7));
  const cellL = 11.0;
  const ci = floor(sY.div(cellL));
  const cj = floor(across.add(half).div(laneW));
  const hv = vec2(ci, cj.add(seed.mul(7)));
  const h1 = hash21(hv);
  const h2 = hash21(hv.add(11.3));
  const h3 = hash21(hv.add(27.1));
  const h4 = hash21(hv.add(5.7));
  const h5 = hash21(hv.add(91.9));
  const hsx = h4.mul(2.0).add(0.6);
  const hsy = min(h5.mul(0.8).add(0.3), laneW.mul(0.42));
  const cx = hsx.add(h2.mul(float(cellL).sub(hsx.mul(2))));
  const cy = hsy.add(h3.mul(laneW.sub(hsy.mul(2))));
  const lx = sY.sub(ci.mul(cellL));
  const ly = across.add(half).sub(cj.mul(laneW));
  const wob = nz(wp, 5, seed.add(40)).mul(0.07);
  const dd = max(abs(lx.sub(cx)).sub(hsx), abs(ly.sub(cy)).sub(hsy)).add(wob);
  const exists = step(h1, worn ? wear.mul(0.5).add(0.22) : wear.mul(0.5));
  const inside = float(1).sub(smoothstep(px.mul(-0.6), px.mul(0.6), dd));
  const patchTone = mix(fresh, old, tone.mul(0.35)).mul(0.9);
  const patchCol = patchTone.mul(float(1).add(nFine.mul(0.2).mul(fadeFine)).add(nMid.mul(0.06).mul(fadeMid)));
  col = mix(col, patchCol, inside.mul(exists));
  col = mix(col, vec3(0.02), lineCov(dd, 0.013, px).mul(exists).mul(0.85));
  const tcell = floor(sY.div(53.0));
  const th = hash21(vec2(tcell, seed));
  const tcen = tcell.mul(53.0).add(6.0).add(hash21(vec2(tcell, seed.add(3))).mul(40.0));
  const td = abs(sY.sub(tcen));
  const tex = step(th, wear.mul(0.55));
  const tIn = float(1).sub(smoothstep(px.mul(-0.6).add(0.275), px.mul(0.6).add(0.275), td));
  col = mix(col, patchCol.mul(1.1), tIn.mul(tex));
  col = mix(col, vec3(0.02), lineCov(td.sub(0.28), 0.012, px).mul(tex).mul(0.85));

  if (worn) {
    const pxFade = float(1).sub(smoothstep(0.05, 0.25, px));
    const oilCell = mx_worley_noise_vec2(vec2(along.mul(0.5), off.mul(1.8)).add(seed.mul(3.1)));
    const oilOn = smoothstep(0.0, 0.5, nz(wp, 0.12, seed.add(80)).add(wear.mul(0.4)));
    const oil = float(1).sub(smoothstep(0.1, 0.3, oilCell.x)).mul(oilOn).mul(float(1).sub(smoothstep(0.2, 0.55, abs(off)))).mul(pxFade);
    col = col.mul(float(1).sub(oil.mul(0.42)));
    const stain = smoothstep(0.1, 0.5, nz(wp, 0.3, seed.add(81)).add(nz(wp, 1.1, seed.add(82)).mul(0.4)).add(wear.mul(0.25)).sub(0.2));
    col = col.mul(float(1).sub(stain.mul(0.2)));
    const skCell = floor(along.add(seed.mul(9.1)).div(41.0));
    const skStart = skCell.mul(41.0).add(hash21(vec2(skCell, seed.add(90))).mul(20.0));
    const skLen = hash21(vec2(skCell, seed.add(91))).mul(9.0).add(5.0);
    const skAlong = along.add(seed.mul(9.1)).sub(skStart);
    const skOn = step(0.62, hash21(vec2(skCell, seed.add(92)))).mul(step(0.0, skAlong)).mul(float(1).sub(smoothstep(skLen.sub(1.5), skLen, skAlong)));
    const skOff = off.add(sin(skAlong.mul(0.25)).mul(0.1)).add(skAlong.mul(0.03));
    const skid = max(lineCov(abs(skOff).sub(0.78), 0.055, px), float(0)).mul(skOn).mul(smoothstep(0.0, 1.5, skAlong));
    col = col.mul(float(1).sub(skid.mul(0.5)));
    const sgn = step(0, across);
    const eJ = half.add(flare).sub(abs(across));
    const jw = nz(vec2(along, sgn), 0.22, seed.add(95)).mul(0.04).add(0.07);
    const joint = lineCov(eJ.sub(0.55).add(nz(vec2(along, sgn), 0.4, seed.add(96)).mul(0.12)), jw, px).mul(smoothstep(-0.2, 0.3, nz(vec2(along, sgn), 0.06, seed.add(97)).add(wear.mul(0.4))));
    col = mix(col, vec3(0.045, 0.043, 0.04), joint.mul(0.8));
    const pcell = floor(sY.div(9.0));
    const pj = floor(across.add(half).div(laneW));
    const pv = vec2(pcell.add(seed.mul(3)), pj);
    const pOn = step(hash21(pv.add(3.3)), wear.mul(0.22));
    const pcx = hash21(pv.add(7.7)).mul(6.0).add(1.5);
    const pcy = hash21(pv.add(9.1)).mul(laneW.sub(1.2)).add(0.6);
    const pr = hash21(pv.add(2.2)).mul(0.25).add(0.18);
    const pd = length(vec2(sY.sub(pcell.mul(9.0)).sub(pcx), across.add(half).sub(pj.mul(laneW)).sub(pcy).mul(1.3)));
    const pot = float(1).sub(smoothstep(pr.sub(0.04), pr, pd)).mul(pOn);
    const rim = smoothstep(pr, pr.add(0.05), pd).mul(float(1).sub(smoothstep(pr.add(0.05), pr.add(0.14), pd))).mul(pOn);
    col = mix(col, vec3(0.035, 0.034, 0.03), pot.mul(0.9));
    col = col.mul(float(1).add(rim.mul(0.35)));
  }

  const e = half.add(flare).sub(abs(across));
  const nEdge = nz(vec2(along, 0), 0.8, seed.add(50)).mul(0.5).add(0.5);
  const nHigh = nz(wp, 17, seed.add(51));
  const cut = worn ? max(wear.mul(0.42).mul(nEdge.mul(nEdge)).add(nz(wp, 1.7, seed.add(53)).mul(0.07)).add(nHigh.mul(0.06)).add(0.02), 0) : max(wear.mul(0.2).mul(nEdge).add(nHigh.mul(0.05)).add(0.01), 0);
  const dirt = float(1).sub(smoothstep(0.04, worn ? 0.95 : 0.5, e)).mul(float(0.3).add(wear.mul(0.7))).mul(nz(wp, 2.5, seed.add(52)).mul(0.4).add(0.6));
  col = col.mul(float(1).add(smoothstep(1.4, 0.35, e).mul(0.13).mul(float(0.4).add(wear))));
  col = mix(col, vec3(0.17, 0.15, 0.12).mul(float(0.8).add(nFine.mul(0.3).mul(fadeFine))), dirt.mul(0.75));
  col = col.add(step(0.72, nGrain).mul(dirt).mul(0.05).mul(fadeFine));
  if (worn) {
    col = mix(col, vec3(0.2, 0.19, 0.16), step(0.8, nFine.mul(0.5).add(0.5)).mul(dirt).mul(fadeFine).mul(0.5));
    col = mix(col, vec3(0.07, 0.09, 0.03), step(0.55, nz(wp, 5.5, seed.add(54))).mul(float(1).sub(smoothstep(0.0, 0.3, e))).mul(smoothstep(0.1, 0.5, wear)).mul(0.7));
  }

  const qi = floor(q.add(0.5));
  const valid = step(0.5, qi).mul(step(qi, lanes.sub(0.5)));
  const dq = abs(q.sub(qi)).mul(laneW);
  const aux = float(2).mul(u);
  const cT1 = lineCov(dq, u, px).mul(dashCov(along, 13, 3));
  const cCont = lineCov(dq, u, px);
  const cDouble = lineCov(dq.sub(aux), u, px);
  const cT3 = lineCov(dq, u, px).mul(dashCov(along, 4.33, 3));
  const centreCov = cT1.mul(indicator(centre, 1)).add(cCont.mul(indicator(centre, 2))).add(cDouble.mul(indicator(centre, 3))).add(cT3.mul(indicator(centre, 4))).mul(valid);
  const hwE = u.mul(1.5);
  const eD = abs(across).sub(half.sub(0.28).sub(hwE));
  const eCov = lineCov(eD, hwE, px);
  const eSide = max(indicator(edgeCode, 1).add(indicator(edgeCode, 2)), indicator(edgeCode, 3).mul(step(0, across)));
  const eDash = mix(float(1), dashCov(along, 26, 20), indicator(edgeCode, 2));
  const noMouth = float(1).sub(smoothstep(0.0, 0.15, flare));
  const edgeCov = eCov.mul(eSide).mul(eDash).mul(noMouth);

  const pw = worn ? wear.mul(0.85).add(0.1) : wear.mul(0.85);
  const n1 = mix(float(0.5), nz(wp, 4.5, seed.add(60)).mul(0.5).add(0.5), float(1).sub(smoothstep(0.03, 0.12, px)));
  const n2 = mix(float(0.5), nz(wp, 38, seed.add(61)).mul(0.5).add(0.5), fadeFine);
  const thick = float(1).sub(pw.mul(float(0.3).add(n1.mul(0.9)))).sub(pw.mul(n2).mul(0.3));
  const alive = smoothstep(0.32, 0.62, thick);
  const mark = max(centreCov, edgeCov).mul(alive);
  col = mix(col, PAINT.mul(float(0.78).add(thick.mul(0.22))), mark);

  material.colorNode = col;
  const rough = float(0.9).sub(track.mul(0.12)).sub(midStrip.mul(0.04));
  material.roughnessNode = mix(mix(mix(rough, float(0.5), bleed), float(0.34), seal.mul(0.8)), float(0.55), mark);
  material.opacityNode = step(cut, e);
  material.alphaTest = 0.5;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  return material;
}

export function vergeMaterial({ worn = false } = {}) {
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const A = attribute('rdA', 'vec4');
  const B = attribute('rdB', 'vec4');
  const G = attribute('rdC', 'vec4').xyz;
  const lat = uv().x;
  const s = uv().y;
  const W = A.x;
  const mat = floor(A.y.add(0.5));
  const seed = B.x;
  const wp = positionWorld.xz;
  const fw = fwidth(wp);
  const px = max(max(fw.x, fw.y), 1e-4);
  const fadeFine = float(1).sub(smoothstep(0.02, 0.07, px));
  const fadeMid = float(1).sub(smoothstep(0.1, 0.5, px));
  const nBig = mx_fractal_noise_float(vec3(wp.mul(0.3), seed), 3, 2, 0.5);
  const nMid = nz(wp, 2.2, seed.add(2));
  const nFine = nz(wp, 30, seed.add(3));
  const nPeb = nz(wp, 70, seed.add(4));
  const streak = mx_noise_float(vec3(lat.mul(5), s.mul(0.5), seed.add(5)));

  const g0 = G;
  const shortG = g0.mul(float(1).add(nBig.mul(0.25)).add(nMid.mul(0.16).mul(fadeMid)).add(nFine.mul(0.2).mul(fadeFine)));
  const dryG = vec3(0.23, 0.2, 0.085).mul(float(1).add(nBig.mul(0.3)).add(streak.mul(0.22).mul(fadeMid)).add(nFine.mul(0.2).mul(fadeFine)));
  const gravel = vec3(0.2, 0.18, 0.15).mul(float(1).add(nMid.mul(0.15).mul(fadeMid)).add(nPeb.mul(0.28).mul(fadeFine)));
  const jf = fract(s);
  const joint = float(1).sub(smoothstep(0.0, 0.015, min(jf, float(1).sub(jf)).mul(1.0))).mul(fadeMid);
  const concrete = vec3(0.3, 0.3, 0.28).mul(float(1).add(nMid.mul(0.08)).add(nFine.mul(0.1).mul(fadeFine))).mul(float(1).sub(joint.mul(0.3)));
  const face = concrete.mul(0.78);
  const weeds = vec3(0.16, 0.17, 0.08).mul(float(1).add(nFine.mul(0.3).mul(fadeFine)));
  const median = mix(gravel, weeds, smoothstep(0.0, 0.5, nBig.add(nMid.mul(0.4))));

  const grassy = max(indicator(mat, 1), max(indicator(mat, 2), indicator(mat, 5)));
  const dustW = float(0.18).add(nz(vec2(s, 0), 0.9, seed.add(6)).mul(0.5).add(0.5).mul(0.4)).add(nMid.mul(0.1));
  const dust = float(1).sub(smoothstep(dustW.mul(0.5), dustW.add(0.2), lat));
  const grassCol = mix(shortG, dryG, indicator(mat, 2));
  let vergeCol = mix(grassCol, gravel.mul(1.05), dust.mul(0.85));
  if (worn) {
    const bandN = nz(vec2(s, 0), 0.3, seed.add(20)).mul(0.5).add(0.5);
    const bandW = float(0.5).add(bandN.mul(0.9)).add(nz(wp, 2.2, seed.add(21)).mul(0.28)).add(nz(wp, 9, seed.add(22)).mul(0.1));
    const bare = float(1).sub(smoothstep(bandW.sub(0.1), bandW.add(0.14), lat));
    const earth = vec3(0.17, 0.138, 0.1).mul(float(1).add(nMid.mul(0.22)).add(nFine.mul(0.25).mul(fadeFine)));
    const grit = step(0.35, nPeb).mul(fadeFine).mul(0.22);
    const bareCol = mix(earth, gravel.mul(1.2), smoothstep(0.1, 0.6, nz(wp, 1.3, seed.add(23)).add(float(1).sub(lat.div(bandW)).mul(0.5)))).add(vec3(grit));
    vergeCol = mix(grassCol, bareCol, bare.mul(0.96));
    const lip = smoothstep(W.sub(0.55), W.sub(0.05), lat);
    const lipCol = mix(earth.mul(0.8), grassCol.mul(0.8), step(0.55, nz(wp, 14, seed.add(24)).mul(0.5).add(0.5)).mul(0.7));
    vergeCol = mix(vergeCol, lipCol, lip.mul(0.75));
  }
  const outer = G.mul(vec3(0.95, 0.98, 1.0));
  let col = vergeCol.mul(grassy)
    .add(gravel.mul(indicator(mat, 0)))
    .add(concrete.mul(indicator(mat, 3)))
    .add(face.mul(indicator(mat, 4)))
    .add(median.mul(indicator(mat, 6)));
  if (!worn) col = mix(col, mix(col, outer, 0.5), grassy.mul(smoothstep(W.mul(0.45), W, lat)));
  material.colorNode = col;
  material.roughnessNode = float(0.97).sub(indicator(mat, 3).add(indicator(mat, 4)).mul(0.12));
  const edgeN = nz(wp, 0.9, seed.add(8)).mul(0.5).add(nz(wp, 3.5, seed.add(9)).mul(0.3)).add(nz(wp, 13, seed.add(10)).mul(0.2));
  const fade = worn
    ? float(1).sub(smoothstep(W.add(edgeN.mul(0.55)).sub(0.1), W.add(edgeN.mul(0.55)).add(0.3), lat))
    : float(1).sub(smoothstep(W.sub(0.75).add(edgeN.mul(0.8)), W.add(1.0), lat));
  material.opacityNode = max(fade, float(1).sub(grassy));
  material.transparent = true;
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  return material;
}

export function paintMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const wear = attribute('pw', 'float');
  const wp = positionWorld.xz;
  const fw = fwidth(wp);
  const px = max(max(fw.x, fw.y), 1e-4);
  const fadeFine = float(1).sub(smoothstep(0.02, 0.07, px));
  const n1 = mix(float(0.5), nz(wp, 4.5, wear.mul(31)).mul(0.5).add(0.5), float(1).sub(smoothstep(0.03, 0.12, px)));
  const n2 = mix(float(0.5), nz(wp, 38, wear.mul(17)).mul(0.5).add(0.5), fadeFine);
  const pw = wear.mul(0.85);
  const thick = float(1).sub(pw.mul(float(0.3).add(n1.mul(0.9)))).sub(pw.mul(n2).mul(0.3));
  material.colorNode = PAINT.mul(float(0.78).add(thick.mul(0.22)));
  material.opacityNode = smoothstep(0.2, 0.7, thick);
  material.transparent = true;
  material.depthWrite = false;
  material.roughnessNode = float(0.55);
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -8;
  return material;
}

export function furnitureMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('pbr', 'vec2');
  material.roughnessNode = pbr.x;
  material.metalnessNode = pbr.y;
  material.side = THREE.DoubleSide;
  return material;
}

export function signMaterial(map) {
  const material = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.7, metalness: 0.0 });
  material.alphaTest = 0.5;
  material.side = THREE.FrontSide;
  return material;
}
