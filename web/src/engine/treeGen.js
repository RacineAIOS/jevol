import * as THREE from 'three/webgpu';
import { mulberry32 } from './rng.js';

const ELLIPSOID = (t) => 0.3 + 0.7 * Math.sin(Math.PI * (0.12 + 0.88 * t));
const CONE = (t) => 1.0 - 0.88 * t;
const COLUMN = (t) => 0.55 + 0.45 * Math.sin(Math.PI * t);

export const SPECIES = {
  oak: {
    foliage: 'broad', bark: 'rough', barkColor: 0x8a7d70, leafColor: 0x8fae6a,
    crownBase: 0.3, leader: 0.62, spread: 0.5, shape: ELLIPSOID,
    angle: [62, 48], count: [7, 6], len2: 0.5, gnarl: [0.1, 0.3, 0.35], tropism: [0, 0.03, -0.02],
    radius: 0.03, leafSize: 1.15, leafCards: 10,
  },
  hornbeam: {
    foliage: 'broad', bark: 'rough', barkColor: 0x9a9890, leafColor: 0xa6c47a,
    crownBase: 0.25, leader: 0.92, spread: 0.32, shape: ELLIPSOID,
    angle: [42, 40], count: [12, 5], len2: 0.45, gnarl: [0.05, 0.15, 0.2], tropism: [0, 0.05, 0],
    radius: 0.022, leafSize: 1.0, leafCards: 9,
  },
  chestnut: {
    foliage: 'broad', bark: 'rough', barkColor: 0x7a6a5c, leafColor: 0x86a35c,
    crownBase: 0.3, leader: 0.8, spread: 0.42, shape: ELLIPSOID,
    angle: [55, 45], count: [9, 6], len2: 0.5, gnarl: [0.06, 0.2, 0.25], tropism: [0, 0.04, -0.03],
    radius: 0.028, leafSize: 1.25, leafCards: 9,
  },
  birch: {
    foliage: 'small', bark: 'birch', barkColor: 0xf2efe8, leafColor: 0xb8cf80,
    crownBase: 0.3, leader: 1.0, spread: 0.22, shape: ELLIPSOID,
    angle: [38, 42], count: [12, 5], len2: 0.55, gnarl: [0.04, 0.12, 0.2], tropism: [0.01, 0.0, -0.12],
    radius: 0.016, leafSize: 0.85, leafCards: 8,
  },
  poplar: {
    foliage: 'small', bark: 'rough', barkColor: 0x9a9384, leafColor: 0x9cbd6c,
    crownBase: 0.12, leader: 1.0, spread: 0.13, shape: COLUMN,
    angle: [20, 25], count: [22, 4], len2: 0.5, gnarl: [0.02, 0.06, 0.15], tropism: [0.02, 0.08, 0.04],
    radius: 0.02, leafSize: 0.9, leafCards: 8,
  },
  willow: {
    foliage: 'willow', bark: 'rough', barkColor: 0x857a6a, leafColor: 0xb4c88e,
    crownBase: 0.3, leader: 0.5, spread: 0.45, shape: ELLIPSOID,
    angle: [50, 35], count: [8, 7], len2: 0.6, gnarl: [0.08, 0.2, 0.15], tropism: [0, 0.04, -0.35],
    radius: 0.03, leafSize: 1.1, leafCards: 9, hanging: true,
  },
  pine: {
    foliage: 'needle', bark: 'rough', barkColor: 0x8a6650, barkTop: 0xc0805a, leafColor: 0x8da880,
    crownBase: 0.55, leader: 0.96, spread: 0.26, shape: ELLIPSOID,
    angle: [72, 45], count: [22, 5], len2: 0.45, gnarl: [0.03, 0.15, 0.2], tropism: [0, 0.06, 0.05],
    radius: 0.02, leafSize: 1.4, leafCards: 11, conifer: true,
  },
  spruce: {
    foliage: 'spruce', bark: 'rough', barkColor: 0x6e5e50, leafColor: 0x6f9a74,
    crownBase: 0.06, leader: 1.0, spread: 0.3, shape: CONE,
    angle: [96, 50], count: [44, 3], len2: 0.4, gnarl: [0.01, 0.04, 0.08], tropism: [0, -0.03, -0.02],
    radius: 0.022, leafSize: 1.25, leafCards: 10, conifer: true,
  },
  shrub: {
    foliage: 'broad', bark: 'rough', barkColor: 0x7a6e60, leafColor: 0x93ad66,
    crownBase: 0.0, leader: 0, spread: 0.85, shape: (t) => 1,
    angle: [24, 45], count: [7, 6], len2: 0.5, gnarl: [0, 0.15, 0.25], tropism: [0, 0.02, 0],
    radius: 0.02, leafSize: 0.75, leafCards: 10, multiStem: true,
  },
};

const UP = new THREE.Vector3(0, 1, 0);

function randomUnit(rnd, out = new THREE.Vector3()) {
  const z = rnd.range(-1, 1);
  const a = rnd.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

function perpendicular(v) {
  const p = Math.abs(v.y) < 0.9 ? UP.clone() : new THREE.Vector3(1, 0, 0);
  return p.cross(v).normalize();
}

function childDirection(parentDir, theta, phi) {
  const p = perpendicular(parentDir).applyAxisAngle(parentDir, phi);
  return parentDir.clone().multiplyScalar(Math.cos(theta)).addScaledVector(p, Math.sin(theta)).normalize();
}

function samplePolyline(points, t) {
  const f = t * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(f));
  const k = f - i;
  const pos = points[i].clone().lerp(points[i + 1], k);
  const dir = points[i + 1].clone().sub(points[i]).normalize();
  return { pos, dir, index: i + k };
}

export function buildSkeleton(speciesName, height, seed) {
  const sp = SPECIES[speciesName];
  const rnd = mulberry32(seed * 7919 + speciesName.length * 104729);
  const branches = [];
  const leaves = [];
  const small = height < 10;
  const countScale = small ? 0.7 : 1;

  const grow = (level, origin, dir, length, radius) => {
    const segs = [10, 6, 3][level];
    const points = [origin.clone()];
    const radii = [radius];
    const d = dir.clone();
    const tmp = new THREE.Vector3();
    const endRadius = level === 0 ? radius * 0.18 : radius * 0.3;
    for (let s = 1; s <= segs; s++) {
      d.addScaledVector(randomUnit(rnd, tmp), sp.gnarl[level]);
      d.y += sp.tropism[level];
      d.normalize();
      points.push(points[s - 1].clone().addScaledVector(d, length / segs));
      radii.push(Math.max(0.008, radius + (endRadius - radius) * (s / segs)));
    }
    branches.push({ level, points, radii });
    return { points, radii };
  };

  const addLeaves = (points, from, count, size) => {
    count = Math.round(count * 1.6);
    size *= 1.2;
    for (let k = 0; k < count; k++) {
      const t = from + (1 - from) * rnd();
      const { pos, dir } = samplePolyline(points, t);
      pos.addScaledVector(randomUnit(rnd), size * 0.35);
      leaves.push({ pos, dir, size: size * rnd.range(0.8, 1.2), roll: rnd.range(0, Math.PI * 2) });
    }
  };

  const spawnChildren = (parent, parentLength, level, count, startT, lengthFn) => {
    const golden = 2.39996;
    const phi0 = rnd.range(0, Math.PI * 2);
    for (let k = 0; k < count; k++) {
      const t = startT + (1 - startT) * ((k + rnd.range(0.2, 0.8)) / count);
      const { pos, dir, index } = samplePolyline(parent.points, t);
      const r = parent.radii[Math.min(parent.radii.length - 1, Math.round(index))];
      const theta = THREE.MathUtils.degToRad(sp.angle[level - 1] * rnd.range(0.8, 1.2));
      const cd = childDirection(dir, theta, phi0 + k * golden + rnd.range(-0.3, 0.3));
      const len = lengthFn(t) * rnd.range(0.8, 1.2);
      const child = grow(level, pos, cd, len, Math.max(0.01, r * (level === 1 ? 0.55 : 0.5)));
      if (level === 1) {
        const n2 = Math.max(2, Math.round(sp.count[1] * countScale * Math.min(1.4, len / (height * 0.25))));
        spawnChildren(child, len, 2, n2, 0.3, (t2) => len * sp.len2 * (1 - 0.5 * t2));
        addLeaves(child.points, 0.7, Math.ceil(sp.leafCards / 2), sp.leafSize);
        if (sp.conifer) addLeaves(child.points, 0.2, sp.leafCards, sp.leafSize);
      } else {
        addLeaves(child.points, sp.conifer ? 0.1 : 0.25, sp.leafCards, sp.leafSize);
      }
    }
  };

  const trunkRadius = height * sp.radius * rnd.range(0.85, 1.15);
  if (sp.multiStem) {
    const stems = Math.round(sp.count[0] * rnd.range(0.8, 1.2));
    for (let k = 0; k < stems; k++) {
      const d = childDirection(UP, THREE.MathUtils.degToRad(sp.angle[0] * rnd.range(0.5, 1.3)), (k * 2.4) + rnd());
      const len = height * sp.spread * rnd.range(0.75, 1.05);
      const stem = grow(1, new THREE.Vector3(rnd.range(-0.15, 0.15), 0, rnd.range(-0.15, 0.15)), d, len, trunkRadius * 0.6);
      spawnChildren(stem, len, 2, sp.count[1], 0.25, (t) => len * sp.len2 * (1 - 0.4 * t));
      addLeaves(stem.points, 0.5, sp.leafCards, sp.leafSize);
    }
  } else {
    const trunkDir = UP.clone().addScaledVector(randomUnit(rnd), 0.04).normalize();
    const trunkLen = height * sp.leader;
    const trunk = grow(0, new THREE.Vector3(), trunkDir, trunkLen, trunkRadius);
    const startT = Math.min(0.95, (sp.crownBase * height) / trunkLen);
    const n1 = Math.max(3, Math.round(sp.count[0] * countScale * rnd.range(0.85, 1.15)));
    spawnChildren(trunk, trunkLen, 1, n1, startT, (t) => {
      const crownT = (t - startT) / Math.max(0.05, 1 - startT);
      return height * sp.spread * sp.shape(crownT);
    });
    if (sp.leader >= 0.9) addLeaves(trunk.points, 0.75, sp.leafCards * 2, sp.leafSize);
  }

  const box = new THREE.Box3();
  for (const l of leaves) box.expandByPoint(l.pos);
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.3, 0.3, 0.3));
  let top = 0;
  for (const b of branches) for (const p of b.points) top = Math.max(top, p.y);
  top = Math.max(top, box.max.y);
  const crownRadius = Math.max(half.x, half.z);
  return { species: speciesName, branches, leaves, center, half, top, crownRadius };
}

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  vertex(p, n, u, v, c) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function addTube(builder, branch, radial, color, colorTop, height) {
  const { points, radii } = branch;
  const n = points.length;
  let normal = null;
  let v = 0;
  const c = new THREE.Color();
  const base = builder.pos.length / 3;
  const uRepeat = Math.max(1, Math.round((2 * Math.PI * radii[0]) / 0.5));
  for (let i = 0; i < n; i++) {
    const t = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    normal = normal ? normal.sub(t.clone().multiplyScalar(normal.dot(t))).normalize() : perpendicular(t);
    const binormal = t.clone().cross(normal);
    if (i > 0) v += points[i].distanceTo(points[i - 1]);
    c.set(color);
    if (colorTop) c.lerp(new THREE.Color(colorTop), THREE.MathUtils.smoothstep(points[i].y / height, 0.4, 0.8));
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const dir = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      builder.vertex(points[i].clone().addScaledVector(dir, radii[i]), dir, (k / radial) * uRepeat, v, c);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = base + i * row + k;
      const b = a + row;
      builder.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

function addLeafCards(builder, skeleton, sp, leaves, sizeScale) {
  const { center, half } = skeleton;
  const leafColor = new THREE.Color(sp.leafColor);
  const c = new THREE.Color();
  const rnd = mulberry32(leaves.length + 11);
  const n = new THREE.Vector3();
  for (const leaf of leaves) {
    const size = leaf.size * sizeScale;
    let a;
    let b;
    if (sp.hanging) {
      a = new THREE.Vector3(0, -1, 0).addScaledVector(randomUnit(rnd), 0.25).normalize();
      b = perpendicular(a).applyAxisAngle(a, leaf.roll);
    } else if (sp.conifer) {
      a = leaf.dir.clone();
      b = a.clone().cross(UP).normalize();
      if (b.lengthSq() < 0.01) b = perpendicular(a);
      b.applyAxisAngle(a, rnd.range(-0.5, 0.5));
    } else {
      const outward = leaf.pos.clone().sub(center);
      outward.y *= 0.5;
      a = outward.normalize().addScaledVector(randomUnit(rnd), 0.9).addScaledVector(UP, 0.3).normalize();
      b = perpendicular(a).applyAxisAngle(a, leaf.roll);
    }
    const origin = leaf.pos.clone().addScaledVector(a, -size * 0.1);
    const rel = leaf.pos.clone().sub(center).divide(half);
    const depth = Math.min(1, rel.length());
    n.copy(rel).normalize();
    const cardN = a.clone().cross(b).normalize();
    if (cardN.dot(n) < 0) cardN.negate();
    n.lerp(cardN, 0.25).normalize();
    const ao = (0.6 + 0.4 * depth) * (0.85 + 0.15 * THREE.MathUtils.clamp(rel.y * 0.5 + 0.5, 0, 1));
    c.copy(leafColor).multiplyScalar(ao * rnd.range(0.88, 1.12));
    const i0 = builder.vertex(origin.clone().addScaledVector(b, -size / 2), n, 0, 0, c);
    builder.vertex(origin.clone().addScaledVector(b, size / 2), n, 1, 0, c);
    builder.vertex(origin.clone().addScaledVector(b, size / 2).addScaledVector(a, size), n, 1, 1, c);
    builder.vertex(origin.clone().addScaledVector(b, -size / 2).addScaledVector(a, size), n, 0, 1, c);
    builder.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  }
}

export function buildTreeLods(skeleton) {
  const sp = SPECIES[skeleton.species];
  const height = skeleton.top;

  const bark0 = new Builder();
  const leaves0 = new Builder();
  for (const br of skeleton.branches) addTube(bark0, br, [8, 5, 3][br.level], sp.barkColor, sp.barkTop, height);
  addLeafCards(leaves0, skeleton, sp, skeleton.leaves, 1);

  const bark1 = new Builder();
  const leaves1 = new Builder();
  for (const br of skeleton.branches) if (br.level < 2) addTube(bark1, br, br.level === 0 ? 5 : 3, sp.barkColor, sp.barkTop, height);
  addLeafCards(leaves1, skeleton, sp, skeleton.leaves.filter((_, i) => i % 3 === 0), 1.75);

  return [
    { bark: bark0.geometry(), leaves: leaves0.geometry() },
    { bark: bark1.geometry(), leaves: leaves1.geometry() },
  ];
}
