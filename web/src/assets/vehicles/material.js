import * as THREE from 'three/webgpu';
import { attribute, positionGeometry, smoothstep, mix, vec3, float } from 'three/tsl';

export function vehicleMaterial({ dirtTop = 0.5 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const col = attribute('aCol', 'vec3');
  const surf = attribute('aSurf', 'vec3');
  const tint = attribute('aTint', 'vec4');

  const base = mix(col, tint.xyz, surf.x);
  const h = positionGeometry.y;
  const dirt = smoothstep(float(dirtTop), float(0.05), h).mul(tint.w);
  m.colorNode = mix(base, vec3(0.2, 0.15, 0.1), dirt.mul(0.6));
  m.roughnessNode = mix(surf.y, float(0.95), dirt);
  m.metalnessNode = surf.z.mul(float(1).sub(dirt));

  return m;
}
