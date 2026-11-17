import * as THREE from 'three/webgpu';

export async function startScene({ fps = 0 } = {}) {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:fixed;inset:0;z-index:0';
  document.body.appendChild(canvas);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9c2d8);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 2000);
  camera.position.set(0, 40, 90);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 400 });
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 200, 200), new THREE.MeshStandardMaterial({ color: 0x6f7f4f, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const count = 20000;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8a7f70, roughness: 0.7, metalness: 0.1 }), count);
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  const m = new THREE.Matrix4();
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < count; i++) {
    const h = 1 + rnd() * 8;
    m.compose(new THREE.Vector3((rnd() - 0.5) * 300, h / 2, (rnd() - 0.5) * 300), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0)), new THREE.Vector3(1 + rnd() * 2, h, 1 + rnd() * 2));
    boxes.setMatrixAt(i, m);
  }
  scene.add(boxes);

  let frames = 0;
  let last = 0;
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (fps > 0 && now - last < 1000 / fps - 2) return;
    last = now;
    const a = (now - t0) / 8000;
    camera.position.set(Math.sin(a) * 90, 40, Math.cos(a) * 90);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    frames++;
  });

  return {
    pixels: [canvas.width, canvas.height],
    frames: () => frames,
    stop() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      canvas.remove();
    },
  };
}
