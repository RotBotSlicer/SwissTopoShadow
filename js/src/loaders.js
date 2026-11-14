// Datenlader für swisstopo-Höhenmodelle (Browser und Node ≥ 18).
import { fromArrayBuffer, fromUrl } from 'geotiff';
import { Raster, Terrain } from './raster.js';
import { lv95ToWgs84 } from './coords.js';

export const STAC = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items';
export const REGIO_COG = 'https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/swissaltiregio_2056_5728.tif';

/** Level-Grenzen (gemessen, siehe README des Python-Kerns). */
export const LOD_DEFAULT = { fineUntil: 1000, regioUntil: 4000, pyramid: [[40, 12000], [80, 24000], [160, Infinity]] };

/** Neueste swissALTI3D-Kachel (2 m) je km² im Rechteck -> Map(tileId -> url). */
export async function findAlti3dTiles([xmin, ymin, xmax, ymax], fetchFn = fetch) {
  const m = 1500;
  const corners = [[xmin - m, ymin - m], [xmax + m, ymin - m], [xmin - m, ymax + m], [xmax + m, ymax + m]].map(([e, n]) => lv95ToWgs84(e, n));
  const lons = corners.map(c => c.lon), lats = corners.map(c => c.lat);
  let url = `${STAC}?bbox=${Math.min(...lons)},${Math.min(...lats)},${Math.max(...lons)},${Math.max(...lats)}&limit=100`;
  const best = new Map();
  while (url) {
    const d = await (await fetchFn(url)).json();
    for (const f of d.features) for (const [key, a] of Object.entries(f.assets)) {
      if (!key.endsWith('_2_2056_5728.tif')) continue;
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
  const tiles = await findAlti3dTiles(bounds, fetchFn);
  const ids = [...tiles.keys()].map(t => t.split('-').map(Number));
  const ex = Math.min(...ids.map(i => i[0])), ex1 = Math.max(...ids.map(i => i[0]));
  const nx = Math.min(...ids.map(i => i[1])), nx1 = Math.max(...ids.map(i => i[1]));
  const P = 500; // 1 km / 2 m
  const w = (ex1 - ex + 1) * P, h = (nx1 - nx + 1) * P;
  const z = new Float32Array(w * h).fill(NaN);
  let done = 0;
  await Promise.all([...tiles].map(async ([id, url]) => {
    const tiff = await fromArrayBuffer(await (await fetchFn(url)).arrayBuffer());
    const img = await tiff.getImage();
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
  return new Raster(z, w, h, ex * 1000, (nx1 + 1) * 1000, 2);
}

let regioTiff = null;
/** swissALTIRegio 10 m über bounds direkt aus dem COG (HTTP-Range-Requests). */
export async function loadRegio([xmin, ymin, xmax, ymax], url = REGIO_COG) {
  regioTiff ??= fromUrl(url, { allowFullFile: false });
  const img = await (await regioTiff).getImage(0);
  const [X0, Y0] = img.getOrigin(), [res] = img.getResolution();
  const W = img.getWidth(), H = img.getHeight(), nod = img.getGDALNoData();
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

/** Gelände wie im Python-Kern (load_terrain_lod): 2 m -> 10 m -> Pyramide. */
export async function loadTerrainLod([xmin, ymin, xmax, ymax], pyramid, { rMax = 30000, lod = LOD_DEFAULT, fetchFn = fetch, onProgress } = {}) {
  const grow = m => [xmin - m, ymin - m, xmax + m, ymax + m];
  const [fine, regio, ...pyr] = await Promise.all([
    loadAlti3d(grow(lod.fineUntil), fetchFn, onProgress),
    loadRegio(grow(lod.regioUntil)),
    ...lod.pyramid.map(([res, until]) => pyramid.raster(res, grow(Math.min(until, rMax) + res))),
  ]);
  return new Terrain([
    { raster: fine, until: lod.fineUntil }, { raster: regio, until: lod.regioUntil },
    ...pyr.map((raster, i) => ({ raster, until: lod.pyramid[i][1] })),
  ]);
}
