import * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { SkyMesh } from './vendor/SkyMesh.js';
import { mulberry32 } from './rng.js';
import { sunPosition } from './sun.js';

export const SHADOW_PROFILES = {
  low: null,
  medium: { cascades: 2, maxFar: 450, mapSize: 1024 },
  high: { cascades: 3, maxFar: 800, mapSize: 4096 },
};

export function createEnvironment(renderer, scene, { seed, quality = 'high', time = null, at = null, weather = {}, shadowMapSize = null, shadowCascades = null } = {}) {
  const rnd = mulberry32(seed);
  const conditions = {
    seed,
    azimuth: rnd.range(190, 250),
    elevation: rnd.range(28, 50),
    turbidity: rnd.range(2.5, 6),
    coverage: rnd.range(0.25, 0.55),
    density: rnd.range(0.3, 0.6),
    cloudScale: 0.00022,
    time,
  };
  if (time && at) Object.assign(conditions, sunPosition(time, at[0], at[1]));
  for (const k of ['coverage', 'turbidity', 'cloudScale']) if (Number.isFinite(weather[k])) conditions[k] = weather[k];

  const sunDir = directionFrom(conditions.azimuth, conditions.elevation);

  const configureSky = (sky) => {
    sky.scale.setScalar(18000);
    sky.frustumCulled = false;
    sky.turbidity.value = conditions.turbidity;
    sky.rayleigh.value = 1.2;
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.8;
    sky.sunPosition.value.copy(sunDir);
    sky.cloudCoverage.value = conditions.coverage;
    sky.cloudDensity.value = conditions.density;
    sky.cloudElevation.value = 0.55;
    sky.cloudScale.value = conditions.cloudScale;
    sky.cloudSpeed.value = 0.00001;
    sky.cloudOffset.value.set(rnd.range(-500, 500), rnd.range(-500, 500));
    return sky;
  };
  const sky = configureSky(new SkyMesh());
  sky.name = 'sky';
  scene.add(sky);

  const envScene = new THREE.Scene();
  const envSky = configureSky(new SkyMesh());
  envSky.cloudOffset.value.copy(sky.cloudOffset.value);
  envSky.showSunDisc.value = 0;
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(envScene);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.23;

  const warm = THREE.MathUtils.smoothstep(conditions.elevation, 5, 45);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb27a).lerp(new THREE.Color(0xfff3e4), warm), 4.5 + 2.8 * warm);
  sun.position.copy(sunDir).multiplyScalar(1500);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const profile = SHADOW_PROFILES[quality];
  let followCamera = false;
  if (profile) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(shadowMapSize ? Math.min(shadowMapSize, profile.mapSize) : profile.mapSize);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 4000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.4;
    if (renderer.backend.isWebGPUBackend) {
      const cascades = shadowCascades ? Math.min(shadowCascades, profile.cascades) : profile.cascades;
      const csm = new CSMShadowNode(sun, { cascades, maxFar: profile.maxFar, mode: 'practical', lightMargin: 300 });
      csm.fade = true;
      sun.shadow.shadowNode = csm;
    } else {
      const half = profile.maxFar * 0.4;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
      sun.shadow.camera.updateProjectionMatrix();
      followCamera = true;
    }
  }

  const haze = new THREE.Color(0xc9d6e2).lerp(new THREE.Color(0xd8d8d4), (conditions.turbidity - 2.5) / 3.5);
  scene.fog = new THREE.FogExp2(haze, 0.00012 + 0.00004 * conditions.turbidity);
  scene.background = null;

  function update(camera) {
    if (!followCamera) return;
    const x = Math.round(camera.position.x);
    const z = Math.round(camera.position.z);
    sun.target.position.set(x, 0, z);
    sun.position.set(x, 0, z).addScaledVector(sunDir, 1500);
  }

  const dynamic = {
    envScene,
    setSunDirection(azimuth, elevation) {
      conditions.azimuth = azimuth;
      conditions.elevation = elevation;
      const d = directionFrom(azimuth, elevation);
      sky.sunPosition.value.copy(d);
      envSky.sunPosition.value.copy(d);
    },
    setLight(direction, color, intensity) {
      sunDir.copy(direction).normalize();
      sun.color.copy(color);
      sun.intensity = intensity;
      sun.position.copy(sunDir).multiplyScalar(1500);
      sun.target.position.set(0, 0, 0);
      sun.updateMatrixWorld();
    },
    setFog(color, density) {
      scene.fog.color.copy(color);
      scene.fog.density = density;
    },
    setSky({ coverage, density, turbidity, rayleigh, sunDisc }) {
      for (const [k, v] of [['cloudCoverage', coverage], ['cloudDensity', density], ['turbidity', turbidity], ['rayleigh', rayleigh]]) {
        if (Number.isFinite(v)) { sky[k].value = v; envSky[k].value = v; }
      }
      if (Number.isFinite(sunDisc)) sky.showSunDisc.value = sunDisc;
    },
    refreshAmbient() {
      pmrem.fromScene(envScene, 0, 0.1, 100, { renderTarget: envTarget });
    },
  };

  return { sky, sun, conditions, shadows: !!profile, update, dynamic };
}

function directionFrom(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
