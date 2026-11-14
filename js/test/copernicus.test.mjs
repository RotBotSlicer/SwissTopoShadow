import test from 'node:test';
import assert from 'node:assert/strict';
import { cop30TileName, sampleGeo, resampleToGrid, geoBoundsOf, lodWorldForPixelSize } from '../src/copernicus.js';
import { localTM } from '../src/coords.js';

test('Kachelnamen Copernicus GLO-30', () => {
  assert.equal(cop30TileName(46, 9), 'Copernicus_DSM_10_N46_00_E009_00_DEM');
  assert.equal(cop30TileName(-34, -71), 'Copernicus_DSM_10_S34_00_W071_00_DEM');
});

// synthetische Kachel: z = 1000 + 2000*(lat-46) + 500*(lon-9) (linear -> bilinear exakt)
function tile(lat0, lon0, w, h) {
  const dLon = 1 / w, dLat = 1 / h, z = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const lat = lat0 + 1 - (r + 0.5) * dLat, lon = lon0 + (c + 0.5) * dLon;
    z[r * w + c] = 1000 + 2000 * (lat - 46) + 500 * (lon - 9);
  }
  return { lon0, lat0: lat0 + 1, dLon, dLat, w, h, z };
}
const f = (lat, lon) => 1000 + 2000 * (lat - 46) + 500 * (lon - 9);

test('sampleGeo bilinear, über Kachelgrenzen und Meer', () => {
  const tiles = [tile(46, 9, 360, 360), tile(46, 10, 240, 360), { lon0: 11, lat0: 47, dLon: 1, dLat: 1, w: 1, h: 1, z: new Float32Array([0]), sea: true }];
  // innen exakt; direkt an der Grenze zweier Kacheln mit verschiedener Pixelweite nur näherungsweise
  for (const [lat, lon, tol] of [[46.5, 9.5, 0.01], [46.123, 9.987, 0.01], [46.9, 10.3, 0.01], [46.2, 10.9, 0.01], [46.31, 9.9995, 0.5], [46.31, 10.0004, 0.5]]) {
    assert.ok(Math.abs(sampleGeo(tiles, lat, lon) - f(lat, lon)) < tol, `${lat},${lon}: ${sampleGeo(tiles, lat, lon) - f(lat, lon)}`);
  }
  assert.equal(sampleGeo(tiles, 46.5, 11.5), 0);
});

test('resampleToGrid in lokaler TM: Werte = Funktion am Gitterpunkt', () => {
  const tiles = [tile(46, 9, 360, 360)];
  const p = localTM(46.5, 9.5);
  const r = resampleToGrid(tiles, p, [-3000, -3000, 3000, 3000], 30);
  let d = 0;
  for (let i = 0; i < r.z.length; i += 97) {
    const row = Math.floor(i / r.w), col = i % r.w;
    const { lat, lon } = p.toLatLon(r.x0 + (col + 0.5) * 30, r.y0 - (row + 0.5) * 30);
    d = Math.max(d, Math.abs(r.z[i] - f(lat, lon)));
  }
  assert.ok(d < 0.02, String(d));
  const g = geoBoundsOf(p, [-3000, -3000, 3000, 3000]);
  assert.ok(g.south < 46.473 && g.north > 46.527 && g.west < 9.461 && g.east > 9.539, JSON.stringify(g));
});

test('Level weltweit nach Pixelgrösse', () => {
  assert.equal(lodWorldForPixelSize(10)[0].res, 30);
  assert.equal(lodWorldForPixelSize(50)[0].res, 60);
  assert.equal(lodWorldForPixelSize(100)[0].res, 120);
});
