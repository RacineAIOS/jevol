import { decodeStep, softmax } from './decode.js';
import { roundtrip444 } from './jpeg444.js';
import { loadRoundtrip444 } from './jpeg444wasm.js';
import { patches, W, H } from './prep.js';
import { promptIds } from './tokens.js';

const ORT_VERSION = '1.31.1';
const TOKENIZERS_VERSION = '0.2.0';
const DEFAULT_ORT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const DEFAULT_TOKENIZERS = `https://cdn.jsdelivr.net/npm/@huggingface/tokenizers@${TOKENIZERS_VERSION}/dist/tokenizers.min.mjs`;

let ort = null;
const S = { meta: null, tok: null, sess: {}, rows: new Map(), entries: new Map(), pre: null, opts: null, io16: true,
  rt: roundtrip444, qBatch: false, visIn: 'patches' };

const post = (m, transfer) => self.postMessage(m, transfer || []);
const now = () => performance.now();

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
function f16ToF32(h) {
  const s = (h & 0x8000) << 16, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) { F32[0] = (m / 1024) * 2 ** -14; return s ? -F32[0] : F32[0]; }
  if (e === 31) U32[0] = s | 0x7f800000 | (m << 13);
  else U32[0] = s | ((e + 112) << 23) | (m << 13);
  return F32[0];
}
function f32ToF16(f) {
  F32[0] = f;
  const x = U32[0];
  const s = (x >>> 16) & 0x8000;
  const e = (x >>> 23) & 0xff;
  let m = x & 0x7fffff;
  if (e === 255) return s | 0x7c00 | (m ? 0x200 : 0);
  let ee = e - 112;
  if (ee >= 31) return s | 0x7c00;
  if (ee <= 0) {
    if (ee < -10) return s;
    m |= 0x800000;
    const shift = 14 - ee;
    let r = m >>> shift;
    const rem = m & ((1 << shift) - 1), half = 1 << (shift - 1);
    if (rem > half || (rem === half && (r & 1))) r++;
    return s | r;
  }
  let r = (ee << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (r & 1))) r++;
  return s | r;
}
const u16 = (data) => (data instanceof Uint16Array ? data : new Uint16Array(data.buffer, data.byteOffset, data.length));
function toIo(u16data) {
  if (S.io16) return u16data;
  const out = new Float32Array(u16data.length);
  for (let i = 0; i < out.length; i++) out[i] = f16ToF32(u16data[i]);
  return out;
}
function fromIo(data) {
  if (S.io16) return u16(data);
  const out = new Uint16Array(data.length);
  for (let i = 0; i < out.length; i++) out[i] = f32ToF16(data[i]);
  return out;
}

async function openCache() {
  try { return await caches.open(S.opts.cacheName); } catch { return null; }
}

const get = (url, init = {}) => fetch(url, S.opts?.referrer ? { ...init, referrer: S.opts.referrer } : init);

async function fetchBytes(url, file) {
  const cache = await openCache();
  let res = cache ? await cache.match(url) : null;
  const fromCache = !!res;
  if (!res) {
    res = await get(url);
    if (!res.ok) throw new Error(`${file} : HTTP ${res.status}`);
    if (cache) cache.put(url, res.clone()).catch(() => {});
  }
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    if (now() - last > 100) { last = now(); post({ type: 'progress', file, loaded, total, fromCache }); }
  }
  post({ type: 'progress', file, loaded, total: total || loaded, fromCache, done: true });
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function ensureRows(ids) {
  const need = [...new Set(ids)].filter((i) => !S.rows.has(i)).sort((a, b) => a - b);
  if (!need.length) return;
  const dim = S.meta.embed.dim, int8 = S.meta.embed.dtype === 'int8', bytes = int8 ? S.meta.embed.rowBytes : dim * 2;
  const url = `${S.opts.base}/${S.meta.embed.file}`;
  const toRow = (raw) => {
    if (!int8) return new Uint16Array(raw.buffer, raw.byteOffset, dim);
    const scale = f16ToF32(raw[0] | (raw[1] << 8));
    const q = new Int8Array(raw.buffer, raw.byteOffset + 2, dim);
    const row = new Uint16Array(dim);
    for (let i = 0; i < dim; i++) row[i] = f32ToF16(q[i] * scale);
    return row;
  };
  const cache = await openCache();
  const missing = [];
  for (const id of need) {
    const hit = cache ? await cache.match(`${url}?row=${id}`) : null;
    if (hit) S.rows.set(id, toRow(new Uint8Array(await hit.arrayBuffer())));
    else missing.push(id);
  }
  const runs = [];
  for (const id of missing) {
    const r = runs[runs.length - 1];
    if (r && id === r[1] + 1) r[1] = id; else runs.push([id, id]);
  }
  await Promise.all(runs.map(async ([lo, hi]) => {
    const res = await get(url, { headers: { Range: `bytes=${lo * bytes}-${(hi + 1) * bytes - 1}` } });
    if (res.status !== 206) { res.body?.cancel(); throw new Error(`${S.meta.embed.file}: the server must accept Range requests (HTTP ${res.status})`); }
    const buf = new Uint8Array(await res.arrayBuffer());
    for (let id = lo; id <= hi; id++) {
      const row = buf.slice((id - lo) * bytes, (id - lo + 1) * bytes);
      S.rows.set(id, toRow(row));
      if (cache) cache.put(`${url}?row=${id}`, new Response(row)).catch(() => {});
    }
  }));
}

function embedRows(ids, out = null, at = 0) {
  const dim = S.meta.embed.dim;
  const o = out || new Uint16Array(ids.length * dim);
  ids.forEach((id, k) => o.set(S.rows.get(id), (at + k) * dim));
  return o;
}

function bytesHave(bytes, text) {
  const t = new TextEncoder().encode(text);
  outer: for (let i = 0; i + t.length <= bytes.length; i++) {
    if (bytes[i] !== t[0]) continue;
    for (let k = 1; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer;
    return true;
  }
  return false;
}

function hideFeatures(drop) {
  if (!drop.size || typeof GPUAdapter === 'undefined') return;
  const proto = GPUAdapter.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'features');
  Object.defineProperty(proto, 'features', { configurable: true, get() { return new Set([...desc.get.call(this)].filter((f) => !drop.has(f))); } });
  const requestDevice = proto.requestDevice;
  proto.requestDevice = function (d = {}) {
    return requestDevice.call(this, { ...d, requiredFeatures: [...(d.requiredFeatures || [])].filter((f) => !drop.has(f)) });
  };
}

async function init(m) {
  S.opts = { base: m.base.replace(/\/$/, ''), variant: m.variant || 'webgpu', ep: m.ep || 'webgpu',
    cacheName: m.cacheName || 'jevol-webgpu-v1', referrer: m.referrer || null, ortUrl: m.ortUrl || DEFAULT_ORT, tokenizersUrl: m.tokenizersUrl || DEFAULT_TOKENIZERS };
  const t0 = now();
  ort = await import( `${S.opts.ortUrl}ort.webgpu.min.mjs`);
  ort.env.wasm.wasmPaths = S.opts.ortUrl;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.logLevel = 'error';
  hideFeatures(new Set(m.dropFeatures || []));
  const { Tokenizer } = await import( S.opts.tokenizersUrl);
  if (m.wasm !== false) S.rt = await loadRoundtrip444(undefined, S.opts.referrer ? { referrer: S.opts.referrer } : {});
  const base = S.opts.base;
  S.meta = await (await get(`${base}/jevol.json`)).json();
  const [tj, tc] = await Promise.all([fetchBytes(`${base}/tokenizer.json`, 'tokenizer.json'), fetchBytes(`${base}/tokenizer_config.json`, 'tokenizer_config.json')]);
  const dec = new TextDecoder();
  S.tok = new Tokenizer(JSON.parse(dec.decode(tj)), JSON.parse(dec.decode(tc)));
  let adapter = null;
  if (S.opts.ep === 'webgpu') {
    if (!navigator.gpu) throw new Error('WebGPU absent');
    adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU: no adapter');
  }
  const ep = S.opts.ep === 'webgpu' ? ['webgpu'] : ['wasm'];
  const lmDir = `lm_${S.opts.variant}`;
  const lmInfo = S.meta.lm[S.opts.variant];
  if (!lmInfo) throw new Error(`no decoder ${lmDir}`);
  const create = (bytes, extra = {}) => ort.InferenceSession.create(bytes, { executionProviders: ep, graphOptimizationLevel: 'all', ...extra });
  S.sess.vision = await create(await fetchBytes(`${base}/vision.onnx`, 'vision.onnx'));
  S.sess.head = await create(await fetchBytes(`${base}/head.onnx`, 'head.onnx'));
  const graph = await fetchBytes(`${base}/${lmDir}/model.onnx`, `${lmDir}/model.onnx`);
  const data = await fetchBytes(`${base}/${lmDir}/model.onnx.data`, `${lmDir}/model.onnx.data`);
  S.headShared = S.sess.head.inputNames.includes('states_q');
  S.io16 = S.opts.variant === 'webgpu';
  const batchable = !bytesHave(graph, 'attention_mask');
  S.qBatch = m.qBatch !== false && batchable;
  S.gpuStates = S.headShared && S.qBatch && S.io16 && S.opts.ep === 'webgpu';
  const lmOut = S.gpuStates ? { hidden_states: 'gpu-buffer' } : {};
  S.meta.text.layer_types.forEach((type, i) => {
    const names = type === 'full_attention' ? [`present.${i}.key`, `present.${i}.value`] : [`present.${i}.conv`, `present.${i}.recurrent`];
    for (const n of names) lmOut[n] = S.opts.ep === 'webgpu' ? 'gpu-buffer' : 'cpu';
  });
  S.sess.lm = await create(graph, { externalData: [{ path: 'model.onnx.data', data }], preferredOutputLocation: lmOut });
  S.lmIn = S.sess.lm.inputNames;
  S.visIn = S.sess.vision.inputNames[0];
  S.loadMs = now() - t0;
  let deviceFeatures = null;
  try { const dev = await ort.env.webgpu?.device; deviceFeatures = dev ? [...dev.features].sort() : null; } catch {}
  const info = { dropFeatures: m.dropFeatures || [], deviceFeatures, loadMs: Math.round(S.loadMs), ep: S.opts.ep, variant: S.opts.variant, questions: S.meta.questions,
    qBatch: S.qBatch, gpuStates: S.gpuStates, visionInput: S.visIn, jpeg: S.rt === roundtrip444 ? 'js' : 'wasm',
    adapter: adapter ? { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, description: adapter.info?.description,
      f16: adapter.features.has('shader-f16'), maxBuffer: adapter.limits.maxBufferSize, maxStorage: adapter.limits.maxStorageBufferBindingSize } : null };
  post({ type: 'ready', info });
}

const TEXT = () => S.meta.text;

function emptyCache() {
  const t = TEXT();
  const c = {};
  const ft = S.io16 ? 'float16' : 'float32';
  const mk = (type, dims) => new ort.Tensor(type, type === 'float16' ? new Uint16Array(dims.reduce((a, b) => a * b, 1)) : new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
  for (const name of S.lmIn) {
    if (name.startsWith('past_key_values')) c[name] = mk(ft, [1, t.kv_heads, 0, t.head_dim]);
    else if (name.endsWith('.conv')) c[name] = mk(ft, [1, t.linear.conv_dim, t.linear.conv_kernel - 1]);
    else if (name.endsWith('.recurrent')) c[name] = mk('float32', [1, t.linear.heads, t.linear.v_dim, t.linear.k_dim]);
  }
  return c;
}

const presentOf = (past) => (past.startsWith('past_key_values') ? past.replace('past_key_values', 'present') : past.replace('past.', 'present.'));

function posTensor(pos, from, to) {
  const n = to - from;
  const a = new BigInt64Array(3 * n);
  for (let d = 0; d < 3; d++) for (let i = 0; i < n; i++) a[d * n + i] = BigInt(pos[d][from + i]);
  return new ort.Tensor('int64', a, [3, 1, n]);
}

async function runLM(embeds, pos, cache, pastLen, keep) {
  const dim = S.meta.embed.dim;
  const t = embeds.length / dim;
  const feeds = {
    inputs_embeds: new ort.Tensor(S.io16 ? 'float16' : 'float32', toIo(embeds), [1, t, dim]),
    position_ids: pos,
  };
  if (S.lmIn.includes('attention_mask')) feeds.attention_mask = new ort.Tensor('int64', new BigInt64Array(pastLen + t).fill(1n), [1, pastLen + t]);
  for (const name of S.lmIn) if (cache[name]) feeds[name] = cache[name];
  const out = await S.sess.lm.run(feeds);
  let h = out.hidden_states;
  if (!S.gpuStates) { h = fromIo(h.data); out.hidden_states.dispose?.(); }
  let next = null;
  if (keep) {
    next = {};
    for (const name of S.lmIn) if (cache[name]) next[name] = out[presentOf(name)];
  } else {
    for (const [k, v] of Object.entries(out)) if (k !== 'hidden_states') v.dispose?.();
  }
  return { h, cache: next };
}

function disposeCache(c) { if (c) for (const v of Object.values(c)) v.dispose?.(); }

function entry(mission) {
  if (!S.entries.has(mission)) {
    const e = promptIds(S.tok, S.meta, mission);
    e.posB = posTensor(e.pos[0], e.a, e.cut);
    e.posQ = e.pos.map((p, j) => posTensor(p, e.cut, e.ids[j].length));
    if (S.entries.size > 64) S.entries.delete(S.entries.keys().next().value);
    S.entries.set(mission, e);
  }
  return S.entries.get(mission);
}

async function systemPrefix(e) {
  const ids = e.ids[0].slice(0, e.a);
  const key = ids.join(',');
  if (!S.pre || S.pre.key !== key) {
    if (S.pre) { disposeCache(S.pre.cache); S.pre.h.dispose?.(); }
    await ensureRows(ids);
    const r = await runLM(embedRows(ids), posTensor(e.pos[0], 0, e.a), emptyCache(), 0, true);
    S.pre = { key, h: r.h, cache: r.cache };
  }
  return S.pre;
}

async function rgbOf(image, jpeg) {
  let { rgba, rgb, width, height } = image;
  if (image.bytes) {
    const bmp = await createImageBitmap(new Blob([image.bytes], { type: image.mime || 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    ({ width, height } = bmp);
    if (width !== W || height !== H) {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'medium';
      g.drawImage(bmp, 0, 0, W, H);
      rgba = g.getImageData(0, 0, W, H).data;
    } else {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      rgba = g.getImageData(0, 0, W, H, { colorSpace: 'srgb' }).data;
    }
    bmp.close();
    width = W; height = H;
  }
  if (width !== W || height !== H) throw new Error(`image ${width} x ${height}, expected ${W} x ${H}`);
  if (jpeg) return S.rt(rgba || rgb, W, H, S.meta.image.jpeg_quality, rgba ? 4 : 3);
  if (rgb) return rgb;
  const out = new Uint8Array(W * H * 3);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { out[i * 3] = rgba[j]; out[i * 3 + 1] = rgba[j + 1]; out[i * 3 + 2] = rgba[j + 2]; }
  return out;
}

async function decide(m) {
  const ms = {};
  let t = now();
  const t0 = t;
  const tick = (k) => { const n = now(); ms[k] = n - t; t = n; };
  const rgb = await rgbOf(m.image, m.jpeg !== false);
  tick('image');
  const px = S.visIn === 'rgb' ? new ort.Tensor('float32', new Float32Array(rgb), [H, W, 3])
    : new ort.Tensor('float32', patches(rgb, S.meta.resize), [1344, 768]);
  tick('prep');
  const e = entry(m.mission);
  await ensureRows(e.ids.flatMap((x) => x.slice(e.b)));
  const pre = await systemPrefix(e);
  tick('tokens');
  const vis = await S.sess.vision.run({ [S.visIn]: px });
  const feats = u16(vis.feats.data);
  tick('vision');
  const dim = S.meta.embed.dim;
  const nB = e.cut - e.a;
  const embB = new Uint16Array(nB * dim);
  embB.set(feats, 0);
  embedRows(e.ids[0].slice(e.b, e.cut), embB, e.b - e.a);
  const B = await runLM(embB, e.posB, pre.cache, e.a, true);
  tick('prefix');
  const nq = S.meta.questions.length;
  let Q;
  if (S.qBatch) Q = await questionsBatched(e, B.cache);
  else {
    const hs = [];
    for (let j = 0; j < nq; j++) hs.push((await runLM(embedRows(e.ids[j].slice(e.cut)), e.posQ[j], B.cache, e.cut, false)).h);
    const lens = hs.map((h) => h.length / dim), L = Math.max(...lens);
    const t = new Uint16Array(nq * L * dim);
    hs.forEach((h, j) => t.set(h, j * L * dim));
    Q = { t, lens, L };
  }
  disposeCache(B.cache);
  tick('questions');
  const cpu16 = (a, dims) => new ort.Tensor('float16', a, dims);
  const feeds = {};
  if (S.headShared) {
    feeds.states_pre = S.gpuStates ? pre.h : cpu16(pre.h, [1, pre.h.length / dim, dim]);
    feeds.states_b = S.gpuStates ? B.h : cpu16(B.h, [1, B.h.length / dim, dim]);
    feeds.states_q = S.gpuStates ? Q.t : cpu16(Q.t, [nq, Q.L, dim]);
    feeds.q_lens = new ort.Tensor('int64', BigInt64Array.from(Q.lens, BigInt), [nq]);
  } else {
    S.meta.questions.forEach((q, j) => {
      const qh = Q.t.subarray(j * Q.L * dim, (j * Q.L + Q.lens[j]) * dim);
      const states = new Uint16Array(pre.h.length + B.h.length + qh.length);
      states.set(pre.h, 0); states.set(B.h, pre.h.length); states.set(qh, pre.h.length + B.h.length);
      feeds[`states_${q}`] = cpu16(states, [1, states.length / dim, dim]);
    });
  }
  const out = await S.sess.head.run(feeds);
  if (S.gpuStates) { B.h.dispose?.(); Q.t.dispose?.(); }
  tick('head');
  if (S.gpuStates) {
    ms.decoder = ms.prefix + ms.questions + ms.head;
    delete ms.prefix; delete ms.questions; delete ms.head;
  }
  const scores = {}, probs = {}, top = {};
  for (const q of S.meta.questions) {
    scores[q] = Array.from(out[`scores_${q}`].data);
    probs[q] = softmax(scores[q]);
    const j = probs[q].reduce((b, x, i) => (x > probs[q][b] ? i : b), 0);
    top[q] = [S.meta.options[q][j], Math.round(probs[q][j] * 1000) / 1000];
  }
  const d = { ...S.meta.decode, ...(m.decode || {}) };
  const cmd = decodeStep(probs.move, probs.altitude, probs.side || null, { sideMode: d.side_mode, speedDead: d.speed_dead, keepTau: d.keep_tau });
  ms.total = now() - t0;
  return { result: { ...cmd, top, probs, scores }, ms };
}

function questionsBatchFeeds(e) {
  if (!e.qBatch) {
    const dim = S.meta.embed.dim, nq = S.meta.questions.length;
    const lens = e.ids.map((x) => x.length - e.cut);
    const L = Math.max(...lens);
    const ids = [];
    const pos = new BigInt64Array(3 * nq * L);
    for (let j = 0; j < nq; j++) {
      const own = e.ids[j].slice(e.cut);
      ids.push(...own, ...new Array(L - own.length).fill(own[own.length - 1]));
      const p = e.pos[j];
      for (let d = 0; d < 3; d++) for (let i = 0; i < L; i++) {
        const at = e.cut + i;
        pos[(d * nq + j) * L + i] = BigInt(at < p[d].length ? p[d][at] : p[d][p[d].length - 1] + (at - p[d].length + 1));
      }
    }
    e.qBatch = { ids, lens, L, dim, nq, pos: new ort.Tensor('int64', pos, [3, nq, L]) };
  }
  return e.qBatch;
}

async function questionsBatched(e, cache) {
  const { ids, lens, L, dim, nq, pos } = questionsBatchFeeds(e);
  const feeds = { inputs_embeds: new ort.Tensor(S.io16 ? 'float16' : 'float32', toIo(embedRows(ids)), [nq, L, dim]), position_ids: pos };
  for (const name of S.lmIn) if (cache[name]) feeds[name] = cache[name];
  const out = await S.sess.lm.run(feeds, ['hidden_states']);
  if (S.gpuStates) return { t: out.hidden_states, lens, L };
  const t = fromIo(out.hidden_states.data);
  out.hidden_states.dispose?.();
  return { t, lens, L };
}

let queue = Promise.resolve();
self.onmessage = (ev) => {
  const m = ev.data;
  queue = queue.then(async () => {
    try {
      if (m.type === 'init') await init(m);
      else if (m.type === 'act') { const r = await decide(m); post({ type: 'act', id: m.id, ...r }); }
      else if (m.type === 'reset') { if (S.pre) { disposeCache(S.pre.cache); S.pre.h.dispose?.(); } S.pre = null; S.entries.clear(); post({ type: 'reset' }); }
    } catch (err) {
      post({ type: 'error', id: m.id ?? null, message: String(err?.message ?? err) });
    }
  });
};
