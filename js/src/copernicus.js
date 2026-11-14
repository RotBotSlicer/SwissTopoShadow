// Weltweites Gelände: Copernicus DEM GLO-30 (30 m, Oberflächenmodell, frei), Kopie bei OpenTopography (SDSC).
// Die AWS-Kopie erlaubt keinen Browserzugriff (kein CORS); die OpenTopography-Kopie schon.
// Die 1°×1°-Kacheln liegen in geografischen Koordinaten; für die Rechnung wird daraus ein Metergitter in einer
// lokalen Transversalen Mercator (coords.localTM) gebildet. Übersichtsstufen des COG liefern die groben Levels.
import { fromUrl } from 'geotiff';
import { Raster, Terrain } from './raster.js';

export const COP30 = 'https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh';

/** Levels weltweit: 30 m bis 6 km, 60 m bis 12 km, 120 m darüber (Faustregel Auflösung ≤ 1 % der Distanz). */
export const LOD_WORLD = [
  { res: 30, overview: 0, until: 6000 },
  { res: 60, overview: 1, until: 12000 },
  { res: 120, overview: 2, until: Infinity },
];

const pad = (v, n) => String(v).padStart(n, '0');
/** Kachelname für die Kachel mit Südwestecke (latS, lonW) (ganze Grad). */
export function cop30TileName(latS, lonW) {
  return `Copernicus_DSM_10_${latS < 0 ? 'S' : 'N'}${pad(Math.abs(latS), 2)}_00_${lonW < 0 ? 'W' : 'E'}${pad(Math.abs(lonW), 3)}_00_DEM`;
}

const tiffCache = new Map();
async function openTile(base, latS, lonW, fetchFn = fetch) {
  const url = `${base}/${cop30TileName(latS, lonW)}.tif`;
  if (!tiffCache.has(url)) {
    tiffCache.set(url, (async () => {
      const r = await fetchFn(url, { headers: { Range: 'bytes=0-0' } });
      if (r.status === 404 || r.status === 403) return null; // keine Kachel = Meer
      if (!r.ok) throw new Error(`Copernicus ${r.status}`);
      return fromUrl(url, { allowFullFile: false });
    })().catch(e => { tiffCache.delete(url); throw e; }));
  }
  return tiffCache.get(url);
}

/**
 * Höhen aus den Copernicus-Kacheln für ein geografisches Rechteck, als Liste von Kachelausschnitten.
 * Jeder Ausschnitt: {lon0, lat0 (obere linke Ecke der Pixel), dLon, dLat, w, h, z}. Fehlende Kacheln: Meer (0 m).
 */
export async function loadGeoTiles({ south, west, north, east }, overview = 0, base = COP30) {
  const jobs = [];
  for (let la = Math.floor(south); la <= Math.floor(north); la++) {
    for (let lo = Math.floor(west); lo <= Math.floor(east); lo++) {
      jobs.push((async () => {
        const tiff = await openTile(base, la, lo);
        if (!tiff) return { lon0: lo, lat0: la + 1, dLon: 1, dLat: 1, w: 1, h: 1, z: new Float32Array([0]), sea: true };
        const n = await tiff.getImageCount();
        const img = await tiff.getImage(Math.min(overview, n - 1));
        const full = await tiff.getImage(0);
        const W = img.getWidth(), H = img.getHeight();
        // Geometrie aus dem Vollbild (Übersichten tragen keine eigene Georeferenz)
        let [ox, oy] = full.getOrigin();
        const [rx, ry] = full.getResolution();
        if (full.geoKeys?.GTRasterTypeGeoKey === 2) { ox -= rx / 2; oy -= ry / 2; } // PixelIsPoint -> Ecke
        const fx = full.getWidth() / W, fy = full.getHeight() / H;
        const dLon = rx * fx, dLat = -ry * fy;
        const c0 = Math.max(0, Math.floor((west - ox) / dLon) - 2), c1 = Math.min(W, Math.ceil((east - ox) / dLon) + 2);
        const r0 = Math.max(0, Math.floor((oy - north) / dLat) - 2), r1 = Math.min(H, Math.ceil((oy - south) / dLat) + 2);
        if (c1 <= c0 || r1 <= r0) return null;
        const [band] = await img.readRasters({ window: [c0, r0, c1, r1] });
        const nod = full.getGDALNoData();
        const z = Float32Array.from(band, v => (v === nod || !(v > -1000 && v < 10000) ? 0 : v));
        return { lon0: ox + c0 * dLon, lat0: oy - r0 * dLat, dLon, dLat, w: c1 - c0, h: r1 - r0, z };
      })());
    }
  }
  return (await Promise.all(jobs)).filter(Boolean);
}

/** Kachel, die (lat, lon) enthält (Pixelkanten). */
function tileAt(tiles, lat, lon) {
  for (const t of tiles) if (lon >= t.lon0 && lon <= t.lon0 + t.w * t.dLon && lat <= t.lat0 && lat >= t.lat0 - t.h * t.dLat) return t;
  return null;
}

/** Pixelwert (r, c) der Kachel t; ausserhalb: nächster Pixel der Nachbarkachel an derselben Stelle (sonst Rand). */
function valueAt(tiles, t, r, c) {
  if (r >= 0 && c >= 0 && r < t.h && c < t.w) return t.z[r * t.w + c];
  const lat = t.lat0 - (r + 0.5) * t.dLat, lon = t.lon0 + (c + 0.5) * t.dLon;
  const n = tileAt(tiles, lat, lon);
  if (n && n !== t) {
    if (n.sea) return 0;
    const rr = Math.min(Math.max(Math.floor((n.lat0 - lat) / n.dLat), 0), n.h - 1);
    const cc = Math.min(Math.max(Math.floor((lon - n.lon0) / n.dLon), 0), n.w - 1);
    return n.z[rr * n.w + cc];
  }
  return t.z[Math.min(Math.max(r, 0), t.h - 1) * t.w + Math.min(Math.max(c, 0), t.w - 1)];
}

/** Bilineare Höhe bei (lat, lon) aus den Kachelausschnitten; an Kachelgrenzen mit den Nachbarpixeln. */
export function sampleGeo(tiles, lat, lon) {
  const t = tileAt(tiles, lat, lon);
  if (!t || t.sea) return 0;
  const c = (lon - t.lon0) / t.dLon - 0.5, r = (t.lat0 - lat) / t.dLat - 0.5;
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0;
  return (1 - fr) * ((1 - fc) * valueAt(tiles, t, r0, c0) + fc * valueAt(tiles, t, r0, c0 + 1))
    + fr * ((1 - fc) * valueAt(tiles, t, r0 + 1, c0) + fc * valueAt(tiles, t, r0 + 1, c0 + 1));
}

/** Metergitter-Raster (Projektion proj) über bounds [xmin,ymin,xmax,ymax] mit Auflösung res aus den Kachelausschnitten. */
export function resampleToGrid(tiles, proj, [xmin, ymin, xmax, ymax], res) {
  const w = Math.ceil((xmax - xmin) / res), h = Math.ceil((ymax - ymin) / res);
  const z = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const { lat, lon } = proj.toLatLon(xmin + (c + 0.5) * res, ymax - (r + 0.5) * res);
    z[r * w + c] = sampleGeo(tiles, lat, lon);
  }
  return new Raster(z, w, h, xmin, ymax, res);
}

/** Geografisches Rechteck, das ein Gitterrechteck der Projektion sicher umfasst. */
export function geoBoundsOf(proj, [xmin, ymin, xmax, ymax]) {
  const pts = [];
  for (let i = 0; i <= 8; i++) for (const [e, n] of [[xmin + (xmax - xmin) * i / 8, ymin], [xmin + (xmax - xmin) * i / 8, ymax], [xmin, ymin + (ymax - ymin) * i / 8], [xmax, ymin + (ymax - ymin) * i / 8]]) pts.push(proj.toLatLon(e, n));
  const m = 0.002;
  return { south: Math.min(...pts.map(p => p.lat)) - m, north: Math.max(...pts.map(p => p.lat)) + m, west: Math.min(...pts.map(p => p.lon)) - m, east: Math.max(...pts.map(p => p.lon)) + m };
}

/** Gelände weltweit für ein Gitterrechteck (Projektion proj): Levels gemäss lod. */
export async function loadTerrainWorld([xmin, ymin, xmax, ymax], proj, { rMax = 30000, lod = LOD_WORLD, base = COP30 } = {}) {
  const levels = await Promise.all(lod.map(async ({ res, overview, until }) => {
    const m = Math.min(until, rMax) + 2 * res;
    const b = [xmin - m, ymin - m, xmax + m, ymax + m].map(v => Math.round(v / res) * res);
    const tiles = await loadGeoTiles(geoBoundsOf(proj, b), overview, base);
    return { raster: resampleToGrid(tiles, proj, b, res), until };
  }));
  return new Terrain(levels);
}

/** Feinstes Level passend zur Pixelgrösse p [m] (wie lodForPixelSize in der Schweiz). */
export function lodWorldForPixelSize(p) {
  return p <= 30 ? LOD_WORLD : p <= 60 ? LOD_WORLD.slice(1) : LOD_WORLD.slice(2);
}
