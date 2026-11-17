const MAX_AREA = 150;
const KEEP_NEIGHBORS = ['road_major', 'road_minor', 'building', 'railway'];

export function cleanClassNoise(world) {
  const { size, classes } = world;
  const names = world.meta.classes;
  const paved = names.indexOf('paved');
  const keep = new Set(KEEP_NEIGHBORS.map((n) => names.indexOf(n)).filter((i) => i >= 0));
  const data = world.macro.image.data;
  const seen = new Uint8Array(size * size);
  const stack = [];
  const component = [];
  let removed = 0;

  for (let start = 0; start < size * size; start++) {
    if (classes[start] !== paved || seen[start]) continue;
    component.length = 0;
    stack.push(start);
    seen[start] = 1;
    const border = new Map();
    let touchesKept = false;
    while (stack.length) {
      const i = stack.pop();
      component.push(i);
      const x = i % size;
      const y = (i - x) / size;
      for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1]) {
        if (j < 0) continue;
        const c = classes[j];
        if (c === paved) {
          if (!seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        } else {
          if (keep.has(c)) touchesKept = true;
          border.set(j, c);
        }
      }
    }
    if (component.length > MAX_AREA || touchesKept || border.size === 0) continue;

    const votes = new Map();
    const color = [0, 0, 0];
    for (const [j, c] of border) {
      votes.set(c, (votes.get(c) ?? 0) + 1);
      for (let k = 0; k < 3; k++) color[k] += data[j * 4 + k];
    }
    let best = paved;
    let bestCount = 0;
    for (const [c, n] of votes) if (n > bestCount) [best, bestCount] = [c, n];
    for (const i of component) {
      classes[i] = best;
      for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(color[k] / border.size);
    }
    removed++;
  }
  world.macro.needsUpdate = true;
  return removed;
}
