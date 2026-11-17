const RETRY_MS = 2000;

function actMessage(header, image) {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const message = new Uint8Array(4 + head.length + image.length);
  new DataView(message.buffer).setUint32(0, head.length, true);
  message.set(head, 4);
  message.set(image, 4 + head.length);
  return message;
}

export function createServerBackend({ hud }) {
  let socket = null;
  let ready = false;
  let nextId = 1;
  const pending = new Map();

  function failAll(message) {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  }

  function open() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello' }));
    socket.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'ready') {
        ready = true;
        hud.setReady(true);
        hud.setStatus('');
        hud.setCompute(`The model runs on the model server (${m.backend === 'cuda' ? 'CUDA' : 'MLX'}, ${m.device ?? 'gpu'}).`);
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === 'act') p.resolve({ ...m.drones[0], ms: m.ms });
      else p.reject(new Error(m.message));
    };
    socket.onclose = () => {
      ready = false;
      hud.setReady(false);
      hud.setStatus('Model server not connected. Retrying…');
      hud.setCompute('The model server is not connected. Start it with: jevol serve --checkpoint <dir>');
      failAll('connection lost');
      setTimeout(open, RETRY_MS);
    };
  }
  open();

  return {
    get ready() { return ready; },
    renderCap: false,
    act(jpeg, mission) {
      if (!ready || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('model server not connected'));
      const id = nextId++;
      socket.send(actMessage({ type: 'act', id, drones: [{ id: 'drone', mission, bytes: jpeg.length }] }, jpeg));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.onclose = null; socket.close(); failAll('closed'); },
  };
}
