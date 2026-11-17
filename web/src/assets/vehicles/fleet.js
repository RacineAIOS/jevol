import * as THREE from 'three/webgpu';
import { buildCar } from './carGeometry.js';
import { MODELS } from './data.js';
import { vehicleMaterial } from './material.js';

export const NEAR_DIST = 45;
export const FAR_DIST = 1100;
const MOVE = 2;

const carCache = new Map();
export function carGeometries(key) {
  if (!carCache.has(key)) carCache.set(key, { near: buildCar(MODELS[key], 'near'), far: buildCar(MODELS[key], 'far') });
  return carCache.get(key);
}

let carMat = null;
let machineMat = null;
const poles = () => {
  carMat ??= vehicleMaterial();
  machineMat ??= vehicleMaterial({ dirtTop: 1.1 });
  return { carMat, machineMat };
};
export const carMaterial = () => poles().carMat;

export class Fleet {
  constructor() {
    this.items = new Map();
  }

  add(key, geoms, matrix, tint) {
    if (!this.items.has(key)) this.items.set(key, { geoms, list: [] });
    this.items.get(key).list.push({ m: matrix, tint });
  }

  get size() {
    let n = 0;
    for (const it of this.items.values()) n += it.list.length;
    return n;
  }

  build(name) {
    const group = new THREE.Group();
    group.name = name;
    const { carMat, machineMat } = poles();
    const pos = new THREE.Vector3();
    const models = [];
    for (const [key, { geoms, list }] of this.items) {
      const n = list.length;
      const all = { matrices: new Float32Array(n * 16), tints: new Float32Array(n * 4), centers: new Float32Array(n * 3), n };
      list.forEach((it, i) => {
        it.m.toArray(all.matrices, i * 16);
        pos.setFromMatrixPosition(it.m).toArray(all.centers, i * 3);
        all.tints.set(it.tint, i * 4);
      });
      const lods = [];
      for (const [lod, material] of geoms.far ? [['near', carMat], ['far', carMat]] : [['near', machineMat]]) {
        const g = geoms[lod].clone();
        const aTint = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
        g.setAttribute('aTint', aTint);
        const mesh = new THREE.InstancedMesh(g, material, n);
        mesh.instanceMatrix.array.set(all.matrices);
        mesh.computeBoundingSphere();
        aTint.array.set(all.tints);
        mesh.name = `${key}-${lod}`;
        mesh.userData.lod = lod;
        group.add(mesh);
        lods.push({ lod, mesh, aTint });
      }
      models.push({ all, lods, machine: !geoms.far });
    }

    const last = new THREE.Vector3(1e9, 1e9, 1e9);
    const cam = new THREE.Vector3();
    const sort = (camera) => {
      cam.setFromMatrixPosition(camera.matrixWorld);
      if (cam.distanceToSquared(last) < MOVE * MOVE) return;
      last.copy(cam);
      for (const { all, lods, machine } of models) {
        const counts = lods.map(() => 0);
        for (let i = 0; i < all.n; i++) {
          const dx = all.centers[i * 3] - cam.x;
          const dy = all.centers[i * 3 + 1] - cam.y;
          const dz = all.centers[i * 3 + 2] - cam.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const k = machine ? 0 : d < NEAR_DIST ? 0 : d < FAR_DIST ? 1 : -1;
          if (k < 0) continue;
          const t = lods[k];
          t.mesh.instanceMatrix.array.set(all.matrices.subarray(i * 16, i * 16 + 16), counts[k] * 16);
          t.aTint.array.set(all.tints.subarray(i * 4, i * 4 + 4), counts[k] * 4);
          counts[k]++;
        }
        lods.forEach((t, k) => {
          t.mesh.count = counts[k];
          t.mesh.instanceMatrix.needsUpdate = true;
          t.aTint.needsUpdate = true;
        });
      }
    };
    const before = (renderer, scene, camera) => {
      if (camera.isPerspectiveCamera) sort(camera);
    };
    group.traverse((o) => {
      if (o.isInstancedMesh) o.onBeforeRender = before;
    });
    group.userData.count = this.size;
    return group;
  }
}
