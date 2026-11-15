// Oberflächenmodell (Wald/Gebäude): Standort am Boden, Strahlen gegen die Oberfläche – wie python/tests/test_horizon.py
import test from 'node:test';
import assert from 'node:assert/strict';
import { Raster, Terrain } from '../src/raster.js';
import { pointHorizon, pointHorizonDetail } from '../src/horizon.js';
import { BuildingMask } from '../src/buildings.js';
import { withSurface, LOD_DEFAULT, LOD_10M } from '../src/loaders.js';

const E0 = 2600000, N0 = 1200000;
function ras(res, fn, half = 1500) {
  const n = Math.round(2 * half / res), z = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) z[r * n + c] = fn(-half + (c + 0.5) * res, half - (r + 0.5) * res);
  return new Raster(z, n, n, E0 - half, N0 + half, res);
}
function surfaceTerrain(forest) {
  return new Terrain([
    { raster: ras(2, (x, y) => (forest(x, y) ? 25 : 0)), until: 1000 },
    { raster: ras(2, () => 0), until: 1000 },
    { raster: ras(10, () => 0), until: Infinity },
  ], { groundLevel: 1 });
}

test('Waldrand 100 m südlich wirft Schatten auf offenes Gelände', () => {
  const h = pointHorizon(surfaceTerrain((x, y) => y < -100), E0, N0, [180], { eye: 1.7, rMax: 1400 })[0];
  assert.ok(Math.abs(h - Math.atan((25 - 1.7) / 100) * 180 / Math.PI) < 0.5, h);
});

test('unter den Kronen Schatten, auf Kronenhöhe nicht', () => {
  const t = surfaceTerrain((x, y) => Math.hypot(x, y) < 300);
  assert.ok(Math.min(...pointHorizon(t, E0, N0, [90, 180, 270], { eye: 1.7, rMax: 1400 })) > 80);
  const top = new Terrain(t.levels, { groundLevel: 0 });
  assert.ok(pointHorizon(top, E0, N0, [180], { eye: 1.7, rMax: 1400 })[0] < 1);
});

test('Lücken in der Oberfläche fallen auf den Boden zurück', () => {
  const t = surfaceTerrain((x, y) => y < -100);
  t.levels[0].raster = new Raster(new Float32Array(t.levels[0].raster.z.length).fill(NaN), t.levels[0].raster.w, t.levels[0].raster.h, t.levels[0].raster.x0, t.levels[0].raster.y0, 2);
  assert.ok(pointHorizon(t, E0, N0, [180], { eye: 1.7, rMax: 1400 })[0] < 0);
});

test('withSurface: nur mit 2-m-Gelände, Boden markiert', () => {
  const l = withSurface(LOD_DEFAULT);
  assert.deepEqual(l.slice(0, 2).map(x => x.src), ['surface', 'alti3d']);
  assert.ok(l[1].ground && !l[0].ground);
  assert.equal(withSurface(LOD_DEFAULT, { point: true })[0].res, 1);
  assert.equal(withSurface(LOD_10M), LOD_10M);
});

test('pointHorizonDetail: h wie pointHorizon, bare ohne Wald, Treffpunkt am Waldrand', () => {
  // Waldrand 100 m südlich (25 m hoch), dahinter Hügel 40 m hoch in 2 km (nur im 10-m-Gelände)
  const t = new Terrain([
    { raster: ras(2, (x, y) => (y < -100 ? 25 : 0)), until: 1000 },
    { raster: ras(2, () => 0), until: 1000 },
    { raster: ras(10, (x, y) => (y < -2000 ? 40 : 0), 3000), until: Infinity },
  ], { groundLevel: 1 });
  const az = [0, 90, 180, 270];
  const d = pointHorizonDetail(t, E0, N0, az, { eye: 1.7, rMax: 2800 });
  assert.deepEqual([...d.h], [...pointHorizon(t, E0, N0, az, { eye: 1.7, rMax: 2800 })]);
  assert.ok(d.h[2] > 12 && d.bare[2] < 2 && d.bare[2] > 0.5, `${d.h[2]} ${d.bare[2]}`); // Wald verdeckt, Gelände: Hügel ~1°
  assert.ok(Math.abs(d.hitN[2] - (N0 - 101)) < 3 && Math.abs(d.hitObj[2] - 25) < 0.1, `${d.hitN[2]} ${d.hitObj[2]}`);
  assert.equal(d.hitObj[0], 0);
});

test('BuildingMask: Kachelindex und Toleranz', () => {
  const m = new Uint8Array(256 * 256); m[10 * 256 + 20] = 1; // Pixel (20, 10) in Kachel 72/80
  const b = new BuildingMask(new Map([['72/80', m]]));
  const E = 2420000 + 72 * 640 + 20.5 * 2.5, N = 1350000 - 80 * 640 - 10.5 * 2.5;
  assert.ok(b.at(E, N)); assert.ok(!b.at(E + 5, N)); assert.ok(b.near(E + 2, N)); assert.ok(!b.at(E + 100000, N));
});
