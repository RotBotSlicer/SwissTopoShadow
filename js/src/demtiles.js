// Höhenkacheln für die 3D-Ansicht der Karte (Web-Mercator, 256 px, Terrarium-Kodierung).
// Die Höhen kommen aus denselben Daten wie die Schattenrechnung: Schweiz aus Pyramide / swissALTIRegio
// (und, wo vorhanden, dem feinen 2-m-Gelände), weltweit aus Copernicus.
import { LV95 } from './coords.js';
import { loadRegio } from './loaders.js';
import { loadGeoTiles, sampleGeo } from './copernicus.js';

export const TILE = 256;

/** Breite/Länge der Pixelzentren einer Kachel (z, x, y), Zeile 0 = Norden. */
export function tileLatLon(z, x, y, size = TILE) {
  const n = 2 ** z, lat = new Float64Array(size), lon = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    lon[i] = (x + (i + 0.5) / size) / n * 360 - 180;
    lat[i] = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (i + 0.5) / size) / n))) * 180 / Math.PI;
  }
  return { lat, lon };
}

/** Geografische Grenzen einer Kachel. */
export function tileBounds(z, x, y) {
  const n = 2 ** z, lon = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

/** Höhen [m] -> RGBA (Terrarium: h = R·256 + G + B/256 − 32768), Auflösung 1/256 m. */
export function encodeTerrarium(h) {
  const out = new Uint8ClampedArray(h.length * 4);
  for (let i = 0; i < h.length; i++) {
    const v = Math.min(Math.max((Number.isFinite(h[i]) ? h[i] : 0) + 32768, 0), 65535.99);
    const r = Math.floor(v / 256), g = Math.floor(v) - r * 256, b = Math.floor((v - Math.floor(v)) * 256);
    out[4 * i] = r; out[4 * i + 1] = g; out[4 * i + 2] = b; out[4 * i + 3] = 255;
  }
  return out;
}
export function decodeTerrarium(rgba) {
  const h = new Float32Array(rgba.length / 4);
  for (let i = 0; i < h.length; i++) h[i] = rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - 32768;
  return h;
}

/** Höhen einer Kachel aus Rastern im Metergitter (erstes Raster mit Daten gewinnt). */
export function heightsFromRasters(z, x, y, rasters, proj = LV95) {
  const { lat, lon } = tileLatLon(z, x, y), h = new Float32Array(TILE * TILE);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) {
    const { E, N } = proj.fromLatLon(lat[r], lon[c]);
    let v = NaN;
    for (const ras of rasters) { const s = ras.sample(E, N); if (s > -1000) { v = s; break; } }
    h[r * TILE + c] = Number.isFinite(v) ? v : 0;
  }
  return h;
}

/**
 * Schweiz: Datenquelle nach Zoomstufe. pyramid: Pyramid (nur Rückfall ausserhalb swissALTIRegio); fine: optional
 * Raster (2 m) des aktuellen Ausschnitts. Für die Darstellung immer swissALTIRegio – ab z13 10 m, darunter dessen
 * Übersichtsstufen (40/80/160 m). Die Pyramide (Maximum) eignet sich nicht: Nachbarkacheln anderer Zoomstufen
 * hätten sonst sichtbare Höhensprünge.
 */
export async function heightsCH(z, x, y, pyramid, fine = null) {
  const b = tileBounds(z, x, y);
  const pts = [[b.south, b.west], [b.south, b.east], [b.north, b.west], [b.north, b.east]].map(([la, lo]) => LV95.fromLatLon(la, lo));
  const m = 60;
  const bb = [Math.min(...pts.map(p => p.E)) - m, Math.min(...pts.map(p => p.N)) - m, Math.max(...pts.map(p => p.E)) + m, Math.max(...pts.map(p => p.N)) + m];
  const rasters = [];
  if (fine && z >= 14 && fine.x0 <= bb[0] && fine.x0 + fine.w * fine.res >= bb[2] && fine.y0 >= bb[3] && fine.y0 - fine.h * fine.res <= bb[1]) rasters.push(fine);
  const ov = z >= 13 ? 0 : z === 12 ? 1 : z === 11 ? 2 : 3;
  rasters.push(await loadRegio(bb, undefined, ov));
  rasters.push(await pyramid.raster(ov === 0 ? 40 : ov === 1 ? 40 : ov === 2 ? 80 : 160, bb));
  return heightsFromRasters(z, x, y, rasters, LV95);
}

/** Weltweit: Copernicus (Übersichtsstufe nach Zoom). */
export async function heightsWorld(z, x, y) {
  const b = tileBounds(z, x, y);
  const overview = z >= 12 ? 0 : z === 11 ? 1 : 2;
  const tiles = await loadGeoTiles({ south: b.south - 0.002, west: b.west - 0.002, north: b.north + 0.002, east: b.east + 0.002 }, overview);
  const { lat, lon } = tileLatLon(z, x, y), h = new Float32Array(TILE * TILE);
  for (let r = 0; r < TILE; r++) for (let c = 0; c < TILE; c++) h[r * TILE + c] = sampleGeo(tiles, lat[r], lon[c]);
  return h;
}
