import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/rng.js';
import { Solids, STYLE, V } from './solids.js';
import { postMaterial } from './materials.js';

const FENCE_KINDS = {
  barbed: { wires: [0.3, 0.55, 0.82, 1.1], span: 3.4 },
  wire: { wires: [0.45, 0.8, 1.1], span: 3.8 },
  rails: { rails: [0.62, 1.05], span: 2.8 },
};
const kindName = (k) => {
  const s = String(k ?? '').toLowerCase();
  if (/rail|wood|horse/.test(s)) return 'rails';
  if (/wire|elec/.test(s)) return 'wire';
  return 'barbed';
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const WIRE = { color: [0.16, 0.16, 0.16], rough: 0.7, metal: 0.2, mat: 0 };
function wire(s, a, b) {
  const d = b.clone().sub(a);
  const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(0.007);
  const up = new THREE.Vector3(0, 0.007, 0);
  const o = side.clone().add(up);
  const p = [a.clone().sub(o), a.clone().add(o), b.clone().add(o), b.clone().sub(o)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  s.add(g, null, WIRE);
  g.dispose();
}

export function buildFences(fences, { heightAt, seed = 1 }, s) {
  const posts = [];
  const wires = new Solids();
  let length = 0;
  (fences ?? []).forEach((fc, fi) => {
    const line = (fc?.line ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (line.length < 2) return;
    const kind = FENCE_KINDS[kindName(fc.kind)];
    const rng = mulberry32((seed * 9001 + fi * 1013 + 29) >>> 0);
    const ground = (x, y) => heightAt(x, -y);
    const spanBase = kind.span * (0.85 + rng() * 0.3);
    const postR = 0.04 + rng() * 0.02;
    const lot = 0.8 + rng() * 0.4;
    const nodes = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, y0] = line[i];
      const [x1, y1] = line[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 0.05) continue;
      const n = Math.max(1, Math.round(L / spanBase));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        nodes.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, corner: k === 0 && (i === 0 || true), seg: i, dx: (x1 - x0) / L, dy: (y1 - y0) / L });
      }
      length += L;
    }
    const last = line[line.length - 1];
    nodes.push({ x: last[0], y: last[1], corner: true, seg: line.length - 2, dx: 0, dy: 0 });
    nodes.forEach((nd, i) => {
      const end = i === 0 || i === nodes.length - 1;
      const corner = nd.corner && (end || (nd.dx !== (nodes[i - 1]?.dx ?? nd.dx)) || (nd.dy !== (nodes[i - 1]?.dy ?? nd.dy)));
      const r = corner ? 0.07 + rng() * 0.02 : postR * (0.9 + rng() * 0.2);
      const h = (corner ? 1.3 : 1.12) + rng() * 0.2;
      nd.top = ground(nd.x, nd.y) + h;
      nd.base = ground(nd.x, nd.y);
      nd.h = h;
      nd.corner = corner;
      posts.push({
        x: nd.x, y: nd.base - 0.25, z: -nd.y, r, h: h + 0.25, lean: [(rng() - 0.5) * 0.05, (rng() - 0.5) * 0.05],
        yaw: rng() * 6.28, tint: lot * (0.85 + rng() * 0.3), grey: corner ? 0 : rng() < 0.2 ? 1 : 0,
      });
      if (end && nodes.length > 2) {
        const o = i === 0 ? nodes[1] : nodes[i - 1];
        const dx = o.x - nd.x;
        const dy = o.y - nd.y;
        const d = Math.hypot(dx, dy) || 1;
        s.groundY = nd.base;
        s.bar(V(nd.x + (dx / d) * 1.8, ground(nd.x + (dx / d) * 1.8, nd.y + (dy / d) * 1.8) + 0.1, -(nd.y + (dy / d) * 1.8)), V(nd.x, nd.base + h * 0.85, -nd.y), 0.04, 0.04, 6, STYLE.wood);
      }
    });
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) > spanBase * 2.5) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const gm = ground(mx, my);
      s.groundY = Math.min(a.base, b.base);
      if (kind.wires) {
        kind.wires.forEach((hh) => {
          const ya = a.base + hh * (a.h / 1.2);
          const yb = b.base + hh * (b.h / 1.2);
          const ym = Math.max(gm + hh * 0.9, (ya + yb) / 2 - 0.03);
          const A = V(a.x, ya, -a.y);
          const B = V(b.x, yb, -b.y);
          const M = V(mx, ym, -my);
          wire(wires, A, M);
          wire(wires, M, B);
        });
      } else {
        for (const hh of kind.rails) {
          const ya = a.base + hh;
          const yb = b.base + hh;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const yaw = Math.atan2(b.y - a.y, b.x - a.x);
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(mx, (ya + yb) / 2, -my + 0),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.atan2(yb - ya, d), 'YXZ')),
            new THREE.Vector3(d - 0.02, 0.14, 0.035),
          );
          s.add(UNIT_BOX, m, STYLE.wood);
        }
      }
    }
  });

  let mesh = null;
  if (posts.length) {
    const g = new THREE.CylinderGeometry(0.46, 0.5, 1, 6, 1, false);
    g.translate(0, 0.5, 0);
    mesh = new THREE.InstancedMesh(g, postMaterial(), posts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    posts.forEach((p, k) => {
      e.set(p.lean[0], p.yaw, p.lean[1]);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.r * 2, p.h, p.r * 2));
      mesh.setMatrixAt(k, m);
      const t = p.tint;
      mesh.setColorAt(k, p.grey ? new THREE.Color(0.8 * t, 1.1 * t, 1.5 * t) : new THREE.Color(t, t * 0.95, t * 0.9));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = 'fence-posts';
  }
  return { posts: mesh, wires: wires.build(), length, count: posts.length };
}
