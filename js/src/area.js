// Rechengitter für einen Kartenausschnitt: Pixel gleichmässig in Web-Mercator (wie die Karte),
// damit die Schattenebene ohne Verzerrung über der Landeskarte liegt. Jeder Pixel trägt seine
// Gitterkoordinate (LV95 oder lokale TM); gerechnet wird in diesem Metergitter.
import { LV95 } from './coords.js';

const D = Math.PI / 180;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * D / 2));
const invMercY = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D;

/**
 * @param {{south:number, west:number, north:number, east:number}} b  WGS84-Grenzen
 * @param {number} w @param {number} h  Pixelzahl
 * @returns {{w, h, coords: Float64Array, bounds, bboxLv95: number[], center: {E, N}, pixelSize: number}}
 */
export function mercatorGrid(b, w, h, proj = LV95) {
  const y0 = mercY(b.north), y1 = mercY(b.south);
  const coords = new Float64Array(2 * w * h);
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (let r = 0; r < h; r++) {
    const lat = invMercY(y0 + (y1 - y0) * (r + 0.5) / h);
    for (let c = 0; c < w; c++) {
      const lon = b.west + (b.east - b.west) * (c + 0.5) / w;
      const { E, N } = proj.fromLatLon(lat, lon);
      const i = r * w + c;
      coords[2 * i] = E; coords[2 * i + 1] = N;
      if (E < xmin) xmin = E; if (E > xmax) xmax = E; if (N < ymin) ymin = N; if (N > ymax) ymax = N;
    }
  }
  const pixelSize = Math.max((xmax - xmin) / (w - 1), (ymax - ymin) / (h - 1));
  return {
    w, h, coords, bounds: b, pixelSize,
    bboxLv95: [xmin - pixelSize, ymin - pixelSize, xmax + pixelSize, ymax + pixelSize],
    center: { E: Math.round((xmin + xmax) / 2), N: Math.round((ymin + ymax) / 2) },
  };
}

/** Pixelzahl so wählen, dass die Pixelgrösse ≈ targetM Meter ist, höchstens maxPx pro Seite. */
export function gridSizeFor(b, targetM = 4, maxPx = 800, proj = LV95) {
  const sw = proj.fromLatLon(b.south, b.west), ne = proj.fromLatLon(b.north, b.east);
  const wm = Math.abs(ne.E - sw.E), hm = Math.abs(ne.N - sw.N);
  const s = Math.max(targetM, wm / maxPx, hm / maxPx);
  return { w: Math.max(2, Math.round(wm / s)), h: Math.max(2, Math.round(hm / s)), widthM: wm, heightM: hm };
}
