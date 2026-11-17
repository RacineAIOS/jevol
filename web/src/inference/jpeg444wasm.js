import { roundtrip444 as roundtripJs } from './jpeg444.js';

export async function loadRoundtrip444(url = new URL('./jpeg444.wasm', import.meta.url), init = {}) {
  try {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    return fromInstance(instance);
  } catch (e) {
    console.warn('[jevol] jpeg444.wasm unavailable, JS fallback:', e?.message ?? e);
    return roundtripJs;
  }
}

export function fromInstance(instance) {
  const x = instance.exports;
  return (pixels, width, height, quality = 90, channels = 4) => {
    const mem = new Uint8Array(x.memory.buffer);
    mem.set(pixels.subarray ? pixels.subarray(0, width * height * channels) : pixels, x.in_ptr());
    if (x.roundtrip444(width, height, channels, quality) !== 0) throw new Error('roundtrip444 (wasm): size not supported');
    return new Uint8Array(x.memory.buffer, x.out_ptr(), width * height * 3);
  };
}
