import { heightAt } from '../engine/world.js';
import { SETTINGS } from '../config.js';
import { createModelCamera } from './modelCamera.js';
import { createHud } from './hud.js';
import { createPathLine } from './pathLine.js';
import { createServerBackend } from './serverBackend.js';
import { createWebgpuBackend } from './webgpuBackend.js';

const SEND_MS = 50;
const STALE_S = 1.2;
const LATERAL_MPS = 3;
const TAKEOFF_MPS = 1.5;
const ON_GROUND_M = 0.3;
const STOP = { linear_x: 0, linear_y: 0, linear_z: 0, angular_z: 0 };

async function loadBackend(hud) {
  return __JEVOL_BACKEND__ === 'server' ? createServerBackend({ hud }) : createWebgpuBackend({ hud });
}

export async function createPilot({ renderer, scene, camera, world, robotView, systems, mission, takeoffAgl, period, name = 'drone' }) {
  const view = createModelCamera({ renderer, scene, world, systems, width: SETTINGS.imageWidth });
  const hud = createHud({ view: view.canvas, mission, examples: SETTINGS.missionExamples, onFly: () => start(), onStop: () => stop() });
  const path = createPathLine({ scene, camera });
  const backend = await loadBackend(hud);
  const speedScale = SETTINGS.speedScale;
  let running = false;
  let phase = 'idle';
  let busy = false;
  let lastSentAt = -Infinity;
  let cmd = null;
  const robot = () => robotView.robots[name];

  function height() {
    const t = robot()?.latest?.truth;
    return t ? t.up - heightAt(world, t.east, -t.north) : null;
  }

  function send() {
    if (!running) return;
    if (phase === 'takeoff') {
      const h = height();
      if (h !== null && h >= takeoffAgl) phase = 'policy';
      robotView.command(name, { ...STOP, linear_z: phase === 'takeoff' ? TAKEOFF_MPS : 0 });
      return;
    }
    robotView.command(name, command() ?? STOP);
  }
  const sender = setInterval(send, SEND_MS);

  function start() {
    const r = robot();
    if (!r || !backend.ready) return;
    hud.setStatus('');
    r.auto = true;
    running = true;
    cmd = null;
    const h = height();
    phase = h !== null && takeoffAgl > 0 && h < Math.min(ON_GROUND_M, takeoffAgl) ? 'takeoff' : 'policy';
  }

  function stop() {
    running = false;
    phase = 'idle';
    cmd = null;
    const r = robot();
    if (r) {
      robotView.command(name, STOP);
      r.auto = false;
    }
  }

  async function decide() {
    const r = robot();
    const body = r?.bodies?.[r.body.name];
    if (!body || !r.frame.visible) return;
    r.frame.visible = false;
    const pending = view.capture(body);
    r.frame.visible = true;
    const jpeg = await pending;
    const t = performance.now();
    const d = await backend.act(jpeg, hud.mission);
    hud.decision(performance.now() - t);
    if (!running || phase !== 'policy') return;
    cmd = {
      linear_x: d.forward * speedScale, linear_y: -d.right * LATERAL_MPS * speedScale, linear_z: d.up, angular_z: d.yaw,
      at: performance.now() / 1000, ms: d.ms,
    };
    send();
  }

  function update() {
    path.update(robot()?.latest?.truth, command());
    if (!running || phase !== 'policy' || !backend.ready || busy) return;
    const now = performance.now() / 1000;
    if (now - lastSentAt < period) return;
    lastSentAt = now;
    busy = true;
    decide().catch((e) => {
      console.warn('[pilot] decision failed:', e.message || e);
      hud.setStatus(`Model error: ${e.message || e}`);
    }).finally(() => { busy = false; });
  }

  function command() {
    return running && phase === 'policy' && cmd && performance.now() / 1000 - cmd.at < STALE_S ? cmd : null;
  }

  return {
    update, start, stop,
    get running() { return running; },
    get renderCap() { return backend.renderCap; },
    get warmMs() { return backend.warmMs ?? null; },
    get phase() { return phase; },
    get command() { return command(); },
    get mission() { return hud.mission; },
    setMission(text) { hud.setMission(text); },
    snapshot: (pose) => view.snapshot(pose),
    close() {
      stop();
      clearInterval(sender);
      backend.close();
      hud.remove();
      path.dispose();
    },
  };
}
