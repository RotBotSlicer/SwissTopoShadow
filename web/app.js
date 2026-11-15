// Web-App: Karte, Ort antippen -> Sonnenzeiten; Ausschnitt -> Schatten über den Tag (WebGL).
// Zwei Gebiete: Schweiz (swisstopo, hochauflösend, LV95) und Weltweit (Copernicus 30 m, OpenTopoMap, lokale TM).
import { Pyramid } from './lib/tiles.js';
import { loadTerrainLod, lodForPixelSize, withSurface, LOD_DEFAULT } from './lib/loaders.js';
import { loadTerrainWorld, lodWorldForPixelSize } from './lib/copernicus.js';
import { pointHorizon, litTimeline, intervals } from './lib/horizon.js';
import { sunPosition, sunPositionGrid, sunPositionGridGrad } from './lib/sun.js';
import { LV95, localTM } from './lib/coords.js';
import { mercatorGrid, gridSizeFor } from './lib/area.js';
import { ShadowRenderer } from './lib/gpu.js';
import { tzlookup } from 'tz-lookup';
import { MapView } from './mapview.js';
import { heightsCH, heightsWorld, encodeTerrarium } from './lib/demtiles.js';

const $ = id => document.getElementById(id);
// Fehler sichtbar machen (z. B. auf dem Handy ohne Entwicklerwerkzeuge)
const showError = e => { const el = document.getElementById('status'); if (el) el.textContent = `Fehler: ${e?.message ?? e}`; };
window.addEventListener('error', ev => showError(ev.error ?? ev.message));
window.addEventListener('unhandledrejection', ev => showError(ev.reason));
const VERSION = (document.querySelector('meta[name="app-version"]')?.content ?? '').slice(0, 7);
const R_MAX = 30000, STEP_MIN = 5, MAX_AREA_M = 50000, GRID_PX = 900;
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
  return lod.some(l => l.src === 'surface') ? `${base} + Wald` : base;
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
const fmtTime = u => new Date(u * 1000).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const status = t => { $('status').textContent = t; };

// ------------------------------------------------------------ Karte
let base = store.get('base') === 'air' ? 'air' : 'map';
const start = store.get('view') ?? { lat: 46.9682, lon: 9.0062, z: 15 };
const mv = new MapView('map', {
  lat: start.lat, lon: start.lon, zoom: start.z,
  // Höhenkacheln für 3D: Schweiz aus Pyramide/swissALTIRegio (+ feines Gelände des Ausschnitts), sonst Copernicus
  dem: {
    ch: async (z, x, y) => encodeTerrarium(await heightsCH(z, x, y, await pyramid(), area && isCH() ? area.terrain.ground : null)),
    world: async (z, x, y) => encodeTerrarium(await heightsWorld(z, x, y)),
  },
});
mv.onMoveEnd(() => { const c = mv.center(); store.set('view', { lat: c.lat, lon: c.lon, z: mv.zoom() }); updateAreaButton(); });

function applyRegion() {
  mv.setRegion(region);
  $('base-seg').hidden = !isCH();
  mv.setBase(isCH() ? base : 'map');
  $('base-map').setAttribute('aria-checked', String(base === 'map')); $('base-air').setAttribute('aria-checked', String(base === 'air'));
  $('reg-ch').setAttribute('aria-checked', String(isCH())); $('reg-world').setAttribute('aria-checked', String(!isCH()));
  $('surface-row').hidden = !isCH(); $('world-note').hidden = isCH();
  $('credits').innerHTML = isCH()
    ? `Karte und Höhendaten © swisstopo · <a href="https://github.com/RotBotSlicer/SwissTopoShadow">Code</a> · Version ${VERSION}`
    : `Höhen: Copernicus DEM GLO-30 © DLR/Airbus, ESA · Karte © OpenTopoMap, OpenStreetMap · <a href="https://github.com/RotBotSlicer/SwissTopoShadow">Code</a> · Version ${VERSION}`;
  updateAreaButton();
}
function setRegion(r) {
  if (r === region) return;
  region = r; store.set('region', r);
  // Ausschnitt und Punkt gehören zum alten Gebiet
  mv.removeOverlay(); for (const k in renderers) delete renderers[k];
  area = null; $('timebox').hidden = true; $('legend').hidden = true; $('area-status').textContent = '';
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
  if (isCH() && !inCH(lat, lon)) { status('Ausserhalb der Schweiz: oben auf „Weltweit“ umschalten.'); return; }
  setTZ(lat, lon);
  const proj = projFor(lat, lon);
  const { E, N } = proj.fromLatLon(lat, lon);
  mv.setMarker(lat, lon);
  $('hint').hidden = true; $('point').hidden = false;
  $('where').textContent = 'rechne…';
  $('summary').textContent = ''; $('ivs').textContent = ''; $('chart').innerHTML = '';
  expand();
  try {
    let terrain = area?.terrain;
    // Gelände des Ausschnitts nur wiederverwenden, wenn es das feine 2-m-Modell ohne Oberfläche ist
    // (mit Wald lädt der Punkt die Oberfläche zusätzlich in 1 m)
    const inArea = terrain && isCH() && !surfaceOn() && area.lod === LOD_DEFAULT && E > area.grid.bboxLv95[0] && E < area.grid.bboxLv95[2] && N > area.grid.bboxLv95[1] && N < area.grid.bboxLv95[3];
    if (!inArea) {
      status('Lade Höhendaten für den Punkt…');
      if (isCH()) {
        const lod = surfaceOn() ? withSurface(LOD_DEFAULT, { point: true }) : LOD_DEFAULT;
        terrain = await loadTerrainLod([E - 50, N - 50, E + 50, N + 50], await pyramid(), { rMax: R_MAX, lod });
      } else {
        terrain = await loadTerrainWorld([E - 50, N - 50, E + 50, N + 50], proj, { rMax: R_MAX });
      }
    }
    const az = Array.from({ length: 1440 }, (_, i) => i * 0.25);
    const h = pointHorizon(terrain, E, N, az, { eye: 1.7, rMax: R_MAX });
    const z = terrain.ground.sample(E, N), top = terrain.fine.sample(E, N);
    pointTerrain = { E, N, lat, lon, proj, az, h, z, canopy: terrain.groundLevel > 0 ? top - z : null };
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
  $('where').textContent = isCH() ? `${Math.round(E)} / ${Math.round(N)}, ${Math.round(z)} m ü. M.`
    : `${lat.toFixed(5)}, ${lon.toFixed(5)}, ${Math.round(z)} m ü. M. · Zeiten in ${TZ}`;
  $('summary').textContent = mins ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min Sonne` : 'Keine direkte Sonne';
  $('ivs').innerHTML = intervals(times, lit).map(([a, b]) => `☀︎ ${fmtTime(a)} – ${fmtTime(b)}`).join('<br>');
  const cp = pointTerrain.canopy;
  $('canopy').textContent = !isCH() ? 'Copernicus 30 m (Oberflächenmodell, Wald grob enthalten)' : cp == null ? 'ohne Wald und Gebäude'
    : cp > 3 ? `mit Wald und Gebäude · der Punkt liegt unter Bäumen oder an einem Gebäude (Oberfläche ${Math.round(cp)} m über Boden)`
      : 'mit Wald und Gebäude';
  $('psum').textContent = `${$('summary').textContent} · ${intervals(times, lit).map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(', ') || '–'}`;
  drawChart(az, h, times, E, N, lit, proj);
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

let chartGeom = null;
function drawChart(az, h, times, E, N, lit, proj) {
  const W = 640, H = 230, L0 = 30, B = 22, T = 6, R = 6;
  const lat = proj.toLatLon(E, N).lat;
  const center = lat >= 0 ? 180 : 0; // Mitte der Grafik: Süden (Nordhalbkugel) bzw. Norden
  const rel = a => ((a - center + 540) % 360) - 180;
  const year = $('date').value.slice(0, 4), ex = extremeDays(year, E, N, proj);
  const path = day => { const t0 = dayStart(day); return Array.from({ length: 1440 / 2 }, (_, i) => ({ u: t0 + 120 * i, ...sunPositionGrid(t0 + 120 * i, E, N, proj) })); };
  const sLong = path(ex.long), sShort = path(ex.short);
  const suns = times.map(u => sunPositionGrid(u, E, N, proj));
  const up = [...sLong, ...suns].filter(s => s.el > -1).map(s => rel(s.az));
  const r0 = Math.max(-180, Math.min(-90, Math.floor((Math.min(...up) - 8) / 15) * 15));
  const r1 = Math.min(180, Math.max(90, Math.ceil((Math.max(...up) + 8) / 15) * 15));
  const vis = az.map((a, i) => (rel(a) >= r0 && rel(a) <= r1 ? h[i] : 0));
  const maxEl = Math.ceil((Math.max(30, ...sLong.map(s => s.el), ...vis) + 3) / 10) * 10;
  const x = r => L0 + (r - r0) / (r1 - r0) * (W - L0 - R), y = e => H - B - Math.max(0, e) / maxEl * (H - B - T);
  chartGeom = { x, y, rel, E, N, proj };
  // Horizont (nach relativem Azimut sortiert)
  const hz = az.map((a, i) => [rel(a), h[i]]).filter(([r]) => r >= r0 && r <= r1).sort((p, q) => p[0] - q[0]);
  let d = `M${x(r0)},${y(0)}`; hz.forEach(([r, v]) => { d += `L${x(r).toFixed(1)},${y(v).toFixed(1)}`; }); d += `L${x(r1)},${y(0)}Z`;
  const line = list => { let s = '', prev = null; list.forEach(p => { if (p.el < -0.5) { prev = null; return; } const r = rel(p.az); const pt = `${x(r).toFixed(1)},${y(p.el).toFixed(1)}`; s += (prev === null || Math.abs(r - prev) > 90 ? 'M' : 'L') + pt; prev = r; }); return s; };
  let dots = '', ticks = '', axes = '';
  suns.forEach((p, i) => {
    if (p.el < -0.5) return;
    const r = rel(p.az);
    if (r < r0 || r > r1) return;
    if (lit[i] && i % 3 === 0) dots += `<circle cx="${x(r).toFixed(1)}" cy="${y(p.el).toFixed(1)}" r="2.6" fill="#e8820c"/>`;
    if (i % 60 === 0) ticks += `<text x="${x(r)}" y="${y(p.el) - 6}" font-size="11" text-anchor="middle" fill="#3d4a42">${fmtTime(p.u ?? times[i]).slice(0, 2)}h</text>`;
  });
  const names = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (const [a, l] of Object.entries(names)) { const r = rel(+a); if (r >= r0 && r <= r1) axes += `<text x="${x(r)}" y="${H - 5}" font-size="11" text-anchor="middle" fill="#5d6a62">${l}</text>`; }
  for (let e = 0; e <= maxEl; e += 10) axes += `<line x1="${L0}" x2="${W - R}" y1="${y(e)}" y2="${y(e)}" stroke="#e6e6e0"/><text x="${L0 - 4}" y="${y(e) + 4}" font-size="10" text-anchor="end" fill="#5d6a62">${e}°</text>`;
  $('chart').innerHTML = `${axes}<path d="${d}" fill="#8a9a78" opacity=".85"/>`
    + `<path d="${line(sLong)}" fill="none" stroke="#c9a227" stroke-width="1.4" stroke-dasharray="4 3"/>`
    + `<path d="${line(sShort)}" fill="none" stroke="#5a7fb0" stroke-width="1.4" stroke-dasharray="4 3"/>`
    + `<path d="${line(suns)}" fill="none" stroke="#d9822b" stroke-width="1.6"/>${dots}${ticks}<g id="nowmark"></g>`;
  const fd = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('de-CH', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  $('lg-day').textContent = fd($('date').value); $('lg-sum').textContent = `längster Tag (${fd(ex.long)})`; $('lg-win').textContent = `kürzester Tag (${fd(ex.short)})`;
  updateProfileVisibility();
}

/** Markiert den Sonnenstand zur Zeit u (Zeitschieber) im Profil. */
function markProfile(u) {
  const g = document.getElementById('nowmark');
  if (!g || !chartGeom) return;
  const { x, y, rel, E, N, proj } = chartGeom, s = sunPositionGrid(u, E, N, proj);
  g.innerHTML = s.el > -0.5 ? `<line x1="${x(rel(s.az))}" x2="${x(rel(s.az))}" y1="${y(0)}" y2="${y(s.el)}" stroke="#d4442e" stroke-width="1" stroke-dasharray="2 2"/><circle cx="${x(rel(s.az))}" cy="${y(s.el)}" r="5" fill="none" stroke="#d4442e" stroke-width="2"/>` : '';
}

mv.onClick((lat, lon) => showPoint(lat, lon));

// ------------------------------------------------------------ Ausschnitt / Schatten
// Ein Ausschnitt besteht aus 1–2 Ebenen: 'near' (fein, im 2D der ganze Ausschnitt) und in schräger 3D-Ansicht
// zusätzlich 'far' (grob, ganzer sichtbarer Boden bis zum Horizont, unter near liegend, mit Loch unter near).
let area = null, suns = [], playing = false, hours = null, selectedMinute = null;
const renderers = {}; // id -> ShadowRenderer (werden wiederverwendet)

const viewBounds = () => mv.nearBounds();
const minPx = () => (isCH() ? 3 : 10); // weltweit: Daten 30 m, feinere Pixel bringen nichts
const FAR_MIN_PX = 20;
function viewProj() { const c = mv.center(); return projFor(c.lat, c.lon); }
const farLod = px => (isCH() ? lodForPixelSize(px) : lodWorldForPixelSize(px)); // fern: ohne Wald/Gebäude
function updateAreaButton() {
  if (!$('area')) return;
  const c = mv.center();
  if (isCH() && !inCH(c.lat, c.lon)) {
    $('area').disabled = true; $('area').textContent = 'Ausserhalb der Schweiz';
    $('region-info').textContent = '→ „Weltweit“ wählen'; return;
  }
  $('region-info').textContent = isCH() ? 'swisstopo, bis 2 m' : 'Copernicus 30 m';
  const b = viewBounds(), s = gridSizeFor(b, minPx(), GRID_PX, viewProj());
  const big = Math.max(s.widthM, s.heightM) > MAX_AREA_M;
  const px = Math.max(s.widthM / s.w, s.heightM / s.h);
  $('area').disabled = big;
  $('area').textContent = big ? 'Für Schatten näher zoomen'
    : `Schatten · ${lodName(areaLod(px))}${wantFar(b) ? ' + Fernbereich' : ''}`;
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

async function loadLayer(id, b, proj, targetPx, lodOf, label) {
  const { w, h } = gridSizeFor(b, targetPx, GRID_PX, proj);
  const grid = mercatorGrid(b, w, h, proj), lod = lodOf(grid.pixelSize);
  const terrain = isCH()
    ? await loadTerrainLod(grid.bboxLv95, await pyramid(), {
      rMax: R_MAX, lod, onProgress: (n, tot) => { $('area-status').textContent = `${label}: lade 2-m-Kacheln ${n}/${tot}…`; },
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
    $('area-status').textContent = 'Lade Höhendaten…';
    const near = await loadLayer('near', b, proj, minPx(), areaLod, 'Nah');
    const layers = [near];
    if (farB) {
      $('area-status').textContent = 'Lade Höhendaten Fernbereich…';
      const far = await loadLayer('far', farB, proj, FAR_MIN_PX, farLod, 'Fern');
      far.renderer.setHole(holeRect(farB, b, far.grid.w, far.grid.h));
      layers.unshift(far); // zuerst (unten) zeichnen
    }
    area = { layers, near, proj, tz: TZ, grid: near.grid, terrain: near.terrain, lod: near.lod };
    hours = null;
    mv.removeOverlay();
    for (const L of layers) await mv.setOverlay(L.id, L.renderer.canvas, L.b);
    prepareDay();
    const g = near.grid, fr = layers.length > 1 ? layers[0] : null;
    $('area-status').textContent = `${g.w}×${g.h} Pixel à ${g.pixelSize.toFixed(1)} m · Gelände ${lodName(near.lod)}`
      + (fr ? ` · Fernbereich ${(Math.max(fr.grid.w * fr.grid.pixelSize, fr.grid.h * fr.grid.pixelSize) / 1000).toFixed(0)} km à ${fr.grid.pixelSize.toFixed(0)} m` : '');
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
      $('timelbl').textContent = 'Tag';
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
    $('area-status').textContent = job.i < suns.length ? `Sonnenstunden ${Math.round(100 * job.i / suns.length)} %` : `Sonnenstunden für ${$('date').value}`;
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
$('ptoggle').setAttribute('aria-pressed', String(store.get('profile') ?? true));
$('ptoggle').onclick = () => setProfile(!profileOn());
$('pclose').onclick = () => setProfile(false);
$('reg-ch').onclick = () => setRegion('ch');
$('base-map').onclick = () => { base = 'map'; store.set('base', base); applyRegion(); };
$('base-air').onclick = () => { base = 'air'; store.set('base', base); applyRegion(); };
$('t3d').onclick = () => {
  const on = $('t3d').getAttribute('aria-pressed') !== 'true';
  $('t3d').setAttribute('aria-pressed', String(on)); mv.set3D(on); updateAreaButton();
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
  if (!navigator.geolocation) return status('Standort nicht verfügbar');
  status('Suche Standort…');
  navigator.geolocation.getCurrentPosition(p => {
    mv.setView(p.coords.latitude, p.coords.longitude, Math.max(mv.zoom(), 15));
    showPoint(p.coords.latitude, p.coords.longitude);
  }, err => status('Standort: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
};

// Bottom-Sheet ein-/ausklappen
function expand() { $('sheet').classList.remove('collapsed'); }
$('grip').onclick = () => $('sheet').classList.toggle('collapsed');

applyRegion();
// Für Tests: Zustand von aussen lesbar
window.__app = { mv, setView: (lat, lon, z) => mv.setView(lat, lon, z), get area() { return area; }, get suns() { return suns; }, get point() { return pointTerrain; }, showPoint, computeArea, setRegion };
