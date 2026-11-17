import * as THREE from 'three/webgpu';
import { SPECIES, buildSkeleton, buildTreeLods } from './treeGen.js';
import { windStrength } from './wind.js';
import { foliageTexture, barkTexture, FOLIAGE_TEXTURE_SIZE } from './textures.js';
import { uv, fwidth, log2, max, pow, dot, normalize, positionWorld, positionLocal, cameraPosition, diffuseColor, uniform, vec3, sin, time } from 'three/tsl';
import { mulberry32, valueNoise } from './rng.js';
import { bakeImpostorAtlas, createImpostorMesh } from './impostors.js';
import { LOD_FADE_ATTRIBUTE, lodFadeMask, lodContributions } from './lodFade.js';
import { SEASON, AUTUMN_TINTS, AUTUMN_SHARE, AUTUMN_WEIGHTS } from './season.js';
import { CONIFER_MODELS, buildConifer, coniferSizeIndex, coniferTexture } from './conifers.js';

export const TREE_QUALITY = {
  low: { distances: [60, 130, 1200], impostorFrame: 32 },
  medium: { distances: [80, 180, 1500], impostorFrame: 48 },
  high: { distances: [100, 230, 1800], impostorFrame: 64 },
};

export const FOLIAGE_GAIN = 2;

const SIZE_CLASSES = [
  { height: 6, seeds: 2 },
  { height: 16, seeds: 3 },
];

const MIX = {
  broadleaf: { oak: 0.4, hornbeam: 0.3, chestnut: 0.15, birch: 0.1, pine: 0.05 },
  conifer: { pine: 0.7, spruce: 0.3 },
  mixed: { pine: 0.4, oak: 0.25, hornbeam: 0.15, birch: 0.15, spruce: 0.05 },
  urban: { birch: 0.2, oak: 0.15, hornbeam: 0.15, chestnut: 0.1, spruce: 0.15, pine: 0.1, poplar: 0.15 },
  riparian: { poplar: 0.35, willow: 0.3, hornbeam: 0.2, birch: 0.15 },
  hedge: { shrub: 0.75, hornbeam: 0.15, birch: 0.1 },
};
const LEAN = { broadleaf: 3, conifer: 2, mixed: 3, urban: 4, riparian: 8, hedge: 6 };

const SHADOW_LAYER = 1;

export const TREE_OPTION_DEFAULTS = {
  alphaToCoverage: true,
  shadowProxy: false,
  lodScale: 1,
  speciesScale: {},
  leafSaturation: 1,
  colorSpread: 1,
  conifers: false,
};
const CONIFER_FOLIAGE = ['pineTuft', 'spruceSpray'];

export function createTrees(world, renderer, { quality = 'high', shadows = true, sun = null, observedColors = [], leafTint = [1, 1, 1], ...treeOptions } = {}) {
  const options = { ...TREE_OPTION_DEFAULTS, ...treeOptions };
  const { distances: baseDistances, impostorFrame } = TREE_QUALITY[quality];
  const lodDistances = baseDistances.map((d, k) => (k < baseDistances.length - 1 ? d * options.lodScale : d));
  const proxyShadows = shadows && options.shadowProxy;
  const speciesNames = Object.keys(SPECIES);
  const contexts = Object.fromEntries(Object.entries(world.meta.trees.contexts).map(([k, v]) => [v, k]));

  const barkMaterials = {};
  for (const kind of ['rough', 'birch']) {
    barkMaterials[kind] = new THREE.MeshLambertNodeMaterial({ map: barkTexture(kind), vertexColors: true });
    barkMaterials[kind].maskNode = lodFadeMask();
  }
  const leafMaterials = {};
  for (const kind of ['broad', 'small', 'willow', 'needle', 'spruce', ...(options.conifers ? CONIFER_FOLIAGE : [])]) {
    const leafMap = CONIFER_FOLIAGE.includes(kind) ? coniferTexture(kind, kind.length * 13) : foliageTexture(kind, kind.length * 13);
    if (options.leafSaturation !== 1) desaturate(leafMap, options.leafSaturation);
    leafMaterials[kind] = new THREE.MeshLambertNodeMaterial({
      map: leafMap,
      vertexColors: true,
      alphaTest: 0.45,
      alphaToCoverage: options.alphaToCoverage,
    });
    leafMaterials[kind].color.setScalar(FOLIAGE_GAIN);
    const mip = log2(max(fwidth(uv()).length().mul(FOLIAGE_TEXTURE_SIZE), 1));
    leafMaterials[kind].opacityNode = mip.mul(0.45).add(1);
    leafMaterials[kind].emissiveNode = foliageLight(sun);
    leafMaterials[kind].maskNode = lodFadeMask();
    const p = positionLocal;
    const sway = sin(time.mul(1.7).add(p.x.mul(1.3)).add(p.z.mul(0.9))).mul(0.6)
      .add(sin(time.mul(4.1).add(p.y.mul(2.7))).mul(0.25)).mul(p.y.mul(0.012).max(0)).mul(windStrength);
    leafMaterials[kind].positionNode = p.add(vec3(sway, 0, sway.mul(0.6)));
  }

  const models = [];
  const modelIndex = {};
  for (const name of speciesNames) {
    if (options.conifers && CONIFER_MODELS[name]) {
      CONIFER_MODELS[name].forEach((model, sizeIdx) => {
        for (let s = 0; s < model.seeds; s++) {
          const built = buildConifer(model, s + 1 + sizeIdx * 10);
          (modelIndex[`${name}/${sizeIdx}`] ??= []).push(models.length);
          models.push({ name, skeleton: built.skeleton, lods: built.lods, bark: built.bark, foliage: built.foliage, trees: [], conifer: true });
        }
      });
      continue;
    }
    SIZE_CLASSES.forEach((size, sizeIdx) => {
      for (let s = 0; s < size.seeds; s++) {
        const skeleton = buildSkeleton(name, size.height, s + 1 + sizeIdx * 10);
        const lods = buildTreeLods(skeleton);
        const key = `${name}/${sizeIdx}`;
        (modelIndex[key] ??= []).push(models.length);
        const sp = SPECIES[name];
        models.push({ name, skeleton, lods, bark: sp.bark, foliage: sp.foliage, trees: [] });
      }
    });
  }

  const atlas = bakeImpostorAtlas(renderer, models, {
    frameSize: impostorFrame,
    barkMaps: Object.fromEntries(Object.entries(barkMaterials).map(([k, m]) => [k, m.map])),
    leafMaps: Object.fromEntries(Object.entries(leafMaterials).map(([k, m]) => [k, m.map])),
  });

  const data = world.trees;
  const stride = world.meta.trees.stride;
  const count = data.length / stride;
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  const leafColors = new Float32Array(count * 3);
  const autumnRnd = mulberry32(1015);
  const observed = new Map((observedColors ?? []).map(([ox, oy, c]) => [`${Math.round(ox)},${Math.round(oy)}`, c]));
  const positions = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const modelOf = new Uint16Array(count);
  const impostorData = new Float32Array(count * 6);
  const lodScale = new Float32Array(count);
  const rnd = mulberry32(2024);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const lean = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const hasColor = stride >= 9;
  const meanColor = [0, 0, 0];
  if (hasColor) {
    for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) meanColor[k] += data[t * stride + 6 + k] / count;
  }

  for (let t = 0; t < count; t++) {
    const o = t * stride;
    const x = data[o];
    const y = data[o + 1];
    const z = data[o + 2];
    const h = Math.max(1, data[o + 3]);
    const r = data[o + 4];
    const context = contexts[data[o + 5]] ?? 'urban';

    const species = pickSpecies(MIX[context] ?? MIX.urban, x, -y, rnd, options.speciesScale);
    const coniferClasses = options.conifers ? CONIFER_MODELS[species] : null;
    const sizeIdx = coniferClasses ? coniferSizeIndex(coniferClasses, h) : h < 10 ? 0 : 1;
    const candidates = modelIndex[`${species}/${sizeIdx}`];
    const model = candidates[rnd.int(candidates.length)];
    const sk = models[model].skeleton;
    modelOf[t] = model;
    models[model].trees.push(t);

    const sy = h / sk.top;
    const forestCrown = !models[model].conifer && (context === 'broadleaf' || context === 'conifer' || context === 'mixed') ? 1.2 : 1;
    const width = THREE.MathUtils.clamp(Math.sqrt(r / Math.max(0.5, sk.crownRadius * sy)), 0.8, 1.25) * forestCrown;
    const sxz = sy * width * rnd.range(0.9, 1.1);
    scale.set(sxz * rnd.range(0.94, 1.06), sy, sxz * rnd.range(0.94, 1.06));
    const yaw = rnd() * Math.PI * 2;
    q.setFromAxisAngle(up, yaw);
    axis.set(rnd.range(-1, 1), 0, rnd.range(-1, 1)).normalize();
    lean.setFromAxisAngle(axis, THREE.MathUtils.degToRad(rnd() * (LEAN[context] ?? 3)));
    q.premultiply(lean);
    pos.set(x, z - world.hmin - 0.2 + (world.surface?.detailAt(x, -y) ?? 0), -y);
    m.compose(pos, q, scale);
    m.toArray(matrices, t * 16);

    const lightDraw = rnd.range(0.92, 1.06);
    const light = options.colorSpread === 1 ? lightDraw : 1 + (lightDraw - 1) * options.colorSpread;
    for (let k = 0; k < 3; k++) {
      const measured = hasColor ? data[o + 6 + k] / Math.max(0.01, meanColor[k]) : 1;
      const clamped = THREE.MathUtils.clamp(measured, 0.7, 1.35);
      colors[t * 3 + k] = light * (options.colorSpread === 1 ? clamped : 1 + (clamped - 1) * options.colorSpread);
    }
    const seen = observed.get(`${Math.round(x)},${Math.round(y)}`);
    let tint = null;
    if (SEASON.autumn > 0 && seen !== undefined) tint = seen >= 0 ? AUTUMN_TINTS[seen] : null;
    else if (autumnRnd() < SEASON.autumn * 1.6 * (AUTUMN_SHARE[species] ?? 0.5)) tint = AUTUMN_TINTS[pickWeighted(AUTUMN_WEIGHTS, autumnRnd())];
    for (let k = 0; k < 3; k++) leafColors[t * 3 + k] = colors[t * 3 + k] * (tint ? tint[k] : 1) * leafTint[k];

    const tile = atlas.tiles[model];
    const off = tile.center.clone().multiply(new THREE.Vector3(sxz, sy, sxz)).applyAxisAngle(up, yaw);
    impostorData.set([pos.x + off.x, pos.y + off.y, pos.z + off.z, tile.radius * sxz, tile.radius * sy, yaw], t * 6);

    positions.set([x, z - world.hmin + h * 0.5, -y], t * 3);
    radii[t] = Math.max(h, r) * 0.6;
    lodScale[t] = THREE.MathUtils.clamp(Math.sqrt(12 / h), 1.0, 2.0);
  }

  const group = new THREE.Group();
  group.name = 'trees';
  const buckets = models.map((model) => {
    const capacity = Math.max(1, model.trees.length);
    const sp = model;
    const make = (geometry, material, name) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      geometry.setAttribute(LOD_FADE_ATTRIBUTE, new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = name;
      mesh.castShadow = shadows && !proxyShadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
      return mesh;
    };
    const [l0, l1] = model.lods;
    const lod1Bark = make(l1.bark, barkMaterials[sp.bark], `${model.name}-lod1-bark`);
    lod1Bark.castShadow = false;
    return [
      [make(l0.bark, barkMaterials[sp.bark], `${model.name}-lod0-bark`), make(l0.leaves, leafMaterials[sp.foliage], `${model.name}-lod0-leaves`)],
      [lod1Bark, make(l1.leaves, leafMaterials[sp.foliage], `${model.name}-lod1-leaves`)],
    ];
  });
  atlas.foliageLight = foliageLight(sun);
  atlas.gain = FOLIAGE_GAIN;
  const impostors = createImpostorMesh(atlas, count, { alphaToCoverage: options.alphaToCoverage, shadowSide: proxyShadows });
  impostors.mesh.castShadow = shadows;
  impostors.mesh.receiveShadow = shadows;
  group.add(impostors.mesh);
  const shadowImpostors = proxyShadows ? createImpostorMesh(atlas, count, { alphaToCoverage: false, shadowOnly: true, lightDir: sun ? sun.position.clone().normalize() : null }) : null;
  if (shadowImpostors) {
    shadowImpostors.mesh.castShadow = true;
    shadowImpostors.mesh.receiveShadow = false;
    shadowImpostors.mesh.layers.set(SHADOW_LAYER);
    shadowImpostors.mesh.name = 'tree-shadow-impostors';
    group.add(shadowImpostors.mesh);
  }
  function enableShadowLayer() {
    if (!sun?.shadow) return;
    sun.shadow.camera.layers.enable(SHADOW_LAYER);
    for (const light of sun.shadow.shadowNode?.lights ?? []) light.shadow.camera.layers.enable(SHADOW_LAYER);
  }
  if (shadowImpostors) enableShadowLayer();

  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastDir = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const counts = buckets.map(() => [0, 0]);
  const d2 = lodDistances.map((d) => d * d);
  const stats = { lod: [0, 0, 0] };
  const fadeWidths = lodDistances.map((d, k) => d * (k === lodDistances.length - 1 ? 0.1 : 0.12));
  const parts = [];

  function update(camera) {
    if (shadowImpostors) enableShadowLayer();
    camera.getWorldDirection(camDir);
    const cp = camera.position;
    if (cp.distanceToSquared(lastPos) < 1 && camDir.dot(lastDir) > 0.9995) return stats;
    lastPos.copy(cp);
    lastDir.copy(camDir);

    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfDiag = Math.atan(Math.tan(halfV) * Math.hypot(1, camera.aspect));
    const cosLimit = Math.cos(Math.min(Math.PI / 2, halfDiag + 0.08));

    for (const c of counts) c.fill(0);
    stats.lod.fill(0);
    let impostorCount = 0;
    let shadowCount = 0;
    for (let t = 0; t < count; t++) {
      const dx = positions[t * 3] - cp.x;
      const dy = positions[t * 3 + 1] - cp.y;
      const dz = positions[t * 3 + 2] - cp.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const scale = lodScale[t];
      if (dist2 * scale * scale > d2[2]) continue;
      const dist = Math.sqrt(dist2);
      if (dx * camDir.x + dy * camDir.y + dz * camDir.z < dist * cosLimit - radii[t]) continue;
      const model = modelOf[t];
      lodContributions(dist * scale, lodDistances, fadeWidths, parts);
      stats.lod[parts[0]]++;
      if (shadowImpostors && parts[parts.length - 2] < 2) {
        const o = t * 6;
        const i = impostorData;
        shadowImpostors.write(shadowCount++, i[o], i[o + 1], i[o + 2], i[o + 3], i[o + 4], i[o + 5], model,
          1, 1, 1, 1);
      }
      for (let p = 0; p < parts.length; p += 2) {
        const level = parts[p];
        const fade = parts[p + 1];
        if (level === 2) {
          const o = t * 6;
          const i = impostorData;
          impostors.write(impostorCount++, i[o], i[o + 1], i[o + 2], i[o + 3], i[o + 4], i[o + 5], model,
            leafColors[t * 3], leafColors[t * 3 + 1], leafColors[t * 3 + 2], fade);
          continue;
        }
        const slot = counts[model][level]++;
        for (const [part, mesh] of buckets[model][level].entries()) {
          mesh.instanceMatrix.array.set(matrices.subarray(t * 16, t * 16 + 16), slot * 16);
          mesh.instanceColor.array.set((part === 1 ? leafColors : colors).subarray(t * 3, t * 3 + 3), slot * 3);
          mesh.geometry.attributes[LOD_FADE_ATTRIBUTE].array[slot] = fade;
        }
      }
    }
    impostors.commit(impostorCount);
    shadowImpostors?.commit(shadowCount);
    stats.shadowImpostors = shadowCount;
    buckets.forEach((levels, model) => {
      levels.forEach((meshes, level) => {
        const n = counts[model][level];
        for (const mesh of meshes) {
          mesh.count = n;
          mesh.visible = n > 0;
          if (n > 0) {
            mesh.instanceMatrix.clearUpdateRanges();
            mesh.instanceMatrix.addUpdateRange(0, n * 16);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.clearUpdateRanges();
            mesh.instanceColor.addUpdateRange(0, n * 3);
            mesh.instanceColor.needsUpdate = true;
            const fadeAttr = mesh.geometry.attributes[LOD_FADE_ATTRIBUTE];
            fadeAttr.clearUpdateRanges();
            fadeAttr.addUpdateRange(0, n);
            fadeAttr.needsUpdate = true;
          }
        }
      });
    });
    return stats;
  }

  const colliders = { count, matrices, modelOf, positions, radii, lods: models.map((model) => model.lods[0]) };
  return { group, update, count, models: models.length, atlas, colliders };
}

export function foliageLight(sun) {
  const sunDir = uniform(sun ? sun.position.clone().normalize() : new THREE.Vector3(0, 1, 0));
  const sunColor = uniform(sun ? sun.color.clone().multiplyScalar(sun.intensity) : new THREE.Color(1, 1, 1));
  const view = normalize(positionWorld.sub(cameraPosition));
  const back = pow(max(dot(view, sunDir), 0), 3);
  return diffuseColor.rgb.mul(vec3(sunColor)).mul(back.mul(0.12).add(0.03));
}

function desaturate(texture, factor) {
  const d = texture.image.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, lum + (d[i + k] - lum) * factor));
  }
  texture.needsUpdate = true;
}

function pickWeighted(weights, r) {
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function pickSpecies(mix, x, z, rnd, scaleBySpecies = {}) {
  const entries = Object.entries(mix);
  let total = 0;
  const weights = entries.map(([name, w], i) => {
    const patch = valueNoise(x / 80 + i * 17.3, z / 80 - i * 9.1);
    const v = w * (scaleBySpecies[name] ?? 1) * (0.25 + 1.5 * patch * patch);
    total += v;
    return v;
  });
  let pick = rnd() * total;
  for (let i = 0; i < entries.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}
