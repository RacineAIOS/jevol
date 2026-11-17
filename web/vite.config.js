import { defineConfig } from 'vite';

const server = process.env.JEVOL_SERVER ?? 'http://127.0.0.1:8000';
const page = process.env.JEVOL_PAGE ?? 'index';
if (!['index', 'diagnose'].includes(page)) throw new Error(`JEVOL_PAGE must be index or diagnose, not ${page}`);
const input = page === 'diagnose' ? { input: 'diagnose.html' } : {};

export default defineConfig(({ mode }) => {
  const requested = process.env.JEVOL_BACKEND ?? (mode === 'server' ? 'server' : 'webgpu');
  const backend = requested === 'mlx' ? 'server' : requested;
  if (!['webgpu', 'server'].includes(backend)) throw new Error(`JEVOL_BACKEND must be webgpu or server, not ${requested}`);
  return {
    publicDir: page === 'index' ? 'public' : false,
    define: { __JEVOL_BACKEND__: JSON.stringify(backend) },
    server: { proxy: { '/ws': { target: server, ws: true } } },
    worker: { format: 'es', rolldownOptions: { output: { comments: false } } },
    build: { rolldownOptions: { ...input, output: { comments: false } }, chunkSizeWarningLimit: 2000, target: 'esnext', outDir: process.env.JEVOL_OUT ?? 'dist', emptyOutDir: page === 'index' },
  };
});
