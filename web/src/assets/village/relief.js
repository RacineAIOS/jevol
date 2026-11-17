import { positionWorld, normalWorld, vec2, vec3, normalize, dot, abs, step, dFdx, dFdy, mix } from 'three/tsl';

export function uvFrame(u, v) {
  const n = normalize(normalWorld);
  const Px = dFdx(positionWorld);
  const Py = dFdy(positionWorld);
  const ux = dFdx(u);
  const uy = dFdy(u);
  const vx = dFdx(v);
  const vy = dFdy(v);
  const det0 = ux.mul(vy).sub(uy.mul(vx));
  const det = det0.add(step(abs(det0), 1e-9).mul(1e-9));
  const Pu = Px.mul(vy).sub(Py.mul(vx)).div(det);
  const Pv = Py.mul(ux).sub(Px.mul(uy)).div(det);
  const T = normalize(Pu.sub(n.mul(dot(n, Pu))).add(vec3(1e-6, 0, 0)));
  const Bp = Pv.sub(n.mul(dot(n, Pv)));
  const B = normalize(Bp.sub(T.mul(dot(T, Bp))).add(vec3(0, 1e-6, 0)));
  const grad = (H) => {
    const hx = dFdx(H);
    const hy = dFdy(H);
    return vec2(hx.mul(vy).sub(hy.mul(vx)).div(det), hy.mul(ux).sub(hx.mul(uy)).div(det));
  };
  return { n, T, B, coord: vec2(u, v), grad };
}

export function swappedFrame(f, swap) {
  return { n: f.n, T: mix(f.T, f.B, swap), B: mix(f.B, f.T, swap), coord: mix(f.coord, f.coord.yx, swap) };
}
