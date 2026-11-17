import '../inference/jevol-worker.js';

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.webgpu.min.mjs';
const lines = [];
const capture = (orig) => (...args) => {
  if (lines.length < 400000) lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  if (!D.profile) orig(...args);
};
const D = { profile: false, sessions: [], runs: [] };
console.log = capture(console.log.bind(console));
console.info = capture(console.info.bind(console));

const inner = self.onmessage;
const send = (m) => self.postMessage(m);

function kindOf(sess) {
  const names = sess.inputNames || [];
  if (names.includes('inputs_embeds')) return 'lm';
  if (names.some((n) => n.startsWith('states_'))) return 'head';
  return 'vision';
}

function hideFeatures(drop) {
  if (!drop.size) return;
  const proto = GPUAdapter.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'features');
  Object.defineProperty(proto, 'features', { configurable: true, get() { return new Set([...desc.get.call(this)].filter((f) => !drop.has(f))); } });
  const requestDevice = proto.requestDevice;
  proto.requestDevice = function (d = {}) {
    const requiredFeatures = [...(d.requiredFeatures || [])].filter((f) => !drop.has(f));
    return requestDevice.call(this, { ...d, requiredFeatures });
  };
}

async function prepare(m) {
  const diag = m.diag || {};
  D.profile = !!diag.profile;
  const ort = await import( ORT_URL);
  const drop = new Set(diag.drop || []);
  hideFeatures(drop);
  const Session = ort.InferenceSession;
  const create = Session.create.bind(Session);
  Session.create = async (bytes, opts = {}) => {
    const o = { ...opts };
    if (D.profile) o.enableProfiling = true;
    const sess = await create(bytes, o);
    const kind = kindOf(sess);
    const run = sess.run.bind(sess);
    sess.run = async (...args) => {
      const t = performance.now();
      try { return await run(...args); } finally { D.runs.push({ kind, ms: performance.now() - t }); }
    };
    D.sessions.push({ kind, sess });
    return sess;
  };
}

function profileOf(text, warmRuns, warm) {
  const ev = [];
  for (const line of text) {
    const t = line.trim().replace(/,$/, '');
    if (!t.startsWith('{')) continue;
    try { ev.push(JSON.parse(t)); } catch { }
  }
  const runs = ev.filter((e) => e.cat === 'Session' && e.name === 'model_run').sort((a, b) => a.ts - b.ts);
  const gpu = ev.filter((e) => e.cat === 'Api');
  const nodes = ev.filter((e) => e.cat === 'Node');
  const n = runs.length;
  if (!n || !warmRuns || n < warmRuns) return { events: ev.length, runs: n };
  const per = gpu.length / n;
  const warmGpu = gpu.slice(gpu.length - Math.round(per * warmRuns));
  const last = runs.slice(n - warmRuns);
  const inWarm = (e) => last.some((r) => e.ts >= r.ts && e.ts <= r.ts + r.dur);
  const kernels = {};
  for (const e of warmGpu) {
    const [, op, prog] = e.name.split('&');
    const key = `${op || e.name}|${prog || ''}`;
    kernels[key] = kernels[key] || { op: op || e.name, program: prog || '', us: 0, count: 0 };
    kernels[key].us += e.dur;
    kernels[key].count++;
  }
  let idle = 0, breaks = 0;
  for (let i = 1; i < warmGpu.length; i++) {
    const g = warmGpu[i].ts - (warmGpu[i - 1].ts + warmGpu[i - 1].dur);
    if (g > 20000) breaks++; else if (g > 0) idle += g;
  }
  return {
    runs: n, gpuEvents: gpu.length, gpuIdleMs: idle / 1000 / warm, gpuBreaks: breaks, gpuEventsPerRun: Math.round(per * 10) / 10, exactSplit: Number.isInteger(per),
    gpuMs: warmGpu.reduce((a, e) => a + e.dur, 0) / 1000 / warm,
    cpuNodeMs: nodes.filter(inWarm).reduce((a, e) => a + e.dur, 0) / 1000 / warm,
    runMs: last.reduce((a, r) => a + r.dur, 0) / 1000 / warm,
    durMultipleOf100: gpu.length ? Math.round((gpu.filter((e) => e.dur % 100 === 0).length / gpu.length) * 100) / 100 : null,
    kernels: Object.values(kernels).map((k) => ({ op: k.op, program: k.program, count: k.count, ms: k.us / 1000 / warm })),
  };
}

function cpuBench() {
  const one = () => {
    const t = performance.now();
    let x = 0x9e3779b9 | 0, s = 0;
    for (let i = 0; i < 30000000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s = (s + (x & 1023)) | 0; }
    return { ms: performance.now() - t, s };
  };
  const r = [one(), one(), one()].map((x) => x.ms).sort((a, b) => a - b);
  return r[1];
}

let queue = Promise.resolve();
self.onmessage = (ev) => {
  const m = ev.data;
  queue = queue.then(async () => {
    try {
      if (m.type === 'init') {
        await prepare(m);
        inner(ev);
        D.ort = await import( ORT_URL);
      } else if (m.type === 'diag-runs') {
        const runs = D.runs;
        D.runs = [];
        send({ type: 'diag-runs', id: m.id, runs });
      } else if (m.type === 'diag-device') {
        const dev = await D.ort?.env.webgpu.device;
        send({ type: 'diag-device', id: m.id, features: dev ? [...dev.features].sort() : null });
      } else if (m.type === 'diag-cpu') {
        send({ type: 'diag-cpu', id: m.id, ms: cpuBench() });
      } else if (m.type === 'diag-profile') {
        const out = [];
        for (const { kind, sess } of D.sessions) {
          const before = lines.length;
          try { sess.endProfiling(); } catch (e) { out.push({ kind, error: String(e?.message || e) }); continue; }
          await new Promise((r) => setTimeout(r, 100));
          out.push({ kind, ...profileOf(lines.slice(before), (m.calls?.[kind] || 0) * m.warm, m.warm) });
        }
        send({ type: 'diag-profile', id: m.id, sessions: out });
      } else {
        inner(ev);
      }
    } catch (err) {
      send({ type: 'error', id: m.id ?? null, message: String(err?.message ?? err) });
    }
  });
};
