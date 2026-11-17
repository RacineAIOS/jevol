export const DEVICE_PROFILES = {
  desktop: { name: 'desktop', maxPixelRatio: 2, shadowCascades: null, shadowMapSize: null, gpu: {} },
  ipad: { name: 'ipad', maxPixelRatio: 1.5, shadowCascades: 2, shadowMapSize: 2048, gpu: {} },
};

export function isIPad(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

export function deviceProfile(nav = globalThis.navigator) {
  return isIPad(nav) ? DEVICE_PROFILES.ipad : DEVICE_PROFILES.desktop;
}

export function minDefined(...values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? Math.min(...v) : null;
}
