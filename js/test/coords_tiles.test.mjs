import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lv95ToWgs84, wgs84ToLv95 } from '../src/coords.js';
import { decodeTile } from '../src/tiles.js';

const fx = name => new URL(`./fixtures/${name}`, import.meta.url);

test('LV95 <-> WGS84 gegenüber pyproj < 5 m (Näherungsformel)', () => {
  const f = JSON.parse(readFileSync(fx('coords.json')));
  let d1 = 0, d2 = 0;
  for (let i = 0; i < f.E.length; i++) {
    const { lat, lon } = lv95ToWgs84(f.E[i], f.N[i]);
    d1 = Math.max(d1, Math.hypot((lat - f.lat[i]) * 111200, (lon - f.lon[i]) * 76000));
    const { E, N } = wgs84ToLv95(f.lat[i], f.lon[i]);
    d2 = Math.max(d2, Math.hypot(E - f.E[i], N - f.N[i]));
  }
  assert.ok(d1 < 5 && d2 < 2, `${d1} ${d2}`);
});

test('decodeTile identisch mit Python', async () => {
  const out = await decodeTile(readFileSync(fx('tile.bin.gz')));
  const ref = JSON.parse(readFileSync(fx('tile_decoded.json')));
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] === null) assert.ok(Number.isNaN(out[i]), `NaN erwartet bei ${i}`);
    else assert.equal(out[i], ref[i]);
  }
});

import { gridBearingOfNorth } from '../src/coords.js';
test('Meridiankonvergenz wie Python/pyproj (< 0.01°)', () => {
  const ref = JSON.parse(readFileSync(fx('convergence.json')));
  for (const [E, N, g] of ref) assert.ok(Math.abs(gridBearingOfNorth(E, N) - g) < 0.01, `${E}/${N}: ${gridBearingOfNorth(E, N)} vs ${g}`);
});

import { sunPositionLv95, sunPositionLv95Grad } from '../src/sun.js';
test('Sonnenstand-Gradient: lineare Näherung über ±25 km < 0.02°', () => {
  const E = 2719286, N = 1203098;
  for (const iso of ['2026-11-14T08:00:00Z', '2026-11-14T11:30:00Z', '2026-06-21T17:00:00Z']) {
    const u = Date.parse(iso) / 1000, s = sunPositionLv95Grad(u, E, N);
    for (const [dE, dN] of [[25000, 0], [0, -25000], [-18000, 18000]]) {
      const t = sunPositionLv95(u, E + dE, N + dN);
      const az = s.az + s.grad.azE * dE + s.grad.azN * dN, el = s.el + s.grad.elE * dE + s.grad.elN * dN;
      assert.ok(Math.abs(((az - t.az + 540) % 360) - 180) < 0.02 && Math.abs(el - t.el) < 0.02, `${iso} ${dE}/${dN}`);
    }
  }
});

import { localTM, LV95 } from '../src/coords.js';
test('localTM = pyproj tmerc (< 1 mm), Hin- und Rückweg', () => {
  for (const c of JSON.parse(readFileSync(fx('tm.json')))) {
    const p = localTM(c.lat0, c.lon0);
    let dF = 0, dI = 0;
    c.lat.forEach((lat, i) => {
      const q = p.fromLatLon(lat, c.lon[i]);
      dF = Math.max(dF, Math.hypot(q.E - c.E[i], q.N - c.N[i]));
      const r = p.toLatLon(c.E[i], c.N[i]);
      dI = Math.max(dI, Math.hypot((r.lat - lat) * 111000, (r.lon - c.lon[i]) * 111000 * Math.cos(lat * Math.PI / 180)));
    });
    assert.ok(dF < 1e-3 && dI < 1e-3, `${c.lat0}/${c.lon0}: ${dF} ${dI}`);
  }
  assert.equal(LV95.fromLatLon(46.95, 7.44).E > 2.5e6, true);
});

test('Meridiankonvergenz localTM: 0 am Mittelmeridian, ~Δλ·sinφ daneben', () => {
  const p = localTM(46.97, 9.0);
  assert.ok(Math.abs(gridBearingOfNorth(0, 0, 0.001, p)) < 1e-6);
  const { E, N } = p.fromLatLon(46.97, 9.4);
  const g = gridBearingOfNorth(E, N, 0.001, p);
  assert.ok(Math.abs(Math.abs(g) - 0.4 * Math.sin(46.97 * Math.PI / 180)) < 0.005, g);
});
