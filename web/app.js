// Web-App: Karte (swisstopo), Ort antippen -> Sonnenzeiten; Ausschnitt -> Schatten über den Tag (WebGL).
import { Pyramid } from './lib/tiles.js';
import { loadTerrainLod } from './lib/loaders.js';
import { pointHorizon, litTimeline, intervals } from './lib/horizon.js';
import { sunPositionLv95 } from './lib/sun.js';
import { lv95ToWgs84, wgs84ToLv95 } from './lib/coords.js';
import { mercatorGrid, gridSizeFor } from './lib/area.js';
import { ShadowRenderer } from './lib/gpu.js';

const $ = id => document.getElementById(id);
const R_MAX = 30000, STEP_MIN = 5, MAX_AREA_M = 3200, TZ = 'Europe/Zurich';
const fmtTime = u => new Date(u * 1000).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const status = t => { $('status').textContent = t; };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

// ------------------------------------------------------------ Karte
const start = store.get('view') ?? { lat: 46.9682, lon: 9.0062, z: 15 };
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([start.lat, start.lon], start.z);
L.control.zoom({ position: 'topright' }).addTo(map);
const wmts = (layer, fmt, opts = {}) => L.tileLayer(`https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${fmt}`,
  { maxZoom: 19, maxNativeZoom: 18, attribution: '© <a href="https://www.swisstopo.admin.ch">swisstopo</a>', ...opts });
wmts('ch.swisstopo.pixelkarte-farbe', 'jpeg').addTo(map);
wmts('ch.swisstopo.swisstlm3d-wanderwege', 'png', { opacity: 0.9, attribution: '' }).addTo(map);
map.on('moveend', () => { const c = map.getCenter(); store.set('view', { lat: c.lat, lon: c.lng, z: map.getZoom() }); updateAreaButton(); });

// Leaflet-Ebene, die ein <canvas> statt eines Bildes zeigt (wie L.ImageOverlay)
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage() {
    const el = this._image = this._url;
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if (this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    el.style.imageRendering = 'auto';
    el.onselectstart = L.Util.falseFn; el.onmousemove = L.Util.falseFn;
  },
});

// ------------------------------------------------------------ Datum / Zeiten
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); }
$('date').value = store.get('date') && store.get('dateSet') === todayStr() ? store.get('date') : todayStr();
/** Unix-Sekunden von 00:00 Zürcher Zeit am gewählten Datum */
function dayStart(day) {
  const noon = Date.parse(`${day}T12:00:00Z`) / 1000;
  const h = +new Date(noon * 1000).toLocaleString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit' });
  return noon - 12 * 3600 - (h - 12) * 3600;
}

// ------------------------------------------------------------ Daten
let pyramidP = null;
const pyramid = () => (pyramidP ??= Pyramid.open('./data/pyramid'));

// ------------------------------------------------------------ Punkt
let marker = null, pointTerrain = null;
async function showPoint(lat, lon) {
  const { E, N } = wgs84ToLv95(lat, lon);
  marker ??= L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#d4442e', fillOpacity: 1 }).addTo(map);
  marker.setLatLng([lat, lon]);
  $('hint').hidden = true; $('point').hidden = false;
  $('where').textContent = `${Math.round(E)} / ${Math.round(N)} – rechne…`;
  $('summary').textContent = ''; $('ivs').textContent = ''; $('chart').innerHTML = '';
  expand();
  try {
    let terrain = area?.terrain;
    const inArea = terrain && E > area.grid.bboxLv95[0] && E < area.grid.bboxLv95[2] && N > area.grid.bboxLv95[1] && N < area.grid.bboxLv95[3];
    if (!inArea) {
      status('Lade Höhendaten für den Punkt…');
      terrain = await loadTerrainLod([E - 50, N - 50, E + 50, N + 50], await pyramid(), { rMax: R_MAX });
    }
    const az = Array.from({ length: 1440 }, (_, i) => i * 0.25);
    const h = pointHorizon(terrain, E, N, az, { eye: 1.7, rMax: R_MAX });
    pointTerrain = { E, N, az, h, z: terrain.fine.sample(E, N) };
    renderPoint();
    status('');
  } catch (e) { console.error(e); status('Fehler: ' + e.message); }
}

function renderPoint() {
  if (!pointTerrain) return;
  const { E, N, az, h, z } = pointTerrain, day = $('date').value, t0 = dayStart(day);
  const times = Array.from({ length: 1440 }, (_, i) => t0 + 60 * i);
  const lit = litTimeline(az, h, times, E, N);
  const mins = lit.filter(Boolean).length;
  $('where').textContent = `${Math.round(E)} / ${Math.round(N)}, ${Math.round(z)} m ü. M.`;
  $('summary').textContent = mins ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min Sonne` : 'Keine direkte Sonne';
  $('ivs').innerHTML = intervals(times, lit).map(([a, b]) => `☀︎ ${fmtTime(a)} – ${fmtTime(b)}`).join('<br>');
  drawChart(az, h, times, E, N, lit);
}

function drawChart(az, h, times, E, N, lit) {
  const W = 640, H = 240, L0 = 34, B = 24, T = 8, R = 8;
  const suns = times.map(u => sunPositionLv95(u, E, N));
  const vis = az.map((a, i) => (a >= 45 && a <= 315 ? h[i] : 0));
  const maxEl = Math.ceil((Math.max(30, ...suns.map(s => s.el), ...vis) + 3) / 10) * 10;
  const x = a => L0 + (a - 45) / 270 * (W - L0 - R), y = e => H - B - Math.max(0, e) / maxEl * (H - B - T);
  let d = `M${x(45)},${y(0)}`;
  az.forEach((a, i) => { if (a >= 45 && a <= 315) d += `L${x(a).toFixed(1)},${y(h[i]).toFixed(1)}`; });
  d += `L${x(315)},${y(0)}Z`;
  let path = '', dots = '', ticks = '', axes = '';
  suns.forEach(({ az: a, el }, i) => {
    if (el < -0.5 || a < 45 || a > 315) return;
    path += `${path ? 'L' : 'M'}${x(a).toFixed(1)},${y(el).toFixed(1)}`;
    if (lit[i]) dots += `<circle cx="${x(a).toFixed(1)}" cy="${y(el).toFixed(1)}" r="3" fill="#e8820c"/>`;
    if (i % 60 === 0) ticks += `<text x="${x(a)}" y="${y(el) - 7}" font-size="12" text-anchor="middle" fill="#3d4a42">${i / 60}h</text>`;
  });
  for (const [a, l] of [[90, 'O'], [135, 'SO'], [180, 'S'], [225, 'SW'], [270, 'W']]) axes += `<text x="${x(a)}" y="${H - 6}" font-size="11" text-anchor="middle" fill="#5d6a62">${l}</text>`;
  for (let e = 0; e <= maxEl; e += 10) axes += `<line x1="${L0}" x2="${W - R}" y1="${y(e)}" y2="${y(e)}" stroke="#e6e6e0"/><text x="${L0 - 5}" y="${y(e) + 4}" font-size="10" text-anchor="end" fill="#5d6a62">${e}°</text>`;
  $('chart').innerHTML = `${axes}<path d="${d}" fill="#8a9a78" opacity=".85"/><path d="${path}" fill="none" stroke="#d9822b" stroke-width="1.5" stroke-dasharray="5 3"/>${dots}${ticks}`;
}

map.on('click', e => showPoint(e.latlng.lat, e.latlng.lng));

// ------------------------------------------------------------ Ausschnitt / Schatten
let area = null, renderer = null, overlay = null, suns = [], playing = false, hours = null;

function viewBounds() {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}
function updateAreaButton() {
  const s = gridSizeFor(viewBounds());
  const big = Math.max(s.widthM, s.heightM) > MAX_AREA_M;
  $('area').disabled = big;
  $('area').textContent = big ? 'Für Schatten näher zoomen' : (area ? 'Schatten neu für Ausschnitt' : 'Schatten für Ausschnitt');
}

async function computeArea() {
  const b = viewBounds(), { w, h } = gridSizeFor(b, 3, 900);
  const grid = mercatorGrid(b, w, h);
  $('area').disabled = true;
  try {
    $('area-status').textContent = 'Lade Höhendaten…';
    const terrain = await loadTerrainLod(grid.bboxLv95, await pyramid(), {
      rMax: R_MAX, onProgress: (n, tot) => { $('area-status').textContent = `Lade 2-m-Kacheln ${n}/${tot}…`; },
    });
    $('area-status').textContent = 'Bereite Grafikkarte vor…';
    const canvas = overlay?._image ?? document.createElement('canvas');
    renderer ??= new ShadowRenderer(canvas);
    renderer.setTerrain(terrain, grid.center);
    renderer.setGrid(grid);
    area = { grid, terrain };
    hours = null;
    if (overlay) overlay.setBounds([[b.south, b.west], [b.north, b.east]]);
    else overlay = new CanvasOverlay(canvas, [[b.south, b.west], [b.north, b.east]], { opacity: 1, interactive: false }).addTo(map);
    prepareDay();
    $('area-status').textContent = `${w}×${h} Pixel à ${grid.pixelSize.toFixed(1)} m`;
    $('sheet').classList.add('collapsed'); // Karte freigeben, Zeitschieber bleibt sichtbar
  } catch (e) {
    console.error(e); $('area-status').textContent = 'Fehler: ' + e.message;
  } finally { updateAreaButton(); }
}

function prepareDay() {
  if (!area) return;
  const t0 = dayStart($('date').value), { E, N } = area.grid.center;
  suns = [];
  for (let m = 0; m < 1440; m += STEP_MIN) {
    const u = t0 + 60 * m, s = sunPositionLv95(u, E, N);
    if (s.el > -1) suns.push({ u, ...s });
  }
  $('timebox').hidden = false;
  const tEl = $('time');
  tEl.max = Math.max(0, suns.length - 1);
  const now = Date.now() / 1000;
  const iNow = suns.findIndex(s => s.u >= now);
  tEl.value = iNow > 0 ? iNow : Math.floor(suns.length / 2);
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
      else if (hours.done) renderer.showSunHours(STEP_MIN, mx);
      return;
    }
    const s = suns[+$('time').value];
    if (!s) return;
    renderer.renderShadow(s.az, s.el, { rMax: R_MAX });
    $('timelbl').textContent = fmtTime(s.u);
  });
}

// Sonnenstunden in Paketen pro Bild rechnen, damit die Oberfläche bedienbar bleibt
function computeHours(mx) {
  const job = hours = { done: false, i: 0 };
  renderer.beginSunHours();
  const step = () => {
    if (hours !== job || $('mode').value !== 'hours') { if (hours === job) hours = null; return; }
    const batch = suns.slice(job.i, job.i + 6);
    renderer.addSunHours(batch, { rMax: R_MAX });
    job.i += batch.length;
    renderer.showSunHours(STEP_MIN, mx);
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
    map.setView([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), 15));
    showPoint(p.coords.latitude, p.coords.longitude);
  }, err => status('Standort: ' + err.message), { enableHighAccuracy: true, timeout: 15000 });
};

// Bottom-Sheet ein-/ausklappen
function expand() { $('sheet').classList.remove('collapsed'); }
$('grip').onclick = () => $('sheet').classList.toggle('collapsed');

updateAreaButton();
// Für Tests: Zustand von aussen lesbar
window.__app = { map, get area() { return area; }, get suns() { return suns; }, showPoint, computeArea };
