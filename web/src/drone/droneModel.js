import { createMini4ProHero } from '../assets/drone/mini4pro.js';

export function createDroneModel(options = {}) {
  const model = createMini4ProHero(options);
  model.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return model;
}
