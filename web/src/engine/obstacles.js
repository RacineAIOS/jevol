const CELL_M = 16;
const DEG = Math.PI / 180;
const WALL_PIECE_M = 8;

export function createObstacleField(build, { clear = [] } = {}) {
  const hits = (x, y, reach) => clear.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r + reach);
  const boxes = [];
  const cylinders = [];
  let cells = null;
  let built = false;

  const sink = {
    box(x, y, base, top, length, width, headingDeg = 0) {
      if (!(top > base) || !(length > 0) || !(width > 0)) return;
      if (clear.length && hits(x, y, Math.hypot(length, width) / 2)) return;
      boxes.push(x, y, base, top, length / 2, width / 2, headingDeg * DEG, Math.hypot(length, width) / 2);
    },
    cylinder(x, y, base, top, radius) {
      if (!(top > base) || !(radius > 0)) return;
      if (clear.length && hits(x, y, radius)) return;
      cylinders.push(x, y, base, top, radius);
    },
    wall(points, { base, top, thickness = 0.08, step = WALL_PIECE_M }) {
      for (let i = 0; i + 1 < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[i + 1];
        const length = Math.hypot(bx - ax, by - ay);
        if (length < 0.05) continue;
        const pieces = Math.max(1, Math.ceil(length / step));
        const heading = Math.atan2(by - ay, bx - ax) / DEG;
        for (let k = 0; k < pieces; k++) {
          const x0 = ax + ((bx - ax) * k) / pieces;
          const y0 = ay + ((by - ay) * k) / pieces;
          const x1 = ax + ((bx - ax) * (k + 1)) / pieces;
          const y1 = ay + ((by - ay) * (k + 1)) / pieces;
          const lo = Math.min(base(x0, y0), base(x1, y1));
          const hi = Math.max(top(x0, y0), top(x1, y1));
          sink.box((x0 + x1) / 2, (y0 + y1) / 2, lo, hi, length / pieces + thickness, thickness, heading);
        }
      }
    },
  };

  function ensure() {
    if (built) return;
    built = true;
    build?.(sink);
    cells = new Map();
    const register = (kind, data, stride, reachAt) => {
      for (let o = 0; o < data.length; o += stride) {
        const r = reachAt(o);
        for (let cx = Math.floor((data[o] - r) / CELL_M); cx <= Math.floor((data[o] + r) / CELL_M); cx++) {
          for (let cy = Math.floor((data[o + 1] - r) / CELL_M); cy <= Math.floor((data[o + 1] + r) / CELL_M); cy++) {
            const key = `${cx},${cy}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(kind, o / stride);
          }
        }
      }
    };
    register(0, boxes, 8, (o) => boxes[o + 7]);
    register(1, cylinders, 5, (o) => cylinders[o + 4]);
  }

  const round = (v) => Math.round(v * 1000) / 1000;

  return {
    query(east, north, half, limit = 5000) {
      ensure();
      const found = [];
      const seen = new Set();
      for (let cx = Math.floor((east - half) / CELL_M); cx <= Math.floor((east + half) / CELL_M); cx++) {
        for (let cy = Math.floor((north - half) / CELL_M); cy <= Math.floor((north + half) / CELL_M); cy++) {
          const list = cells.get(`${cx},${cy}`);
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            const id = list[k] * 1e9 + list[k + 1];
            if (seen.has(id)) continue;
            seen.add(id);
            const o = list[k + 1] * (list[k] === 0 ? 8 : 5);
            const a = list[k] === 0 ? boxes : cylinders;
            const reach = list[k] === 0 ? a[o + 7] : a[o + 4];
            const dx = Math.abs(a[o] - east);
            const dy = Math.abs(a[o + 1] - north);
            if (dx > half + reach || dy > half + reach) continue;
            found.push([list[k], o, Math.hypot(dx, dy) - reach]);
          }
        }
      }
      if (found.length > limit) {
        found.sort((p, q) => p[2] - q[2]);
        found.length = limit;
      }
      const out = { boxes: [], cylinders: [] };
      for (const [kind, o] of found) {
        if (kind === 0) out.boxes.push([round(boxes[o]), round(boxes[o + 1]), round(boxes[o + 2]), round(boxes[o + 3]), round(boxes[o + 4]), round(boxes[o + 5]), round(boxes[o + 6])]);
        else out.cylinders.push([round(cylinders[o]), round(cylinders[o + 1]), round(cylinders[o + 2]), round(cylinders[o + 3]), round(cylinders[o + 4])]);
      }
      return out;
    },
    all() {
      ensure();
      return { boxes: boxes.length / 8, cylinders: cylinders.length / 5 };
    },
    each(onBox, onCylinder) {
      ensure();
      for (let o = 0; o < boxes.length; o += 8) onBox(boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], boxes[o + 4], boxes[o + 5], boxes[o + 6]);
      for (let o = 0; o < cylinders.length; o += 5) onCylinder(cylinders[o], cylinders[o + 1], cylinders[o + 2], cylinders[o + 3], cylinders[o + 4]);
    },
  };
}
