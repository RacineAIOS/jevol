import * as THREE from 'three/webgpu';
import { loadWorld, heightAt } from './engine/world.js';
import { createTerrain } from './engine/terrain.js';
import { createGroundSurface } from './engine/groundSurface.js';
import { createFineGround, createFineState, displacedNodes } from './engine/fineGround.js';
import { createTrees } from './engine/trees.js';
import { createEnvironment } from './engine/environment.js';
import { createGrass } from './engine/grass.js';
import { FlyCamera } from './engine/flycam.js';
import { setSeason } from './engine/season.js';
import { cleanClassNoise } from './engine/classCleanup.js';
import { createFarLand } from './engine/farLand.js';
import { setBakedNoise } from './engine/fastNoise.js';
import { deviceProfile, minDefined } from './engine/deviceProfile.js';
import { createRoads, createPaths, UNPAVED } from './world/common.js';
import { flightField } from './world/flightField.js';
import { createDroneView } from './drone/droneView.js';
import { createObstacleSource } from './drone/obstacleSource.js';
import { createPilot } from './pilot/pilot.js';
import { DATA, SETTINGS } from './config.js';

const status = document.getElementById('status');
const showError = (e) => {
  if (!status.isConnected) return;
  status.textContent = `Could not start${status.dataset.step ? ` (${status.dataset.step})` : ''}: ${e?.message || e}`;
  status.style.color = 'rgb(255,190,120)';
};
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));
const map = flightField;
const meta = await fetch(`${DATA}/meta.json`).then((r) => r.json());
const sunAt = meta.center ? [meta.center.lat, meta.center.lon] : meta.sunAt ?? null;
const quality = 'high';
const seed = Math.floor(Math.random() * 1e6);
setSeason(map.season);
const device = deviceProfile();
const gpu = { ...device.gpu, ...map.gpu };
gpu.shadowMapSize = minDefined(map.gpu.shadowMapSize, device.shadowMapSize);
setBakedNoise(gpu.bakedNoise);

const renderer = new THREE.WebGPURenderer({ antialias: true });
const fullRatio = Math.min(window.devicePixelRatio, device.maxPixelRatio);
renderer.setPixelRatio(fullRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
const env = createEnvironment(renderer, scene, { seed, quality, at: sunAt, shadowMapSize: gpu.shadowMapSize, shadowCascades: device.shadowCascades });
scene.environmentIntensity = map.ambient;
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 20000);

status.textContent = 'Loading the map…';
const world = await loadWorld(DATA);
status.textContent = 'Building the scene…';
const step = (name) => { status.dataset.step = name; };
setTimeout(() => { if (status.isConnected && !status.style.color) status.textContent = `Building the scene… (${status.dataset.step || 'start'})`; }, 10000);
cleanClassNoise(world);
world.cropsMeasured = true;
map.clearGround(world);
world.surface = createGroundSurface({
  size: world.size, half: world.half, heights: world.heights, classes: world.classes, classNames: world.meta.classes,
  wear: world.wear,
  fields: world.meta.fields?.types ? { data: world.fields.image.data, step: world.meta.fields.step, types: world.meta.fields.types } : null,
});
world.surface.setRoads(world.roads.filter((r) => !UNPAVED.has(r.nature)));
world.surface.setZones([]);
world.fine = createFineState();

step('terrain');
const terrain = createTerrain(world);
const roads = createRoads(world);
const paths = createPaths(world, { quality });
terrain.traverse((o) => { o.receiveShadow = env.shadows; });
scene.add(terrain);
const sites = map.createSites(world, { quality });
for (const group of [roads.group, paths.group, ...sites.groups]) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = env.shadows;
    o.castShadow = env.shadows && !o.userData.noShadow;
  });
  scene.add(group);
}
step('trees');
const trees = createTrees(world, renderer, { quality, shadows: env.shadows, sun: env.sun });
scene.add(trees.group);
step('far land');
scene.add(await createFarLand(world, DATA));
step('grass');
const grass = createGrass(world, { quality, fine: world.fine, sun: env.sun });
if (grass) scene.add(grass.mesh);
const fineGround = createFineGround({ world, fine: world.fine, material: world.groundMaterial(displacedNodes(world.fine)), shadows: env.shadows });
scene.add(fineGround.group);

camera.position.set(0, heightAt(world, 0, 0) + 80, 60);
const fly = new FlyCamera(camera, renderer.domElement, world);
const systems = { trees, env, paths, sites, grass };
window.sim = { scene, camera, fly, world, renderer, trees, env, grass, sites, fineGround };

step('drone');
window.sim.robots = await createDroneView({
  scene, camera, fly, world, fineGround, shadows: env.shadows, spawn: map.spawn,
  obstacles: createObstacleSource({ world, sites, trees: true }),
});
step('pilot');
window.sim.policy = await createPilot({
  renderer, scene, camera, world, robotView: window.sim.robots, systems,
  mission: SETTINGS.mission, takeoffAgl: SETTINGS.takeoffHeight, period: SETTINGS.period,
});
sites.start?.(window.sim);
status.remove();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const flightRatio = () => Math.min(fullRatio, window.sim.policy.warmMs > SETTINGS.slowWarmMs ? SETTINGS.slowPixelRatio : SETTINGS.flightPixelRatio);
const timer = new THREE.Timer();
timer.connect(document);
let lastDraw = 0;
renderer.setAnimationLoop(() => {
  if (window.sim.policy.running || window.sim.policy.renderCap) {
    const now = performance.now();
    if (now - lastDraw < 1000 / SETTINGS.flightFps - 2) return;
    lastDraw = now;
  }
  const ratio = window.sim.policy.running && window.sim.policy.renderCap ? flightRatio() : fullRatio;
  if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const ground = fly.update(dt);
  window.sim.robots.update(dt);
  window.sim.policy.update();
  trees.update(camera);
  env.update(camera);
  paths.update(camera);
  sites.update(camera, dt);
  grass?.update(camera.position.y - ground);
  fineGround.update(camera, ground);
  const near = Math.min(0.5, Math.max(0.05, (camera.position.y - ground) * 0.33));
  if (Math.abs(near - camera.near) > 0.005) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
});
