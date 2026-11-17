const TRUNK_PER_HEIGHT = 0.018;
const TRUNK_MIN_M = 0.08;
const TRUNK_MAX_M = 0.45;
const TRUNK_SHARE = 0.4;
const SHRUB_HEIGHT_M = 3;
const SHRUB_RADIUS_SHARE = 0.35;
const SINK_M = 0.3;

export function addTreeObstacles(sink, world, heightAt) {
  const data = world.trees;
  const stride = world.meta.trees.stride;
  const count = data.length / stride;
  for (let t = 0; t < count; t++) {
    const o = t * stride;
    const x = data[o];
    const y = data[o + 1];
    const height = Math.max(1, data[o + 3]);
    const crown = data[o + 4];
    const ground = heightAt(x, -y);
    if (height <= SHRUB_HEIGHT_M) {
      sink.cylinder(x, y, ground - SINK_M, ground + height, Math.max(TRUNK_MIN_M, crown * SHRUB_RADIUS_SHARE));
    } else {
      const radius = Math.min(TRUNK_MAX_M, Math.max(TRUNK_MIN_M, height * TRUNK_PER_HEIGHT));
      sink.cylinder(x, y, ground - SINK_M, ground + height * TRUNK_SHARE, radius);
    }
  }
}
