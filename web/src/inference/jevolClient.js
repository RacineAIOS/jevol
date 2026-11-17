export function createJevolWorker({ onProgress = () => {}, ...init } = {}) {
  const worker = new Worker(new URL('./jevol-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextId = 1;
  let readyResolve, readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') onProgress(m);
    else if (m.type === 'ready') readyResolve(m.info);
    else if (m.type === 'act' || m.type === 'error') {
      const p = pending.get(m.id);
      if (!p) { if (m.type === 'error') readyReject(new Error(m.message)); return; }
      pending.delete(m.id);
      if (m.type === 'act') p.resolve(m); else p.reject(new Error(m.message));
    }
  };
  worker.onerror = (e) => readyReject(new Error(e.message || 'worker failed'));
  worker.postMessage({ type: 'init', referrer: location.href, ...init });
  return {
    ready,
    act({ mission, image, jpeg = true }) {
      const id = nextId++;
      worker.postMessage({ type: 'act', id, mission, image, jpeg });
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    terminate() { worker.terminate(); for (const p of pending.values()) p.reject(new Error('worker stopped')); pending.clear(); },
  };
}
