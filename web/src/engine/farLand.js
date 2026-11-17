import * as THREE from 'three/webgpu';

const CANOPY = 20;
export const SENTINEL_ALBEDO = 0.55;
const INNER = 1000;

export async function createFarLand(world, base = '/data') {
  const meta = await (await fetch(`${base}/far.json`)).json();
  const [buffer, bitmap] = await Promise.all([
    fetch(`${base}/${meta.height.file}`).then((r) => r.arrayBuffer()),
    fetch(`${base}/far.jpg`).then((r) => r.blob()).then((b) => createImageBitmap(b)),
  ]);
  const heights = new Float32Array(buffer);
  const n = meta.size;
  const half = meta.half;
  const step = (2 * half) / n;

  const canvas = new OffscreenCanvas(n, n);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, n, n);
  const pixels = ctx.getImageData(0, 0, n, n).data;

  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -half + (i + 0.5) * step;
      const y = half - (j + 0.5) * step;
      const r = pixels[k * 4];
      const g = pixels[k * 4 + 1];
      const b = pixels[k * 4 + 2];
      const forest = (r + g + b) / 3 < 45 ? CANOPY : 0;
      const inside = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(y)), INNER, INNER + 250);
      positions.set([x, heights[k] + forest * (1 - inside) - world.hmin - 3 * inside, -y], k * 3);
      uvs.set([(i + 0.5) / n, (j + 0.5) / n], k * 2);
    }
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = -half + (i + 0.5) * step;
      const y0 = half - (j + 0.5) * step;
      if (Math.max(Math.abs(x0 + step / 2), Math.abs(y0 - step / 2)) < INNER - 2 * step) continue;
      const a = j * n + i;
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const map = new THREE.Texture(bitmap);
  map.colorSpace = THREE.NoColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  map.needsUpdate = true;
  const material = new THREE.MeshLambertNodeMaterial({ map, color: new THREE.Color().setScalar(SENTINEL_ALBEDO) });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'distant-landscape';
  mesh.frustumCulled = false;
  return mesh;
}
