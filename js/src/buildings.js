// Gebäudemaske aus dem Dachflächen-Layer (BFE „Eignung von Hausdächern“, Grundlage swissBUILDINGS3D).
// Die WMTS-Kacheln zeigen jede Dachfläche farbig auf durchsichtigem Grund: deckend = Gebäude.
// Stufe 22 der LV95-Kachelmatrix: 2.5 m pro Pixel, 640 m pro Kachel.

export const ROOF_WMTS = 'https://wmts.geo.admin.ch/1.0.0/ch.bfe.solarenergie-eignung-daecher/default/current/2056';
const X0 = 2420000, Y0 = 1350000, Z = 22, RES = 2.5, TILE = 256, SPAN = RES * TILE;

/** PNG -> RGBA-Pixel im Browser (OffscreenCanvas, sonst <canvas>). */
export async function decodePngBrowser(blob) {
  const bmp = await createImageBitmap(blob);
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height)
    : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
}

/** Maske der Gebäude im LV95-Rechteck [xmin, ymin, xmax, ymax]. */
export async function loadBuildingMask([xmin, ymin, xmax, ymax], { fetchFn = fetch, decode = decodePngBrowser, base = ROOF_WMTS } = {}) {
  const c0 = Math.floor((xmin - X0) / SPAN), c1 = Math.floor((xmax - X0) / SPAN);
  const r0 = Math.floor((Y0 - ymax) / SPAN), r1 = Math.floor((Y0 - ymin) / SPAN);
  const tiles = new Map();
  const jobs = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    jobs.push((async () => {
      try {
        const res = await fetchFn(`${base}/${Z}/${c}/${r}.png`);
        if (!res.ok) return; // keine Kachel = keine Gebäude
        const px = await decode(await res.blob());
        const m = new Uint8Array(TILE * TILE);
        for (let i = 0; i < m.length; i++) m[i] = px[4 * i + 3] > 128 ? 1 : 0;
        tiles.set(`${c}/${r}`, m);
      } catch { /* fehlende Kachel: als „keine Gebäude“ behandeln */ }
    })());
  }
  await Promise.all(jobs);
  return new BuildingMask(tiles);
}

export class BuildingMask {
  constructor(tiles) { this.tiles = tiles; }
  /** true, wenn (E, N) auf einer Dachfläche liegt. */
  at(E, N) {
    const fx = (E - X0) / SPAN, fy = (Y0 - N) / SPAN, c = Math.floor(fx), r = Math.floor(fy);
    const m = this.tiles.get(`${c}/${r}`);
    if (!m) return false;
    const i = Math.min(TILE - 1, Math.floor((fx - c) * TILE)), j = Math.min(TILE - 1, Math.floor((fy - r) * TILE));
    return m[j * TILE + i] === 1;
  }
  /** Gebäude in der Nähe von (E, N) – Strahl trifft meist die Dachkante, daher etwas Toleranz. */
  near(E, N, tol = 2.5) {
    for (const [dx, dy] of [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol]]) if (this.at(E + dx, N + dy)) return true;
    return false;
  }
}
