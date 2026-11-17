const RAD = Math.PI / 180;

export function sunPosition(date, latDeg, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;

  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));

  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD)
    + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD));

  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = (((minutes + eqTime + 4 * lonDeg) % 1440) + 1440) % 1440;
  const hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;

  const lat = latDeg * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = 90 - zenith / RAD;
  let azimuth = Math.atan2(
    Math.sin(hourAngle * RAD),
    Math.cos(hourAngle * RAD) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  ) / RAD + 180;
  azimuth = ((azimuth % 360) + 360) % 360;

  return { azimuth, elevation: elevation + refraction(elevation) };
}

function refraction(h) {
  if (h < -1) return 0;
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60;
}
