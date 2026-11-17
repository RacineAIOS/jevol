import { createBrowserModel, quickCheck } from '../inference/browserModel.js';
import { showNotice } from './notice.js';

const MODEL_BASE = 'models/jevol-web/s64_12c/';
const CACHE_NAME = 'jevol-s64_12c';
const WARMUP_RUNS = 2;
const GATE_MS = 800;
const RETRY_RATIO = 3;
const RETRY_DROP = ['subgroups', 'subgroup-size-control', 'chromium-experimental-subgroup-matrix'];

export function createWebgpuBackend({ hud }) {
  let model = null;
  let ready = false;
  let renderCap = false;
  let shownAt = 0;
  let warmMs = null;

  const compute = () => {
    const s = model?.state;
    hud.setCompute(s?.decisions ? `The model runs in your browser (WebGPU), ${Math.round(s.lastMs)} ms per decision.` : ready ? 'The model runs in your browser (WebGPU).' : 'Loading the model in your browser…');
  };
  compute();

  (async () => {
    const check = await quickCheck();
    if (!check.ok) {
      hud.setStatus(`WebGPU is not available (${check.reason}).`);
      hud.setCompute('WebGPU is not available in this browser.');
      showNotice({ kind: 'missing', detail: check.reason });
      return;
    }
    const bar = hud.loadingBar();
    renderCap = true;
    const start = async (dropFeatures) => {
      const m = createBrowserModel({ base: new URL(MODEL_BASE, location.href).href, cacheName: CACHE_NAME, dropFeatures, onProgress: (p) => bar.update(p) });
      try {
        await m.ready;
        bar.update({ loaded: 1, total: 1, text: dropFeatures.length ? 'Tuning the model for this GPU…' : 'Warming up the model…' });
        await new Promise((r) => setTimeout(r, 250));
        return { m, ...(await m.warmup({ runs: WARMUP_RUNS })) };
      } catch (e) {
        m.terminate();
        throw e;
      }
    };
    try {
      let best = await start([]);
      if (best.decoder > RETRY_RATIO * best.vision) {
        best.m.terminate();
        const other = await start(RETRY_DROP);
        if (other.ms < best.ms) best = other;
        else {
          other.m.terminate();
          best = await start([]);
        }
      }
      model = best.m;
      warmMs = best.ms;
      if (warmMs > GATE_MS) {
        const report = { ...(await model.diagnostics()), gateMs: GATE_MS };
        model.terminate();
        model = null;
        renderCap = false;
        const detail = `${(warmMs / 1000).toFixed(warmMs < 1000 ? 2 : 1)} s`;
        hud.setStatus('Your GPU is too slow for this demo.');
        hud.setCompute(`The model takes ${detail} per decision in this browser, 0.8 s needed.`);
        hud.setDiagnostics(() => report);
        showNotice({ kind: 'slow', detail, diagnostics: () => report });
      } else {
        hud.setDiagnostics(async () => model.diagnostics());
        ready = true;
        hud.setReady(true);
        compute();
      }
    } catch (e) {
      hud.setStatus(`The model could not start in this browser: ${e.message || e}`);
      model?.terminate();
      model = null;
      renderCap = false;
    }
    bar.remove();
  })();

  return {
    get ready() { return ready; },
    get renderCap() { return renderCap; },
    get warmMs() { return warmMs; },
    async act(jpeg, mission) {
      if (!ready) throw new Error('model not ready');
      const result = await model.act(jpeg, mission);
      if (performance.now() - shownAt > 500) { shownAt = performance.now(); compute(); }
      return result;
    },
    close() { model?.terminate(); },
  };
}
