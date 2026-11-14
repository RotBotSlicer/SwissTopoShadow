// Oberflächenmodell (Wald/Gebäude): Standort am Boden, Strahlen gegen die Oberfläche – wie python/tests/test_horizon.py
import test from 'node:test';
import assert from 'node:assert/strict';
import { Raster, Terrain } from '../src/raster.js';
import { pointHorizon } from '../src/horizon.js';
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
