import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Raster, Terrain } from '../src/raster.js';
import { pointHorizon, horizonMap, litDirect, litFromHorizon, sunHoursMap, interpPeriodic, intervals } from '../src/horizon.js';

const fx = name => new URL(`./fixtures/${name}`, import.meta.url);
const f = JSON.parse(readFileSync(fx('horizon_syn.json')));
const terrain = new Terrain(f.levels.map((m, i) => {
  const b = readFileSync(fx(`syn_level${i}.f32`));
  return { raster: new Raster(new Float32Array(b.buffer, b.byteOffset, m.w * m.h), m.w, m.h, m.x0, m.y0, m.res), until: m.until ?? Infinity };
}));

test('pointHorizon = Python (5 Punkte × 180 Azimute)', () => {
  let d = 0;
  f.pts.forEach(([x, y], j) => {
    const h = pointHorizon(terrain, f.E0 + x, f.N0 + y, f.az, { eye: 1.7, rMax: 2800 });
    h.forEach((v, i) => { d = Math.max(d, Math.abs(v - f.ph[j][i])); });
  });
  assert.ok(d < 0.01, `max diff ${d}°`);
});

const hm = horizonMap(terrain, f.grid, { nAz: 36, rMax: 2800, growth: 0.01 });

test('horizonMap = Python', () => {
  let d = 0;
  for (let i = 0; i < hm.length; i++) d = Math.max(d, Math.abs(hm[i] - f.hm[i]));
  assert.ok(d < 0.01, `max diff ${d}°`);
});

test('litDirect und litFromHorizon = Python (≥ 99.5 % Pixel)', () => {
  f.suns.forEach(([el, az], j) => {
    const a = litDirect(terrain, f.grid, el, az, { rMax: 2800, growth: 0.01 });
    const b = litFromHorizon(hm, 36, el, az);
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) { sa += a[i] === f.ld[j][i]; sb += b[i] === f.lf[j][i]; }
    assert.ok(sa / a.length >= 0.995 && sb / b.length >= 0.995, `${el}/${az}: ${sa / a.length} ${sb / b.length}`);
  });
});

test('sunHoursMap = Python (± 1 Zeitschritt)', () => {
  const sh = sunHoursMap(hm, 36, f.u, 46.97, 9.0, 5);
  let d = 0;
  for (let i = 0; i < sh.length; i++) d = Math.max(d, Math.abs(sh[i] - f.sh[i]));
  assert.ok(d <= 5 / 60 + 1e-6, `max diff ${d} h`);
});

test('interpPeriodic wie numpy.interp(period=360)', () => {
  const xp = [10, 100, 200, 300], fp = [1, 2, 3, 4];
  assert.equal(interpPeriodic(55, xp, fp), 1.5);
  assert.equal(interpPeriodic(355, xp, fp), 4 + (1 - 4) * (55 / 70));
  assert.equal(interpPeriodic(5, xp, fp), 4 + (1 - 4) * (65 / 70));
  assert.deepEqual(intervals([1, 2, 3, 4, 5], [0, 1, 1, 0, 1]), [[2, 4], [5, 5]]);
});
