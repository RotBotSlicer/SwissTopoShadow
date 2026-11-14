import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sunPosition } from '../src/sun.js';

test('sunPosition identisch mit Python (2000 Zufallsfälle)', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/sun.json', import.meta.url)));
  let dA = 0, dE = 0;
  for (let i = 0; i < f.u.length; i++) {
    const { az, el } = sunPosition(f.u[i], f.lat[i], f.lon[i]);
    dA = Math.max(dA, Math.abs(((az - f.az[i] + 540) % 360) - 180));
    dE = Math.max(dE, Math.abs(el - f.el[i]));
  }
  assert.ok(dA < 1e-8 && dE < 1e-8, `dA=${dA} dE=${dE}`);
});
