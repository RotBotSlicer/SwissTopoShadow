// Echte swisstopo-Daten: nur mit SCHATTEN_NETWORK=1 und SCHATTEN_PYRAMID=<ordner|url>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pyramid } from '../src/tiles.js';
import { loadTerrainLod, withSurface, LOD_DEFAULT } from '../src/loaders.js';
import { pointHorizon, litTimeline, intervals } from '../src/horizon.js';

const on = process.env.SCHATTEN_NETWORK === '1' && process.env.SCHATTEN_PYRAMID;
const E = 2719286, N = 1203098;

async function openPyramid(base) {
  if (base.startsWith('http')) return Pyramid.open(base);
  const get = async rel => readFileSync(join(base, rel));
  return new Pyramid(JSON.parse(readFileSync(join(base, 'manifest.json'))), get);
}

test('Bösbächibach: JS-Gelände + Horizont = Python, Sonne 10:08–10:56', { skip: !on && 'SCHATTEN_NETWORK=1 nicht gesetzt', timeout: 600000 }, async () => {
  const pyr = await openPyramid(process.env.SCHATTEN_PYRAMID);
  const terrain = await loadTerrainLod([E - 50, N - 50, E + 50, N + 50], pyr, { rMax: 30000 });
  const ref = JSON.parse(readFileSync(new URL('./fixtures/boesbaechi_py.json', import.meta.url)));
  const h = pointHorizon(terrain, E, N, ref.az, { eye: 1.7, rMax: 30000 });
  let d = 0;
  h.forEach((v, i) => { d = Math.max(d, Math.abs(v - ref.h[i])); });
  console.log(`# max |JS - Python| Horizont: ${d.toFixed(5)}°`);
  assert.ok(d < 0.01, `max diff ${d}`);

  const t0 = Date.UTC(2026, 10, 14, 5, 0) / 1000; // 06:00 MEZ
  const times = Array.from({ length: 12 * 60 }, (_, i) => t0 + 60 * i);
  const iv = intervals(times, litTimeline(ref.az, h, times, E, N));
  const hhmm = u => new Date((u + 3600) * 1000).toISOString().slice(11, 16);
  console.log('# Sonne:', iv.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(', '));
  assert.equal(iv.length, 1);
  assert.ok(Math.abs(iv[0][0] - (t0 + (4 * 60 + 8) * 60)) <= 120 && Math.abs(iv[0][1] - (t0 + (4 * 60 + 56) * 60)) <= 120);
});

test('Bösbächibach mit Wald/Gebäude (1 m/2 m Oberfläche): JS = Python, Sonne 10:14–10:16 und 10:20–10:50', { skip: !on && 'SCHATTEN_NETWORK=1 nicht gesetzt', timeout: 600000 }, async () => {
  const pyr = await openPyramid(process.env.SCHATTEN_PYRAMID);
  const terrain = await loadTerrainLod([E - 50, N - 50, E + 50, N + 50], pyr, { rMax: 30000, lod: withSurface(LOD_DEFAULT, { point: true }) });
  const ref = JSON.parse(readFileSync(new URL('./fixtures/boesbaechi_surface_py.json', import.meta.url)));
  const h = pointHorizon(terrain, E, N, ref.az, { eye: 1.7, rMax: 30000 });
  let d = 0;
  h.forEach((v, i) => { d = Math.max(d, Math.abs(v - ref.h[i])); });
  console.log(`# max |JS - Python| Horizont mit Oberfläche: ${d.toFixed(5)}°`);
  assert.ok(d < 0.01, `max diff ${d}`);
  const t0 = Date.UTC(2026, 10, 14, 5, 0) / 1000;
  const times = Array.from({ length: 12 * 60 }, (_, i) => t0 + 60 * i);
  const iv = intervals(times, litTimeline(ref.az, h, times, E, N));
  const hhmm = u => new Date((u + 3600) * 1000).toISOString().slice(11, 16);
  const txt = iv.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(', ');
  console.log('# Sonne mit Oberfläche:', txt);
  assert.equal(txt, '10:14–10:16, 10:20–10:50');
});
