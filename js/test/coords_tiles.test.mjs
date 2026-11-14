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
