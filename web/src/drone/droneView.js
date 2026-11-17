import * as THREE from 'three/webgpu';
import { heightAt } from '../engine/world.js';
import { createObstacleField } from '../engine/obstacles.js';
import { createDroneModel } from './droneModel.js';

const DEFAULT_SPAWN = [20, 10, 0];

const LIMITS = [12, 12, 4, (120 * Math.PI) / 180];
const RESPONSE_S = 0.6;
const YAW_RESPONSE_S = 0.1;
const TILT_RESPONSE_S = 0.2;
const REST_M = 0.07;
const MAX_AGL_M = 120;
const CMD_TIMEOUT_S = 0.5;
const STEP_S = 0.02;
const MAX_STEPS_PER_FRAME = 6;
const MAX_TILT = (25 * Math.PI) / 180;
const TILT_PER_MPS2 = 0.1;
const BODY_RADIUS_M = 0.22;
const BODY_HALF_HEIGHT_M = 0.08;
const EDGE_MARGIN_M = 12;
const WALL_THICKNESS_M = 0.4;
const FEET_DROP_M = 0.07 - 0.0505;
const PROP_SPOOL_RATE = 2.5;
const PROP_BLUR_FROM = 0.35;
const FOLLOW_FILL = 0.3;
const FOLLOW_MIN_M = 1.1;
const FOLLOW_MAX_M = 40;
const FOLLOW_WHEEL = 1.12;
const FOLLOW_AHEAD = 0.3;
const FOLLOW_PITCH = -0.28;
const FOLLOW_CLEARANCE_M = 0.15;
const FOLLOW_TURN_RATE = 2.5;
const LOOK_HOLD_MS = 1500;
const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function stepDrone(s, cmd, dt, ground) {
  let [forward, side, climb, turn] = cmd ?? [0, 0, 0, 0];
  const onGround = s.u - ground(s.e, s.n) <= REST_M + 0.005;
  if (onGround && climb <= 0) forward = side = turn = climb = 0;
  const cos = Math.cos(s.yaw);
  const sin = Math.sin(s.yaw);
  const gain = 1 - Math.exp(-dt / RESPONSE_S);
  const ae = ((forward * cos - side * sin - s.ve) * gain) / dt;
  const an = ((forward * sin + side * cos - s.vn) * gain) / dt;
  s.ve += ae * dt;
  s.vn += an * dt;
  s.vu += (climb - s.vu) * gain;
  s.w += (turn - s.w) * (1 - Math.exp(-dt / YAW_RESPONSE_S));
  s.yaw += s.w * dt;
  s.e += s.ve * dt;
  s.n += s.vn * dt;
  s.u += s.vu * dt;
  const floor = ground(s.e, s.n) + REST_M;
  if (s.u <= floor) {
    s.u = floor;
    s.vu = Math.max(0, s.vu);
    if (onGround && climb <= 0) s.ve = s.vn = 0;
  }
  s.u = Math.min(s.u, ground(s.e, s.n) + MAX_AGL_M);
  const tiltGain = 1 - Math.exp(-dt / TILT_RESPONSE_S);
  s.pitch += (clamp((ae * cos + an * sin) * TILT_PER_MPS2, -MAX_TILT, MAX_TILT) - s.pitch) * tiltGain;
  s.roll += (clamp(-(-ae * sin + an * cos) * TILT_PER_MPS2, -MAX_TILT, MAX_TILT) - s.roll) * tiltGain;
  return s;
}

export function pushOut(s, boxes, cylinders, radius = BODY_RADIUS_M, half = BODY_HALF_HEIGHT_M) {
  let touched = 0;
  const resolve = (nx, ny, depth, z0, z1) => {
    const upDepth = z1 - (s.u - half);
    const downDepth = s.u + half - z0;
    if (Math.min(upDepth, downDepth) < depth) {
      const sign = upDepth < downDepth ? 1 : -1;
      s.u += sign * Math.min(upDepth, downDepth);
      if (s.vu * sign < 0) s.vu = 0;
      return;
    }
    s.e += nx * depth;
    s.n += ny * depth;
    const into = s.ve * nx + s.vn * ny;
    if (into < 0) { s.ve -= into * nx; s.vn -= into * ny; }
  };
  for (const b of boxes) {
    if (!(b[3] > s.u - half && b[2] < s.u + half)) continue;
    const cos = Math.cos(b[6]);
    const sin = Math.sin(b[6]);
    const dx = s.e - b[0];
    const dy = s.n - b[1];
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const gx = lx - clamp(lx, -b[4], b[4]);
    const gy = ly - clamp(ly, -b[5], b[5]);
    const gap = Math.hypot(gx, gy);
    if (gap >= radius) continue;
    let nx;
    let ny;
    let depth;
    if (gap > 1e-9) { nx = gx / gap; ny = gy / gap; depth = radius - gap; } else {
      const faceX = b[4] - Math.abs(lx);
      const faceY = b[5] - Math.abs(ly);
      [nx, ny] = faceX < faceY ? [Math.sign(lx) || 1, 0] : [0, Math.sign(ly) || 1];
      depth = radius + Math.min(faceX, faceY);
    }
    resolve(nx * cos - ny * sin, nx * sin + ny * cos, depth, b[2], b[3]);
    touched++;
  }
  for (const c of cylinders) {
    if (!(c[3] > s.u - half && c[2] < s.u + half)) continue;
    const dx = s.e - c[0];
    const dy = s.n - c[1];
    const gap = Math.hypot(dx, dy);
    if (gap >= c[4] + radius) continue;
    resolve(gap > 1e-9 ? dx / gap : 1, gap > 1e-9 ? dy / gap : 0, c[4] + radius - gap, c[2], c[3]);
    touched++;
  }
  return touched;
}

function buildingField(world) {
  return createObstacleField((sink) => {
    const ground = (x, y) => heightAt(world, x, -y);
    for (const b of world.buildings ?? []) {
      const ring = b.rings?.[0];
      if (!ring || ring.length < 4 || !(b.h > 0)) continue;
      const top = (b.z0 ?? world.hmin) - world.hmin + b.h;
      sink.wall(ring, { base: (x, y) => Math.min(ground(x, y), top - 0.5), top: () => top, thickness: WALL_THICKNESS_M });
      const heading = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const [x, y] of ring) {
        const u = x * c + y * s;
        const v = -x * s + y * c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      if (ring.length === 5) sink.box(((u0 + u1) / 2) * c - ((v0 + v1) / 2) * s, ((u0 + u1) / 2) * s + ((v0 + v1) / 2) * c, top - 0.5, top, u1 - u0, v1 - v0, heading / RAD);
    }
  });
}

export async function createDroneView({ scene, camera, fly, world, fineGround, shadows, spawn = DEFAULT_SPAWN, obstacles = null }) {
  const ground = (e, n) => heightAt(world, e, -n);
  const fields = [obstacles, buildingField(world)].filter(Boolean);

  const frame = new THREE.Group();
  frame.name = 'drone';
  frame.rotation.x = -Math.PI / 2;
  scene.add(frame);
  const body = new THREE.Group();
  frame.add(body);
  const model = createDroneModel({ id: 'drone', color: 0xc9ccd0 });
  model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
  model.traverse((o) => { if (o.isMesh) o.castShadow = shadows; });
  model.position.set(0, 0, -FEET_DROP_M);
  body.add(model);

  const drone = {
    name: 'drone', label: 'Drone', size: 0.45, linear: 7, angular: 1.2, turningLinear: 7, turningAngular: 1.2, climb: 3,
    body: { name: 'body' }, frame, model, bodies: { body }, spool: 0, auto: false, latest: null, previous: null,
  };
  drone.followDistance = drone.followShown = Math.max(FOLLOW_MIN_M, drone.size / (2 * Math.tan((camera.fov * RAD) / 2) * FOLLOW_FILL));
  const robots = { drone };

  const state = { e: 0, n: 0, u: 0, ve: 0, vn: 0, vu: 0, yaw: 0, w: 0, pitch: 0, roll: 0 };
  let before = { ...state };
  let command = [0, 0, 0, 0];
  let commandAge = Infinity;
  let time = 0;
  let pending = 0;
  let touching = 0;
  let following = true;
  let aimed = false;
  const keys = new Set();
  const limit = world.half - EDGE_MARGIN_M;

  function place(east, north, yaw) {
    Object.assign(state, { e: east, n: north, u: ground(east, north) + REST_M, ve: 0, vn: 0, vu: 0, yaw, w: 0, pitch: 0, roll: 0 });
    before = { ...state };
    command = [0, 0, 0, 0];
    commandAge = Infinity;
    pending = 0;
    aimed = false;
    publish();
  }

  function publish() {
    const height = state.u - ground(state.e, state.n);
    drone.previous = drone.latest;
    drone.latest = {
      t: time, status: 'ok',
      truth: { east: state.e, north: state.n, up: state.u, yaw: Math.atan2(Math.sin(state.yaw), Math.cos(state.yaw)), pitch: state.pitch, roll: state.roll },
      flight: { height_m: height, speed_mps: Math.hypot(state.ve, state.vn), climb_mps: state.vu },
      cmd: { linear_x: command[0], linear_y: command[1], linear_z: command[2], angular_z: command[3], enabled: true },
      contacts: touching,
    };
  }

  function advance() {
    before = { ...state };
    time += STEP_S;
    commandAge += STEP_S;
    stepDrone(state, commandAge <= CMD_TIMEOUT_S ? command : null, STEP_S, ground);
    touching = 0;
    for (const field of fields) {
      const near = field.query(state.e, state.n, BODY_RADIUS_M + 1.5, 200);
      if (near.boxes.length || near.cylinders.length) touching += pushOut(state, near.boxes, near.cylinders);
    }
    if (Math.abs(state.e) > limit) { state.e = clamp(state.e, -limit, limit); state.ve = 0; }
    if (Math.abs(state.n) > limit) { state.n = clamp(state.n, -limit, limit); state.vn = 0; }
    publish();
  }

  const quat = new THREE.Quaternion();
  function show(alpha) {
    const mix = (a, b) => a + (b - a) * alpha;
    const yaw = mix(before.yaw, state.yaw);
    const pitch = mix(before.pitch, state.pitch);
    const roll = mix(before.roll, state.roll);
    body.position.set(mix(before.e, state.e), mix(before.n, state.n), mix(before.u, state.u));
    const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw / 2), Math.sin(yaw / 2), Math.cos(pitch / 2), Math.sin(pitch / 2), Math.cos(roll / 2), Math.sin(roll / 2)];
    quat.set(sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy);
    body.quaternion.copy(quat);
    return { east: body.position.x, north: body.position.y, up: body.position.z, yaw };
  }

  function spin(dt) {
    if (!model.userData.setPropellers) return;
    const flight = drone.latest.flight;
    const flying = flight.height_m > REST_M + 0.055 || flight.speed_mps > 0.1;
    drone.spool += ((flying ? 1 : 0) - drone.spool) * (1 - Math.exp(-dt * PROP_SPOOL_RATE));
    if (drone.spool < 0.005) drone.spool = 0;
    model.userData.setPropellers(drone.spool > PROP_BLUR_FROM ? 'disc' : 'static');
    model.userData.spin(dt, drone.spool * (drone.spool > PROP_BLUR_FROM ? 900 : 40));
  }

  const dir = new THREE.Vector3();
  const look = new THREE.Vector3();
  function chase(dt, shown) {
    if (!following) { fineGround?.setFocus(null); return; }
    const { east, north, up, yaw } = shown;
    fineGround?.setFocus(east, -north);
    const behind = yaw - Math.PI / 2;
    if (!aimed) { fly.yaw = behind; fly.pitch = FOLLOW_PITCH; aimed = true; } else if (!fly.dragging && performance.now() - fly.lookedAt > LOOK_HOLD_MS) {
      const error = Math.atan2(Math.sin(behind - fly.yaw), Math.cos(behind - fly.yaw));
      fly.yaw += error * (1 - Math.exp(-dt * FOLLOW_TURN_RATE));
    }
    camera.rotation.set(fly.pitch, fly.yaw, fly.roll, 'YXZ');
    camera.getWorldDirection(dir);
    drone.followShown += (drone.followDistance - drone.followShown) * (1 - Math.exp(-dt * 8));
    look.set(east + Math.cos(yaw) * drone.size * FOLLOW_AHEAD, up + drone.size * 0.3, -north - Math.sin(yaw) * drone.size * FOLLOW_AHEAD);
    camera.position.copy(look).addScaledVector(dir, -drone.followShown);
    camera.position.y = Math.max(camera.position.y, heightAt(world, camera.position.x, camera.position.z) + FOLLOW_CLEARANCE_M);
    fly.velocity.set(0, 0, 0);
  }

  const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyU', 'KeyJ']);
  const onKeyDown = (e) => {
    if (ARROWS.has(e.code)) { keys.add(e.code); e.preventDefault(); } else if (e.repeat) return;
    else if (e.code === 'KeyR') place(spawn[0], spawn[1], spawn[2] * RAD);
    else if (e.code === 'KeyF') { if (following) drone.followDistance = Math.max(FOLLOW_MIN_M, drone.size / (2 * Math.tan((camera.fov * RAD) / 2) * FOLLOW_FILL)); following = true; aimed = false; } else if (e.code === 'KeyG') following = false;
  };
  const onKeyUp = (e) => { keys.delete(e.code); };
  const onWheel = (e) => { if (following) drone.followDistance = clamp(drone.followDistance * (e.deltaY < 0 ? 1 / FOLLOW_WHEEL : FOLLOW_WHEEL), FOLLOW_MIN_M, FOLLOW_MAX_M); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('wheel', onWheel);
  function drive() {
    if (drone.auto || !keys.size) return;
    const forward = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    const both = forward !== 0 && turn !== 0;
    setCommand({ linear_x: forward * (both ? drone.turningLinear : drone.linear), angular_z: turn * (both ? drone.turningAngular : drone.angular), linear_z: ((keys.has('KeyU') ? 1 : 0) - (keys.has('KeyJ') ? 1 : 0)) * drone.climb });
  }

  function setCommand(cmd) {
    const values = [cmd.linear_x ?? 0, cmd.linear_y ?? 0, cmd.linear_z ?? 0, cmd.angular_z ?? 0];
    command = values.map((v, i) => clamp(Number.isFinite(v) ? v : 0, -LIMITS[i], LIMITS[i]));
    commandAge = 0;
  }


  place(spawn[0], spawn[1], (spawn[2] ?? 0) * RAD);

  return {
    robots,
    update(dt) {
      drive();
      pending = Math.min(pending + dt, STEP_S * MAX_STEPS_PER_FRAME);
      while (pending >= STEP_S) { advance(); pending -= STEP_S; }
      const shown = show(pending / STEP_S);
      spin(dt);
      chase(dt, shown);
    },
    setFollowing(on) { following = on; aimed = false; },
    get following() { return following; },
    command(name, cmd) { if (name === 'drone') setCommand(cmd); },
    placeRobot(name, east, north, yaw) { if (name === 'drone') place(east, north, yaw); },
    reset() { place(spawn[0], spawn[1], (spawn[2] ?? 0) * RAD); },
    close() { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('wheel', onWheel); frame.removeFromParent(); },
  };
}
