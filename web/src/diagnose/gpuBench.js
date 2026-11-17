const N = 1024;

const matmulCode = (t) => `${t === 'f16' ? 'enable f16;' : ''}
@group(0) @binding(0) var<storage, read> A: array<${t}>;
@group(0) @binding(1) var<storage, read> B: array<${t}>;
@group(0) @binding(2) var<storage, read_write> C: array<${t}>;
const N = ${N}u;
var<workgroup> As: array<${t}, 1024>;
var<workgroup> Bs: array<${t}, 1024>;
@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) g: vec3u) {
  var acc: array<${t}, 16>;
  let tid = l.y * 16u + l.x;
  for (var k0 = 0u; k0 < N; k0 += 16u) {
    for (var i = 0u; i < 4u; i++) {
      let e = tid * 4u + i;
      As[e] = A[(g.y * 64u + e / 16u) * N + k0 + e % 16u];
      Bs[e] = B[(k0 + e / 64u) * N + g.x * 64u + e % 64u];
    }
    workgroupBarrier();
    for (var k = 0u; k < 16u; k++) {
      for (var i = 0u; i < 4u; i++) {
        let a = As[(l.y * 4u + i) * 16u + k];
        for (var j = 0u; j < 4u; j++) { acc[i * 4u + j] += a * Bs[k * 64u + l.x * 4u + j]; }
      }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    for (var j = 0u; j < 4u; j++) { C[(g.y * 64u + l.y * 4u + i) * N + g.x * 64u + l.x * 4u + j] = acc[i * 4u + j]; }
  }
}`;

const tinyCode = `@group(0) @binding(0) var<storage, read_write> X: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) { X[id.x] = X[id.x] * 0.5 + 1.0; }`;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function matmul(device, type, ts, reps = 10, runs = 5) {
  const bytes = N * N * (type === 'f16' ? 2 : 4);
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const bufs = [0, 1, 2].map(() => device.createBuffer({ size: bytes, usage }));
  const init = new Uint8Array(bytes);
  for (let i = 0; i < init.length; i += 2) init[i + 1] = type === 'f16' ? 0x30 : 0x3c;
  device.queue.writeBuffer(bufs[0], 0, init);
  device.queue.writeBuffer(bufs[1], 0, init);
  const module = device.createShaderModule({ code: matmulCode(type) });
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const once = async (withTs) => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass(withTs && ts ? { timestampWrites: { querySet: ts.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    for (let r = 0; r < reps; r++) pass.dispatchWorkgroups(N / 64, N / 64);
    pass.end();
    if (withTs && ts) {
      enc.resolveQuerySet(ts.set, 0, 2, ts.resolve, 0);
      enc.copyBufferToBuffer(ts.resolve, 0, ts.read, 0, 16);
    }
    const t = performance.now();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const wall = performance.now() - t;
    let gpu = null;
    if (withTs && ts) {
      await ts.read.mapAsync(GPUMapMode.READ);
      const v = new BigUint64Array(ts.read.getMappedRange().slice(0));
      ts.read.unmap();
      gpu = Number(v[1] - v[0]) / 1e6;
    }
    return { wall, gpu };
  };
  await once(false);
  const walls = [], gpus = [];
  for (let i = 0; i < runs; i++) {
    const r = await once(true);
    walls.push(r.wall);
    if (r.gpu != null && r.gpu > 0) gpus.push(r.gpu);
  }
  bufs.forEach((b) => b.destroy());
  const flop = 2 * N * N * N * reps;
  const wall = median(walls);
  const gpu = gpus.length ? median(gpus) : null;
  return { type, wallMs: +wall.toFixed(2), gpuMs: gpu != null ? +gpu.toFixed(2) : null, tflopsWall: +(flop / wall / 1e9).toFixed(3), tflopsGpu: gpu ? +(flop / gpu / 1e9).toFixed(3) : null };
}

async function dispatchCost(device) {
  const buf = device.createBuffer({ size: 64 * 4, usage: GPUBufferUsage.STORAGE });
  const module = device.createShaderModule({ code: tinyCode });
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
  const n = 2000;
  const run = async () => {
    const t0 = performance.now();
    const enc = device.createCommandEncoder();
    for (let i = 0; i < n; i++) {
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
    const cb = enc.finish();
    const t1 = performance.now();
    device.queue.submit([cb]);
    await device.queue.onSubmittedWorkDone();
    return { encodeUs: ((t1 - t0) * 1000) / n, totalUs: ((performance.now() - t0) * 1000) / n };
  };
  await run();
  const r = [await run(), await run(), await run()];
  const lat = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    lat.push(performance.now() - t);
  }
  buf.destroy();
  return {
    dispatches: n,
    encodeUsPerDispatch: +median(r.map((x) => x.encodeUs)).toFixed(2),
    totalUsPerDispatch: +median(r.map((x) => x.totalUs)).toFixed(2),
    submitRoundTripMs: +median(lat).toFixed(3),
  };
}

export async function gpuBench() {
  const adapter = await navigator.gpu.requestAdapter();
  const want = ['shader-f16', 'timestamp-query'].filter((f) => adapter.features.has(f));
  const device = await adapter.requestDevice({ requiredFeatures: want });
  let ts = null;
  if (device.features.has('timestamp-query')) {
    ts = {
      set: device.createQuerySet({ type: 'timestamp', count: 2 }),
      resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
      read: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
    };
  }
  const out = { matmul: [] };
  out.matmul.push(await matmul(device, 'f32', ts));
  if (device.features.has('shader-f16')) out.matmul.push(await matmul(device, 'f16', ts));
  out.dispatch = await dispatchCost(device);
  device.destroy();
  return out;
}

export async function f16Speed() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
  try {
    const t = performance.now();
    const r = await matmul(device, 'f16', null, 8, 3);
    return { tflops: r.tflopsWall, wallMs: r.wallMs, totalMs: Math.round(performance.now() - t) };
  } finally {
    device.destroy();
  }
}
