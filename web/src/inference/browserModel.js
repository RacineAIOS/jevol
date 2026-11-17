import { createJevolWorker } from './jevolClient.js';

const MODEL_MB = 560;

export async function quickCheck({ minBufferMB = 300 } = {}) {
  const ua = navigator.userAgent;
  if (!('gpu' in navigator)) return { ok: false, reason: 'no WebGPU in this browser' };
  if (/Firefox\//.test(ua)) return { ok: false, reason: 'WebGPU in Firefox is too slow' };
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return { ok: false, reason: 'not enough memory per tab on iPhone and iPad' };
  if (navigator.deviceMemory && navigator.deviceMemory < 4) return { ok: false, reason: `only ${navigator.deviceMemory} GB of device memory` };
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { }
  if (!adapter) return { ok: false, reason: 'no WebGPU adapter' };
  if (adapter.info?.isFallbackAdapter || adapter.isFallbackAdapter) return { ok: false, reason: 'WebGPU runs in software because graphics acceleration is off' };
  if (!adapter.features.has('shader-f16')) return { ok: false, reason: 'the GPU has no shader-f16' };
  const maxBufferMB = adapter.limits.maxBufferSize / 2 ** 20;
  const maxStorageMB = adapter.limits.maxStorageBufferBindingSize / 2 ** 20;
  if (maxBufferMB < minBufferMB || maxStorageMB < 128) return { ok: false, reason: 'GPU buffers too small' };
  return { ok: true, reason: '' };
}

export function createBrowserModel({ base, cacheName, dropFeatures = [], onProgress = () => {} }) {
  const files = {};
  const state = { decisions: 0, lastMs: 0 };
  const recent = [];
  let readyInfo = null;
  let warmupMs = null;
  const jw = createJevolWorker({
    base, cacheName, dropFeatures,
    onProgress: (p) => {
      files[p.file] = p;
      const all = Object.values(files);
      const loaded = all.reduce((a, f) => a + f.loaded, 0) / 1e6;
      const total = Math.max(MODEL_MB, all.reduce((a, f) => a + (f.total || f.loaded), 0) / 1e6);
      onProgress({ loaded, total, text: `Loading the model in your browser ${loaded.toFixed(0)} / ${total.toFixed(0)} MB${p.fromCache ? ' (cache)' : ''}` });
    },
  });

  async function warmup({ runs = 2, mission = 'Fly forward along the road.' } = {}) {
    await jw.ready;
    const c = new OffscreenCanvas(672, 504);
    const g = c.getContext('2d');
    g.fillStyle = '#7f8a96';
    g.fillRect(0, 0, 672, 504);
    const rgba = g.getImageData(0, 0, 672, 504).data;
    const runsMs = [];
    for (let i = 0; i < runs + 1; i++) {
      const t = performance.now();
      const r = await jw.act({ mission, image: { rgba: rgba.slice(), width: 672, height: 504 } });
      if (i > 0) runsMs.push({ wall: performance.now() - t, vision: r.ms?.vision ?? 0, decoder: r.ms?.decoder ?? 0 });
    }
    const mid = (k) => runsMs.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(runsMs.length / 2)];
    warmupMs = mid('wall');
    return { ms: warmupMs, vision: mid('vision'), decoder: mid('decoder') };
  }

  async function act(jpeg, mission) {
    const t = performance.now();
    const { result, ms } = await jw.act({ mission, image: { bytes: jpeg, mime: 'image/jpeg' }, jpeg: true });
    state.decisions++;
    state.lastMs = performance.now() - t;
    recent.push({ ...ms, roundTrip: state.lastMs });
    if (recent.length > 20) recent.shift();
    return { forward: result.forward, yaw: result.yaw, up: result.up, right: result.right, ms: state.lastMs };
  }

  jw.ready.then((info) => { readyInfo = info; }, () => {});

  async function diagnostics() {
    const median = (k) => {
      const v = recent.map((r) => r[k]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
      return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null;
    };
    const keys = [...new Set(recent.flatMap((r) => Object.keys(r)))];
    let adapter = null;
    try {
      const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (a) {
        adapter = { vendor: a.info?.vendor, architecture: a.info?.architecture, description: a.info?.description, fallback: !!(a.info?.isFallbackAdapter || a.isFallbackAdapter),
          features: [...a.features].sort(), maxBufferMB: Math.round(a.limits.maxBufferSize / 2 ** 20), maxStorageMB: Math.round(a.limits.maxStorageBufferBindingSize / 2 ** 20),
          maxWorkgroupStorage: a.limits.maxComputeWorkgroupStorageSize };
      }
    } catch {}
    return {
      userAgent: navigator.userAgent, platform: navigator.userAgentData?.platform ?? navigator.platform, deviceMemory: navigator.deviceMemory ?? null,
      cores: navigator.hardwareConcurrency, crossOriginIsolated: self.crossOriginIsolated, pixelRatio: devicePixelRatio, screen: [screen.width, screen.height],
      visible: document.visibilityState, adapter, dropFeatures, worker: readyInfo, warmupMs: warmupMs && Math.round(warmupMs), decisions: state.decisions,
      medianMs: Object.fromEntries(keys.map((k) => [k, median(k)])),
    };
  }

  return { ready: jw.ready, warmup, act, diagnostics, get state() { return { ...state }; }, terminate: () => jw.terminate() };
}
