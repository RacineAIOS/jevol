import * as THREE from 'three/webgpu';

export class Buffers {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.rdA = [];
    this.rdB = [];
    this.rdC = [];
    this.idx = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('rdA', new THREE.Float32BufferAttribute(this.rdA, 4));
    g.setAttribute('rdB', new THREE.Float32BufferAttribute(this.rdB, 4));
    g.setAttribute('rdC', new THREE.Float32BufferAttribute(this.rdC, 4));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function buildSections(rs, segs, flares) {
  const recs = [];
  const flareAt = (s) => {
    let f = 0;
    if (flares?.start) f += flares.start.amount * Math.max(0, 1 - s / flares.start.length) ** 2;
    if (flares?.end) f += flares.end.amount * Math.max(0, 1 - (rs.length - s) / flares.end.length) ** 2;
    return f;
  };
  const segOf = (s) => {
    for (let i = segs.length - 1; i >= 0; i--) if (s >= segs[i].s0 - 1e-6) return segs[i];
    return segs[0];
  };
  const make = (p, mk, gap = false) => ({ x: p.x, z: p.z, tx: p.tx, tz: p.tz, s: p.s, flare: flareAt(p.s), mk, gap });
  const pts = rs.pts;
  const all = rs.closed ? [...pts, { ...pts[0], s: rs.length }] : pts;
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (i > 0) {
      const a = all[i - 1];
      for (const seg of segs) {
        const b = seg.s0;
        if (b > a.s + 1e-6 && b < p.s - 1e-6) {
          const t = (b - a.s) / (p.s - a.s);
          let tx = a.tx + (p.tx - a.tx) * t;
          let tz = a.tz + (p.tz - a.tz) * t;
          const l = Math.hypot(tx, tz) || 1;
          tx /= l;
          tz /= l;
          const mid = { x: a.x + (p.x - a.x) * t, z: a.z + (p.z - a.z) * t, tx, tz, s: b };
          const prev = segs[segs.indexOf(seg) - 1] ?? segs[0];
          recs.push(make(mid, prev, true));
          recs.push(make(mid, seg));
        }
      }
    }
    recs.push(make(p, i === all.length - 1 ? segOf(p.s - 1e-3) : segOf(p.s)));
  }
  return recs;
}

export function addStrip(buf, recs, i0, i1, cols, heightAt) {
  const n = cols.length;
  const base = buf.vertexCount;
  for (let i = i0; i <= i1; i++) {
    const rec = recs[i];
    const sx = -rec.tz;
    const sz = rec.tx;
    for (const col of cols) {
      const v = col.at(rec);
      const x = rec.x + sx * v.off;
      const z = rec.z + sz * v.off;
      buf.pos.push(x, heightAt(x, z) + v.y, z);
      buf.uv.push(v.ux, rec.s);
      buf.rdA.push(...v.A);
      buf.rdB.push(...v.B);
      buf.rdC.push(...(v.C ?? [0, 0, 0, 0]));
    }
  }
  for (let r = 0; r < i1 - i0; r++) {
    if (recs[i0 + r].gap) continue;
    for (let k = 0; k < n - 1; k++) {
      if (cols[k].skipNext) continue;
      const a = base + r * n + k;
      const b = a + n;
      buf.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

export function addFan(buf, ring, centre, heightAt, y, A, B, C = [0, 0, 0, 0]) {
  const base = buf.vertexCount;
  const put = (x, z, ux) => {
    buf.pos.push(x, heightAt(x, z) + y, z);
    buf.uv.push(ux, 0);
    buf.rdA.push(...A);
    buf.rdB.push(...B);
    buf.rdC.push(...C);
  };
  put(centre.x, centre.z, 2);
  for (const p of ring) put(p.x, p.z, 2);
  const m = ring.length;
  for (let i = 0; i < m; i++) buf.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % m));
}
