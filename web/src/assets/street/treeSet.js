import * as THREE from 'three/webgpu';
import { SPECIES, buildSkeleton, buildTreeLods } from '../../engine/treeGen.js';
import { foliageTexture, barkTexture } from '../../engine/textures.js';
import { diffuseColor } from 'three/tsl';
import { FOLIAGE_GAIN } from '../../engine/trees.js';
import { mulberry32 } from '../../engine/rng.js';

const NEAR = 38;
const GONE = 420;

function thinLeaves(geo, every, grow) {
  const n = geo.attributes.position.count / 4;
  const keep = [];
  for (let k = 0; k < n; k += every) keep.push(k);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const src = geo.attributes[name];
    const a = new Float32Array(keep.length * 4 * src.itemSize);
    keep.forEach((k, i) => {
      for (let v = 0; v < 4; v++) for (let c = 0; c < src.itemSize; c++) a[(i * 4 + v) * src.itemSize + c] = src.array[(k * 4 + v) * src.itemSize + c];
    });
    if (name === 'position') {
      keep.forEach((k, i) => {
        const o = i * 12;
        const cx = (a[o] + a[o + 3] + a[o + 6] + a[o + 9]) / 4;
        const cy = (a[o + 1] + a[o + 4] + a[o + 7] + a[o + 10]) / 4;
        const cz = (a[o + 2] + a[o + 5] + a[o + 8] + a[o + 11]) / 4;
        for (let v = 0; v < 4; v++) {
          a[o + v * 3] = cx + (a[o + v * 3] - cx) * grow;
          a[o + v * 3 + 1] = cy + (a[o + v * 3 + 1] - cy) * grow;
          a[o + v * 3 + 2] = cz + (a[o + v * 3 + 2] - cz) * grow;
        }
        void k;
      });
    }
    out.setAttribute(name, new THREE.BufferAttribute(a, src.itemSize));
  }
  const idx = [];
  keep.forEach((k, i) => {
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
  });
  out.setIndex(idx);
  return out;
}

export function createTreeSet(list, { seed = 1, sun = null } = {}) {
  const group = new THREE.Group();
  group.name = 'street-trees';
  if (!list.length || typeof document === 'undefined') return { group, update() {}, count: 0 };
  const rng = mulberry32(seed * 313 + 5);
  const bark = {};
  const leaf = {};
  const barkMat = (kind) => (bark[kind] ??= Object.assign(new THREE.MeshLambertNodeMaterial({ map: barkTexture(kind), vertexColors: true }), { emissiveNode: diffuseColor.rgb.mul(0.1) }));
  const leafMat = (kind) => {
    if (!leaf[kind]) {
      const m = new THREE.MeshLambertNodeMaterial({ map: foliageTexture(kind, kind.length * 13), vertexColors: true, alphaTest: 0.45, alphaToCoverage: true });
      m.color.setScalar(FOLIAGE_GAIN);
      m.emissiveNode = diffuseColor.rgb.mul(0.16);
      leaf[kind] = m;
    }
    return leaf[kind];
  };
  const models = new Map();
  const modelOf = (species, k) => {
    const key = `${species}/${k}`;
    if (!models.has(key)) {
      const sp = SPECIES[species];
      const sk = buildSkeleton(species, species === 'shrub' ? 1.2 : 10, k + 3);
      const lods = buildTreeLods(sk);
      const near = species === 'shrub' ? { bark: lods[1].bark, leaves: thinLeaves(lods[1].leaves, 3, 1.5) } : lods[1];
      const far = { bark: species === 'shrub' ? null : lods[1].bark, leaves: thinLeaves(lods[1].leaves, species === 'shrub' ? 4 : 3, species === 'shrub' ? 1.8 : 1.6) };
      models.set(key, { species, sp, near, far, top: sk.top, items: [] });
    }
    return models.get(key);
  };
  for (const t of list) {
    const m = modelOf(t.species, Math.floor(rng() * 3));
    m.items.push({ x: t.x, y: t.y, s: (t.height / m.top) * (t.scale ?? 1) * (0.92 + rng() * 0.16), yaw: rng() * Math.PI * 2, tone: 0.85 + rng() * 0.3 });
  }
  const meshes = [];
  for (const m of models.values()) {
    for (const lod of ['near', 'far']) {
      const g = m[lod];
      for (const [part, mat] of [['bark', barkMat(m.sp.bark)], ['leaves', leafMat(m.sp.foliage)]]) {
        if (!g[part]) continue;
        const mesh = new THREE.InstancedMesh(g[part], mat, m.items.length);
        mesh.name = `street-trees-${m.species}-${lod}-${part}`;
        mesh.frustumCulled = false;
        mesh.userData.thermalClass = 'tree';
        mesh.count = 0;
        mesh.userData.noShadow = lod === 'far';
        group.add(mesh);
        meshes.push({ mesh, m, lod });
      }
    }
  }
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const update = (camera) => {
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const e of meshes) {
      e.mesh.count = 0;
      e.mesh.receiveShadow = false;
    }
    for (const m of models.values()) {
      const near = [];
      const far = [];
      for (const it of m.items) {
        const d = Math.hypot(it.x - cx, -it.y - cz);
        if (d < NEAR) near.push(it);
        else if (d < GONE) far.push(it);
      }
      for (const e of meshes) {
        if (e.m !== m) continue;
        const arr = e.lod === 'near' ? near : far;
        arr.forEach((it, i) => {
          dummy.position.set(it.x, 0, -it.y);
          dummy.rotation.set(0, it.yaw, 0);
          dummy.scale.setScalar(it.s);
          dummy.updateMatrix();
          e.mesh.setMatrixAt(i, dummy.matrix);
          col.setScalar(it.tone);
          e.mesh.setColorAt(i, col);
        });
        e.mesh.count = arr.length;
        e.mesh.instanceMatrix.needsUpdate = true;
        if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true;
      }
    }
  };
  return { group, update, count: list.length };
}
