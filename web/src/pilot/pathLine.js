import * as THREE from 'three/webgpu';

const HORIZON_S = 3;
const STEP_S = 0.1;
const WIDTH_M = 0.3;
const LIFT_M = -0.15;
const COLOR = 0x9d9ea6;
const LAYER = 5;

const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const rrt = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const aces = (c, exposure) => mul(OUT, mul(IN, c.map((x) => (x * exposure) / 0.6)).map(rrt)).map((x) => Math.min(1, Math.max(0, x)));
function compensated(target, exposure) {
  const x = [...target];
  for (let i = 0; i < 4000; i++) {
    const y = aces(x, exposure);
    for (let k = 0; k < 3; k++) x[k] = Math.max(1e-4, x[k] + 2.4 * (target[k] - y[k]) * Math.max(x[k], 0.02));
  }
  return x;
}

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.12, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPathLine({ scene, camera }) {
  const n = Math.round(HORIZON_S / STEP_S) + 1;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const index = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    uvs.set([u, 0, u, 1], i * 4);
    if (i < n - 1) {
      const a = 2 * i;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({ color: COLOR, map: gradientTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    fog: false });
  const target = new THREE.Color(COLOR);
  let exposureDone = null;
  function matchColor() {
    const renderer = window.sim?.renderer;
    const exposure = renderer?.toneMapping === THREE.ACESFilmicToneMapping ? renderer.toneMappingExposure : null;
    if (exposure === exposureDone) return;
    exposureDone = exposure;
    if (exposure == null) { material.color.copy(target); return; }
    const [r, g, b] = compensated([target.r, target.g, target.b], exposure);
    material.color.setRGB(r, g, b);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  mesh.layers.set(LAYER);
  camera?.layers.enable(LAYER);
  scene.add(mesh);

  function update(truth, cmd) {
    if (!truth || !cmd) { mesh.visible = false; return; }
    matchColor();
    let x = truth.east;
    let y = truth.north;
    let z = truth.up + LIFT_M;
    let h = truth.yaw;
    const v = cmd.linear_x || 0;
    const vy = cmd.linear_y || 0;
    const vz = cmd.linear_z || 0;
    const w = cmd.angular_z || 0;
    const half = WIDTH_M / 2;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        h += w * STEP_S;
        x += (v * Math.cos(h) - vy * Math.sin(h)) * STEP_S;
        y += (v * Math.sin(h) + vy * Math.cos(h)) * STEP_S;
        z += vz * STEP_S;
      }
      const lx = -Math.sin(h) * half;
      const ly = Math.cos(h) * half;
      positions.set([x + lx, z, -(y + ly), x - lx, z, -(y - ly)], i * 6);
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeBoundingSphere();
    mesh.visible = Math.hypot(v, vy, vz) > 0.05 || Math.abs(w) > 0.02;
  }

  return { update, dispose() { scene.remove(mesh); geometry.dispose(); material.map?.dispose(); material.dispose(); } };
}
