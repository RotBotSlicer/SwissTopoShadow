// Datenlader für swisstopo-Höhenmodelle (Browser und Node ≥ 18).
import { fromArrayBuffer, fromUrl } from 'geotiff';
import { Raster, Terrain } from './raster.js';
import { lv95ToWgs84 } from './coords.js';

export const STAC_BASE = 'https://data.geo.admin.ch/api/stac/v0.9/collections';
export const STAC = `${STAC_BASE}/ch.swisstopo.swissalti3d/items`;
export const STAC_SURFACE = `${STAC_BASE}/ch.swisstopo.swisssurface3d-raster/items`; // Oberfläche inkl. Wald/Gebäude
export const REGIO_COG = 'https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/swissaltiregio_2056_5728.tif';

/**
 * Gelände-Levels: Quelle und Distanzgrenze (gemessen, siehe README des Python-Kerns).
 * src: 'alti3d' (2 m, live) | 'regio' (10 m, live aus COG) | 'pyramid' (res 40/80/160 m, eigene Kacheln)
 *      | 'surface' (swissSURFACE3D, res 1 oder 2 m, live aus Übersichtsstufen des COG)
 * ground: true markiert das Level für die Standorthöhe (sonst Level 0).
 */
const PYR = [{ src: 'pyramid', res: 40, until: 12000 }, { src: 'pyramid', res: 80, until: 24000 }, { src: 'pyramid', res: 160, until: Infinity }];
export const LOD_DEFAULT = [{ src: 'alti3d', until: 1000 }, { src: 'regio', until: 4000 }, ...PYR];
export const LOD_10M = [{ src: 'regio', until: 4000 }, ...PYR];
export const LOD_40M = PYR;

/** Oberflächenmodell (Wald/Gebäude) vor das 2-m-Gelände setzen; Standorthöhe bleibt der Boden.
 *  point=true: zusätzlich 1 m bis 300 m (für einzelne Punkte, weniger Randeffekte an Bäumen/Häusern). */
export function withSurface(lod, { point = false } = {}) {
  if (lod[0].src !== 'alti3d') return lod; // nur mit 2-m-Gelände sinnvoll
  const s = [{ src: 'surface', res: 2, until: lod[0].until }];
  if (point) s.unshift({ src: 'surface', res: 1, until: 300 });
  return [...s, { ...lod[0], ground: true }, ...lod.slice(1)];
}

/**
 * Feinstes Gelände passend zur Pixelgrösse p [m] eines Ausschnitts: Gelände feiner als die Pixel
 * bringt kaum etwas, kostet aber quadratisch Daten. Bis 4 m: 2 m, bis 15 m: 10 m, sonst 40 m.
 */
export function lodForPixelSize(p) {
  return p <= 4 ? LOD_DEFAULT : p <= 15 ? LOD_10M : LOD_40M;
}

/** Neueste swissALTI3D-Kachel (2 m) je km² im Rechteck -> Map(tileId -> url). */
export async function findAlti3dTiles([xmin, ymin, xmax, ymax], fetchFn = fetch, stac = STAC, tag = '_2_2056_5728.tif') {
  const m = 1500;
  const corners = [[xmin - m, ymin - m], [xmax + m, ymin - m], [xmin - m, ymax + m], [xmax + m, ymax + m]].map(([e, n]) => lv95ToWgs84(e, n));
  const lons = corners.map(c => c.lon), lats = corners.map(c => c.lat);
  let url = `${stac}?bbox=${Math.min(...lons)},${Math.min(...lats)},${Math.max(...lons)},${Math.max(...lats)}&limit=100`;
  const best = new Map();
  while (url) {
    const d = await (await fetchFn(url)).json();
    for (const f of d.features) for (const [key, a] of Object.entries(f.assets)) {
      if (!key.endsWith(tag)) continue;
      const [, year, tile] = key.split('_');
      const [e, n] = tile.split('-').map(v => +v * 1000);
      if (e + 1000 <= xmin || e >= xmax || n + 1000 <= ymin || n >= ymax) continue;
      if (!best.has(tile) || best.get(tile).year < +year) best.set(tile, { year: +year, url: a.href });
    }
    url = d.links.find(l => l.rel === 'next')?.href;
  }
  return new Map([...best].map(([k, v]) => [k, v.url]));
}

/** swissALTI3D 2 m als Mosaik ganzer km-Kacheln über bounds. */
export async function loadAlti3d(bounds, fetchFn = fetch, onProgress) {
  return loadKmTiles(await findAlti3dTiles(bounds, fetchFn), 2,
    async url => (await fromArrayBuffer(await (await fetchFn(url)).arrayBuffer())).getImage(), onProgress);
}

/** swissSURFACE3D-Raster (Gelände + Wald + Gebäude) in 1 m oder 2 m: nur die Übersichtsstufe wird gelesen (HTTP-Range). */
export async function loadSurface(bounds, res = 2, fetchFn = fetch, onProgress) {
  const tiles = await findAlti3dTiles(bounds, fetchFn, STAC_SURFACE, '_0.5_2056_5728.tif');
  const index = { 1: 1, 2: 2 }[res];
  if (!index) throw new Error('Oberfläche nur in 1 m oder 2 m');
  return loadKmTiles(tiles, res, async url => (await fromUrl(url, { allowFullFile: false })).getImage(index), onProgress);
}

/** Mosaik ganzer km-Kacheln; getImage(url) -> GeoTIFFImage mit 1000/res Pixeln je Seite. */
async function loadKmTiles(tiles, res, getImage, onProgress) {
  if (!tiles.size) throw new Error('keine Kacheln gefunden');
  const ids = [...tiles.keys()].map(t => t.split('-').map(Number));
  const ex = Math.min(...ids.map(i => i[0])), ex1 = Math.max(...ids.map(i => i[0]));
  const nx = Math.min(...ids.map(i => i[1])), nx1 = Math.max(...ids.map(i => i[1]));
  const P = Math.round(1000 / res);
  const w = (ex1 - ex + 1) * P, h = (nx1 - nx + 1) * P;
  const z = new Float32Array(w * h).fill(NaN);
  let done = 0;
  await Promise.all([...tiles].map(async ([id, url]) => {
    const img = await getImage(url);
    const nod = img.getGDALNoData();
    const [band] = await img.readRasters();
    const [e, n] = id.split('-').map(Number);
    const oc = (e - ex) * P, or = (nx1 - n) * P;
    for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) {
      const v = band[r * img.getWidth() + c];
      z[(or + r) * w + oc + c] = (v === nod || v < -1000 || v > 1e30) ? NaN : v;
    }
    onProgress?.(++done, tiles.size);
  }));
  return new Raster(z, w, h, ex * 1000, (nx1 + 1) * 1000, res);
}

let regioTiff = null;
/** swissALTIRegio über bounds direkt aus dem COG (HTTP-Range-Requests).
 *  overview 0 = 10 m; 1, 2, 3 … = Übersichtsstufen 40, 80, 160 m (ausgedünnt; nur für die Darstellung). */
export async function loadRegio([xmin, ymin, xmax, ymax], url = REGIO_COG, overview = 0) {
  regioTiff ??= fromUrl(url, { allowFullFile: false });
  const tiff = await regioTiff;
  const full = await tiff.getImage(0);
  const img = overview ? await tiff.getImage(Math.min(overview, (await tiff.getImageCount()) - 1)) : full;
  const [X0, Y0] = full.getOrigin();
  const res = full.getResolution()[0] * full.getWidth() / img.getWidth();
  const W = img.getWidth(), H = img.getHeight(), nod = full.getGDALNoData();
  const c0 = Math.floor((xmin - X0) / res), r0 = Math.floor((Y0 - ymax) / res);
  const c1 = Math.ceil((xmax - X0) / res), r1 = Math.ceil((Y0 - ymin) / res);
  const w = c1 - c0, h = r1 - r0;
  const z = new Float32Array(w * h).fill(NaN);
  const cc0 = Math.max(0, c0), rr0 = Math.max(0, r0), cc1 = Math.min(W, c1), rr1 = Math.min(H, r1);
  if (cc1 > cc0 && rr1 > rr0) {
    const [band] = await img.readRasters({ window: [cc0, rr0, cc1, rr1] });
    const bw = cc1 - cc0;
    for (let r = rr0; r < rr1; r++) for (let c = cc0; c < cc1; c++) {
      const v = band[(r - rr0) * bw + (c - cc0)];
      z[(r - r0) * w + (c - c0)] = (v === nod || v < -1000 || v > 1e30) ? NaN : v;
    }
  }
  return new Raster(z, w, h, X0 + c0 * res, Y0 - r0 * res, res);
}

/** Gelände wie im Python-Kern (load_terrain_lod): Levels gemäss lod (Standard 2 m -> 10 m -> Pyramide). */
export async function loadTerrainLod([xmin, ymin, xmax, ymax], pyramid, { rMax = 30000, lod = LOD_DEFAULT, fetchFn = fetch, onProgress } = {}) {
  const grow = m => [xmin - m, ymin - m, xmax + m, ymax + m];
  const rasters = await Promise.all(lod.map(({ src, res, until }) => {
    const b = grow(Math.min(until, rMax) + (res ?? 10));
    if (src === 'alti3d') return loadAlti3d(grow(until), fetchFn, onProgress);
    if (src === 'surface') return loadSurface(grow(until), res, fetchFn);
    if (src === 'regio') return loadRegio(b);
    return pyramid.raster(res, b);
  }));
  const groundLevel = Math.max(0, lod.findIndex(l => l.ground));
  return new Terrain(rasters.map((raster, i) => ({ raster, until: lod[i].until })), { groundLevel });
}
