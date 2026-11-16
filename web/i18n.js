// Sprache: Deutsch / Englisch. t('key', {a: 1}) setzt {a} ein. Statische Texte im HTML über data-i18n* Attribute.
const DICT = {
  de: {
    title: 'Schatten – swisstopo',
    region: 'Gebiet', ch: 'Schweiz', world: 'Weltweit', background: 'Hintergrund', map: 'Karte', aerial: 'Luftbild',
    view3d: '3D-Ansicht', date: 'Datum', today: 'Heute', myLocation: 'Mein Standort', profileToggle: 'Profil ein-/ausblenden',
    profile: 'Profil', areaBtn: 'Schatten für Ausschnitt', display: 'Anzeige', modeShadow: 'Schatten', modeHours: 'Sonnenstunden',
    buildings3d: '3D-Gebäude', buildings3dNote: '(swissBUILDINGS3D, nur in 3D)', trails: 'Wanderwege', surface: 'Wald und Gebäude', surfaceNote: '(swissSURFACE3D, nur bei feinem Gelände)',
    worldNote: 'Weltweit: Copernicus-Höhenmodell 30 m (Oberfläche, Wald grob enthalten) · Karte OpenTopoMap',
    hint: 'Tippe auf die Karte, um die Sonnenzeiten an einem Ort zu sehen.',
    play: 'Abspielen', time: 'Uhrzeit', closeProfile: 'Profil ausblenden', resetZoom: 'Ganzen Horizont zeigen',
    chartLabel: 'Horizont und Sonnenbahn', chosenDay: 'gewählter Tag', longestDay: 'längster Tag', shortestDay: 'kürzester Tag',
    longestOn: 'längster Tag ({d})', shortestOn: 'kürzester Tag ({d})',
    terrain: 'Gelände', trees: 'Wald/Bäume', buildings: 'Gebäude',
    search: 'Ort suchen', searchPh: 'Ort, Berg, Hütte, Adresse …', closeSearch: 'Suche schliessen',
    searching: 'Suche …', notFound: 'Nichts gefunden', searchDown: 'Suche nicht erreichbar', language: 'Sprache',
    error: 'Fehler: {m}', outsideCH: 'Ausserhalb der Schweiz: oben auf „Weltweit“ umschalten.', computing: 'rechne…',
    loadingPoint: 'Lade Höhendaten für den Punkt…', masl: 'm ü. M.', timesIn: 'Zeiten in {tz}',
    sunHM: '{h} h {m} min Sonne', noSun: 'Keine direkte Sonne',
    copNote: 'Copernicus 30 m (Oberflächenmodell, Wald grob enthalten)', noSurface: 'ohne Wald und Gebäude',
    withSurface: 'mit Wald und Gebäude',
    aboveCanopy: 'mit Wald und Gebäude · Blick über Baumkronen bzw. Dach (Oberfläche {h} m über Boden)',
    underCanopy: 'mit Wald und Gebäude · der Punkt liegt unter Bäumen oder an einem Gebäude (Oberfläche {h} m über Boden – für den Blick darüber die Höhe unten grösser wählen)',
    creditsCH: 'Karte und Höhendaten © swisstopo', creditsWorld: 'Höhen: Copernicus DEM GLO-30 © DLR/Airbus, ESA · Karte © OpenTopoMap, OpenStreetMap',
    outsideBtn: 'Ausserhalb der Schweiz', chooseWorld: '→ „Weltweit“ wählen', infoCH: 'swisstopo, bis 2 m', infoWorld: 'Copernicus 30 m',
    recompute: 'Ansicht geändert ↻', zoomCloser: 'Für Schatten näher zoomen', shadowBtn: 'Schatten · {lod}', farPart: ' + Fernbereich', forest: 'Wald',
    near: 'Nah', far: 'Fern', loadingTiles: '{l}: lade 2-m-Kacheln {n}/{t}…', loadingDem: 'Lade Höhendaten…',
    loadingDemFar: 'Lade Höhendaten Fernbereich…', areaInfo: '{w}×{h} Pixel à {px} m · Gelände {lod}',
    farInfo: ' · Fernbereich {km} km à {px} m', day: 'Tag', hoursPct: 'Sonnenstunden {p} %', hoursFor: 'Sonnenstunden für {d}',
    orbitLeft: 'Nach links drehen', orbitRight: 'Nach rechts drehen', tiltUp: 'Zum Horizont kippen', tiltDown: 'Mehr von oben ansehen',
    hint3dTouch: '3D: mit zwei Fingern drehen und kippen – oder die Knöpfe rechts (gedrückt halten).',
    hint3dDesk: '3D: Trackpad mit zwei Fingern drehen · ⇧ + scrollen kippt · ⌥ + scrollen dreht · oder die Knöpfe rechts (gedrückt halten).',
    noGeo: 'Standort nicht verfügbar', locating: 'Suche Standort…', geoErr: 'Standort: {m}',
  },
  en: {
    title: 'Shadows – terrain sun & shade',
    region: 'Region', ch: 'Switzerland', world: 'Worldwide', background: 'Background', map: 'Map', aerial: 'Aerial',
    view3d: '3D view', date: 'Date', today: 'Today', myLocation: 'My location', profileToggle: 'Show/hide profile',
    profile: 'Profile', areaBtn: 'Shadows for view', display: 'Display', modeShadow: 'Shadows', modeHours: 'Sun hours',
    buildings3d: '3D buildings', buildings3dNote: '(swissBUILDINGS3D, 3D only)', trails: 'Hiking trails', surface: 'Forest and buildings', surfaceNote: '(swissSURFACE3D, fine terrain only)',
    worldNote: 'Worldwide: Copernicus elevation model 30 m (surface, forest roughly included) · Map OpenTopoMap',
    hint: 'Tap the map to see the sun times at a place.',
    play: 'Play', time: 'Time of day', closeProfile: 'Hide profile', resetZoom: 'Show whole horizon',
    chartLabel: 'Horizon and sun path', chosenDay: 'selected day', longestDay: 'longest day', shortestDay: 'shortest day',
    longestOn: 'longest day ({d})', shortestOn: 'shortest day ({d})',
    terrain: 'Terrain', trees: 'Forest/trees', buildings: 'Buildings',
    search: 'Search place', searchPh: 'Place, peak, hut, address …', closeSearch: 'Close search',
    searching: 'Searching …', notFound: 'Nothing found', searchDown: 'Search unavailable', language: 'Language',
    error: 'Error: {m}', outsideCH: 'Outside Switzerland: switch to “Worldwide” above.', computing: 'computing…',
    loadingPoint: 'Loading elevation data for the point…', masl: 'm a.s.l.', timesIn: 'times in {tz}',
    sunHM: '{h} h {m} min sun', noSun: 'No direct sun',
    copNote: 'Copernicus 30 m (surface model, forest roughly included)', noSurface: 'without forest and buildings',
    withSurface: 'with forest and buildings',
    aboveCanopy: 'with forest and buildings · view above treetops or roof (surface {h} m above ground)',
    underCanopy: 'with forest and buildings · the point is under trees or next to a building (surface {h} m above ground – raise the height below to look over it)',
    creditsCH: 'Map and elevation data © swisstopo', creditsWorld: 'Elevation: Copernicus DEM GLO-30 © DLR/Airbus, ESA · Map © OpenTopoMap, OpenStreetMap',
    outsideBtn: 'Outside Switzerland', chooseWorld: '→ choose “Worldwide”', infoCH: 'swisstopo, down to 2 m', infoWorld: 'Copernicus 30 m',
    recompute: 'View changed ↻', zoomCloser: 'Zoom in for shadows', shadowBtn: 'Shadows · {lod}', farPart: ' + far range', forest: 'forest',
    near: 'Near', far: 'Far', loadingTiles: '{l}: loading 2 m tiles {n}/{t}…', loadingDem: 'Loading elevation data…',
    loadingDemFar: 'Loading elevation data (far range)…', areaInfo: '{w}×{h} pixels of {px} m · terrain {lod}',
    farInfo: ' · far range {km} km at {px} m', day: 'Day', hoursPct: 'Sun hours {p} %', hoursFor: 'Sun hours for {d}',
    orbitLeft: 'Rotate left', orbitRight: 'Rotate right', tiltUp: 'Tilt toward horizon', tiltDown: 'View more from above',
    hint3dTouch: '3D: rotate and tilt with two fingers – or use the buttons on the right (press and hold).',
    hint3dDesk: '3D: rotate with two fingers on the trackpad · ⇧ + scroll tilts · ⌥ + scroll rotates · or use the buttons on the right (press and hold).',
    noGeo: 'Location not available', locating: 'Finding location…', geoErr: 'Location: {m}',
  },
};

const pick = () => {
  try { const s = JSON.parse(localStorage.getItem('lang')); if (s === 'de' || s === 'en') return s; } catch { }
  return (navigator.language ?? 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
};
export let LANG = pick();
export const LOCALE = () => (LANG === 'de' ? 'de-CH' : 'en-GB');

export function t(key, p = {}) {
  const s = DICT[LANG][key] ?? DICT.de[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? `{${k}}`));
}

/** Sprache setzen (gespeichert) und statische Texte übersetzen. */
export function setLang(l) {
  LANG = l === 'en' ? 'en' : 'de';
  try { localStorage.setItem('lang', JSON.stringify(LANG)); } catch { }
  applyStatic();
}

/** data-i18n (Text), data-i18n-aria, data-i18n-title, data-i18n-ph (Platzhalter) */
export function applyStatic(root = document) {
  document.documentElement.lang = LANG;
  document.title = t('title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
}

export const KEYS = DICT; // für Tests
