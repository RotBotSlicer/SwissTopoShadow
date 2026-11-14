import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Raster } from '../src/raster.js';

test('Raster.sample identisch mit Python/scipy (inkl. Rand und NaN)', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/raster.json', import.meta.url)));
  const r = new Raster(f.z.map(v => v ?? NaN), f.w, f.h, f.x0, f.y0, f.res);
  let d = 0;
  for (let i = 0; i < f.E.length; i++) d = Math.max(d, Math.abs(r.sample(f.E[i], f.N[i]) - f.v[i]));
  assert.ok(d < 5e-4, `max diff ${d}`); // Python liefert float32 (ulp ~2.4e-4 bei 3000 m)
});
