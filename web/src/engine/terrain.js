import * as THREE from 'three/webgpu';
import { heightAtPixel } from './world.js';
import { CLASS_STYLE, CLASS_NOISE } from './palette.js';
import { hash2 as hash, valueNoise } from './rng.js';
import { groundDetailArray, GROUND_TILE_METERS } from './textures.js';
import { SEASON, STRAW } from './season.js';
import { wearTerrain } from './wear.js';
import { noise2, fractalNoise2 } from './fastNoise.js';
import {
  texture, uv, positionLocal, positionWorld, positionView, normalView, vec2, vec3, float, mix,
  cross, dot, sign, abs, normalize, cos, sin, fract, min, fwidth, smoothstep, clamp,
} from 'three/tsl';

const CHUNK = 128;
const LOD_LEVELS = [
  { step: 1, distance: 0 },
  { step: 2, distance: 220 },
  { step: 4, distance: 520 },
  { step: 8, distance: 1100 },
];

export function createTerrain(world) {
  const { albedo, roughness } = buildTextures(world);
  world.albedo = albedo;
  const material = terrainMaterial(world, albedo, roughness);
  if (world.fine) material.positionNode = positionLocal.sub(vec3(0, world.fine.lowerNode(), 0));
  world.groundMaterial = (nodes) => terrainMaterial(world, albedo, roughness, nodes);

  const group = new THREE.Group();
  group.name = 'terrain';
  const chunks = world.size / CHUNK;
  for (let cj = 0; cj < chunks; cj++) {
    for (let ci = 0; ci < chunks; ci++) {
      const lod = new THREE.LOD();
      const cx = (ci + 0.5) * CHUNK - world.half;
      const cz = (cj + 0.5) * CHUNK - world.half;
      const cy = heightAtPixel(world, (ci + 0.5) * CHUNK, (cj + 0.5) * CHUNK);
      lod.position.set(cx, cy, cz);
      for (const { step, distance } of LOD_LEVELS) {
        const geometry = buildChunkGeometry(world, ci, cj, step, cx, cy, cz);
        lod.addLevel(new THREE.Mesh(geometry, material), distance);
      }
      group.add(lod);
    }
  }
  return group;
}

function terrainMaterial(world, albedo, roughness, nodes) {
  if (!world.classTex) {
    const created = new THREE.DataTexture(world.classes, world.size, world.size, THREE.RedFormat, THREE.UnsignedByteType);
    created.minFilter = THREE.NearestFilter;
    created.magFilter = THREE.NearestFilter;
    created.generateMipmaps = false;
    created.needsUpdate = true;
    world.classTex = created;
  }
  const classTex = world.classTex;
  const detail = groundDetailArray(world.meta.classes);
  const C = Object.fromEntries(world.meta.classes.map((name, i) => [name, i]));

  const material = new THREE.MeshPhysicalNodeMaterial({ roughness: 1, metalness: 0 });
  const wp = positionWorld.xz;
  const jitter = vec2(noise2(wp.mul(0.7)), noise2(wp.mul(0.7).add(31.7))).mul(0.6);
  const classUv = wp.add(jitter).add(world.half).div(world.size);
  const cls = texture(classTex, classUv).r.mul(255).round().toInt();

  const field = texture(world.fields, uv());
  const types = world.meta.fields?.types ?? null;
  const cropCode = types ? field.b.mul(255 / world.meta.fields.step).round() : null;
  const isCrop = types
    ? cropCode.greaterThan(0.5).select(1, 0).mul(cls.equal(C.crop).select(1, 0))
    : field.b.mul(cls.equal(C.crop).select(1, 0));
  const angle = field.r.mul(Math.PI);
  const plan = vec2(wp.x, wp.y.negate());
  const along = plan.x.mul(cos(angle)).add(plan.y.mul(sin(angle)));
  const across = plan.y.mul(cos(angle)).sub(plan.x.mul(sin(angle)));
  const detailUv = mix(wp.div(GROUND_TILE_METERS), vec2(across, along).div(GROUND_TILE_METERS), isCrop);

  const d1 = texture(detail, detailUv).depth(cls).rgb.mul(2);
  const d2 = texture(detail, detailUv.div(3.7).add(vec2(0.37, 0.71))).depth(cls).rgb.mul(2);
  const detailColor = d1.mul(mix(vec3(1), d2, 0.5));

  const cropWeight = world.cropsMeasured ? 0.85 : 0.45;
  let color = groundBaseColor(world, uv(), mix(float(0.85), float(cropWeight), isCrop)).mul(detailColor);
  const typeIs = (name) => cropCode.sub(types[name]).abs().lessThan(0.5).select(1, 0);
  let rowHeight = null;
  if (types) {
    color = mix(color, texture(world.macro, uv()).rgb.mul(mix(vec3(1), detailColor, 0.5)), isCrop);
  }

  const period = types ? mix(float(18), float(32), field.g) : 24;
  const lane = types ? across.add(sin(along.mul(0.021).add(field.g.mul(40))).mul(0.5)) : across;
  const x = fract(lane.div(period).add(field.g.mul(types ? 7.13 : 1))).mul(period).sub(types ? period.mul(0.5) : period / 2);
  const track = min(abs(x.sub(0.9)), abs(x.add(0.9)));
  const aa = fwidth(across).mul(0.5);
  let tram = float(1).sub(smoothstep(aa.negate().add(0.25), aa.add(0.3), track));
  if (types) {
    const standing = typeIs('wheat').add(typeIs('maize')).add(typeIs('rapeseed'));
    const broken = smoothstep(-0.55, 0.15, sin(along.mul(0.031).add(field.g.mul(9))).add(sin(along.mul(0.011).add(lane.mul(0.013)))).mul(0.5));
    tram = tram.mul(standing).mul(broken);
  }
  const swath = sin(across.mul((2 * Math.PI) / 6.1).add(noise2(plan.mul(0.02)).mul(3))).mul(0.035);
  color = color.mul(float(1).add(swath.mul(isCrop))).mul(mix(float(1), float(types ? 0.8 : 0.72), tram.mul(isCrop)));
  if (types) {
    const strength = sin(plan.x.mul(0.043).add(sin(plan.y.mul(0.057)).mul(2))).mul(0.2).add(0.85);
    const kinds = ['wheat', 'maize', 'rapeseed', 'plough', 'stubble'].map(typeIs);
    const [isWheat, isMaize, isRapeseed, isPlough, isStubble] = kinds;
    const rowPeriod = isWheat.mul(0.17).add(isMaize.mul(0.75)).add(isRapeseed.mul(0.42)).add(isPlough.mul(0.42)).add(isStubble.mul(0.2)).max(0.1);
    const rowFade = float(1).sub(smoothstep(rowPeriod.mul(0.18), rowPeriod.mul(0.5), fwidth(across))).mul(strength);
    const rowWave = sin(across.mul(Math.PI * 2).div(rowPeriod));
    const rowColor = rowWave.mul(isWheat.mul(0.07).add(isRapeseed.mul(0.09)).add(isPlough.mul(0.24)).add(isStubble.mul(0.06)));
    const maizeColor = smoothstep(-0.3, 0.5, rowWave).sub(0.5).mul(0.5).mul(isMaize);
    rowHeight = rowWave.mul(isWheat.mul(0.006).add(isRapeseed.mul(0.012)).add(isPlough.mul(0.045)).add(isStubble.mul(0.008)).add(isMaize.mul(0.035))).mul(rowFade);
    const rowsOut = rowColor.mul(rowFade).add(maizeColor.mul(rowFade));
    const mowBand = sin(across.mul((2 * Math.PI) / 4.6).add(sin(along.mul(0.04)).mul(1.2))).mul(0.07);
    const windrow = smoothstep(0.92, 1.0, sin(across.mul((2 * Math.PI) / 4.6).add(1.2))).mul(-0.12);
    const mown = mowBand.add(windrow).mul(typeIs('mown'));
    color = color.mul(float(1).add(rowsOut).add(mown));
  }

  const grassLike = cls.equal(C.grass).or(cls.equal(C.meadow)).or(cls.equal(C.residential))
    .or(cls.equal(C.industrial)).or(cls.equal(C.sport)).select(1, 0);
  color = mix(color, grassColor(color, wp), grassLike);
  const grainScale = 0.7;
  const grain = noise2(wp.mul(grainScale)).mul(0.14);
  const grainFade = float(1).sub(smoothstep(0.3, 0.9, fwidth(wp.x.mul(grainScale))));
  color = color.mul(float(1).add(grain.mul(grainFade).mul(grassLike)));

  const pavedLike = cls.equal(C.paved).or(cls.equal(C.road_major)).or(cls.equal(C.road_minor)).select(1, 0);
  const aggregate = noise2(wp.mul(70)).mul(0.6).add(noise2(wp.mul(190)).mul(0.4));
  const stain = smoothstep(0.35, 0.6, noise2(wp.mul(1.3).add(17.1))).mul(-0.12);
  const fine = float(1).sub(smoothstep(0.004, 0.02, fwidth(wp.x)));
  color = color.mul(float(1).add(aggregate.mul(0.22).mul(fine).add(stain).mul(pavedLike)));

  let wearRelief = null;
  if (world.wear) {
    const worn = wearTerrain(world, color, wp, { grassLike, notPaved: float(1).sub(pavedLike) });
    color = worn.color;
    wearRelief = worn.relief;
  }

  material.colorNode = color;
  material.roughnessNode = texture(roughness, uv()).g;
  material.specularIntensityNode = cls.equal(C.water).select(1, 0.15);
  let relief = dot(d1, vec3(1 / 3)).mul(0.012);
  if (rowHeight && !nodes) relief = relief.add(rowHeight);
  if (wearRelief && !nodes) relief = relief.add(wearRelief);
  material.normalNode = microReliefNormal(nodes ? relief.add(nodes.grain) : relief, nodes?.viewNormal);
  if (nodes) material.positionNode = nodes.position;
  return material;
}

export const GRASS_TINT = [0.92, 1.0, 0.8];

export function grassColor(color, xz, dryness = SEASON.grassDry) {
  const patches = fractalNoise2(xz.mul(0.08), 3, 2.0, 0.5);
  const dry = smoothstep(0.0, 0.45, patches);
  const lush = smoothstep(0.0, 0.4, patches.negate());
  let c = mix(color, color.mul(vec3(1.15, 1.05, 0.75)), dry.mul(0.5));
  c = mix(c, c.mul(vec3(0.85, 1.0, 0.8)), lush.mul(0.4));
  c = c.mul(vec3(...GRASS_TINT));
  if (dryness > 0) {
    const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const straw = vec3(...STRAW).mul(clamp(lum.div(GRASS_LUM), 0.7, 1.3));
    c = mix(c, straw, float(dryness).mul(float(1).sub(lush.mul(0.6))));
  }
  return c;
}

export const GRASS_LUM = 0.09;

export function groundBaseColor(world, uvNode, measuredWeight = float(0.85)) {
  const measured = texture(world.macro, uvNode);
  const lum = dot(measured.rgb, vec3(0.2126, 0.7152, 0.0722));
  const measuredColor = mix(vec3(lum), measured.rgb, 1.4).mul(0.8).max(0);
  return mix(texture(world.albedo, uvNode).rgb, measuredColor, measured.a.mul(measuredWeight));
}

export function microReliefNormal(height, baseNormal = normalView) {
  const sx = positionView.dFdx();
  const sy = positionView.dFdy();
  const n = baseNormal;
  const r1 = cross(sy, n);
  const r2 = cross(n, sx);
  const det = dot(sx, r1);
  const grad = sign(det).mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)));
  return normalize(abs(det).mul(n).sub(grad));
}

function buildChunkGeometry(world, ci, cj, step, cx, cy, cz) {
  const n = CHUNK / step;
  const vpr = n + 1;
  const gridCount = vpr * vpr;
  const skirtCount = 4 * vpr;
  const positions = new Float32Array((gridCount + skirtCount) * 3);
  const normals = new Float32Array((gridCount + skirtCount) * 3);
  const uvs = new Float32Array((gridCount + skirtCount) * 2);
  const indices = [];

  const setVertex = (v, pi, pj, dy) => {
    const x = pi - world.half + 0.5;
    const z = pj - world.half + 0.5;
    positions[v * 3] = x - cx;
    positions[v * 3 + 1] = heightAtPixel(world, pi, pj) - cy - dy;
    positions[v * 3 + 2] = z - cz;
    const s = step;
    const dx = (heightAtPixel(world, pi + s, pj) - heightAtPixel(world, pi - s, pj)) / (2 * s);
    const dz = (heightAtPixel(world, pi, pj + s) - heightAtPixel(world, pi, pj - s)) / (2 * s);
    const len = Math.hypot(dx, 1, dz);
    normals[v * 3] = -dx / len;
    normals[v * 3 + 1] = 1 / len;
    normals[v * 3 + 2] = -dz / len;
    uvs[v * 2] = (pi + 0.5) / world.size;
    uvs[v * 2 + 1] = (pj + 0.5) / world.size;
  };

  const i0 = ci * CHUNK;
  const j0 = cj * CHUNK;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) setVertex(j * vpr + i, i0 + i * step, j0 + j * step, 0);
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * vpr + i;
      const b = a + vpr;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const skirtDepth = 2 * step;
  const edges = [
    (k) => [k, 0],
    (k) => [k, n],
    (k) => [0, k],
    (k) => [n, k],
  ];
  let v = gridCount;
  for (const edge of edges) {
    const start = v;
    for (let k = 0; k <= n; k++) {
      const [i, j] = edge(k);
      setVertex(v++, i0 + i * step, j0 + j * step, skirtDepth);
    }
    for (let k = 0; k < n; k++) {
      const [ia, ja] = edge(k);
      const [ib, jb] = edge(k + 1);
      const top0 = ja * vpr + ia;
      const top1 = jb * vpr + ib;
      const bot0 = start + k;
      const bot1 = start + k + 1;
      indices.push(top0, bot0, top1, top1, bot0, bot1, top0, top1, bot0, top1, bot1, bot0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function buildTextures(world) {
  const { size, classes } = world;
  const names = world.meta.classes;
  const styles = names.map((name) => CLASS_STYLE[name] ?? CLASS_STYLE.grass);
  const noiseAmp = names.map((name) => CLASS_NOISE[name] ?? 0.1);

  const color = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const p = j * size + i;
      const c = classes[p];
      const style = styles[c];
      const n = 0.5 * valueNoise(i / 64, j / 64) + 0.3 * valueNoise(i / 16, j / 16) + 0.2 * hash(i, j);
      const k = 1 + (n - 0.5) * 2 * noiseAmp[c];
      color[p * 4] = clamp255(style.color[0] * k);
      color[p * 4 + 1] = clamp255(style.color[1] * k);
      color[p * 4 + 2] = clamp255(style.color[2] * k);
      color[p * 4 + 3] = 255;
      rough[p * 4 + 1] = clamp255(style.roughness * 255);
      rough[p * 4 + 3] = 255;
    }
  }

  const albedo = new THREE.DataTexture(color, size, size, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const roughness = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);
  for (const tex of [albedo, roughness]) {
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  }
  return { albedo, roughness };
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
