// Ortssuche: Antworten von geo.admin.ch und Photon werden einheitlich gelesen (Beispiele nach deren Dokumentation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeoAdmin, parsePhoton, searchPlaces } from '../src/search.js';

const GEO = { results: [
  { attrs: { label: '<i>Populated Place</i> <b>Wabern</b> (BE) - Köniz', lat: 46.9287, lon: 7.4532, origin: 'gazetteer', detail: 'wabern koeniz' } },
  { attrs: { label: '<b>Bern-Mittelland</b>', lat: 46.8969, lon: 7.4959, origin: 'district' } },
  { attrs: { label: 'kaputt', origin: 'address' } },
] };
const PH = { features: [
  { properties: { name: 'Matterhorn', state: 'Valais/Wallis', country: 'Schweiz', osm_key: 'natural', osm_value: 'peak' }, geometry: { type: 'Point', coordinates: [7.6586, 45.9763] } },
  { properties: { name: 'Berlin', state: 'Berlin', country: 'Deutschland', osm_key: 'place', osm_value: 'city' }, geometry: { type: 'Point', coordinates: [13.3889, 52.517] } },
] };

test('geo.admin.ch: Art aus <i>, Name ohne HTML, Zoom nach Herkunft', () => {
  const r = parseGeoAdmin(GEO);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: 'Wabern (BE) - Köniz', kind: 'Populated Place', detail: '', lat: 46.9287, lon: 7.4532, zoom: 15, ch: true });
  assert.equal(r[1].name, 'Bern-Mittelland'); assert.equal(r[1].zoom, 11);
});

test('Photon: Name, Ort/Land, Zoom nach Art, Schweiz erkannt', () => {
  const [m, b] = parsePhoton(PH);
  assert.equal(m.name, 'Matterhorn'); assert.equal(m.kind, 'Gipfel'); assert.equal(m.detail, 'Valais/Wallis, Schweiz'); assert.equal(m.zoom, 14); assert.equal(m.ch, true);
  assert.equal(b.zoom, 12); assert.equal(b.ch, false);
  assert.equal(parsePhoton(PH, 'en')[0].kind, 'Peak');
});

test('Schweiz: ohne Treffer bei geo.admin.ch weiter mit Photon; Welt: Photon mit Nähe', async () => {
  const urls = [];
  const fake = (geo, ph) => async u => { urls.push(u); return { ok: true, json: async () => (u.includes('geo.admin') ? geo : ph) }; };
  let r = await searchPlaces('Berlin', { fetchFn: fake({ results: [] }, PH) });
  assert.equal(r[1].name, 'Berlin'); assert.equal(urls.length, 2);
  urls.length = 0;
  r = await searchPlaces('Wabern', { fetchFn: fake(GEO, PH) });
  assert.equal(r[0].name, 'Wabern (BE) - Köniz'); assert.equal(urls.length, 1);
  urls.length = 0;
  await searchPlaces('Matterhorn', { region: 'world', near: { lat: 46, lon: 7.5 }, fetchFn: fake(GEO, PH) });
  assert.ok(urls[0].startsWith('https://photon.komoot.io/api/?q=Matterhorn') && urls[0].includes('lat=46.0000'));
  assert.deepEqual(await searchPlaces(' a ', { fetchFn: fake(GEO, PH) }), []);
});
