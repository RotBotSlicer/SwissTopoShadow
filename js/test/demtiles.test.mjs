import test from 'node:test';
import assert from 'node:assert/strict';
import { tileLatLon, tileBounds, encodeTerrarium, decodeTerrarium, heightsFromRasters } from '../src/demtiles.js';
import { Raster } from '../src/raster.js';
import { LV95 } from '../src/coords.js';

test('Terrarium hin und zurück (1/256 m)', () => {
  const h = Float32Array.from([-412.3, 0, 1416.77, 4807.9, 8848.125]);
  const d = decodeTerrarium(encodeTerrarium(h));
  h.forEach((v, i) => assert.ok(Math.abs(d[i] - v) <= 1 / 256 + 1e-3, `${v} -> ${d[i]}`));
});

test('Kachelgeometrie: Zentren innerhalb der Grenzen, Norden oben', () => {
  const z = 14, x = 8601, y = 5760, b = tileBounds(z, x, y), { lat, lon } = tileLatLon(z, x, y);
  assert.ok(lat[0] < b.north && lat[0] > lat[255] && lat[255] > b.south && lon[0] > b.west && lon[255] < b.east);
});

test('Höhen aus Raster = Raster an der Pixelposition', () => {
  // lineares Gelände in LV95: z = 1000 + 0.1·(E-2719000) − 0.05·(N-1203000)
  const n = 600, res = 10, x0 = 2716000, y0 = 1206000, z = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) z[r * n + c] = 1000 + 0.1 * (x0 + (c + 0.5) * res - 2719000) - 0.05 * (y0 - (r + 0.5) * res - 1203000);
  const ras = new Raster(z, n, n, x0, y0, res);
  const zt = 14, { lat, lon } = { lat: 46.968, lon: 9.006 };
  const tx = Math.floor((lon + 180) / 360 * 2 ** zt), ty = Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** zt);
  const h = heightsFromRasters(zt, tx, ty, [ras], LV95);
  const p = tileLatLon(zt, tx, ty), q = LV95.fromLatLon(p.lat[100], p.lon[50]);
  assert.ok(Math.abs(h[100 * 256 + 50] - (1000 + 0.1 * (q.E - 2719000) - 0.05 * (q.N - 1203000))) < 0.01);
});
