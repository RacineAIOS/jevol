import * as THREE from 'three/webgpu';
import { COARSE_CUTOFF } from './groundSurface.js';
import {
  attribute, cameraViewMatrix, modelWorldMatrix, normalGeometry, positionGeometry, positionLocal, positionWorld, smoothstep, step, texture,
  uniform, float, length, mix, normalize, varying, vec3, vec4, fwidth, mx_noise_float,
} from 'three/tsl';

const MID_SIZE = 12.8;
const MID_CELLS = 64;
const NEAR_CELLS = 128;
const RINGS = 2;
const SPAN = (2 * RINGS + 1) * MID_SIZE;
const FADE = [22, 30];
const NEAR_REACH = 4;
const SKIRT = 0.25;
const BUDGET_MS = 4;
const ALTITUDE = [12, 18];
const FOCUS_MARGIN = 1;
const TEXEL = 0.2;
const TEX_SIZE = Math.round(SPAN / TEXEL);

export function createFineState() {
  const detail = new Uint16Array(TEX_SIZE * TEX_SIZE);
  const tex = new THREE.DataTexture(detail, TEX_SIZE, TEX_SIZE, THREE.RedFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const center = uniform(new THREE.Vector2(0, 0));
  const amount = uniform(0);
  const radius = uniform(0);
  return {
    detail, tex, center, amount, radius,
    lowerNode() {
      const r = length(modelWorldMatrix.mul(vec4(positionLocal, 1)).xz.sub(center));
      return float(1).sub(smoothstep(radius.sub(2), radius, r)).mul(0.6);
    },
    outsideNode() {
      return step(radius, length(positionWorld.xz.sub(center)));
    },
    grassOffsetNode(xz) {
      const r = length(xz.sub(center));
      const w = float(1).sub(smoothstep(FADE[0], FADE[1], r)).mul(amount);
      return texture(tex, xz.add(TEXEL / 2).div(SPAN)).r.mul(w);
    },
  };
}

function indexFor(cells) {
  const n = cells + 1;
  const indices = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      const b = a + n;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  let v = n * n;
  for (const edge of [(k) => k, (k) => cells * n + k, (k) => k * n, (k) => k * n + cells]) {
    const start = v;
    v += n;
    for (let k = 0; k < cells; k++) {
      const top0 = edge(k);
      const top1 = edge(k + 1);
      const bot0 = start + k;
      const bot1 = start + k + 1;
      indices.push(top0, bot0, top1, top1, bot0, bot1, top0, top1, bot0, top1, bot1, bot0);
    }
  }
  return new THREE.BufferAttribute(new Uint32Array(indices), 1);
}

export function createFineGround({ world, fine, material, decals = [], shadows = true }) {
  const { surface } = world;
  const group = new THREE.Group();
  group.name = 'fine-ground';
  group.visible = false;
  const indexOf = { [MID_CELLS]: indexFor(MID_CELLS), [NEAR_CELLS]: indexFor(NEAR_CELLS) };
  const pools = { [MID_CELLS]: [], [NEAR_CELLS]: [] };
  const live = new Map();
  const queue = [];
  let centerTile = null;
  let committed = null;
  let focus = null;
  let job = null;
  const stats = { built: 0, msLast: 0 };

  function newTile(cells) {
    const n = cells + 1;
    const count = n * n + 4 * n;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aBaseNormal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aDetail', new THREE.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    geometry.setIndex(indexOf[cells]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = shadows;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, geometry, cells, decals: decals.map(({ material: m }) => {
      const d = new THREE.Mesh(geometry, m);
      d.receiveShadow = shadows;
      d.userData.noShadow = true;
      d.visible = false;
      d.renderOrder = 1;
      mesh.add(d);
      return d;
    }) };
  }

  function acquire(cells) {
    return pools[cells].pop() ?? newTile(cells);
  }

  function release(tile) {
    tile.mesh.visible = false;
    tile.ready = false;
    tile.building = false;
    pools[tile.cells].push(tile);
  }

  function* fill(tile) {
    const { cells, x0, z0, size } = tile;
    const n = cells + 1;
    const step = size / cells;
    const m = n + 2;
    const base = new Float32Array(m * m);
    const detail = new Float32Array(m * m);
    for (let j = 0; j < m; j++) {
      const z = z0 + (j - 1) * step;
      for (let i = 0; i < m; i++) {
        const x = x0 + (i - 1) * step;
        base[j * m + i] = surface.baseAt(x, z);
        detail[j * m + i] = surface.detailAt(x, z, cells === MID_CELLS ? COARSE_CUTOFF : 0);
      }
      yield;
    }
    const a = tile.geometry.attributes;
    const write = (v, i, j, drop) => {
      const q = (j + 1) * m + i + 1;
      const x = x0 + i * step;
      const z = z0 + j * step;
      a.position.array[v * 3] = x;
      a.position.array[v * 3 + 1] = base[q] - drop;
      a.position.array[v * 3 + 2] = z;
      a.aDetail.array[v] = detail[q];
      a.uv.array[v * 2] = (x + world.half) / world.size;
      a.uv.array[v * 2 + 1] = (z + world.half) / world.size;
      const bdx = (base[q + 1] - base[q - 1]) / (2 * step);
      const bdz = (base[q + m] - base[q - m]) / (2 * step);
      const ddx = (detail[q + 1] - detail[q - 1]) / (2 * step);
      const ddz = (detail[q + m] - detail[q - m]) / (2 * step);
      const l0 = Math.hypot(bdx, 1, bdz);
      a.aBaseNormal.array[v * 3] = -bdx / l0;
      a.aBaseNormal.array[v * 3 + 1] = 1 / l0;
      a.aBaseNormal.array[v * 3 + 2] = -bdz / l0;
      const fx = bdx + ddx;
      const fz = bdz + ddz;
      const l1 = Math.hypot(fx, 1, fz);
      a.normal.array[v * 3] = -fx / l1;
      a.normal.array[v * 3 + 1] = 1 / l1;
      a.normal.array[v * 3 + 2] = -fz / l1;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) write(j * n + i, i, j, 0);
    }
    let v = n * n;
    for (const edge of [(k) => [k, 0], (k) => [k, cells], (k) => [0, k], (k) => [cells, k]]) {
      for (let k = 0; k <= cells; k++) {
        const [i, j] = edge(k);
        write(v++, i, j, SKIRT);
      }
    }
    for (const name of ['position', 'normal', 'aBaseNormal', 'aDetail', 'uv']) a[name].needsUpdate = true;
    tile.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(x0 + size / 2, surface.baseAt(x0 + size / 2, z0 + size / 2), z0 + size / 2),
      size * 0.75 + 3,
    );
    tile.decals.forEach((d, k) => {
      const r = decals[k].rect;
      d.visible = x0 < r.x1 && x0 + size > r.x0 && z0 < r.z1 && z0 + size > r.z0;
    });
    if (cells === MID_CELLS) writeGrassDetail(tile, detail, m);
    tile.ready = true;
  }

  function writeGrassDetail(tile, detail, m) {
    for (let j = 0; j < tile.cells; j++) {
      for (let i = 0; i < tile.cells; i++) {
        const x = tile.x0 + i * TEXEL;
        const z = tile.z0 + j * TEXEL;
        const u = ((Math.round(x / TEXEL) % TEX_SIZE) + TEX_SIZE) % TEX_SIZE;
        const w = ((Math.round(z / TEXEL) % TEX_SIZE) + TEX_SIZE) % TEX_SIZE;
        fine.detail[w * TEX_SIZE + u] = THREE.DataUtils.toHalfFloat(detail[(j + 1) * m + i + 1]);
      }
    }
    fine.tex.needsUpdate = true;
  }

  function need(key, cells, x0, z0, size) {
    if (live.has(key)) return live.get(key);
    const tile = acquire(cells);
    Object.assign(tile, { key, x0, z0, size, ready: false, building: true });
    live.set(key, tile);
    queue.push(tile);
    return tile;
  }

  function wanted(fx, fz) {
    const c = centerTile;
    const keep = new Set();
    const mids = [];
    for (let dz = -RINGS; dz <= RINGS; dz++) {
      for (let dx = -RINGS; dx <= RINGS; dx++) {
        const ix = c.ix + dx;
        const iz = c.iz + dz;
        const key = `${ix},${iz},m`;
        const x0 = ix * MID_SIZE;
        const z0 = iz * MID_SIZE;
        mids.push(need(key, MID_CELLS, x0, z0, MID_SIZE));
        keep.add(key);
      }
    }
    const nearDistance = (m) => Math.hypot(
      Math.max(m.x0 - fx, 0, fx - m.x0 - MID_SIZE),
      Math.max(m.z0 - fz, 0, fz - m.z0 - MID_SIZE),
    );
    for (const m of mids) {
      m.subdivided = nearDistance(m) < NEAR_REACH;
      if (!m.subdivided) {
        if (m.children) for (const c of m.children) c.mesh.visible = false;
        m.children = null;
        continue;
      }
      m.children = [];
      for (let b = 0; b < 2; b++) {
        for (let a = 0; a < 2; a++) {
          const key = `${m.key},${a}${b}`;
          keep.add(key);
          m.children.push(need(key, NEAR_CELLS, m.x0 + (a * MID_SIZE) / 2, m.z0 + (b * MID_SIZE) / 2, MID_SIZE / 2));
        }
      }
    }
    return { keep, mids };
  }

  function work() {
    const start = performance.now();
    while (performance.now() - start < BUDGET_MS) {
      if (!job) {
        const tile = queue.shift();
        if (!tile) break;
        job = fill(tile);
      }
      if (job.next().done) {
        job = null;
        stats.built++;
      }
    }
    stats.msLast = performance.now() - start;
  }

  return {
    group,
    stats,
    setFocus(x, z) {
      focus = x === null ? null : [x, z];
    },
    update(camera, ground) {
      const agl = camera.position.y - ground;
      const fade = focus ? 1 : 1 - THREE.MathUtils.smoothstep(agl, ALTITUDE[0], ALTITUDE[1]);
      if (fade <= 0) {
        group.visible = false;
        fine.amount.value = 0;
        fine.radius.value = 0;
        committed = null;
        centerTile = null;
        job = null;
        for (const tile of live.values()) release(tile);
        live.clear();
        queue.length = 0;
        return;
      }
      const fx = focus ? focus[0] : camera.position.x;
      const fz = focus ? focus[1] : camera.position.z;
      if (!centerTile
        || fx < centerTile.ix * MID_SIZE - FOCUS_MARGIN || fx > (centerTile.ix + 1) * MID_SIZE + FOCUS_MARGIN
        || fz < centerTile.iz * MID_SIZE - FOCUS_MARGIN || fz > (centerTile.iz + 1) * MID_SIZE + FOCUS_MARGIN) {
        centerTile = { ix: Math.floor(fx / MID_SIZE), iz: Math.floor(fz / MID_SIZE) };
      }
      const { keep, mids } = wanted(fx, fz);
      work();

      if (mids.every((m) => m.ready)) {
        committed = centerTile;
        fine.center.value.set((centerTile.ix + 0.5) * MID_SIZE, (centerTile.iz + 0.5) * MID_SIZE);
        fine.radius.value = FADE[1] - 0.5;
        for (const [key, tile] of live) {
          if (keep.has(key)) continue;
          if (tile.building && !tile.ready) {
            const at = queue.indexOf(tile);
            if (at >= 0) queue.splice(at, 1);
            else job = null;
          }
          release(tile);
          live.delete(key);
        }
      }
      if (!committed) return;
      group.visible = true;
      fine.amount.value = fade;
      for (const m of mids) {
        const split = m.subdivided && m.children.every((c) => c.ready);
        m.mesh.visible = m.ready && !split;
        if (m.children) for (const c of m.children) c.mesh.visible = split;
      }
    },
    renderedAt(x, z) {
      for (const tile of live.values()) {
        if (!tile.ready || x < tile.x0 || z < tile.z0 || x > tile.x0 + tile.size || z > tile.z0 + tile.size) continue;
        if (tile.cells !== NEAR_CELLS) continue;
        const step = tile.size / tile.cells;
        const i = Math.round((x - tile.x0) / step);
        const j = Math.round((z - tile.z0) / step);
        const v = j * (tile.cells + 1) + i;
        const a = tile.geometry.attributes;
        return { x: a.position.array[v * 3], z: a.position.array[v * 3 + 2], y: a.position.array[v * 3 + 1] + a.aDetail.array[v] };
      }
      return null;
    },
    info() {
      let triangles = 0;
      let visible = 0;
      for (const tile of live.values()) {
        if (!tile.mesh.visible) continue;
        visible++;
        triangles += (tile.cells * tile.cells) * 2;
      }
      return { active: group.visible, tiles: live.size, visible, triangles, queue: queue.length, built: stats.built };
    },
  };
}

export function displacedNodes(fine, lift = 0) {
  const r = length(positionGeometry.xz.sub(fine.center));
  const w = float(1).sub(smoothstep(FADE[0], FADE[1], r)).mul(fine.amount);
  const position = positionGeometry.add(vec3(0, attribute('aDetail', 'float').mul(w).add(lift), 0));
  const worldNormal = mix(attribute('aBaseNormal', 'vec3'), normalGeometry, w);
  const viewNormal = normalize(varying(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz, 'vFineNormal'));
  const xz = positionWorld.xz;
  const pixel = fwidth(xz.x);
  const grain = mx_noise_float(xz.mul(14)).mul(0.0016).add(mx_noise_float(xz.mul(45)).mul(0.0005))
    .mul(float(1).sub(smoothstep(0.004, 0.02, pixel)));
  return { position, viewNormal, grain };
}
