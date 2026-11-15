// Ortssuche: Schweiz über die Suche von geo.admin.ch (Orte, Berge, Hütten, Gemeinden, Adressen – swissNAMES3D),
// weltweit über Photon (OpenStreetMap, komoot). Ergebnis einheitlich: {name, kind, detail, lat, lon, zoom, ch}.

export const GEOADMIN_SEARCH = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
export const PHOTON = 'https://photon.komoot.io/api/';

const inCH = (lat, lon) => lat > 45.8 && lat < 47.85 && lon > 5.9 && lon < 10.55;
const strip = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// Zoom (wie MapView.zoom, d. h. MapLibre-Zoom + 1) je nach Art des Treffers
const ZOOM_CH = { gazetteer: 15, address: 17, gg25: 13, zipcode: 13, district: 11, kantone: 10 };
const ZOOM_OSM = { country: 7, state: 9, region: 9, county: 10, city: 12, town: 13, village: 14, hamlet: 15, suburb: 14,
  peak: 14, volcano: 14, mountain_range: 11, glacier: 13, lake: 12, water: 12, island: 12 };

/** Treffer aus geo.admin.ch (results[].attrs). Die Art steht im Label kursiv: „<i>Gipfel</i> <b>Glärnisch</b>“. */
export function parseGeoAdmin(json) {
  return (json?.results ?? []).map(({ attrs: a }) => {
    if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return null;
    const label = String(a.label ?? '');
    const kind = strip((label.match(/<i>(.*?)<\/i>/) ?? [])[1]);
    const name = strip(label.replace(/<i>.*?<\/i>/, '')) || strip(a.detail);
    return { name, kind, detail: '', lat: a.lat, lon: a.lon, zoom: ZOOM_CH[a.origin] ?? 15, ch: true };
  }).filter(Boolean);
}

const KIND_DE = { peak: 'Gipfel', volcano: 'Vulkan', mountain_range: 'Gebirge', ridge: 'Grat', saddle: 'Pass', mountain_pass: 'Pass',
  glacier: 'Gletscher', lake: 'See', water: 'Gewässer', river: 'Fluss', waterfall: 'Wasserfall', island: 'Insel', valley: 'Tal',
  city: 'Stadt', town: 'Ort', village: 'Dorf', hamlet: 'Weiler', suburb: 'Quartier', locality: 'Ort', country: 'Land', state: 'Region',
  alpine_hut: 'Berghütte', wilderness_hut: 'Hütte', hotel: 'Hotel', attraction: 'Sehenswürdigkeit', viewpoint: 'Aussichtspunkt',
  castle: 'Burg', museum: 'Museum', church: 'Kirche', station: 'Bahnhof', aerodrome: 'Flugplatz', park: 'Park', house: 'Adresse' };

const kindOf = (v, lang) => (!(v in KIND_DE) ? '' : lang === 'de' ? KIND_DE[v]
  : v.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));

/** Treffer aus Photon (GeoJSON-Features). */
export function parsePhoton(json, lang = 'de') {
  return (json?.features ?? []).map(f => {
    const p = f.properties ?? {}, [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const name = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ');
    if (!name) return null;
    const detail = [p.city !== name ? p.city : null, p.state, p.country].filter(Boolean).join(', ');
    return { name, kind: kindOf(p.osm_value, lang), detail, lat, lon, zoom: ZOOM_OSM[p.osm_value] ?? 15, ch: inCH(lat, lon) };
  }).filter(Boolean);
}

/**
 * Suchen. region 'ch': zuerst geo.admin.ch, ohne Treffer weltweit (Photon). region 'world': Photon,
 * Treffer in der Nähe von near = {lat, lon} werden bevorzugt.
 */
export async function searchPlaces(q, { region = 'ch', near = null, lang = 'de', limit = 8, fetchFn = fetch, signal } = {}) {
  q = q.trim();
  if (q.length < 2) return [];
  const get = async url => { const r = await fetchFn(url, { signal }); if (!r.ok) throw new Error(`Suche: HTTP ${r.status}`); return r.json(); };
  if (region === 'ch') {
    const u = `${GEOADMIN_SEARCH}?type=locations&lang=${lang}&limit=${limit}&searchText=${encodeURIComponent(q)}`
      + '&origins=gazetteer,gg25,zipcode,address,district,kantone';
    const res = parseGeoAdmin(await get(u));
    if (res.length) return res;
  }
  let u = `${PHOTON}?q=${encodeURIComponent(q)}&limit=${limit}&lang=${['de', 'en', 'fr'].includes(lang) ? lang : 'default'}`;
  if (near) u += `&lat=${near.lat.toFixed(4)}&lon=${near.lon.toFixed(4)}`;
  return parsePhoton(await get(u), lang);
}
