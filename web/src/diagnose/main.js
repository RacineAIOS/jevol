import { startScene } from './scene.js';
import { gpuBench } from './gpuBench.js';

const MODEL_BASE = 'models/jevol-web/s64_12c/';
const CACHE_NAME = 'jevol-s64_12c';
const MISSION = 'Fly forward along the road.';
const WARM = 5;
const SUBGROUP_MATRIX = 'chromium-experimental-subgroup-matrix';

const STEPS = [
  { id: 'a_default', label: 'a. Model only, default device', diag: {}, cpu: true },
  { id: 'b_noSubgroupMatrix', label: 'b. Model only, device without subgroup-matrix', diag: { drop: [SUBGROUP_MATRIX] } },
  { id: 'c_noSubgroups', label: 'c. Model only, device without subgroups and subgroup-matrix', diag: { drop: ['subgroups', 'subgroup-size-control', SUBGROUP_MATRIX] } },
  { id: 'd_stages', label: 'd. Per-stage timings of a', derived: true },
  { id: 'e_profile', label: 'e. GPU kernel profile of a (timestamp-query)', diag: { profile: true } },
  { id: 'f_render24', label: 'f1. Model with a three.js scene at 24 fps', diag: {}, scene: { fps: 24 } },
  { id: 'f_renderFull', label: 'f2. Model with a three.js scene at full rate', diag: {}, scene: { fps: 0 } },
  { id: 'g_micro', label: 'g. Raw GPU and CPU speed (no model)', micro: true },
  { id: 'h_defaultAgain', label: 'h. Same as a, again (drift check)', diag: {} },
];

const $ = (s) => document.querySelector(s);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => (a.length ? sorted(a)[Math.floor(a.length / 2)] : null);
const p90 = (a) => (a.length ? sorted(a)[Math.min(a.length - 1, Math.ceil(a.length * 0.9) - 1)] : null);
const state = { running: false, done: false, results: null };
window.__diag = state;

function plain(v, depth = 0) {
  if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (depth > 4) return String(v);
  if (Array.isArray(v) || (typeof v[Symbol.iterator] === 'function' && typeof v !== 'string')) return [...v].map((x) => plain(x, depth + 1));
  const o = {};
  for (const k in v) { const x = plain(v[k], depth + 1); if (x !== undefined) o[k] = x; }
  return o;
}

async function environment() {
  const env = {
    date: new Date().toISOString(), userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null,
    pixelRatio: devicePixelRatio, screen: [screen.width, screen.height], window: [innerWidth, innerHeight], crossOriginIsolated: self.crossOriginIsolated,
    visibility: document.visibilityState, inIframe: window.top !== window.self, ort: '1.31.1',
  };
  try { env.uaData = await navigator.userAgentData?.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'model', 'fullVersionList']); } catch { }
  try {
    const a = await navigator.gpu.requestAdapter();
    const b = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    env.adapter = { info: plain(a.info), features: [...a.features].sort(), limits: plain(a.limits), fallback: !!(a.info?.isFallbackAdapter || a.isFallbackAdapter) };
    env.adapterHighPerformance = b ? plain(b.info) : null;
  } catch (e) { env.adapter = { error: String(e?.message || e) }; }
  return env;
}

function grayImage() {
  const c = new OffscreenCanvas(672, 504);
  const g = c.getContext('2d');
  g.fillStyle = '#7f8a96';
  g.fillRect(0, 0, 672, 504);
  return g.getImageData(0, 0, 672, 504).data;
}

function client(diag, onProgress) {
  const worker = new Worker(new URL('./diag-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextId = 1, readyResolve, readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') onProgress(m);
    else if (m.type === 'ready') readyResolve(m.info);
    else {
      const p = pending.get(m.id);
      if (!p) { if (m.type === 'error') readyReject(new Error(m.message)); return; }
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    }
  };
  worker.onerror = (e) => readyReject(new Error(e.message || 'worker failed'));
  worker.postMessage({ type: 'init', referrer: location.href, base: new URL(MODEL_BASE, location.href).href, cacheName: CACHE_NAME, diag });
  const call = (m, transfer) => {
    const id = nextId++;
    worker.postMessage({ ...m, id }, transfer || []);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  return { ready, call, stop: () => { worker.terminate(); for (const p of pending.values()) p.reject(new Error('stopped')); } };
}

function runSummary(perDecision) {
  const out = {};
  for (const kind of ['vision', 'lm', 'head']) {
    const sums = perDecision.map((runs) => runs.filter((r) => r.kind === kind).reduce((a, r) => a + r.ms, 0));
    const calls = perDecision.map((runs) => runs.filter((r) => r.kind === kind).map((r) => r.ms));
    out[kind] = { callsPerDecision: calls[0]?.length ?? 0, msPerDecision: round(median(sums)), msPerCall: calls[0]?.length ? calls[0].map((_, i) => round(median(calls.map((c) => c[i] ?? 0)))) : [] };
  }
  return out;
}

function profileSummary(sessions) {
  const bySession = {};
  const kernels = {};
  for (const s of sessions) {
    if (s.error || s.gpuMs == null) { bySession[s.kind] = s; continue; }
    bySession[s.kind] = { gpuMs: round(s.gpuMs), gpuIdleMs: round(s.gpuIdleMs), gpuBreaks: s.gpuBreaks, cpuNodeMs: round(s.cpuNodeMs), runMs: round(s.runMs), gpuEventsPerRun: s.gpuEventsPerRun, exactSplit: s.exactSplit, durMultipleOf100: s.durMultipleOf100 };
    for (const x of s.kernels) {
      const key = `${s.kind}: ${x.op}${x.program && x.program !== x.op ? ` (${x.program})` : ''}`;
      kernels[key] = kernels[key] || { kernel: key, ms: 0, dispatches: 0 };
      kernels[key].ms += x.ms;
      kernels[key].dispatches += x.count;
    }
  }
  const gpuTotal = Object.values(bySession).reduce((a, k) => a + (k.gpuMs || 0), 0);
  return {
    note: 'per warm decision. gpuMs: GPU kernel time from timestamp-query. cpuNodeMs: CPU time inside ORT kernels (dispatch). runMs: ORT model_run time.',
    gpuMsPerDecision: round(gpuTotal), bySession,
    topKernels: Object.values(kernels).sort((x, y) => y.ms - x.ms).slice(0, 10).map((k) => ({ kernel: k.kernel, msPerDecision: round(k.ms, 2), dispatchesPerDecision: round(k.dispatches / WARM) })),
  };
}

async function runModel(step, setText) {
  const r = { id: step.id };
  let scene = null;
  const loadT = performance.now();
  let lastText = 0;
  const c = client(step.diag, (p) => {
    if (performance.now() - lastText > 200) { lastText = performance.now(); setText(`loading ${p.file} ${(p.loaded / 1e6).toFixed(0)} MB${p.fromCache ? ' (cache)' : ''}`); }
  });
  try {
    if (step.scene) {
      scene = await startScene(step.scene);
      r.canvasPixels = scene.pixels;
    }
    const info = await c.ready;
    r.loadMs = Math.round(performance.now() - loadT);
    r.workerLoadMs = info.loadMs;
    r.dropped = step.diag?.drop || [];
    r.gpuStates = info.gpuStates;
    r.jpeg = info.jpeg;
    if (scene) await new Promise((res) => setTimeout(res, 250));
    const rgba = grayImage();
    const wall = [], stages = [], runs = [];
    let frames0 = 0, t0 = 0;
    for (let i = 0; i <= WARM; i++) {
      setText(i === 0 ? 'cold decision' : `warm decision ${i} / ${WARM}`);
      if (i === 1 && scene) { frames0 = scene.frames(); t0 = performance.now(); }
      const t = performance.now();
      const m = await c.call({ type: 'act', mission: MISSION, image: { rgba: rgba.slice(), width: 672, height: 504 } });
      const ms = performance.now() - t;
      const rr = (await c.call({ type: 'diag-runs' })).runs;
      if (i === 0) { r.coldMs = Math.round(ms); r.coldStages = Object.fromEntries(Object.entries(m.ms).map(([k, v]) => [k, round(v)])); continue; }
      wall.push(ms);
      stages.push(m.ms);
      runs.push(rr);
      r.top = m.result.top;
    }
    r.deviceFeatures = (await c.call({ type: 'diag-device' })).features;
    if (scene) r.renderFps = round(((scene.frames() - frames0) * 1000) / (performance.now() - t0));
    r.warmMs = wall.map((x) => Math.round(x));
    r.medianMs = round(median(wall));
    r.p90Ms = round(p90(wall));
    r.minMs = round(Math.min(...wall));
    const keys = [...new Set(stages.flatMap((s) => Object.keys(s)))];
    r.stagesMedianMs = Object.fromEntries(keys.map((k) => [k, round(median(stages.map((s) => s[k]).filter((x) => typeof x === 'number')))]));
    r.sessionRuns = runSummary(runs);
    if (step.cpu) { setText('CPU speed in the worker'); r.workerCpuMs = round((await c.call({ type: 'diag-cpu' })).ms); }
    if (step.diag?.profile) {
      setText('reading the GPU profile');
      const calls = Object.fromEntries(Object.entries(r.sessionRuns).map(([k, v]) => [k, v.callsPerDecision]));
      const p = await c.call({ type: 'diag-profile', warm: WARM, calls });
      r.profile = profileSummary(p.sessions);
    }
  } catch (e) {
    r.error = String(e?.message || e);
  } finally {
    c.stop();
    scene?.stop();
  }
  return r;
}

function cpuBenchMain() {
  const one = () => {
    const t = performance.now();
    let x = 0x9e3779b9 | 0, s = 0;
    for (let i = 0; i < 30000000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s = (s + (x & 1023)) | 0; }
    return performance.now() - t + (s === 0.5 ? 1 : 0);
  };
  return round(median([one(), one(), one()]));
}

function brief(r) {
  if (!r) return '';
  if (r.error) return `error: ${r.error}`;
  if (r.id === 'd_stages') return Object.entries(r.stagesMedianMs || {}).map(([k, v]) => `${k} ${v}`).join(', ') + ' ms';
  if (r.id === 'g_micro') {
    const mm = (r.gpu?.matmul || []).map((x) => `${x.type} ${x.tflopsWall} TFLOPS`).join(', ');
    return `${mm}; dispatch ${r.gpu?.dispatch?.totalUsPerDispatch} us; CPU main ${r.cpuMainMs} ms`;
  }
  let s = `median ${r.medianMs} ms, p90 ${r.p90Ms} ms, cold ${r.coldMs} ms`;
  if (r.renderFps != null) s += `, render ${r.renderFps} fps`;
  if (r.profile?.gpuMsPerDecision != null) s += `, GPU ${r.profile.gpuMsPerDecision} ms per decision`;
  return s;
}

function buildList() {
  const list = $('#steps');
  list.innerHTML = '';
  for (const s of STEPS) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="name"></span><span class="state">waiting</span><div class="res"></div>';
    li.querySelector('.name').textContent = s.label;
    li.dataset.id = s.id;
    list.appendChild(li);
  }
}

async function run() {
  if (state.running) return;
  state.running = true;
  state.done = false;
  $('#run').disabled = true;
  $('#copy').disabled = true;
  buildList();
  const results = { environment: await environment(), steps: {}, notes: ['f runs the model in its worker with a scene in the page; the main-thread variant is not measured.'] };
  state.results = results;
  for (const step of STEPS) {
    const li = document.querySelector(`li[data-id="${step.id}"]`);
    const st = li.querySelector('.state');
    st.textContent = 'running';
    li.classList.add('on');
    const setText = (t) => { st.textContent = t; };
    let r;
    if (step.derived) {
      const a = results.steps.a_default;
      r = { id: step.id, stagesMedianMs: a?.stagesMedianMs, sessionRuns: a?.sessionRuns, coldStages: a?.coldStages, note: 'decoder = prefix + questions + head (hidden states stay on the GPU)' };
    } else if (step.micro) {
      r = { id: step.id };
      try { r.gpu = await gpuBench(); } catch (e) { r.gpuError = String(e?.message || e); }
      r.cpuMainMs = cpuBenchMain();
      r.cpuWorkerMs = results.steps.a_default?.workerCpuMs ?? null;
    } else {
      r = await runModel(step, setText);
    }
    results.steps[step.id] = r;
    li.classList.remove('on');
    st.textContent = r.error ? 'failed' : 'done';
    li.querySelector('.res').textContent = brief(r);
    $('#out').value = JSON.stringify(results, null, 1);
  }
  results.summary = Object.fromEntries(Object.entries(results.steps).filter(([, r]) => r.medianMs != null).map(([k, r]) => [k, { medianMs: r.medianMs, p90Ms: r.p90Ms }]));
  $('#out').value = JSON.stringify(results, null, 1);
  state.running = false;
  state.done = true;
  $('#run').disabled = false;
  $('#copy').disabled = false;
}

$('#run').onclick = run;
$('#copy').onclick = async () => {
  const text = $('#out').value;
  try { await navigator.clipboard.writeText(text); $('#copy').textContent = 'Copied'; } catch { $('#out').select(); $('#copy').textContent = 'Select all and copy the text below'; }
};
buildList();
if (!('gpu' in navigator)) { $('#run').disabled = true; $('#note').textContent = 'WebGPU is not available in this browser.'; }
