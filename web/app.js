// Web-App: Karte, Ort antippen -> Sonnenzeiten; Ausschnitt -> Schatten über den Tag (WebGL).
// Zwei Gebiete: Schweiz (swisstopo, hochauflösend, LV95) und Weltweit (Copernicus 30 m, OpenTopoMap, lokale TM).
import { Pyramid } from './lib/tiles.js';
import { loadTerrainLod, lodForPixelSize, withSurface, LOD_DEFAULT } from './lib/loaders.js';
import { loadTerrainWorld, lodWorldForPixelSize } from './lib/copernicus.js';
import { pointHorizonDetail, litTimeline, intervals } from './lib/horizon.js';
import { loadBuildingMask } from './lib/buildings.js';
import { searchPlaces } from './lib/search.js';
import { sunPosition, sunPositionGrid, sunPositionGridGrad } from './lib/sun.js';
import { LV95, localTM } from './lib/coords.js';
import { mercatorGrid, gridSizeFor } from './lib/area.js';
import { ShadowRenderer } from './lib/gpu.js';
import { tzlookup } from 'tz-lookup';
import { MapView } from './mapview.js';
import { heightsCH, heightsWorld, encodeTerrarium } from './lib/demtiles.js';
import { t, setLang, applyStatic, LANG, LOCALE } from './i18n.js';
applyStatic();

const $ = id => document.getElementById(id);
// Fehler sichtbar machen (z. B. auf dem Handy ohne Entwicklerwerkzeuge)
const showError = e => { const el = document.getElementById('status'); if (el) el.textContent = t('error', { m: e?.message ?? e }); };
window.addEventListener('error', ev => showError(ev.error ?? ev.message));
window.addEventListener('unhandledrejection', ev => showError(ev.reason));
const VERSION = (document.querySelector('meta[name="app-version"]')?.content ?? '').slice(0, 7);
const R_MAX = 30000, STEP_MIN = 5, MAX_AREA_M = 50000, GRID_PX = 900, GRID_PX_NEAR3D = 1400;
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

// ------------------------------------------------------------ Gebiet
let region = store.get('region') === 'world' ? 'world' : 'ch';
const isCH = () => region === 'ch';
// grobe Umgebung der Schweiz (swisstopo-Daten vorhanden); ausserhalb -> Weltweit nötig
const inCH = (lat, lon) => lat > 45.8 && lat < 47.85 && lon > 5.9 && lon < 10.55;
/** Projektion für einen Ort: Schweiz LV95, sonst lokale Transversale Mercator um den Ort */
const projFor = (lat, lon) => (isCH() ? LV95 : localTM(+lat.toFixed(4), +lon.toFixed(4)));
const lodName = lod => {
  if (!isCH()) return `${lod[0].res} m`;
  const g = lod.find(l => l.ground) ?? lod[0];
  const base = g.src === 'alti3d' ? '2 m' : g.src === 'regio' ? '10 m' : `${g.res} m`;
  return lod.some(l => l.src === 'surface') ? `${base} + ${t('forest')}` : base;
};
const surfaceOn = () => isCH() && $('surface').checked;
/** Gelände-Schema für einen Ausschnitt mit Pixelgrösse px (Wald/Gebäude nur Schweiz und feines Gelände) */
const areaLod = px => {
  if (!isCH()) return lodWorldForPixelSize(px);
  const l = lodForPixelSize(px); return surfaceOn() ? withSurface(l) : l;
};

// Zeitzone: Schweiz fix, weltweit aus der Lage (Ausschnitt-Mitte bzw. Punkt)
let TZ = 'Europe/Zurich';
const setTZ = (lat, lon) => { TZ = isCH() ? 'Europe/Zurich' : (tzlookup(lat, lon) || 'UTC'); };
const fmtTime = u => new Date(u * 1000).toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const status = t => { $('status').textContent = t; };
/** Kurzer Hinweis über der Karte (verschwindet nach einigen Sekunden oder beim Antippen). */
function toast(text, ms = 7000) {
  const el = $('toast'); el.textContent = text; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
  el.onclick = () => { el.hidden = true; };
}

// ------------------------------------------------------------ Karte
let base = store.get('base') === 'air' ? 'air' : 'map';
const start = store.get('view') ?? { lat: 45.9700, lon: 7.6586, z: 13 }; // erster Besuch: Matterhorn (etwas südlich, damit der Gipfel über dem Menü in der Mitte steht)
const mv = new MapView('map', {
  lat: start.lat, lon: start.lon, zoom: start.z,
  // Höhenkacheln für 3D: Schweiz aus Pyramide/swissALTIRegio (+ feines Gelände des Ausschnitts), sonst Copernicus
  dem: {
    ch: async (z, x, y) => encodeTerrarium(await heightsCH(z, x, y, await pyramid(), area && isCH() ? area.terrain.ground : null)),
    world: async (z, x, y) => encodeTerrarium(await heightsWorld(z, x, y)),
  },
});
applyStatic(); // Texte der Kartenknöpfe (3D-Steuerung)
mv.onMoveEnd(() => { const c = mv.center(); store.set('view', { lat: c.lat, lon: c.lon, z: mv.zoom() }); updateAreaButton(); });

function applyRegion() {
  mv.setRegion(region);
  $('base-seg').hidden = !isCH();
  mv.setBase(isCH() ? base : 'map');
  $('base-map').setAttribute('aria-checked', String(base === 'map')); $('base-air').setAttribute('aria-checked', String(base === 'air'));
  $('reg-ch').setAttribute('aria-checked', String(isCH())); $('reg-world').setAttribute('aria-checked', String(!isCH()));
  $('surface-row').hidden = !isCH(); $('trails-row').hidden = !isCH(); if (typeof applyBuildings === 'function') applyBuildings(); $('world-note').hidden = isCH();
  $('credits').innerHTML = isCH()
    ? `${t('creditsCH')} · <a href="https://github.com/RotBotSlicer/SwissTopoShadow">Code</a> · Version ${VERSION}`
    : `${t('creditsWorld')} · <a href="https://github.com/RotBotSlicer/SwissTopoShadow">Code</a> · Version ${VERSION}`;
  updateAreaButton();
}
function setRegion(r) {
  if (r === region) return;
  region = r; store.set('region', r);
  // Ausschnitt und Punkt gehören zum alten Gebiet
  mv.removeOverlay(); for (const k in renderers) delete renderers[k];
  area = null; chartMarkU = null; $('timebox').hidden = true; $('legend').hidden = true; $('area-status').textContent = '';
  applyRegion();
  if (pointTerrain) showPoint(pointTerrain.lat, pointTerrain.lon);
}

// ------------------------------------------------------------ Datum / Zeiten
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); }
$('date').value = store.get('date') && store.get('dateSet') === todayStr() ? store.get('date') : todayStr();
/** Versatz der Zeitzone TZ zu UTC [s] zum Zeitpunkt unix */
function tzOffset(unix) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(unix * 1000)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000) - unix;
}
/** Unix-Sekunden von 00:00 Ortszeit (TZ) am gewählten Datum */
function dayStart(day) {
  const midUtc = Date.parse(`${day}T00:00:00Z`) / 1000;
  return midUtc - tzOffset(midUtc + 12 * 3600);
}

// ------------------------------------------------------------ Daten
let pyramidP = null;
const pyramid = () => (pyramidP ??= Pyramid.open('./data/pyramid'));

// ------------------------------------------------------------ Punkt
let pointTerrain = null;
async function showPoint(lat, lon) {
  if (isCH() && !inCH(lat, lon)) { status(t('outsideCH')); return; }
  store.set('point', { lat, lon }); // beim nächsten Öffnen wieder anzeigen
  setTZ(lat, lon);
  const proj = projFor(lat, lon);
  const { E, N } = proj.fromLatLon(lat, lon);
  mv.setMarker(lat, lon);
  $('hint').hidden = true; $('point').hidden = false;
  $('where').textContent = t('computing');
  $('summary').textContent = ''; $('ivs').textContent = ''; $('chart').innerHTML = '';
  expand();
  try {
    let terrain = area?.terrain;
    // Gelände des Ausschnitts nur wiederverwenden, wenn es das feine 2-m-Modell ohne Oberfläche ist
    // (mit Wald lädt der Punkt die Oberfläche zusätzlich in 1 m)
    const inArea = terrain && isCH() && !surfaceOn() && area.lod === LOD_DEFAULT && E > area.grid.bboxLv95[0] && E < area.grid.bboxLv95[2] && N > area.grid.bboxLv95[1] && N < area.grid.bboxLv95[3];
    if (!inArea) {
      status(t('loadingPoint'));
      if (isCH()) {
        const lod = surfaceOn() ? withSurface(LOD_DEFAULT, { point: true }) : LOD_DEFAULT;
        terrain = await loadTerrainLod([E - 50, N - 50, E + 50, N + 50], await pyramid(), { rMax: R_MAX, lod });
      } else {
        terrain = await loadTerrainWorld([E - 50, N - 50, E + 50, N + 50], proj, { rMax: R_MAX });
      }
    }
    const az = Array.from({ length: 1440 }, (_, i) => i * 0.25);
    const det = pointHorizonDetail(terrain, E, N, az, { eye: 1.7, rMax: R_MAX });
    const h = det.h;
    // Was bestimmt den Horizont? 0 Gelände, 1 Wald/Bäume, 2 Gebäude (nur mit Oberflächenmodell)
    const cls = new Uint8Array(az.length);
    if (terrain.groundLevel > 0) {
      const reach = terrain.levels[terrain.groundLevel - 1].until + 50;
      const bm = await loadBuildingMask([E - reach, N - reach, E + reach, N + reach]).catch(() => null);
      for (let k = 0; k < az.length; k++) {
        if (det.hitObj[k] > 2 && h[k] - det.bare[k] > 0.05) cls[k] = bm?.near(det.hitE[k], det.hitN[k]) ? 2 : 1;
      }
    }
    const z = terrain.ground.sample(E, N), top = terrain.fine.sample(E, N);
    pointTerrain = { E, N, lat, lon, proj, az, h, bare: det.bare, cls, z, canopy: terrain.groundLevel > 0 ? top - z : null };
    renderPoint();
    status('');
  } catch (e) { console.error(e); status('Fehler: ' + e.message); }
}

function renderPoint() {
  if (!pointTerrain) return;
  const { E, N, lat, lon, proj, az, h, z } = pointTerrain, day = $('date').value;
  setTZ(lat, lon);
  const t0 = dayStart(day);
  const times = Array.from({ length: 1440 }, (_, i) => t0 + 60 * i);
  const lit = litTimeline(az, h, times, E, N, proj);
  const mins = lit.filter(Boolean).length;
  $('where').textContent = isCH() ? `${Math.round(E)} / ${Math.round(N)}, ${Math.round(z)} ${t('masl')}`
    : `${lat.toFixed(5)}, ${lon.toFixed(5)}, ${Math.round(z)} ${t('masl')} · ${t('timesIn', { tz: TZ })}`;
  $('summary').textContent = mins ? t('sunHM', { h: Math.floor(mins / 60), m: String(mins % 60).padStart(2, '0') }) : t('noSun');
  $('ivs').innerHTML = intervals(times, lit).map(([a, b]) => `☀︎ ${fmtTime(a)} – ${fmtTime(b)}`).join('<br>');
  const cp = pointTerrain.canopy;
  $('canopy').textContent = !isCH() ? t('copNote') : cp == null ? t('noSurface')
    : cp > 3 ? t('underCanopy', { h: Math.round(cp) }) : t('withSurface');
  $('psum').textContent = `${$('summary').textContent} · ${intervals(times, lit).map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ') || '–'}`;
  drawChart(az, h, times, E, N, lit, proj, pointTerrain);
}

// ------------------------------------------------------------ Profil (Horizont + Sonnenbahnen)
const profileOn = () => $('ptoggle').getAttribute('aria-pressed') === 'true';
function setProfile(on) {
  $('ptoggle').setAttribute('aria-pressed', String(on)); store.set('profile', on);
  updateProfileVisibility();
}
function updateProfileVisibility() {
  const show = profileOn() && !!pointTerrain;
  $('profile').hidden = !show;
  document.body.classList.toggle('has-profile', show);
  if (show) document.body.style.setProperty('--ph', `${$('profile').offsetHeight}px`);
}

/** Tage mit längstem und kürzestem Tag im Jahr des gewählten Datums (am Ort, nach Tageslänge). */
function extremeDays(year, E, N, proj) {
  const len = day => {
    const t0 = dayStart(day); let n = 0;
    for (let m = 0; m < 1440; m += 10) if (sunPositionGrid(t0 + 60 * m, E, N, proj).el > -0.833) n++;
    return n;
  };
  // Sonnenwende = Tag mit extremer Deklination (ortsunabhängig): Sonnenhöhe am Nordpol ≈ Deklination
  const scan = mon => {
    let best = null;
    for (let d = 16; d <= 26; d++) {
      const day = `${year}-${mon}-${String(d).padStart(2, '0')}`;
      const decl = sunPosition(Date.parse(`${day}T12:00:00Z`) / 1000, 90, 0, false).el;
      if (!best || (mon === '06' ? decl > best.decl : decl < best.decl)) best = { day, decl };
    }
    return best.day;
  };
  const jun = scan('06'), dec = scan('12');
  return len(jun) >= len(dec) ? { long: jun, short: dec } : { long: dec, short: jun }; // Südhalbkugel: umgekehrt
}

let chartGeom = null, chartData = null, chartView = null, chartMarkU = null;
const CW = 640, CH_ = 230, CL = 30, CB = 22, CT = 6, CR = 6; // Grafikmasse (viewBox) und Ränder

/** Daten fürs Profil vorbereiten (teuer), danach renderChart (bei Zoom/Verschieben nur dieses). */
function drawChart(az, h, times, E, N, lit, proj, pt = {}) {
  const lat = proj.toLatLon(E, N).lat;
  const center = lat >= 0 ? 180 : 0; // Mitte der Grafik: Süden (Nordhalbkugel) bzw. Norden
  const rel = a => ((a - center + 540) % 360) - 180;
  const year = $('date').value.slice(0, 4), ex = extremeDays(year, E, N, proj);
  const path = day => { const t0 = dayStart(day); return Array.from({ length: 1440 / 2 }, (_, i) => ({ u: t0 + 120 * i, ...sunPositionGrid(t0 + 120 * i, E, N, proj) })); };
  const sLong = path(ex.long), sShort = path(ex.short);
  const suns = times.map(u => ({ u, ...sunPositionGrid(u, E, N, proj) }));
  const up = [...sLong, ...suns].filter(s => s.el > -1).map(s => rel(s.az));
  const r0 = Math.max(-180, Math.min(-90, Math.floor((Math.min(...up) - 8) / 15) * 15));
  const r1 = Math.min(180, Math.max(90, Math.ceil((Math.max(...up) + 8) / 15) * 15));
  const vis = az.map((a, i) => (rel(a) >= r0 && rel(a) <= r1 ? h[i] : 0));
  const maxEl = Math.ceil((Math.max(30, ...sLong.map(s => s.el), ...vis) + 3) / 10) * 10;
  // Horizont nach relativem Azimut sortiert: [r, h, Gelände allein, Klasse]
  const bare = pt.bare ?? h, cls = pt.cls ?? new Uint8Array(az.length);
  const hz = az.map((a, i) => [rel(a), h[i], bare[i], cls[i]]).sort((p, q) => p[0] - q[0]);
  hz.unshift([hz[hz.length - 1][0] - 360, ...hz[hz.length - 1].slice(1)]); hz.push([hz[1][0] + 360, ...hz[1].slice(1)]); // Rand schliessen
  chartData = { rel, center, r0, r1, maxEl, hz, sLong, sShort, suns, lit, E, N, proj };
  chartView = null;
  renderChart();
  const fd = day => new Date(`${day}T12:00:00Z`).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const has = k => hz.some(p => p[3] === k && p[0] >= r0 && p[0] <= r1);
  $('lg-obj').innerHTML = `<span class="sw sw-ter"></span>${t('terrain')}`
    + (has(1) ? `<span class="sw sw-tree"></span>${t('trees')}` : '') + (has(2) ? `<span class="sw sw-bld"></span>${t('buildings')}` : '');
  $('lg-day').textContent = fd($('date').value); $('lg-sum').textContent = t('longestOn', { d: fd(ex.long) }); $('lg-win').textContent = t('shortestOn', { d: fd(ex.short) });
  updateProfileVisibility();
}

/** Sichtbarer Bereich: ganzer Bereich, oder gezoomt {k, ca, ce} (Faktor, Mitte Azimut/Höhe) – im Rahmen gehalten. */
function chartRange() {
  const { r0, r1, maxEl } = chartData;
  if (!chartView) return { a0: r0, a1: r1, e0: 0, e1: maxEl, k: 1 };
  const k = chartView.k, sa = (r1 - r0) / k, se = maxEl / k;
  const ca = Math.min(r1 - sa / 2, Math.max(r0 + sa / 2, chartView.ca)), ce = Math.min(maxEl - se / 2, Math.max(se / 2, chartView.ce));
  chartView.ca = ca; chartView.ce = ce;
  return { a0: ca - sa / 2, a1: ca + sa / 2, e0: ce - se / 2, e1: ce + se / 2, k };
}

function renderChart() {
  if (!chartData) return;
  const { rel, center, hz, sLong, sShort, suns, lit, E, N, proj } = chartData;
  const { a0, a1, e0, e1, k } = chartRange();
  const W = CW, H = CH_, L0 = CL, B = CB, T = CT, R = CR;
  const x = r => L0 + (r - a0) / (a1 - a0) * (W - L0 - R), y = e => H - B - (e - e0) / (e1 - e0) * (H - B - T);
  chartGeom = { x, y, rel, E, N, proj, e0 };
  const inA = r => r >= a0 - 2 && r <= a1 + 2;
  const P = (r, v) => `${x(r).toFixed(1)},${y(v).toFixed(1)}`;
  const vz = hz.filter(p => inA(p[0])), yb = y(e0) + 2;
  let d = vz.length ? `M${x(vz[0][0]).toFixed(1)},${yb}` : '';
  vz.forEach(([r, , b]) => { d += `L${P(r, b)}`; }); if (vz.length) d += `L${x(vz[vz.length - 1][0]).toFixed(1)},${yb}Z`;
  // Grau: Gelände allein; darüber farbig, was Wald/Bäume (grün) bzw. Gebäude (rot) zusätzlich verdecken
  const objPaths = { 1: '', 2: '' }, half = 0.125;
  for (let i = 0; i < vz.length;) {
    const c = vz[i][3];
    if (!c) { i++; continue; }
    let j = i; while (j + 1 < vz.length && vz[j + 1][3] === c) j++;
    const run = vz.slice(i, j + 1), ra = run[0][0] - half, rb = run[run.length - 1][0] + half;
    objPaths[c] += `M${P(ra, run[0][2])}L${P(ra, run[0][1])}` + run.map(([r, v]) => `L${P(r, v)}`).join('')
      + `L${P(rb, run[run.length - 1][1])}L${P(rb, run[run.length - 1][2])}` + [...run].reverse().map(([r, , b]) => `L${P(r, b)}`).join('') + 'Z';
    i = j + 1;
  }
  const line = list => { let s = '', prev = null; list.forEach(p => { if (p.el < -0.5) { prev = null; return; } const r = rel(p.az); s += (prev === null || Math.abs(r - prev) > 90 ? 'M' : 'L') + P(r, p.el); prev = r; }); return s; };
  // Sonnenpunkte und Zeitmarken: gezoomt dichter (stündlich → viertelstündlich → alle 5 min)
  const tStep = k >= 8 ? 5 : k >= 3 ? 15 : 60, dStep = k >= 3 ? 1 : 3;
  let dots = '', ticks = '', axes = '';
  suns.forEach((p, i) => {
    if (p.el < -0.5) return;
    const r = rel(p.az);
    if (r < a0 || r > a1 || p.el < e0 || p.el > e1) return;
    if (lit[i] && i % dStep === 0) dots += `<circle cx="${x(r).toFixed(1)}" cy="${y(p.el).toFixed(1)}" r="2.6" fill="#e8820c"/>`;
    if (i % tStep === 0) ticks += `<text x="${x(r).toFixed(1)}" y="${(y(p.el) - 6).toFixed(1)}" font-size="11" text-anchor="middle" fill="#3d4a42">${tStep === 60 ? fmtTime(p.u).slice(0, 2) + 'h' : fmtTime(p.u)}</text>`;
  });
  // Achsen: Himmelsrichtungen, gezoomt zusätzlich Grad
  const names = LANG === 'de' ? { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
    : { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  const aStep = [45, 15, 10, 5, 2, 1].find(s => (a1 - a0) / s >= 4) ?? 1;
  for (let r = Math.ceil(a0 / aStep) * aStep; r <= a1; r += aStep) {
    const az = ((r + center) % 360 + 360) % 360;
    const lab = names[az] ?? (aStep < 45 ? `${az}°` : null);
    if (lab) axes += `<text x="${x(r).toFixed(1)}" y="${H - 5}" font-size="11" text-anchor="middle" fill="#5d6a62">${lab}</text>`;
  }
  const eStep = [10, 5, 2, 1, 0.5].find(s => (e1 - e0) / s >= 3) ?? 0.5;
  for (let ev = Math.ceil(e0 / eStep) * eStep; ev <= e1 + 1e-9; ev += eStep) {
    axes += `<line x1="${L0}" x2="${W - R}" y1="${y(ev).toFixed(1)}" y2="${y(ev).toFixed(1)}" stroke="#e6e6e0"/><text x="${L0 - 4}" y="${(y(ev) + 4).toFixed(1)}" font-size="10" text-anchor="end" fill="#5d6a62">${+ev.toFixed(1)}°</text>`;
  }
  $('chart').innerHTML = `<defs><clipPath id="plotclip"><rect x="${L0}" y="0" width="${W - L0 - R}" height="${H - B}"/></clipPath></defs>${axes}`
    + `<g clip-path="url(#plotclip)"><path d="${d}" fill="#9b9d96" opacity=".85"/>`
    + `<path d="${objPaths[1]}" fill="#5f9a4e" opacity=".9"/><path d="${objPaths[2]}" fill="#c8473a" opacity=".9"/>`
    + `<path d="${line(sLong)}" fill="none" stroke="#c9a227" stroke-width="1.4" stroke-dasharray="4 3"/>`
    + `<path d="${line(sShort)}" fill="none" stroke="#5a7fb0" stroke-width="1.4" stroke-dasharray="4 3"/>`
    + `<path d="${line(suns)}" fill="none" stroke="#d9822b" stroke-width="1.6"/>${dots}${ticks}<g id="nowmark"></g></g>`;
  $('preset').hidden = !chartView;
  if (chartMarkU !== null) markProfile(chartMarkU);
}

// Zoomen im Profil: zwei Finger (Pinch), Mausrad; mit einem Finger verschieben; Doppeltipp oder ⟲ = ganzer Bereich
{
  const svg = $('chart'), pts = new Map();
  let start = null, lastTap = 0, tap = null;
  const toData = (cx, cy) => { // Bildschirm -> Azimut/Höhe im aktuellen Bereich
    const b = svg.getBoundingClientRect(), { a0, a1, e0, e1 } = chartRange();
    const sx = (cx - b.left) / b.width * CW, sy = (cy - b.top) / b.height * CH_;
    return { a: a0 + (sx - CL) / (CW - CL - CR) * (a1 - a0), e: e0 + (CH_ - CB - sy) / (CH_ - CB - CT) * (e1 - e0) };
  };
  const zoomAt = (k, cx, cy, ref) => { // Faktor k, Punkt ref (Daten) bleibt unter (cx, cy)
    const { r0, r1, maxEl } = chartData;
    k = Math.min((r1 - r0) / 3, Math.max(1, k));
    if (k <= 1.001) { chartView = null; renderChart(); return; }
    chartView = { k, ca: 0, ce: 0 };
    const b = svg.getBoundingClientRect(), sx = (cx - b.left) / b.width * CW, sy = (cy - b.top) / b.height * CH_;
    const fa = (sx - CL) / (CW - CL - CR), fe = (CH_ - CB - sy) / (CH_ - CB - CT);
    chartView.ca = ref.a - (fa - 0.5) * (r1 - r0) / k; chartView.ce = ref.e - (fe - 0.5) * maxEl / k;
    renderChart();
  };
  const reset = () => { chartView = null; renderChart(); };
  svg.style.touchAction = 'none';
  svg.addEventListener('pointerdown', ev => {
    if (!chartData) return;
    svg.setPointerCapture(ev.pointerId); pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    tap = pts.size === 1 ? { t: Date.now(), x: ev.clientX, y: ev.clientY } : null; // Doppeltipp erkennen
    const p = [...pts.values()], k = chartView?.k ?? 1;
    if (p.length === 2) {
      const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2;
      start = { mode: 'pinch', k, dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, ref: toData(cx, cy) };
    } else if (p.length === 1) start = { mode: 'pan', ref: toData(p[0].x, p[0].y) };
  });
  svg.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId) || !start) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const p = [...pts.values()];
    if (start.mode === 'pinch' && p.length === 2) {
      const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      zoomAt(start.k * dist / start.dist, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, start.ref);
    } else if (start.mode === 'pan' && p.length === 1 && chartView) {
      zoomAt(chartView.k, p[0].x, p[0].y, start.ref);
    }
  });
  const up = ev => {
    pts.delete(ev.pointerId);
    if (tap && !pts.size && Date.now() - tap.t < 250 && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) < 8) {
      if (Date.now() - lastTap < 350) { reset(); lastTap = 0; } else lastTap = Date.now();
    }
    if (pts.size) tap = null;
    const p = [...pts.values()];
    start = p.length === 1 ? { mode: 'pan', ref: toData(p[0].x, p[0].y) } : null; // nach Pinch mit einem Finger weiter verschieben
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', ev => {
    if (!chartData) return;
    ev.preventDefault();
    zoomAt((chartView?.k ?? 1) * Math.exp(-ev.deltaY * 0.002), ev.clientX, ev.clientY, toData(ev.clientX, ev.clientY));
  }, { passive: false });
  $('preset').onclick = reset;
}

/** Markiert den Sonnenstand zur Zeit u (Zeitschieber) im Profil. */
function markProfile(u) {
  const g = document.getElementById('nowmark');
  chartMarkU = u;
  if (!g || !chartGeom) return;
  const { x, y, rel, E, N, proj, e0 } = chartGeom, s = sunPositionGrid(u, E, N, proj);
  g.innerHTML = s.el > -0.5 ? `<line x1="${x(rel(s.az))}" x2="${x(rel(s.az))}" y1="${y(Math.max(0, e0))}" y2="${y(s.el)}" stroke="#d4442e" stroke-width="1" stroke-dasharray="2 2"/><circle cx="${x(rel(s.az))}" cy="${y(s.el)}" r="5" fill="none" stroke="#d4442e" stroke-width="2"/>` : '';
}

mv.onClick((lat, lon) => showPoint(lat, lon));

// ------------------------------------------------------------ Ausschnitt / Schatten
// Ein Ausschnitt besteht aus 1–2 Ebenen: 'near' (fein, im 2D der ganze Ausschnitt) und in schräger 3D-Ansicht
// zusätzlich 'far' (grob, ganzer sichtbarer Boden bis zum Horizont, unter near liegend, mit Loch unter near).
let area = null, suns = [], playing = false, hours = null, selectedMinute = null;
const renderers = {}; // id -> ShadowRenderer (werden wiederverwendet)

/** Feiner Bereich. In 3D möglichst weit (bis 2.5 km hinter dem unteren Bildrand), aber nur so weit, dass die Pixel
 *  höchstens 4 m gross bleiben – sonst fielen Wald und Gebäude (2-m-Oberflächenmodell) weg. */
function viewBounds() {
  if (!mv.is3D || mv.map.getPitch() < 1) return mv.nearBounds();
  let b;
  for (const reach of [2500, 1800, 1200, 800]) {
    b = mv.nearBounds(reach);
    const s = gridSizeFor(b, minPx(), gridPx(), viewProj());
    if (Math.max(s.widthM / s.w, s.heightM / s.h) <= 4) break;
  }
  return b;
}
const gridPx = () => (mv.is3D && mv.map.getPitch() >= 1 ? GRID_PX_NEAR3D : GRID_PX);
const minPx = () => (isCH() ? 3 : 10); // weltweit: Daten 30 m, feinere Pixel bringen nichts
const FAR_MIN_PX = 20;
function viewProj() { const c = mv.center(); return projFor(c.lat, c.lon); }
const farLod = px => (isCH() ? lodForPixelSize(px) : lodWorldForPixelSize(px)); // fern: ohne Wald/Gebäude
function updateAreaButton() {
  if (!$('area')) return;
  const c = mv.center();
  if (isCH() && !inCH(c.lat, c.lon)) {
    $('area').disabled = true; $('area').textContent = t('outsideBtn');
    $('region-info').textContent = t('chooseWorld'); return;
  }
  $('region-info').textContent = isCH() ? t('infoCH') : t('infoWorld');
  const b = viewBounds(), s = gridSizeFor(b, minPx(), gridPx(), viewProj());
  const big = Math.max(s.widthM, s.heightM) > MAX_AREA_M;
  const px = Math.max(s.widthM / s.w, s.heightM / s.h);
  $('area').disabled = big;
  const stale = !big && area && !viewCovered();
  $('area').textContent = big ? t('zoomCloser')
    : (stale ? t('recompute') + ' · ' : '') + t('shadowBtn', { lod: lodName(areaLod(px)) }) + (wantFar(b) ? t('farPart') : '');
  $('area').classList.toggle('stale', !!stale);
}
/** Deckt der gerechnete Schatten die aktuelle Ansicht ab? (Stichproben des sichtbaren Bodens) */
function viewCovered() {
  if (!area) return false;
  const v = mv.viewBounds(), pts = mv.is3D && mv.map.getPitch() >= 1 ? mv._footprint(0.15, 1, R_MAX)
    : [0, 0.5, 1].flatMap(i => [0, 0.5, 1].map(j => ({ lat: v.south + (v.north - v.south) * i, lng: v.west + (v.east - v.west) * j })));
  if (!pts.length) return true;
  const inside = p => area.layers.some(({ b }) => p.lat >= b.south - 1e-4 && p.lat <= b.north + 1e-4 && p.lng >= b.west - 1e-4 && p.lng <= b.east + 1e-4);
  return pts.filter(inside).length >= 0.9 * pts.length;
}
/** Fernbereich nur, wenn die 3D-Ansicht deutlich mehr Boden zeigt als der feine Bereich. */
function wantFar(near) {
  if (!mv.is3D || mv.map.getPitch() < 15) return null;
  const far = mv.farBounds(near, R_MAX);
  const f = (b) => (b.north - b.south) * (b.east - b.west);
  return f(far) > 1.5 * f(near) ? far : null;
}
const mercX = lon => (lon + 180) / 360;
const mercY = lat => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
/** Pixelrechteck von inner im Gitter outer (beide Web-Mercator), 1 Pixel nach innen versetzt. */
function holeRect(outer, inner, w, h) {
  const x = lon => (mercX(lon) - mercX(outer.west)) / (mercX(outer.east) - mercX(outer.west)) * w;
  const y = lat => (mercY(lat) - mercY(outer.north)) / (mercY(outer.south) - mercY(outer.north)) * h;
  return { c0: Math.ceil(x(inner.west)) + 1, c1: Math.floor(x(inner.east)) - 1, r0: Math.ceil(y(inner.north)) + 1, r1: Math.floor(y(inner.south)) - 1 };
}

async function loadLayer(id, b, proj, targetPx, lodOf, label, maxPx = GRID_PX) {
  const { w, h } = gridSizeFor(b, targetPx, maxPx, proj);
  const grid = mercatorGrid(b, w, h, proj), lod = lodOf(grid.pixelSize);
  const terrain = isCH()
    ? await loadTerrainLod(grid.bboxLv95, await pyramid(), {
      rMax: R_MAX, lod, onProgress: (n, tot) => { $('area-status').textContent = t('loadingTiles', { l: label, n, t: tot }); },
    })
    : await loadTerrainWorld(grid.bboxLv95, proj, { rMax: R_MAX, lod });
  const r = renderers[id] ??= new ShadowRenderer(document.createElement('canvas'));
  r.setTerrain(terrain, grid.center);
  r.setGrid(grid);
  r.setHole(null);
  return { id, b, grid, terrain, lod, renderer: r, suns: [] };
}

async function computeArea() {
  const b = viewBounds(), proj = viewProj(), farB = wantFar(b);
  const c = mv.center(); setTZ(c.lat, c.lon);
  $('area').disabled = true;
  try {
    $('area-status').textContent = t('loadingDem');
    const near = await loadLayer('near', b, proj, minPx(), areaLod, t('near'), gridPx());
    const layers = [near];
    if (farB) {
      $('area-status').textContent = t('loadingDemFar');
      const far = await loadLayer('far', farB, proj, FAR_MIN_PX, farLod, t('far'));
      far.renderer.setHole(holeRect(farB, b, far.grid.w, far.grid.h));
      layers.unshift(far); // zuerst (unten) zeichnen
    }
    area = { layers, near, proj, tz: TZ, grid: near.grid, terrain: near.terrain, lod: near.lod };
    hours = null;
    mv.removeOverlay();
    for (const L of layers) await mv.setOverlay(L.id, L.renderer.canvas, L.b);
    await mv.setOutline([layers[0].b]); // nur die äussere Grenze (Fernbereich, sonst der einzige Bereich)
    prepareDay();
    const g = near.grid, fr = layers.length > 1 ? layers[0] : null;
    area.statusText = () => t('areaInfo', { w: g.w, h: g.h, px: g.pixelSize.toFixed(1), lod: lodName(near.lod) })
      + (fr ? t('farInfo', { km: (Math.max(fr.grid.w * fr.grid.pixelSize, fr.grid.h * fr.grid.pixelSize) / 1000).toFixed(0), px: fr.grid.pixelSize.toFixed(0) }) : '');
    $('area-status').textContent = area.statusText();
    $('sheet').classList.add('collapsed'); // Karte freigeben, Zeitschieber bleibt sichtbar
  } catch (e) {
    console.error(e); $('area-status').textContent = 'Fehler: ' + e.message;
  } finally { updateAreaButton(); }
}

function prepareDay() {
  if (!area) return;
  TZ = area.tz;
  const t0 = dayStart($('date').value), { E, N } = area.near.grid.center;
  suns = [];
  for (const L of area.layers) L.suns = [];
  for (let m = 0; m < 1440; m += STEP_MIN) {
    const u = t0 + 60 * m, s = sunPositionGridGrad(u, E, N, area.proj);
    if (s.el > -1.5) {
      suns.push({ u, ...s });
      // gleiche Zeitschritte für alle Ebenen, Sonnenrichtung je Ebenenmitte
      for (const L of area.layers) {
        L.suns.push(L === area.near ? { u, ...s } : { u, ...sunPositionGridGrad(u, L.grid.center.E, L.grid.center.N, area.proj) });
      }
    }
  }
  $('timebox').hidden = false;
  const tEl = $('time');
  tEl.max = Math.max(0, suns.length - 1);
  // gleiche Uhrzeit wie bisher beibehalten, sonst jetzt, sonst Mittag
  const keep = selectedMinute ?? ((Date.now() / 1000 - t0) / 60);
  const i = suns.findIndex(s => (s.u - t0) / 60 >= keep);
  tEl.value = i > 0 ? i : Math.floor(suns.length / 2);
  hours = null;
  draw();
}

let pending = false;
function draw() {
  if (pending || !area) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const mode = $('mode').value;
    $('legend').hidden = mode !== 'hours';
    if (mode === 'hours') {
      $('timelbl').textContent = t('day');
      const mx = suns.length * STEP_MIN / 60;
      $('legend').innerHTML = `<span>0 h</span><span class="ramp" style="background:linear-gradient(90deg,#29337a,#338c8c,#f2d94d,#ed731a)"></span><span>${mx.toFixed(1)} h</span>`;
      if (hours === null) computeHours(mx);
      else if (hours.done) { for (const L of area.layers) L.renderer.showSunHours(STEP_MIN, mx); mv.overlayChanged(); }
      return;
    }
    const i = +$('time').value, s = suns[i];
    if (!s) return;
    TZ = area.tz;
    for (const L of area.layers) { const t = L.suns[i]; L.renderer.renderShadow(t.az, t.el, { rMax: R_MAX, grad: t.grad }); }
    mv.overlayChanged();
    selectedMinute = (s.u - dayStart($('date').value)) / 60;
    $('timelbl').textContent = fmtTime(s.u);
    if (pointTerrain) { const tz = TZ; markProfile(s.u); TZ = tz; }
  });
}

// Sonnenstunden in Paketen pro Bild rechnen, damit die Oberfläche bedienbar bleibt
function computeHours(mx) {
  const job = hours = { done: false, i: 0 };
  for (const L of area.layers) L.renderer.beginSunHours();
  const step = () => {
    if (hours !== job || $('mode').value !== 'hours') { if (hours === job) hours = null; return; }
    const n = Math.min(6, suns.length - job.i);
    for (const L of area.layers) {
      L.renderer.addSunHours(L.suns.slice(job.i, job.i + n), { rMax: R_MAX });
      L.renderer.showSunHours(STEP_MIN, mx);
    }
    job.i += n;
    mv.overlayChanged();
    $('area-status').textContent = job.i < suns.length ? t('hoursPct', { p: Math.round(100 * job.i / suns.length) }) : t('hoursFor', { d: $('date').value });
    if (job.i < suns.length) requestAnimationFrame(step); else job.done = true;
  };
  requestAnimationFrame(step);
}

function play() {
  if (!playing) return;
  const t = $('time');
  t.value = (+t.value + 1) % (+t.max + 1);
  draw();
  setTimeout(play, 120);
}

$('area').onclick = computeArea;
$('time').oninput = () => { if ($('mode').value !== 'shadow') $('mode').value = 'shadow'; draw(); };
$('mode').onchange = draw;
$('surface').checked = store.get('surface') ?? true;
// 3D-Gebäude (Prototyp): nur Schweiz und nur in 3D; Bibliothek wird erst beim Einschalten geladen
var buildings = null; // var: applyRegion ruft applyBuildings schon vor dieser Zeile auf
async function applyBuildings() {
  $('bld-row').hidden = !(isCH() && mv.is3D);
  const want = $('bld').checked && isCH() && mv.is3D;
  if (!want && !buildings) return;
  if (!buildings) { const { Buildings } = await import('./buildings3d.js'); buildings ??= new Buildings(mv.map); }
  try { await buildings.set(want); } catch (e) { console.error(e); status(t('error', { m: e.message })); }
}
$('bld').checked = store.get('buildings3d') ?? true;
$('bld').onchange = () => { store.set('buildings3d', $('bld').checked); applyBuildings(); };
$('trails').checked = store.get('trails') ?? true;
mv.setTrails($('trails').checked);
$('trails').onchange = () => { store.set('trails', $('trails').checked); mv.setTrails($('trails').checked); };
$('ptoggle').setAttribute('aria-pressed', String(store.get('profile') ?? true));
$('ptoggle').onclick = () => setProfile(!profileOn());
$('pclose').onclick = () => setProfile(false);
$('reg-ch').onclick = () => setRegion('ch');
$('base-map').onclick = () => { base = 'map'; store.set('base', base); applyRegion(); };
$('base-air').onclick = () => { base = 'air'; store.set('base', base); applyRegion(); };
$('t3d').onclick = () => {
  const on = $('t3d').getAttribute('aria-pressed') !== 'true';
  $('t3d').setAttribute('aria-pressed', String(on)); mv.set3D(on).then(applyBuildings); updateAreaButton();
  if (on) toast(t(matchMedia('(pointer: fine)').matches ? 'hint3dDesk' : 'hint3dTouch'));
};
$('reg-world').onclick = () => setRegion('world');
$('surface').onchange = () => {
  store.set('surface', surfaceOn());
  updateAreaButton();
  if (area) computeArea();
  if (pointTerrain) showPoint(pointTerrain.lat, pointTerrain.lon); // gleiche Koordinaten, kein Umrechnungsfehler
};
$('play').onclick = () => {
  playing = !playing; $('play').textContent = playing ? '❚❚' : '▶';
  if (playing) { $('mode').value = 'shadow'; play(); }
};
$('date').onchange = () => { store.set('date', $('date').value); store.set('dateSet', todayStr()); prepareDay(); renderPoint(); };
$('today').onclick = () => { $('date').value = todayStr(); $('date').onchange(); };
$('locate').onclick = () => {
  if (!navigator.geolocation) return status(t('noGeo'));
  status(t('locating'));
  navigator.geolocation.getCurrentPosition(p => {
    mv.setView(p.coords.latitude, p.coords.longitude, Math.max(mv.zoom(), 15));
    showPoint(p.coords.latitude, p.coords.longitude);
  }, err => status(t('geoErr', { m: err.message })), { enableHighAccuracy: true, timeout: 15000 });
};

// Bottom-Sheet ein-/ausklappen
function expand() { $('sheet').classList.remove('collapsed'); }
$('grip').onclick = () => $('sheet').classList.toggle('collapsed');

applyRegion();
// Für Tests: Zustand von aussen lesbar
// ------------------------------------------------------------ Ortssuche
{
  const box = $('search'), q = $('sq'), list = $('sres'), info = $('sinfo');
  let results = [], ctrl = null, timer = null;
  const open = () => { box.hidden = false; q.focus(); q.select(); };
  const close = () => { box.hidden = true; ctrl?.abort(); clearTimeout(timer); };
  const render = () => {
    list.replaceChildren(...results.map((r, i) => {
      const li = document.createElement('li'), n = document.createElement('div'), d = document.createElement('div');
      li.setAttribute('role', 'option'); if (i === 0) li.className = 'sel';
      n.className = 'sn'; n.textContent = r.name;
      d.className = 'sd'; d.textContent = [r.kind, r.detail].filter(Boolean).join(' · ');
      li.append(n, d); li.onclick = () => choose(r);
      return li;
    }));
  };
  async function run() {
    ctrl?.abort(); ctrl = new AbortController();
    const text = q.value;
    if (text.trim().length < 2) { results = []; render(); info.textContent = ''; return; }
    info.textContent = t('searching');
    try {
      const c = mv.center();
      results = await searchPlaces(text, { region, lang: LANG, near: { lat: c.lat, lon: c.lon }, signal: ctrl.signal });
      if (text !== q.value) return;
      render();
      info.textContent = results.length ? '' : t('notFound');
    } catch (e) {
      if (e.name !== 'AbortError') { info.textContent = t('searchDown'); console.error(e); }
    }
  }
  function choose(r) {
    close();
    if (isCH() && !r.ch) { pointTerrain = null; setRegion('world'); } // Ort ausserhalb: auf weltweit wechseln
    mv.setView(r.lat, r.lon, r.zoom);
    showPoint(r.lat, r.lon);
  }
  $('sbtn').onclick = open;
  $('sclose').onclick = close;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run().then(() => { if (results[0] && !box.hidden) choose(results[0]); }); }
  });
}

// ------------------------------------------------------------ Sprache
function showLang() {
  $('lang-de').setAttribute('aria-checked', String(LANG === 'de')); $('lang-en').setAttribute('aria-checked', String(LANG === 'en'));
}
function switchLang(l) {
  if (l === LANG) return;
  setLang(l); showLang();
  applyRegion(); // Quellenangabe, Knopf Ausschnitt
  if (pointTerrain) renderPoint(); else if (chartData) renderChart();
  if (area?.statusText && !hours) $('area-status').textContent = area.statusText();
  if (area) { hours = hours?.done ? hours : null; draw(); }
}
$('lang-de').onclick = () => switchLang('de');
$('lang-en').onclick = () => switchLang('en');
showLang();

// Zuletzt angetippten Punkt wiederherstellen (Karte steht schon an der letzten Stelle)
{
  const p0 = store.get('point');
  if (p0 && Number.isFinite(p0.lat) && Number.isFinite(p0.lon)) mv.ready.then(() => showPoint(p0.lat, p0.lon));
}

window.__app = { mv, setView: (lat, lon, z) => mv.setView(lat, lon, z), get area() { return area; }, get suns() { return suns; }, get point() { return pointTerrain; }, showPoint, computeArea, setRegion };
