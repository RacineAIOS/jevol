import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const COLORS = { magenta: 0xff3fc8, cyan: 0x18c8ff, yellow: 0xffd21f, orange: 0xff7a1a, lime: 0x8be000 };
const WHITE = 0xf2f2ee;
const DARK = 0x1d1f23;
const BAR_M = 0.3;
const CONTAINER = { length: 6.06, width: 2.44, height: 2.59 };
const CONTAINER_COLORS = [0x8a3b2a, 0x2f5d8a, 0x3e6b4a, 0xc9a227, 0x7a7d82];
const UP = new THREE.Vector3(0, 1, 0);

function paint(geometry, color) {
  const c = new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function bar(out, matrix, a, b, section, colors, stripe = 0.5) {
  const total = a.distanceTo(b);
  const n = Math.max(1, Math.round(total / stripe));
  const dir = b.clone().sub(a).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(section, total / n, section);
    g.applyQuaternion(turn);
    const mid = a.clone().lerp(b, (i + 0.5) / n);
    g.translate(mid.x, mid.y, mid.z);
    out.push(paint(g.applyMatrix4(matrix), colors[i % colors.length]));
  }
}

function box(out, matrix, size, center, color) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  g.translate(center[0], center[1], center[2]);
  out.push(paint(g.applyMatrix4(matrix), color));
}

function ring(out, matrix, radius, tube, up, colors, bands = 16) {
  const g = new THREE.TorusGeometry(radius, tube, 10, bands * 4);
  const c = colors.map((v) => new THREE.Color(v));
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i)) + Math.PI;
    const k = c[Math.floor((a / (Math.PI * 2)) * bands + 0.5) % c.length];
    col.set([k.r, k.g, k.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate(0, up, 0);
  out.push(g.applyMatrix4(matrix));
}

function numberTexture(number, color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16181c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.fillStyle = '#fff';
  ctx.font = '700 86px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const STATE_COLORS = { idle: [0.5, 0.5, 0.5], next: [0.25, 3.2, 0.5], done: [0.25, 0.7, 1.6] };
function stripMaterial() {
  const material = new THREE.MeshBasicNodeMaterial();
  const color = new THREE.Vector3(...STATE_COLORS.idle);
  material.colorNode = uniform(color);
  return { material, set: (state) => color.set(...(STATE_COLORS[state] ?? STATE_COLORS.idle)) };
}

export function createCourse({ items = [], heightAt = () => 0, name = 'flight-course' } = {}) {
  const group = new THREE.Group();
  group.name = name;
  const solid = [];
  const fabric = [];
  const flat = [];
  const strips = [];
  const obstacles = [];
  const gates = [];
  const numbers = new Map();

  for (const item of items) {
    const heading = ((item.headingDeg ?? 0) * Math.PI) / 180;
    const normal = [Math.cos(heading), Math.sin(heading)];
    const side = [-Math.sin(heading), Math.cos(heading)];
    const sideDeg = (item.headingDeg ?? 0) + 90;
    const base = heightAt(item.x, -item.y);
    const matrix = new THREE.Matrix4().makeRotationY(heading + Math.PI / 2).setPosition(item.x, base, -item.y);
    const at = (u, w = 0) => [item.x + side[0] * u + normal[0] * w, item.y + side[1] * u + normal[1] * w];
    const color = item.color ?? COLORS.magenta;
    const lit = [];
    let pass = null;

    if (item.type === 'gate') {
      const w = item.width ?? 4;
      const h = item.height ?? 3;
      const lift = item.lift ?? 0;
      const s = BAR_M;
      const top = lift + h;
      for (const sx of [-1, 1]) bar(solid, matrix, new THREE.Vector3(sx * (w + s) / 2, 0, 0), new THREE.Vector3(sx * (w + s) / 2, top + s, 0), s, [color, WHITE]);
      bar(solid, matrix, new THREE.Vector3(-w / 2, top + s / 2, 0), new THREE.Vector3(w / 2, top + s / 2, 0), s, [WHITE, color]);
      if (lift > s) bar(solid, matrix, new THREE.Vector3(-w / 2, lift - s / 2, 0), new THREE.Vector3(w / 2, lift - s / 2, 0), s, [color, WHITE]);
      for (const sx of [-1, 1]) {
        const [x, y] = at(sx * (w + s) / 2);
        obstacles.push(['box', x, y, base - 0.5, base + top + s, s, s, sideDeg]);
        lit.push(new THREE.BoxGeometry(0.05, h, s + 0.02).translate(sx * (w / 2 - 0.02), lift + h / 2, 0));
      }
      obstacles.push(['box', item.x, item.y, base + top, base + top + s, w + 2 * s, s, sideDeg]);
      if (lift > s) obstacles.push(['box', item.x, item.y, base + lift - s, base + lift, w + 2 * s, s, sideDeg]);
      lit.push(new THREE.BoxGeometry(w, 0.05, s + 0.02).translate(0, top - 0.02, 0));
      if (item.number != null) {
        if (!numbers.has(item.number)) numbers.set(item.number, new THREE.MeshBasicNodeMaterial({ map: numberTexture(item.number, color) }));
        for (const sz of [-1, 1]) {
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), numbers.get(item.number));
          plate.geometry.rotateY(sz > 0 ? 0 : Math.PI).translate(0, top + s + 0.5, sz * 0.03).applyMatrix4(matrix);
          plate.userData.noShadow = true;
          group.add(plate);
        }
        box(solid, matrix, [1.0, 1.0, 0.04], [0, top + s + 0.5, 0], DARK);
      }
      pass = { shape: 'rect', up: base + lift + h / 2, halfWidth: w / 2, halfHeight: h / 2 };
    } else if (item.type === 'hoop') {
      const radius = item.radius ?? 2.2;
      const tube = 0.2;
      const up = item.up ?? radius + 1.2;
      ring(solid, matrix, radius, tube, up, [color, WHITE]);
      if (!item.float) {
        const pole = new THREE.CylinderGeometry(0.07, 0.09, up - radius, 10).translate(0, (up - radius) / 2, 0);
        solid.push(paint(pole.applyMatrix4(matrix), DARK));
        solid.push(paint(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 20).translate(0, 0.04, 0).applyMatrix4(matrix), DARK));
        obstacles.push(['cylinder', item.x, item.y, base - 0.5, base + up - radius, 0.1]);
      }
      const pieces = 24;
      for (let k = 0; k < pieces; k++) {
        const a = (k / pieces) * Math.PI * 2;
        const [x, y] = at(Math.cos(a) * radius);
        const v = base + up + Math.sin(a) * radius;
        obstacles.push(['box', x, y, v - tube - 0.03, v + tube + 0.03, 2 * tube + Math.abs(Math.sin(a)) * 0.45, tube * 2, sideDeg]);
      }
      lit.push(new THREE.TorusGeometry(radius - tube - 0.02, 0.035, 6, 56).translate(0, up, 0));
      pass = { shape: 'circle', up: base + up, radius: radius - tube };
    } else if (item.type === 'flag') {
      const h = item.height ?? 4.2;
      solid.push(paint(new THREE.CylinderGeometry(0.025, 0.04, h, 8).translate(0, h / 2, 0).applyMatrix4(matrix), DARK));
      const cloth = new THREE.PlaneGeometry(1, h * 0.78, 4, 14);
      const p = cloth.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = Math.min(1, Math.max(0, p.getY(i) / (h * 0.78) + 0.5));
        const u = Math.min(1, Math.max(0, p.getX(i) + 0.5));
        const widthAt = 0.78 * Math.sqrt(Math.max(0, 1 - v ** 2.6)) * (0.55 + 0.45 * Math.min(1, v * 6 + 0.4));
        p.setXYZ(i, u * widthAt + 0.03, h * 0.2 + v * h * 0.78, 0.09 * Math.sin(v * 5 + u * 2) * u);
      }
      cloth.computeVertexNormals();
      fabric.push(paint(cloth.applyMatrix4(matrix), color));
      obstacles.push(['cylinder', item.x, item.y, base - 0.5, base + h, 0.08]);
    } else if (item.type === 'pylon') {
      const h = item.height ?? 2.6;
      const n = Math.round(h / 0.52);
      for (let i = 0; i < n; i++) {
        const r0 = 0.34 - (0.12 * i) / n;
        const r1 = 0.34 - (0.12 * (i + 1)) / n;
        solid.push(paint(new THREE.CylinderGeometry(r1, r0, h / n, 16).translate(0, (i + 0.5) * (h / n), 0).applyMatrix4(matrix), i % 2 ? WHITE : color));
      }
      obstacles.push(['cylinder', item.x, item.y, base - 0.5, base + h, 0.34]);
    } else if (item.type === 'tunnel') {
      const length = item.length ?? 18;
      const radius = item.radius ?? 3;
      const n = Math.max(2, Math.round(length / 1.5));
      for (let i = 0; i < n; i++) {
        const strip = new THREE.PlaneGeometry(Math.PI * radius, length / n, 14, 1);
        const p = strip.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const a = p.getX(k) / radius;
          p.setXYZ(k, Math.sin(a) * radius, Math.cos(a) * radius, -length / 2 + (i + 0.5) * (length / n) + p.getY(k));
        }
        strip.computeVertexNormals();
        fabric.push(paint(strip.applyMatrix4(matrix), i % 2 ? WHITE : color));
      }
      for (let i = 0; i <= n; i += 2) {
        const rib = new THREE.TorusGeometry(radius + 0.02, 0.05, 6, 20, Math.PI).translate(0, 0, -length / 2 + i * (length / n));
        solid.push(paint(rib.applyMatrix4(matrix), DARK));
      }
      for (const sx of [-1, 1]) {
        for (const [offset, from, to, width] of [[0.97, 0, 0.5, 0.12], [0.84, 0.45, 0.78, 0.2], [0.6, 0.72, 0.95, 0.42]]) {
          const [x, y] = at(sx * radius * offset);
          obstacles.push(['box', x, y, base + radius * from - (from ? 0 : 0.5), base + radius * to, length, radius * width, item.headingDeg ?? 0]);
        }
      }
      obstacles.push(['box', item.x, item.y, base + radius * 0.93, base + radius + 0.1, length, radius * 0.9, item.headingDeg ?? 0]);
      lit.push(new THREE.TorusGeometry(radius - 0.08, 0.04, 6, 24, Math.PI).translate(0, 0, length / 2), new THREE.TorusGeometry(radius - 0.08, 0.04, 6, 24, Math.PI).translate(0, 0, -length / 2));
      pass = { shape: 'rect', up: base + radius * 0.47, halfWidth: radius * 0.9, halfHeight: radius * 0.47 };
    } else if (item.type === 'arch') {
      const w = item.width ?? 9;
      const h = item.height ?? 5.5;
      for (const sx of [-1, 1]) {
        bar(solid, matrix, new THREE.Vector3(sx * w / 2, 0, 0), new THREE.Vector3(sx * w / 2, h, 0), 0.7, item.solid ? [color] : [DARK, color], 1.1);
        const [x, y] = at(sx * w / 2);
        obstacles.push(['box', x, y, base - 0.5, base + h, 0.7, 0.7, sideDeg]);
      }
      bar(solid, matrix, new THREE.Vector3(-w / 2 - 0.35, h - 0.25, 0), new THREE.Vector3(w / 2 + 0.35, h - 0.25, 0), 0.5, item.solid ? [color] : [DARK, WHITE], 0.5);
      bar(solid, matrix, new THREE.Vector3(-w / 2 - 0.35, h - 0.75, 0), new THREE.Vector3(w / 2 + 0.35, h - 0.75, 0), 0.5, item.solid ? [color] : [WHITE, DARK], 0.5);
      obstacles.push(['box', item.x, item.y, base + h - 1, base + h, w + 0.7, 0.5, sideDeg]);
      lit.push(new THREE.BoxGeometry(w - 0.7, 0.06, 0.52).translate(0, h - 1.03, 0));
      pass = { shape: 'rect', up: base + (h - 1) / 2, halfWidth: w / 2 - 0.35, halfHeight: (h - 1) / 2 };
    } else if (item.type === 'containers') {
      const { length, width, height } = CONTAINER;
      const gap = item.gap ?? 4;
      const offset = gap / 2 + width / 2;
      let k = item.seed ?? 0;
      for (const sx of [-1, 1]) {
        for (let level = 0; level < 2; level++) {
          box(solid, matrix, [width, height, length], [sx * offset, height * (level + 0.5), 0], CONTAINER_COLORS[k++ % CONTAINER_COLORS.length]);
        }
        for (const sz of [-1, 1]) box(solid, matrix, [0.12, height * 2, 0.12], [sx * (gap / 2 - 0.01), height, sz * (length / 2 - 0.05)], DARK);
        const [x, y] = at(sx * offset);
        obstacles.push(['box', x, y, base - 0.5, base + 2 * height, length, width, item.headingDeg ?? 0]);
      }
      box(solid, matrix, [length, height, width], [0, height * 2.5, 0], CONTAINER_COLORS[k % CONTAINER_COLORS.length]);
      obstacles.push(['box', item.x, item.y, base + 2 * height, base + 3 * height, width, length, item.headingDeg ?? 0]);
      lit.push(new THREE.BoxGeometry(gap, 0.06, 0.4).translate(0, 2 * height - 0.03, length / 2), new THREE.BoxGeometry(gap, 0.06, 0.4).translate(0, 2 * height - 0.03, -length / 2));
      pass = { shape: 'rect', up: base + height, halfWidth: gap / 2, halfHeight: height };
    } else if (item.type === 'container') {
      const { length, width, height } = CONTAINER;
      const levels = item.levels ?? 1;
      for (let level = 0; level < levels; level++) {
        const c = item.levelColors?.[level] ?? (level === 0 ? color : (item.topColor ?? CONTAINER_COLORS[(item.seed ?? 0) % CONTAINER_COLORS.length]));
        box(solid, matrix, [width, height, length], [0, height * (level + 0.5), 0], c);
        for (const sx of [-1, 1]) for (let k = -4; k <= 4; k++) box(solid, matrix, [0.04, height - 0.2, 0.08], [sx * (width / 2 + 0.02), height * (level + 0.5), k * 0.65], DARK);
      }
      obstacles.push(['box', item.x, item.y, base - 0.5, base + height * levels, length, width, item.headingDeg ?? 0]);
    } else if (item.type === 'pad') {
      const radius = item.radius ?? 2;
      const bands = [[0, 0.18, color], [0.18, 0.45, WHITE], [0.45, 0.62, color], [0.62, 0.86, WHITE], [0.86, 1, color]];
      for (const [r0, r1, c] of bands) {
        const g = r0 === 0 ? new THREE.CircleGeometry(r1 * radius, 40) : new THREE.RingGeometry(r0 * radius, r1 * radius, 40);
        g.rotateX(-Math.PI / 2).translate(item.x, base + 0.04, -item.y);
        flat.push(paint(g, c));
      }
    }

    if (pass && item.timed && item.strip === false) {
      gates.push({ ...pass, type: item.type, east: item.x, north: item.y, normal, side, setState: () => {} });
    } else if (pass && item.timed) {
      const strip = stripMaterial();
      const mesh = new THREE.Mesh(mergeGeometries(lit.map((g) => g.applyMatrix4(matrix)), false), strip.material);
      mesh.userData.noShadow = true;
      mesh.name = `${name}-band-${gates.length}`;
      group.add(mesh);
      strips.push(strip);
      gates.push({ ...pass, type: item.type, east: item.x, north: item.y, normal, side, setState: strip.set });
    }
  }

  const add = (parts, material, suffix, noShadow = false) => {
    if (!parts.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
    mesh.name = `${name}-${suffix}`;
    mesh.frustumCulled = false;
    if (noShadow) mesh.userData.noShadow = true;
    group.add(mesh);
  };
  add(solid, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 }), 'solids');
  add(fabric, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), 'fabrics');
  add(flat, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'ground', true);

  return {
    group,
    gates,
    addObstacles(sink) {
      for (const [kind, ...values] of obstacles) sink[kind](...values);
    },
    stats: { items: items.length, gates: gates.length, obstacles: obstacles.length },
  };
}
