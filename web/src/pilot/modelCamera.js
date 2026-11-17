import * as THREE from 'three/webgpu';
import { heightAt } from '../engine/world.js';

const FISHEYE_FOV = (160 * Math.PI) / 180;
const COVER_Y = 2.75;
const JPEG_QUALITY = 0.95;
const VIEW_W = 1280;
const VIEW_H = 720;

function fisheyeTable(w, h, focal) {
  const tx = new Float32Array(w * h);
  const ty = new Float32Array(w * h);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const dx = u + 0.5 - w / 2;
      const dy = v + 0.5 - h / 2;
      const r = Math.max(Math.hypot(dx, dy), 1e-8);
      const t = Math.tan(Math.min(r / focal, 1.55)) / r;
      tx[v * w + u] = dx * t;
      ty[v * w + u] = dy * t;
    }
  }
  return { tx, ty };
}

function sampleTable({ tx, ty }, sw, sh) {
  const n = tx.length;
  const coverX = COVER_Y * (sw / sh);
  const index = new Int32Array(n);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = (tx[i] / coverX + 1) * 0.5 * sw - 0.5;
    let y = (ty[i] / COVER_Y + 1) * 0.5 * sh - 0.5;
    x = Math.max(0, Math.min(sw - 1.001, x));
    y = Math.max(0, Math.min(sh - 1.001, y));
    const x0 = x | 0;
    const y0 = y | 0;
    wx[i] = x - x0;
    wy[i] = y - y0;
    index[i] = (y0 * sw + x0) * 4;
  }
  return { index, wx, wy, row: sw * 4 };
}

export function createModelCamera({ renderer, scene, world, systems, width }) {
  const W = width;
  const H = (width * 3) / 4;
  const focal = Math.hypot(W, H) / 2 / (FISHEYE_FOV / 2);
  const samplePxPerUnit = (200 * W) / 448;
  const camera = new THREE.PerspectiveCamera(140, 4 / 3, 0.1, 20000);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const outCtx = out.getContext('2d');
  const outImage = outCtx.createImageData(W, H);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const viewCtx = canvas.getContext('2d');
  const view = document.createElement('canvas');
  view.width = VIEW_W;
  view.height = VIEW_H;
  const viewTarget = new THREE.CanvasTarget(view);
  const sh = Math.min(VIEW_H, Math.round(2 * COVER_Y * samplePxPerUnit));
  const sw = Math.round((sh * VIEW_W) / VIEW_H);
  const sample = new OffscreenCanvas(sw, sh).getContext('2d', { willReadFrequently: true });
  const lookup = sampleTable(fisheyeTable(W, H, focal), sw, sh);

  function render(pose) {
    camera.aspect = VIEW_W / VIEW_H;
    camera.fov = (2 * Math.atan(COVER_Y) * 180) / Math.PI;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    camera.position.set(pose.east, pose.up, -pose.north);
    camera.rotation.set(0, pose.yaw - Math.PI / 2, 0, 'YXZ');
    camera.updateMatrixWorld();
    const ground = heightAt(world, camera.position.x, camera.position.z);
    systems.trees.update(camera);
    systems.env.update(camera);
    systems.paths.update(camera);
    systems.sites.update(camera, 0);
    systems.grass?.update(camera.position.y - ground);
    const main = renderer.getCanvasTarget();
    renderer.setCanvasTarget(viewTarget);
    renderer.render(scene, camera);
    renderer.setCanvasTarget(main);
  }

  function read(source) {
    sample.drawImage(source, 0, 0, sw, sh);
    return sample.getImageData(0, 0, sw, sh).data;
  }

  function project(data) {
    const dst = outImage.data;
    const { index, wx, wy, row } = lookup;
    for (let i = 0, o = 0; i < W * H; i++, o += 4) {
      const a = index[i];
      const c = a + row;
      const fx = wx[i];
      const fy = wy[i];
      for (let k = 0; k < 3; k++) {
        const top = data[a + k] + (data[a + 4 + k] - data[a + k]) * fx;
        const bottom = data[c + k] + (data[c + 4 + k] - data[c + k]) * fx;
        dst[o + k] = top + (bottom - top) * fy;
      }
      dst[o + 3] = 255;
    }
    outCtx.putImageData(outImage, 0, 0);
    viewCtx.drawImage(out, 0, 0);
  }

  function poseOf(body) {
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(body.quaternion);
    return { east: body.position.x, north: body.position.y, up: body.position.z, yaw: Math.atan2(forward.y, forward.x) };
  }

  async function encode(pending) {
    const bitmap = await pending;
    project(read(bitmap));
    bitmap.close();
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return new Uint8Array(await blob.arrayBuffer());
  }

  return {
    canvas,
    capture(body) {
      render(poseOf(body));
      return encode(createImageBitmap(view));
    },
    snapshot(pose) {
      render(pose);
      project(read(view));
      return out.toDataURL('image/jpeg', JPEG_QUALITY);
    },
  };
}
