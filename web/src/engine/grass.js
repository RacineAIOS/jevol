import * as THREE from 'three/webgpu';
import {
  instanceIndex, cameraPosition, cameraViewMatrix, positionGeometry, texture, uniform, varying, time,
  vec2, vec3, vec4, float, floor, fract, sin, cos, dot, length, mix, smoothstep, normalize, step,
} from 'three/tsl';
import { groundBaseColor, grassColor } from './terrain.js';
import { wearGrass } from './wear.js';
import { windStrength } from './wind.js';

export const GRASS_QUALITY = {
  low: null,
  medium: [
    { grid: 160, spacing: 0.07, width: 0.4, contrast: 0.22, altitude: [3, 8] },
    { grid: 224, spacing: 0.3, width: 1, contrast: 0.18, altitude: [35, 80] },
    { grid: 192, spacing: 0.8, width: 2.5, contrast: 0.07, altitude: [70, 160] },
  ],
  high: [
    { grid: 192, spacing: 0.07, width: 0.4, contrast: 0.22, altitude: [3, 8] },
    { grid: 320, spacing: 0.25, width: 1, contrast: 0.18, altitude: [35, 80] },
    { grid: 256, spacing: 0.6, width: 2.2, contrast: 0.1, altitude: [70, 160] },
    { grid: 224, spacing: 1.5, width: 5, contrast: 0.05, altitude: [140, 300] },
  ],
};

const GRASS_BY_CLASS = {
  grass: [1.0, 0.1],
  meadow: [1.0, 0.13],
  residential: [0.9, 0.07],
  industrial: [0.85, 0.14],
  forest_broadleaf: [0.3, 0.12],
  forest_conifer: [0.2, 0.1],
  forest_mixed: [0.3, 0.12],
  scrub: [0.7, 0.2],
  sport: [1.0, 0.04],
  railway: [0.05, 0.08],
  bare: [0.1, 0.07],
};
const MAX_HEIGHT = 0.6;

export const GRASS_OPTION_DEFAULTS = { groundNormal: false, dropAbsent: false };

export function createGrass(world, { quality = 'high', fine = null, sun = null, ...grassOptions } = {}) {
  const rings = GRASS_QUALITY[quality];
  if (!rings) return null;
  const options = { ...GRASS_OPTION_DEFAULTS, ...grassOptions };

  const n = world.size * world.size;
  const half = new Uint16Array(n);
  for (let i = 0; i < n; i++) half[i] = THREE.DataUtils.toHalfFloat(world.heights[i]);
  const heightTex = new THREE.DataTexture(half, world.size, world.size, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;

  const classes = world.meta.classes;
  const lut = new Uint8Array(classes.length * 4);
  classes.forEach((name, i) => {
    const [density, height] = GRASS_BY_CLASS[name] ?? [0, 0];
    lut[i * 4] = Math.round(density * 255);
    lut[i * 4 + 1] = Math.round((height / MAX_HEIGHT) * 255);
    lut[i * 4 + 3] = 255;
  });
  const lutTex = new THREE.DataTexture(lut, classes.length, 1, THREE.RGBAFormat);
  lutTex.magFilter = THREE.NearestFilter;
  lutTex.minFilter = THREE.NearestFilter;
  lutTex.needsUpdate = true;

  const sunDir = uniform(new THREE.Vector3(0, 1, 0));
  const shared = { world, heightTex, lutTex, classCount: classes.length, fine, options, sunDir };
  const group = new THREE.Group();
  group.name = 'grass';
  const built = [];
  let inner = null;
  let innerFade = null;
  rings.forEach((ring, k) => {
    const radius = (ring.grid * ring.spacing) / 2;
    const last = k === rings.length - 1;
    const fadeOut = [radius * (last ? 0.35 : 0.6), radius * 0.95];
    const r = createRing(shared, ring, inner, fadeOut, innerFade);
    group.add(r.mesh);
    built.push({ ...r, ring });
    inner = fadeOut;
    innerFade = r.altitudeFade;
  });

  return {
    mesh: group,
    count: rings.reduce((sum, r) => sum + r.grid * r.grid, 0),
    reach: inner[1],
    update(altitude) {
      if (options.groundNormal && sun) sunDir.value.subVectors(sun.position, sun.target.position).normalize();
      for (const r of built) {
        const f = 1 - THREE.MathUtils.smoothstep(altitude, r.ring.altitude[0], r.ring.altitude[1]);
        r.altitudeFade.value = f;
        r.mesh.visible = f > 0;
      }
      group.visible = built.some((r) => r.mesh.visible);
    },
  };
}

function createRing({ world, heightTex, lutTex, classCount, fine, options, sunDir }, ring, fadeIn, fadeOut, innerFade) {
  const { grid: G, spacing, width, contrast } = ring;

  const idx = float(instanceIndex);
  const gx = idx.mod(G);
  const gz = floor(idx.div(G));
  const cell = floor(cameraPosition.xz.div(spacing)).sub(G / 2).add(vec2(gx, gz));
  const hash = (offset) => fract(sin(dot(cell.mod(4096).add(offset), vec2(127.1, 311.7))).mul(43758.5453));
  const h1 = hash(0);
  const h2 = hash(17.31);
  const h3 = hash(41.7);
  const xz = cell.add(vec2(h1, h2)).mul(spacing);
  const worldUv = xz.add(world.half).div(world.size);

  const baseY = texture(heightTex, worldUv).r;
  const groundY = fine ? baseY.add(fine.grassOffsetNode(xz)) : baseY;
  const cls = texture(world.classTex, worldUv).r.mul(255).round();
  const params = texture(lutTex, vec2(cls.add(0.5).div(classCount), 0.5));
  const dist = length(xz.sub(cameraPosition.xz));
  const worn = world.wear ? wearGrass(world, xz) : null;
  const density = worn ? params.r.mul(worn.density) : params.r;
  const classHeight = worn ? params.g.mul(MAX_HEIGHT).mul(worn.height) : params.g.mul(MAX_HEIGHT);

  const altitudeFade = uniform(1);
  const grow = fadeIn ? mix(float(1), smoothstep(fadeIn[0], fadeIn[1], dist), innerFade) : float(1);
  const shrink = float(1).sub(smoothstep(fadeOut[0], fadeOut[1], dist));
  const present = step(h3, density);
  const height = classHeight.mul(h1.mul(0.8).add(0.6)).mul(grow).mul(shrink).mul(present).mul(altitudeFade);

  const p = positionGeometry;
  const angle = h2.mul(Math.PI * 2);
  const c = cos(angle);
  const s = sin(angle);
  const widen = dist.div(60).add(1).mul(width);
  let local = vec2(p.x.mul(c).sub(p.z.mul(s)), p.x.mul(s).add(p.z.mul(c))).mul(widen);
  if (options.dropAbsent) local = local.mul(step(0.002, height));
  const gust = sin(time.mul(1.6).add(xz.x.mul(0.35)).add(xz.y.mul(0.22))).mul(0.5).add(0.6);
  const flutter = sin(time.mul(7.0).add(h1.mul(30))).mul(0.15);
  const bend = gust.add(flutter).mul(windStrength).mul(p.y.mul(p.y)).mul(height).mul(0.35);
  const position = vec3(
    xz.x.add(local.x).add(bend.mul(0.9)),
    groundY.add(p.y.mul(height)).sub(0.02),
    xz.y.add(local.y).add(bend.mul(0.4)),
  );

  const ground = groundBaseColor(world, worldUv);
  let base = grassColor(ground, xz);
  const near = float(1).sub(smoothstep(6, 20, dist));
  const greenTuft = step(hash(73.1), 0.25);
  const greenPart = mix(float(1).sub(p.y).mul(0.6), float(0.8), greenTuft).mul(near);
  base = mix(base, grassColor(ground, xz, 0), greenPart);
  if (worn) base = worn.tint(base);
  if (options.groundNormal) base = base.mul(hash(91.7).mul(0.1).add(0.95));
  const color = varying(base.mul(mix(float(1 - contrast), float(1 + contrast), p.y)), 'vGrassColor');
  const side = vec3(s.negate(), 0, c);
  let normalWorld = varying(normalize(vec3(0, 1, 0).add(side.mul(0.25))), 'vGrassNormal');
  if (options.groundNormal) {
    const e = 1 / world.size;
    const dx = texture(heightTex, worldUv.add(vec2(e, 0))).r.sub(texture(heightTex, worldUv.sub(vec2(e, 0))).r).mul(0.5);
    const dz = texture(heightTex, worldUv.add(vec2(0, e))).r.sub(texture(heightTex, worldUv.sub(vec2(0, e))).r).mul(0.5);
    const toSun = vec3(sunDir.x, 0, sunDir.z).add(vec3(1e-4, 0, 0)).normalize();
    const lean = hash(57.3).mul(0.22).add(0.08);
    normalWorld = varying(normalize(vec3(dx.negate(), 1, dz.negate()).add(toSun.mul(lean))), 'vGrassNormal');
  }

  const material = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  material.specularIntensityNode = float(0.15);
  material.positionNode = position;
  material.colorNode = color;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normalWorld, 0)).xyz);

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tuftGeometry(), 3));
  geometry.instanceCount = G * G;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = `grass-${spacing}m`;
  return { mesh, altitudeFade };
}

function tuftGeometry() {
  const out = [];
  const blades = [
    { a: 0, dx: 0.0, dz: 0.0, lean: 0.06, w: 0.06 },
    { a: Math.PI / 3, dx: 0.03, dz: -0.02, lean: -0.08, w: 0.05 },
    { a: (2 * Math.PI) / 3, dx: -0.025, dz: 0.03, lean: 0.1, w: 0.055 },
  ];
  for (const b of blades) {
    const c = Math.cos(b.a);
    const s = Math.sin(b.a);
    const pt = (x, y, z) => out.push(b.dx + x * c - z * s, y, b.dz + x * s + z * c);
    pt(-b.w / 2, 0, 0);
    pt(b.w / 2, 0, 0);
    pt(0, 1, b.lean);
  }
  return out;
}
