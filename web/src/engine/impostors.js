import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, cos, sin, vec2, vec3, vec4, abs, max, min, floor, round,
  normalize, cross, texture, varying, fwidth, log2, positionGeometry, uv,
} from 'three/tsl';
import { LOD_FADE_ATTRIBUTE, lodFadeMask } from './lodFade.js';

export const IMPOSTOR_GRID = 6;

function decodeHemiOct(u, v) {
  const x = (u + v) / 2;
  const z = (u - v) / 2;
  const y = 1 - Math.abs(x) - Math.abs(z);
  return new THREE.Vector3(x, y, z).normalize();
}

export function bakeImpostorAtlas(renderer, models, { frameSize, barkMaps, leafMaps }) {
  const N = IMPOSTOR_GRID;
  const F = frameSize;
  const perRow = Math.ceil(Math.sqrt(models.length));
  const size = perRow * N * F;

  const target = new THREE.RenderTarget(size, size, { depthBuffer: true });
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.anisotropy = 4;

  const barkPoles = {};
  for (const [k, map] of Object.entries(barkMaps)) barkPoles[k] = new THREE.MeshBasicNodeMaterial({ map, vertexColors: true });
  const leafPoles = {};
  for (const [k, map] of Object.entries(leafMaps)) {
    leafPoles[k] = new THREE.MeshBasicNodeMaterial({ map, vertexColors: true, alphaTest: 0.4 });
    const mip = log2(max(fwidth(uv()).length().mul(map.image.width), 1));
    leafPoles[k].opacityNode = mip.mul(0.6).add(1);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  const prev = {
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
  };
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.clear();

  const tiles = models.map((model, index) => {
    const lod = model.lods[0];
    const group = new THREE.Group();
    group.add(new THREE.Mesh(lod.bark, barkPoles[model.bark]));
    group.add(new THREE.Mesh(lod.leaves, leafPoles[model.foliage]));
    scene.add(group);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    let radius = 0;
    const v = new THREE.Vector3();
    for (const g of [lod.bark, lod.leaves]) {
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) radius = Math.max(radius, v.fromBufferAttribute(p, i).distanceTo(center));
    }
    radius *= 1.02;

    const tx = index % perRow;
    const ty = Math.floor(index / perRow);
    for (let fy = 0; fy < N; fy++) {
      for (let fx = 0; fx < N; fx++) {
        const dir = decodeHemiOct((fx / (N - 1)) * 2 - 1, (fy / (N - 1)) * 2 - 1);
        camera.left = -radius;
        camera.right = radius;
        camera.top = radius;
        camera.bottom = -radius;
        camera.near = 0.01;
        camera.far = radius * 4;
        camera.up.set(0, 1, 0);
        camera.position.copy(center).addScaledVector(dir, radius * 2);
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        const px = (tx * N + fx) * F;
        const py = size - (ty * N + fy + 1) * F;
        target.viewport.set(px, py, F, F);
        target.scissor.set(px, py, F, F);
        renderer.render(scene, camera);
      }
    }
    scene.remove(group);
    return { center, radius, tile: index };
  });

  renderer.setRenderTarget(prev.target);
  renderer.autoClear = prev.autoClear;
  renderer.setClearColor(prev.clearColor, prev.clearAlpha);
  for (const m of [...Object.values(barkPoles), ...Object.values(leafPoles)]) m.dispose();

  return { texture: target.texture, target, tiles, perRow, frameSize: F, size };
}

export function createImpostorMesh(atlas, capacity, { alphaToCoverage = true, shadowOnly = false, shadowSide = shadowOnly, lightDir = null } = {}) {
  const N = IMPOSTOR_GRID;
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const data = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const fades = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  quad.setAttribute(LOD_FADE_ATTRIBUTE, fades);
  quad.setAttribute('iCenter', centers);
  quad.setAttribute('iData', data);
  quad.setAttribute('iTint', tints);
  quad.instanceCount = 0;

  const iCenter = attribute('iCenter', 'vec3');
  const iData = attribute('iData', 'vec4');
  const iTint = attribute('iTint', 'vec3');
  const q = positionGeometry.xy;

  const toCam = lightDir ? vec3(lightDir.x, lightDir.y, lightDir.z) : normalize(cameraPosition.sub(iCenter));
  const right = normalize(cross(vec3(0, 1, 0), toCam));
  const up = cross(toCam, right);
  const flat = iCenter.add(right.mul(q.x.mul(iData.x))).add(up.mul(q.y.mul(iData.y)));
  const world = shadowOnly ? flat.sub(toCam.mul(iData.y)) : flat;

  const c = cos(iData.z);
  const s = sin(iData.z);
  const local = vec3(toCam.x.mul(c).sub(toCam.z.mul(s)), max(toCam.y, 0.02), toCam.x.mul(s).add(toCam.z.mul(c)));
  const d = local.div(abs(local.x).add(abs(local.y)).add(abs(local.z)));
  const oct = vec2(d.x.add(d.z), d.x.sub(d.z)).mul(0.5).add(0.5);
  const frame = min(max(round(oct.mul(N - 1)), 0), N - 1);
  const tile = vec2(iData.w.mod(atlas.perRow), floor(iData.w.div(atlas.perRow)));
  const cell = tile.mul(N).add(frame);
  const cellUv = cell.add(q.mul(0.5).add(0.5)).div(atlas.perRow * N);
  const atlasUv = varying(vec2(cellUv.x, cellUv.y.oneMinus()), 'vImpostorUv');

  const material = new THREE.MeshLambertNodeMaterial({ alphaTest: 0.5, alphaToCoverage });
  const sample = texture(atlas.texture, atlasUv);
  const mip = log2(max(fwidth(atlasUv).length().mul(atlas.size), 1));
  const albedo = min(sample.rgb.div(max(sample.a, 0.02)), 1).mul(atlas.gain ?? 1);
  material.colorNode = vec4(albedo.mul(varying(iTint, 'vImpostorTint')), sample.a.mul(mip.mul(0.5).add(1)));
  if (shadowSide) material.shadowSide = THREE.DoubleSide;
  material.positionNode = world;
  material.maskNode = lodFadeMask();
  if (atlas.foliageLight) material.emissiveNode = atlas.foliageLight;

  const mesh = new THREE.Mesh(quad, material);
  mesh.frustumCulled = false;
  mesh.name = 'tree-impostors';

  return {
    mesh,
    write(slot, cx, cy, cz, halfW, halfH, yaw, tile, r, g, b, fade = 1) {
      fades.array[slot] = fade;
      centers.array[slot * 3] = cx;
      centers.array[slot * 3 + 1] = cy;
      centers.array[slot * 3 + 2] = cz;
      data.array[slot * 4] = halfW;
      data.array[slot * 4 + 1] = halfH;
      data.array[slot * 4 + 2] = yaw;
      data.array[slot * 4 + 3] = tile;
      tints.array[slot * 3] = r;
      tints.array[slot * 3 + 1] = g;
      tints.array[slot * 3 + 2] = b;
    },
    commit(count) {
      quad.instanceCount = count;
      mesh.visible = count > 0;
      for (const [a, n] of [[centers, 3], [data, 4], [tints, 3], [fades, 1]]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, count * n);
        a.needsUpdate = true;
      }
    },
  };
}
