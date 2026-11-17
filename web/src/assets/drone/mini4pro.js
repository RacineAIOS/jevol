import * as THREE from 'three/webgpu';
import { float, length, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const PROP_R = 0.0675;
const MOTORS = [
  [-0.105, -0.0905], [0.105, -0.0905], [-0.119, 0.0715], [0.119, 0.0715],
];
const HINGES = [
  [-0.028, -0.040], [0.028, -0.040], [-0.030, 0.036], [0.030, 0.036],
];
const ARM_Y = [-0.004, -0.004, -0.012, -0.012];
const ARM_RISE = 0.016;
const PROP_Y = 0.0443;
const FOOT_Y = -0.050;
const WHITE = new THREE.Color(0xd9dbde);

function roundedBox(w, h, d, r, seg = 4, shape) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    v.sub(inner);
    if (v.lengthSq() > 1e-12) {
      v.normalize();
      n.setXYZ(i, v.x, v.y, v.z);
      p.setXYZ(i, inner.x + v.x * r, inner.y + v.y * r, inner.z + v.z * r);
    }
  }
  if (shape) for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); shape(v); p.setXYZ(i, v.x, v.y, v.z); }
  return g;
}

function put(g, x, y, z, color, rot = [0, 0, 0]) {
  g.deleteAttribute('uv');
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function cylinder(rt, rb, h, seg = 20) { return new THREE.CylinderGeometry(rt, rb, h, seg); }

function labelTexture(lines, w = 256, h = 64, color = '#3a3d42') {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  lines.forEach(([text, size, weight], i) => {
    c.font = `${weight} ${size}px sans-serif`;
    c.fillText(text, w / 2, (h * (i + 0.6)) / lines.length);
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function bladeGeometry(sign) {
  const rows = 9, cols = 3, r0 = 0.0085;
  const pos = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    const x = r0 + (PROP_R - r0) * s;
    const chord = (0.0035 + 0.0050 * Math.sin(Math.PI * Math.pow(s, 0.65))) * (1 - 0.5 * Math.pow(s, 7)) + 0.0012;
    const twist = THREE.MathUtils.lerp(0.38, 0.12, s);
    for (let j = 0; j <= cols; j++) {
      const t = j / cols - 0.5;
      const u = t * chord;
      const camber = 0.0004 * (1 - 4 * t * t);
      pos.push(x, u * Math.sin(twist) + camber, sign * u * Math.cos(twist));
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function propellerGeometry(sign) {
  const a = bladeGeometry(sign);
  const b = a.clone().rotateY(Math.PI);
  return mergeGeometries([a, b]);
}

export function createMini4ProHero(options = {}) {
  const { color = 0xc3c6ca, propellers = 'static', folded = 0, leds = true } = options;
  const group = new THREE.Group();
  group.name = 'mini4pro-hero';
  const body = new THREE.Color(color);
  const bodyLow = body.clone().multiplyScalar(0.94);
  const bodyHigh = body.clone().lerp(WHITE, 0.4);
  const BLACK = 0x17181a, GRAPHITE = 0x2b2d31, RUBBER = 0x101112, LENS = 0x1a2a3a;

  const shell = [];
  const dark = [];
  const glass = [];

  const E = { cy: -0.0205, cz: -0.004, a: 0.034, c: 0.074, top: 0.024, bottom: 0.0235 };
  const egg = (ux, uy, uz, out = new THREE.Vector3()) => {
    const front = Math.max(0, -uz), rear = Math.max(0, uz);
    const w = E.a * (1 - 0.2 * front + 0.06 * rear);
    const h = uy > 0 ? E.top * (1 + 0.1 * rear) : E.bottom * (1 - 0.12 * rear);
    return out.set(ux * w, E.cy + uy * h, E.cz + uz * E.c);
  };
  const dirOf = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const eggNormal = (p) => new THREE.Vector3((p.x) / (E.a * E.a), (p.y - E.cy) / (E.top * E.top), (p.z - E.cz) / (E.c * E.c)).normalize();
  {
    const g = new THREE.SphereGeometry(1, 40, 24);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { egg(p.getX(i), p.getY(i), p.getZ(i), v); p.setXYZ(i, v.x, v.y, v.z); }
    const m = mergeVertices(g, 1e-6);
    m.computeVertexNormals();
    const col = new Float32Array(m.attributes.position.count * 3);
    const c = body;
    for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    shell.push(m);
  }
  const line = (dirs, r = 0.00045, closed = false, lift = 1.0025) => {
    const pts = dirs.map(([x, y, z]) => { const p = egg(x, y, z); p.sub(new THREE.Vector3(0, E.cy, E.cz)).multiplyScalar(lift).add(new THREE.Vector3(0, E.cy, E.cz)); return p; });
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), pts.length * 2, r, 4, closed);
    g.deleteAttribute('uv');
    dark.push(put(g, 0, 0, 0, BLACK));
  };
  const ring = [];
  for (let i = 0; i < 40; i++) { const f = (i / 40) * Math.PI * 2; ring.push(dirOf(Math.cos(f) * 0.985, -0.17, Math.sin(f) * 0.985)); }
  line(ring, 0.0005, true, 1.001);
  const cover = (u, from, to) => { const d = []; for (let i = 0; i <= 10; i++) { const a = from + ((to - from) * i) / 10; d.push(dirOf(Math.sin(a) * Math.sqrt(1 - u * u), Math.cos(a) * Math.sqrt(1 - u * u), u)); } return d; };
  line(cover(0.30, -1.0, 1.0));
  for (const sx of [-1, 1]) { const d = []; for (let i = 0; i <= 8; i++) { const t = 0.30 + (0.52 * i) / 8; const x = sx * 0.55, y = Math.sqrt(Math.max(0.01, 1 - x * x - t * t)); d.push([x, y, t]); } line(d); }
  line((() => { const d = []; for (let i = 0; i <= 8; i++) { const t = -0.62 + (0.92 * i) / 8; d.push(dirOf(0, Math.sqrt(1 - t * t), t)); } return d; })(), 0.0004);

  const lens = (dir, r, ring2 = 1.45) => {
    const [dx, dy, dz] = dirOf(...dir);
    const p = egg(dx, dy, dz);
    const n = eggNormal(p);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const place = (g, depth, color) => { g.applyQuaternion(q); g.translate(p.x + n.x * depth, p.y + n.y * depth, p.z + n.z * depth); return put(g, 0, 0, 0, color); };
    dark.push(place(cylinder(r * ring2, r * ring2 * 1.08, 0.0016, 16), -0.0002, GRAPHITE));
    glass.push(place(cylinder(r, r, 0.0016, 14), 0.0003, LENS));
    glass.push(place(cylinder(r * 0.45, r * 0.45, 0.0016, 10), 0.0006, 0x3b6a96));
  };
  for (const sx of [-1, 1]) {
    lens([sx * 0.34, 0.20, -0.92], 0.0036);
    lens([sx * 0.34, 0.93, -0.30], 0.0032);
    lens([sx * 0.30, 0.22, 0.93], 0.0034);
    lens([sx * 0.32, -0.93, -0.22], 0.0036);
  }
  {
    const p = egg(0, -1, -0.15);
    dark.push(put(roundedBox(0.008, 0.0016, 0.005, 0.0006, 1), p.x, p.y - 0.0003, p.z, GRAPHITE));
    glass.push(put(roundedBox(0.005, 0.0016, 0.003, 0.0005, 1), p.x, p.y - 0.0010, p.z, 0x15202c));
    const q = egg(0, -1, 0.35);
    dark.push(put(roundedBox(0.012, 0.0014, 0.0065, 0.0006, 1), q.x, q.y - 0.0002, q.z, GRAPHITE));
  }

  const noseFront = egg(0, 0, -1).z;
  const gy = E.cy - 0.004, gz = noseFront - 0.0095;
  {
    const bowl = new THREE.SphereGeometry(0.0145, 18, 10);
    bowl.scale(1, 0.8, 0.9);
    dark.push(put(bowl, 0, gy + 0.0015, noseFront + 0.0035, 0x0f1012));
  }
  dark.push(put(cylinder(0.0062, 0.0062, 0.0055, 18), 0, gy + 0.0105, gz + 0.0035, GRAPHITE));
  shell.push(put(roundedBox(0.0032, 0.0165, 0.0075, 0.0014, 2), 0.0122, gy + 0.0025, gz + 0.0015, bodyLow));
  dark.push(put(cylinder(0.0048, 0.0048, 0.0055, 14), 0.0128, gy, gz, GRAPHITE, [0, 0, Math.PI / 2]));
  dark.push(put(roundedBox(0.0195, 0.0165, 0.0195, 0.0052, 3), 0, gy, gz, BLACK));
  dark.push(put(cylinder(0.0078, 0.0078, 0.0036, 24), 0, gy, gz - 0.0108, GRAPHITE, [Math.PI / 2, 0, 0]));
  dark.push(put(cylinder(0.0064, 0.0064, 0.0014, 24), 0, gy, gz - 0.0128, 0x0b0c0d, [Math.PI / 2, 0, 0]));
  const dome = new THREE.SphereGeometry(0.0056, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.5, 1);
  glass.push(put(dome, 0, gy, gz - 0.0136, 0x1b2c3c, [-Math.PI / 2, 0, 0]));
  glass.push(put(cylinder(0.0026, 0.0026, 0.0006, 10), 0, gy, gz - 0.0141, 0x3b6a96, [Math.PI / 2, 0, 0]));

  const pad = (x, z, w, d) => {
    const uz = (z - E.cz) / E.c;
    const ux = x / (E.a * (1 - 0.2 * Math.max(0, -uz) + 0.06 * Math.max(0, uz)));
    const yTop = egg(ux, -Math.sqrt(Math.max(0.01, 1 - ux * ux - uz * uz)), uz).y + 0.002;
    const h = yTop - FOOT_Y;
    const leg = cylinder(w * 0.30, w * 0.45, h, 12);
    leg.scale(1, 1, d / w);
    shell.push(put(leg, x, (yTop + FOOT_Y) / 2, z, bodyLow));
    const foot = cylinder(w * 0.55, w * 0.62, 0.0036, 12);
    foot.scale(1, 1, d / w);
    dark.push(put(foot, x, FOOT_Y + 0.0018, z, RUBBER));
  };
  for (const sx of [-1, 1]) {
    pad(sx * 0.030, -0.040, 0.011, 0.015);
    pad(sx * 0.024, 0.050, 0.011, 0.016);
  }

  const plateGeometry = (ux0, ux1, uz0, uz1, nx = 8, nz = 3) => {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const ux = ux0 + ((ux1 - ux0) * i) / nx, uz = uz1 - ((uz1 - uz0) * j) / nz;
      const uy = Math.sqrt(Math.max(0.0001, 1 - ux * ux - uz * uz));
      const p = egg(ux, uy, uz);
      const n = eggNormal(p);
      pos.push(p.x + n.x * 0.0004, p.y + n.y * 0.0004, p.z + n.z * 0.0004);
      uv.push(i / nx, 1 - j / nz);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + nx + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  };
  const plates = [
    { g: plateGeometry(-0.5, 0.5, 0.42, 0.62), texture: labelTexture([['MINI 4 PRO', 30, 'bold'], ['7.3 V  Li-ion  Intelligent Flight Battery', 11, 'normal']], 256, 80) },
  ];

  const shellMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.0 });
  const darkMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 });
  const glassMat = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.04 });
  const merge = (list) => mergeGeometries(list);
  const unify = (list) => { const indexed = list.every((g) => g.index); return indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g)); };
  group.add(new THREE.Mesh(merge(unify(shell)), shellMat));
  group.add(new THREE.Mesh(merge(unify(dark)), darkMat));
  const glassMesh = new THREE.Mesh(merge(unify(glass)), glassMat);
  glassMesh.userData.noShadow = true;
  group.add(glassMesh);
  for (const { g, texture } of plates) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicNodeMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.userData.noShadow = true;
    group.add(m);
  }

  function armGeometry(len, bend, color) {
    const rows = 12, seg = 10;
    const pos = [], idx = [];
    const c0 = new THREE.Vector3(0, 0, 0), c1 = new THREE.Vector3(len * 0.5, 0, bend), c2 = new THREE.Vector3(len, 0, 0);
    const curve = new THREE.QuadraticBezierCurve3(c0, c1, c2);
    for (let i = 0; i <= rows; i++) {
      const s = i / rows;
      const p = curve.getPoint(s), tg = curve.getTangent(s);
      const side = new THREE.Vector3(-tg.z, 0, tg.x);
      const hw = THREE.MathUtils.lerp(0.0105, 0.0058, Math.pow(s, 0.8));
      const hh = THREE.MathUtils.lerp(0.0062, 0.0036, s);
      for (let k = 0; k < seg; k++) {
        const f = (k / seg) * Math.PI * 2;
        const e = Math.sign(Math.cos(f)) * Math.pow(Math.abs(Math.cos(f)), 0.7);
        const g = Math.sign(Math.sin(f)) * Math.pow(Math.abs(Math.sin(f)), 0.7);
        pos.push(p.x + side.x * hw * e, p.y + hh * g + ARM_RISE * Math.pow(s, 1.6), p.z + side.z * hw * e);
      }
    }
    for (let i = 0; i < rows; i++) for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const cc = new THREE.Color(color);
    const col = new Float32Array((rows + 1) * seg * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = cc.r; col[i + 1] = cc.g; col[i + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  const arms = [];
  const bladeCW = propellerGeometry(1), bladeCCW = propellerGeometry(-1);
  const hubGeom = mergeGeometries([cylinder(0.0062, 0.0072, 0.0060, 16), cylinder(0.0036, 0.0036, 0.0085, 10).translate(0, 0.0005, 0)].map((g) => { g.deleteAttribute('uv'); return g; }));
  const disc = new THREE.CircleGeometry(PROP_R, 36).rotateX(-Math.PI / 2);
  const rr = length(positionLocal.xz).div(PROP_R);
  const discAlpha = float(0.06).add(smoothstep(0.25, 0.5, rr).mul(0.09)).mul(float(1).sub(smoothstep(0.88, 1.0, rr)));
  const discMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  discMat.colorNode = vec3(0.32, 0.34, 0.37);
  discMat.opacityNode = discAlpha;
  const blurBladeMat = new THREE.MeshBasicNodeMaterial({ color: 0x3a3d42, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const bladeMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b3e43, roughness: 0.5, side: THREE.DoubleSide });
  const hubMat = new THREE.MeshStandardNodeMaterial({ color: 0x1d1f22, roughness: 0.35, metalness: 0.2 });
  const ledMat = [new THREE.MeshBasicNodeMaterial({ color: 0xff3020 }), new THREE.MeshBasicNodeMaterial({ color: 0x38ff60 })];
  const props = [];

  MOTORS.forEach(([mx, mz], i) => {
    const [hx, hz] = HINGES[i];
    const front = mz < 0;
    const armY = ARM_Y[i];
    const dx = mx - hx, dz = mz - hz;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const arm = new THREE.Group();
    arm.position.set(hx, armY, hz);
    arm.userData.openYaw = yaw;
    arm.userData.foldYaw = front ? -Math.PI / 2 + Math.sign(hx) * 0.12 : Math.PI / 2 - Math.sign(hx) * 0.12;
    const s = [], d = [];
    s.push(armGeometry(len, front ? 0.007 : -0.005, bodyHigh));
    d.push(put(cylinder(0.0062, 0.0062, 0.0105, 14), 0, 0, 0, GRAPHITE));
    const stack = PROP_Y - armY;
    const base = ARM_RISE - 0.003;
    const rest = stack - base;
    const pedH = rest * 0.3, bellH = Math.min(0.017, rest * 0.5);
    s.push(put(cylinder(0.0068, 0.0078, pedH, 18), len, base + pedH / 2, 0, bodyLow));
    d.push(put(cylinder(0.0115, 0.0112, bellH, 24), len, base + pedH + bellH / 2, 0, GRAPHITE));
    d.push(put(cylinder(0.0090, 0.0115, 0.0020, 24), len, base + pedH + bellH + 0.001, 0, BLACK));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      d.push(put(new THREE.BoxGeometry(0.0011, bellH * 0.55, 0.0030), len + Math.cos(a) * 0.0114, base + pedH + bellH * 0.5, Math.sin(a) * 0.0114, BLACK, [0, -a, 0]));
    }
    arm.add(new THREE.Mesh(merge(unify(s)), shellMat), new THREE.Mesh(merge(unify(d)), darkMat));
    if (leds) {
      const led = new THREE.Mesh(roundedBox(0.010, 0.0020, 0.0036, 0.0009, 1), ledMat[front ? 0 : 1]);
      led.position.set(len * 0.7, -0.0036 + ARM_RISE * Math.pow(0.7, 1.6), front ? 0.004 : -0.002);
      led.userData.noShadow = true;
      led.userData.led = true;
      arm.add(led);
    }
    const prop = new THREE.Group();
    prop.position.set(len, stack, 0);
    prop.rotation.y = (i * 1.3) % Math.PI;
    const sign = front === (mx < 0) ? 1 : -1;
    const blades = new THREE.Mesh(sign > 0 ? bladeCW : bladeCCW, bladeMat);
    const hub = new THREE.Mesh(hubGeom, hubMat);
    hub.position.y = 0.0015;
    const blurBlades = new THREE.Mesh(sign > 0 ? bladeCW : bladeCCW, blurBladeMat);
    const blurDisc = new THREE.Mesh(disc, discMat);
    blurDisc.userData.noShadow = true;
    blurBlades.userData.noShadow = true;
    blurBlades.visible = blurDisc.visible = false;
    prop.add(blades, hub, blurBlades, blurDisc);
    arm.add(prop);
    prop.userData = { blades, blur: [blurBlades, blurDisc], sign };
    props.push(prop);
    group.add(arm);
    arms.push(arm);
  });

  const state = { mode: null, fold: 0 };
  function setPropellers(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    for (const p of props) {
      p.userData.blades.visible = mode !== 'disc';
      for (const m of p.userData.blur) m.visible = mode === 'disc';
    }
  }
  function setFold(t) {
    state.fold = t;
    for (const a of arms) a.rotation.y = THREE.MathUtils.lerp(a.userData.openYaw, a.userData.foldYaw, t);
  }
  function setLeds(on) { group.traverse((o) => { if (o.userData.led) o.visible = on; }); }
  setPropellers(propellers);
  setFold(folded);

  const solidMat = new THREE.MeshBasicMaterial({ visible: false });
  const solids = [
    new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.048, 0.160).translate(0, -0.020, -0.004), solidMat),
  ];
  MOTORS.forEach(([mx, mz], i) => {
    solids.push(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03).translate(mx, ARM_Y[i] + 0.012, mz), solidMat));
  });
  MOTORS.forEach(([mx, mz], i) => {
    const [hx, hz] = HINGES[i];
    const len = Math.hypot(mx - hx, mz - hz);
    const g = new THREE.BoxGeometry(len, 0.02, 0.03);
    g.rotateY(Math.atan2(-(mz - hz), mx - hx));
    g.translate((mx + hx) / 2, ARM_Y[i], (mz + hz) / 2);
    solids.push(new THREE.Mesh(g, solidMat));
  });
  solids.forEach((s) => { s.visible = false; s.userData.noShadow = true; group.add(s); });

  group.userData.solids = solids;
  group.userData.radius = Math.hypot(0.1865, 0.149);
  group.userData.spin = (dt, rate = 120) => { for (const p of props) p.rotation.y += rate * dt * p.userData.sign; };
  group.userData.propellers = props;
  group.userData.setPropellers = setPropellers;
  group.userData.setFold = setFold;
  group.userData.setLeds = setLeds;
  group.userData.propellerMode = () => state.mode;
  return group;
}
