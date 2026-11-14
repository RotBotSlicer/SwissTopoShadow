// Horizont, Schatten, Sonnenzeiten – Port von schatten/horizon.py (CPU-Referenz).
// Alle Azimute sind Gitterazimute (LV95); Sonnenstand über sunPositionLv95.
import { sunPositionLv95 } from './sun.js';

export const R_EARTH = 6371000;
export const K_REFRACTION = 0.13;
const DEG = Math.PI / 180;

const drop = r => r * r / (2 * R_EARTH) * (1 - K_REFRACTION);

/** Abtastdistanzen: Schritt = Auflösung des Levels bei r, mindestens growth·r. */
export function rayDistances(terrain, rMax, growth = 0) {
  const out = [];
  let r = terrain.resAt(0);
  while (r <= rMax) { out.push(r); r += Math.max(terrain.resAt(r), growth * r); }
  return Float64Array.from(out);
}

/** Horizontwinkel [°] eines Punkts für die Azimute azDeg (Array). */
export function pointHorizon(terrain, E, N, azDeg, { eye = 1.7, rMax = 15000, growth = 0 } = {}) {
  const z0 = terrain.fine.sample(E, N) + eye;
  const rs = rayDistances(terrain, rMax, growth);
  return Float64Array.from(azDeg, a => {
    const s = Math.sin(a * DEG), c = Math.cos(a * DEG);
    let best = -Infinity;
    for (const r of rs) {
      const t = (terrain.sample(E + s * r, N + c * r, r) - z0 - drop(r)) / r;
      if (t > best) best = t;
    }
    return Math.atan(best) / DEG;
  });
}

/** Gitter-Pixelzentren: grid = {x0, y0, res, w, h} (x0,y0 = obere linke Ecke). */
export function gridCoords(grid, i) {
  const r = Math.floor(i / grid.w), c = i - r * grid.w;
  return [grid.x0 + (c + 0.5) * grid.res, grid.y0 - (r + 0.5) * grid.res];
}

/** Horizontkarte: Float32Array [nAz][h][w] in Grad, Azimute k·360/nAz. */
export function horizonMap(terrain, grid, { nAz = 72, eye = 1.0, rMax = 15000, growth = 0.01, onProgress } = {}) {
  const n = grid.w * grid.h;
  const E = new Float64Array(n), N = new Float64Array(n), z0 = new Float64Array(n);
  for (let i = 0; i < n; i++) { [E[i], N[i]] = gridCoords(grid, i); z0[i] = terrain.fine.sample(E[i], N[i]) + eye; }
  const rs = rayDistances(terrain, rMax, growth);
  const out = new Float32Array(nAz * n);
  const best = new Float64Array(n);
  for (let k = 0; k < nAz; k++) {
    const a = k * 360 / nAz * DEG, s = Math.sin(a), c = Math.cos(a);
    best.fill(-Infinity);
    for (const r of rs) {
      const d = drop(r), sr = s * r, cr = c * r;
      for (let i = 0; i < n; i++) {
        const t = (terrain.sample(E[i] + sr, N[i] + cr, r) - z0[i] - d) / r;
        if (t > best[i]) best[i] = t;
      }
    }
    for (let i = 0; i < n; i++) out[k * n + i] = Math.atan(best[i]) / DEG;
    onProgress?.(k + 1, nAz);
  }
  return out;
}

/** Horizont aus der Karte in Richtung sunAz (linear zwischen Sektoren) für alle Pixel. */
export function horizonAt(hmap, nAz, sunAz, out = new Float32Array(hmap.length / nAz)) {
  const n = hmap.length / nAz, x = (((sunAz % 360) + 360) % 360) / 360 * nAz;
  const k0 = Math.floor(x) % nAz, k1 = (k0 + 1) % nAz, f = x - Math.floor(x);
  for (let i = 0; i < n; i++) out[i] = (1 - f) * hmap[k0 * n + i] + f * hmap[k1 * n + i];
  return out;
}

/** Uint8Array 1 = besonnt. */
export function litFromHorizon(hmap, nAz, sunEl, sunAz) {
  const h = horizonAt(hmap, nAz, sunAz), out = new Uint8Array(h.length);
  for (let i = 0; i < h.length; i++) out[i] = sunEl > h[i] ? 1 : 0;
  return out;
}

/** Referenz: besonnt durch direktes Abtasten in Sonnenrichtung. */
export function litDirect(terrain, grid, sunEl, sunAz, { eye = 1.0, rMax = 15000, growth = 0.01 } = {}) {
  const n = grid.w * grid.h, out = new Uint8Array(n);
  if (sunEl <= -1) return out;
  const t = Math.tan(sunEl * DEG), s = Math.sin(sunAz * DEG), c = Math.cos(sunAz * DEG);
  const rs = rayDistances(terrain, rMax, growth);
  for (let i = 0; i < n; i++) {
    const [E, N] = gridCoords(grid, i), z0 = terrain.fine.sample(E, N) + eye;
    let lit = 1;
    for (const r of rs) if ((terrain.sample(E + s * r, N + c * r, r) - z0 - drop(r)) / r >= t) { lit = 0; break; }
    out[i] = lit;
  }
  return out;
}

/** Punkt (E, N) mit Horizontprofil (Gitterazimute aufsteigend, 0..360): besonnt je Zeitpunkt. */
export function litTimeline(azDeg, horizonDeg, unixS, E, N) {
  return Array.from(unixS, u => {
    const { az, el } = sunPositionLv95(u, E, N);
    return el > interpPeriodic(az, azDeg, horizonDeg) && el > -0.833;
  });
}

/** Wie numpy.interp(x, xp, fp, period=360) für aufsteigendes xp. */
export function interpPeriodic(x, xp, fp) {
  const n = xp.length;
  x = ((x % 360) + 360) % 360;
  let j = 0;
  while (j < n && xp[j] <= x) j++;
  const i0 = (j - 1 + n) % n, i1 = j % n;
  let a = xp[i0], b = xp[i1];
  if (j === 0) a -= 360;
  if (j === n) b += 360;
  return b === a ? fp[i0] : fp[i0] + (fp[i1] - fp[i0]) * (x - a) / (b - a);
}

/** Zusammenhängende true-Abschnitte -> [[start, ende], …]. */
export function intervals(times, flags) {
  const out = []; let start = null;
  for (let i = 0; i < times.length; i++) {
    if (flags[i] && start === null) start = times[i];
    if (!flags[i] && start !== null) { out.push([start, times[i]]); start = null; }
  }
  if (start !== null) out.push([start, times[times.length - 1]]);
  return out;
}

/** Stunden direkter Sonne je Pixel für Zeitpunkte unixDay (Schritt stepMin); (E, N) = Bezugsort für die Sonne. */
export function sunHoursMap(hmap, nAz, unixDay, E, N, stepMin = 5) {
  const n = hmap.length / nAz, acc = new Float32Array(n), h = new Float32Array(n);
  for (const u of unixDay) {
    const { az, el } = sunPositionLv95(u, E, N);
    if (el <= -0.833) continue;
    horizonAt(hmap, nAz, az, h);
    for (let i = 0; i < n; i++) if (el > h[i]) acc[i] += stepMin / 60;
  }
  return acc;
}
