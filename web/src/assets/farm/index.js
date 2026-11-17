import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Solids } from './solids.js';
import { solidMaterial, decalMaterial } from './materials.js';
import { createBales } from './bales.js';
import { buildTractors } from './tractors.js';
import { buildYard } from './yard.js';
import { buildFences } from './fences.js';


export { createBales } from './bales.js';

const HIDE_DISTANCE = 420;

export function createRuralDecor(input = {}, { heightAt = () => 0, quality = 'high', seed = 1, decals = true } = {}) {
  const group = new THREE.Group();
  group.name = 'rural-decor';
  const small = new THREE.Group();
  small.name = 'rural-small';
  group.add(small);
  const opts = { heightAt, quality, seed };

  const bales = createBales(input.bales, opts);
  small.add(bales.group);

  const solids = new Solids();
  const tractors = buildTractors(input.tractors, opts);
  const yard = buildYard({ troughs: input.troughs, manure: input.manure, gates: input.gates }, opts, solids);
  const fences = buildFences(input.fences, opts, solids);
  const parts = [tractors.geometry, solids.build()].filter(Boolean);

  if (parts.length) {
    const g = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, solidMaterial());
    m.name = 'rural-solids';
    small.add(m);
  }
  if (fences.posts) {
    fences.posts.userData.noShadow = true;
    group.add(fences.posts);
  }
  if (fences.wires) {
    const w = new THREE.Mesh(fences.wires, solidMaterial());
    w.userData.noShadow = true;
    w.name = 'fence-wires';
    group.add(w);
  }

  let decalCount = 0;
  if (decals) {
    const g = yard.decalGeometry(heightAt);
    if (g) {
      const m = new THREE.Mesh(g, decalMaterial());
      m.userData.noShadow = true;
      m.renderOrder = 1;
      m.name = 'rural-decals';
      group.add(m);
      decalCount = g.attributes.position.count / 49;
    }
  }

  const bounds = new THREE.Box3();
  for (const [x, z] of [...bales.points, ...tractors.points, ...yard.points]) bounds.expandByPoint(new THREE.Vector3(x, 0, z));
  bounds.expandByVector(new THREE.Vector3(15, 400, 15));
  const hasSmall = !bounds.isEmpty();
  const blobs = [...bales.blobs, ...tractors.blobs, ...yard.blobs];

  return {
    group,
    blobs,
    update(camera) {
      small.visible = hasSmall && bounds.distanceToPoint(camera.position) < HIDE_DISTANCE;
    },
    info() {
      return `rural : ${bales.count} bales, ${tractors.points.length} tractors, ${fences.count} stakes (${Math.round(fences.length)} m), ${blobs.length} stains, ${triangles(group)} tri`;
    },
  };
}

function triangles(object) {
  let t = 0;
  object.traverse((o) => {
    if (o.isMesh) t += ((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(t);
}
