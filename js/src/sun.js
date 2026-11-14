// Sonnenstand nach NOAA (Meeus-Näherung) – 1:1-Port von schatten/sun.py.
// Azimut: Grad ab Norden im Uhrzeigersinn. Höhe: Grad, scheinbar (inkl. Refraktion).
import { lv95ToWgs84, gridBearingOfNorth } from './coords.js';

const DEG = Math.PI / 180;

export function refractionDeg(e) {
  const te = Math.tan(Math.min(Math.max(e, -89), 89) * DEG);
  let r; // Bogensekunden
  if (e > 85) r = 0;
  else if (e > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (e > -0.575) r = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

/** @returns {{az:number, el:number}} für Unix-Sekunden (UTC), lat/lon in Grad */
export function sunPosition(unixS, latDeg, lonDeg, apparent = true) {
  const jd = unixS / 86400 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * DEG;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * DEG;
  const eot = 4 / DEG * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const minutesUtc = mod(unixS, 86400) / 60;
  const tst = mod(minutesUtc + eot + 4 * lonDeg, 1440);
  const ha = (tst / 4 - 180) * DEG;
  const lat = latDeg * DEG;
  const cosz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  let el = 90 - Math.acos(Math.min(1, Math.max(-1, cosz))) / DEG;
  const az = mod(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / DEG + 180, 360);
  if (apparent) el += refractionDeg(el);
  return { az, el };
}

function mod(a, n) { return ((a % n) + n) % n; }

/** Sonnenstand im LV95-Gitter: Azimut ab Gitter-Nord (inkl. Meridiankonvergenz), Höhe. */
export function sunPositionLv95(unixS, E, N, apparent = true) {
  const { lat, lon } = lv95ToWgs84(E, N);
  const p = sunPosition(unixS, lat, lon, apparent);
  return { az: mod(p.az + gridBearingOfNorth(E, N), 360), el: p.el };
}

/** Sonnenstand am Ort (E, N) plus lineare Änderung pro Meter (für grosse Ausschnitte), d = Schrittweite [m]. */
export function sunPositionLv95Grad(unixS, E, N, d = 2000) {
  const c = sunPositionLv95(unixS, E, N);
  const e1 = sunPositionLv95(unixS, E + d, N), e0 = sunPositionLv95(unixS, E - d, N);
  const n1 = sunPositionLv95(unixS, E, N + d), n0 = sunPositionLv95(unixS, E, N - d);
  const da = (a, b) => ((a - b + 540) % 360) - 180;
  return { ...c, grad: { azE: da(e1.az, e0.az) / (2 * d), azN: da(n1.az, n0.az) / (2 * d), elE: (e1.el - e0.el) / (2 * d), elN: (n1.el - n0.el) / (2 * d) } };
}
