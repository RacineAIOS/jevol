import * as THREE from 'three/webgpu';
import { heightAt } from './world.js';

export class FlyCamera {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = -0.25;
    this.roll = 0;
    this.speed = 15;
    this.clearance = 1;
    this.keys = new Set();
    this.velocity = new THREE.Vector3();

    this.dragging = false;
    this.lookedAt = -Infinity;
    let pointer = null;
    let last = null;
    dom.style.touchAction = 'none';
    dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', (e) => {
      if (pointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointer = e.pointerId;
      last = [e.clientX, e.clientY];
      this.dragging = true;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = 'grabbing';
      document.activeElement?.blur?.();
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      const scale = e.pointerType === 'touch' ? 0.005 : 0.0045;
      this.yaw += (e.clientX - last[0]) * scale;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - last[1]) * scale, -1.5, 1.5);
      last = [e.clientX, e.clientY];
      this.lookedAt = performance.now();
    });
    const release = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.dragging = false;
      this.lookedAt = performance.now();
      dom.style.cursor = 'grab';
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('lostpointercapture', release);
    document.addEventListener('wheel', (e) => {
      this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 300);
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  update(dt) {
    const k = this.keys;
    const forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const up = (k.has('Space') ? 1 : 0) - (k.has('KeyC') ? 1 : 0);
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const target = new THREE.Vector3(
      -sin * forward + cos * right,
      up,
      -cos * forward - sin * right,
    ).multiplyScalar(this.speed * boost);
    this.velocity.lerp(target, 1 - Math.exp(-dt * 4));

    const p = this.camera.position;
    p.addScaledVector(this.velocity, dt);
    const limit = this.world.half - 1;
    p.x = THREE.MathUtils.clamp(p.x, -limit, limit);
    p.z = THREE.MathUtils.clamp(p.z, -limit, limit);
    const ground = heightAt(this.world, p.x, p.z);
    if (p.y < ground + this.clearance) p.y = ground + this.clearance;

    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    return ground;
  }
}
