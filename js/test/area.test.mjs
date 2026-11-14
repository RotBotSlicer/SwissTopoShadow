import test from 'node:test';
import assert from 'node:assert/strict';
import { mercatorGrid, gridSizeFor } from '../src/area.js';
import { lv95ToWgs84 } from '../src/coords.js';

test('mercatorGrid: Ecken und Mitte konsistent, Pixel ~ quadratisch', () => {
  const sw = lv95ToWgs84(2718000, 1202000), ne = lv95ToWgs84(2720000, 1204000);
  const b = { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
  const { w, h } = gridSizeFor(b, 5);
  assert.ok(Math.abs(w - 400) <= 8 && Math.abs(h - 400) <= 8, `${w}x${h}`);
  const g = mercatorGrid(b, w, h);
  // erster Pixel = Nordwest, letzter = Südost
  assert.ok(g.coords[1] > g.coords[2 * (w * h - 1) + 1] && g.coords[0] < g.coords[2 * (w * h - 1)]);
  assert.ok(Math.abs(g.center.E - 2719000) < 30 && Math.abs(g.center.N - 1203000) < 30, JSON.stringify(g.center));
  assert.ok(g.pixelSize > 4.8 && g.pixelSize < 5.6, g.pixelSize);
  // Nachbarpixel in x: ~5 m Abstand
  const dx = Math.hypot(g.coords[2] - g.coords[0], g.coords[3] - g.coords[1]);
  assert.ok(Math.abs(dx - 5) < 0.3, dx);
});
