// Kartenansicht auf Basis von MapLibre GL (2D, später 3D).
// Kapselt alles Kartenspezifische, damit app.js nur mit Breite/Länge und einfachen Aufrufen arbeitet.
// Zoomstufen nach aussen wie bei 256-Pixel-Kacheln (Leaflet/OSM-Zählung); MapLibre zählt intern um 1 tiefer.
/* global maplibregl */

const SWISSTOPO = l => `https://wmts.geo.admin.ch/1.0.0/${l}/default/current/3857/{z}/{x}/{y}.${l.includes('wanderwege') ? 'png' : 'jpeg'}`;
const ATTR_CH = '© <a href="https://www.swisstopo.admin.ch">swisstopo</a>';
const ATTR_OTM = '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM';

/** Terrarium-RGBA (256×256) -> PNG-Bytes für MapLibre. */
async function toPng(rgba) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').putImageData(new ImageData(rgba, 256, 256), 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return blob.arrayBuffer();
}

export class MapView {
  /** dem: { ch(z,x,y), world(z,x,y) } -> Promise<Uint8ClampedArray> (Terrarium-RGBA) für die 3D-Ansicht */
  constructor(container, { lat, lon, zoom, dem }) {
    for (const [name, fn] of Object.entries(dem ?? {})) {
      maplibregl.addProtocol(`dem${name}`, async params => {
        const [z, x, y] = params.url.split('://')[1].split('/').map(Number);
        return { data: await toPng(await fn(z, x, y)) };
      });
    }
    this.map = new maplibregl.Map({
      container, center: [lon, lat], zoom: zoom - 1, attributionControl: { compact: true },
      dragRotate: false, touchPitch: false, maxPitch: 0,
      style: {
        version: 8,
        sources: {
          lk: { type: 'raster', tiles: [SWISSTOPO('ch.swisstopo.pixelkarte-farbe')], tileSize: 256, maxzoom: 18, attribution: ATTR_CH },
          luft: { type: 'raster', tiles: [SWISSTOPO('ch.swisstopo.swissimage')], tileSize: 256, maxzoom: 19, attribution: ATTR_CH },
          wander: { type: 'raster', tiles: [SWISSTOPO('ch.swisstopo.swisstlm3d-wanderwege')], tileSize: 256, maxzoom: 18 },
          otm: { type: 'raster', tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 17, attribution: ATTR_OTM },
          'dem-ch': { type: 'raster-dem', tiles: ['demch://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 14 },
          'dem-world': { type: 'raster-dem', tiles: ['demworld://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 12 },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#e8e6df' } },
          { id: 'lk', type: 'raster', source: 'lk' },
          { id: 'luft', type: 'raster', source: 'luft', layout: { visibility: 'none' } },
          { id: 'otm', type: 'raster', source: 'otm', layout: { visibility: 'none' } },
          { id: 'wander', type: 'raster', source: 'wander', minzoom: 12, paint: { 'raster-opacity': 0.9 } },
        ],
      },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    this.ready = new Promise(r => this.map.on('load', r));
    // 3D: Kameramitte auf das Gelände setzen und die Kamera nie im Berg stehen lassen
    this.map.on('moveend', () => this._fixCamera());
    this.map.on('idle', () => this._fixCamera());
    this.region = 'ch'; this.base = 'map'; this.is3D = false;
    this.marker = null; this.overlay = null;
  }

  // ---------------------------------------------------------------- Ansicht
  center() { const c = this.map.getCenter(); return { lat: c.lat, lon: c.lng }; }
  zoom() { return this.map.getZoom() + 1; }
  setView(lat, lon, zoom = this.zoom()) { this.map.jumpTo({ center: [lon, lat], zoom: zoom - 1 }); }

  /** Sichtbares Rechteck (bei gekippter 3D-Ansicht: Rechteck um die Mitte, wie die Draufsicht es zeigen würde). */
  viewBounds() {
    const m = this.map;
    if (m.getPitch() < 1 && Math.abs(m.getBearing()) < 1) {
      const b = m.getBounds();
      return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    }
    const c = m.getCenter(), z = m.getZoom(), cv = m.getCanvas();
    const w = cv.clientWidth, h = cv.clientHeight, ws = 512 * 2 ** z;
    const x = (c.lng + 180) / 360 * ws, y = (1 - Math.log(Math.tan(Math.PI / 4 + c.lat * Math.PI / 360)) / Math.PI) / 2 * ws;
    const lon = px => px / ws * 360 - 180, lat = py => Math.atan(Math.sinh(Math.PI * (1 - 2 * py / ws))) * 180 / Math.PI;
    return { south: lat(y + h / 2), north: lat(y - h / 2), west: lon(x - w / 2), east: lon(x + w / 2) };
  }

  /** Boden-Punkte unter einem Raster von Bildschirmpunkten (Zeilen yFrom..yTo als Anteil der Höhe). */
  _footprint(yFrom, yTo, maxDistM = 120000) {
    const m = this.map, cv = m.getCanvas(), w = cv.clientWidth, h = cv.clientHeight, c = m.getCenter(), pts = [];
    for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
      const p = m.unproject([w * i / 8, h * (yFrom + (yTo - yFrom) * j / 8)]);
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      if (c.distanceTo(p) > maxDistM) continue;
      pts.push(p);
    }
    return pts;
  }
  static _bbox(pts) {
    return { south: Math.min(...pts.map(p => p.lat)), north: Math.max(...pts.map(p => p.lat)), west: Math.min(...pts.map(p => p.lng)), east: Math.max(...pts.map(p => p.lng)) };
  }
  /** 3D: feiner Bereich = Boden unter der unteren Bildhälfte (nahe Kamera). */
  nearBounds() {
    if (!this.is3D || this.map.getPitch() < 1) return this.viewBounds();
    const pts = this._footprint(0.5, 1);
    return pts.length > 3 ? MapView._bbox(pts) : this.viewBounds();
  }
  /** 3D: grober Bereich = ganzer sichtbarer Boden bis zum Horizont, höchstens ±halfM um die Mitte von near. */
  farBounds(near, halfM = 30000) {
    const pts = this._footprint(0.0, 1, 150000);
    const b = pts.length > 3 ? MapView._bbox(pts) : near;
    const lat0 = (near.south + near.north) / 2, lon0 = (near.west + near.east) / 2;
    const dLat = halfM / 111320, dLon = halfM / (111320 * Math.cos(lat0 * Math.PI / 180));
    return {
      south: Math.max(Math.min(b.south, near.south), lat0 - dLat), north: Math.min(Math.max(b.north, near.north), lat0 + dLat),
      west: Math.max(Math.min(b.west, near.west), lon0 - dLon), east: Math.min(Math.max(b.east, near.east), lon0 + dLon),
    };
  }

  onClick(cb) { this.map.on('click', e => cb(e.lngLat.lat, e.lngLat.lng)); }
  onMoveEnd(cb) { this.map.on('moveend', cb); }

  // ---------------------------------------------------------------- Ebenen
  setRegion(region) { this.region = region; this._applyLayers(); if (this.is3D) this._applyTerrain(); }
  setBase(base) { this.base = base; this._applyLayers(); }
  async _applyLayers() {
    await this.ready;
    const ch = this.region === 'ch', vis = (id, on) => this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('lk', ch && this.base === 'map'); vis('luft', ch && this.base === 'air'); vis('wander', ch); vis('otm', !ch);
  }

  // ---------------------------------------------------------------- 3D
  async set3D(on) {
    await this.ready;
    this.is3D = on;
    const m = this.map;
    for (const h of [m.dragRotate, m.touchPitch]) on ? h.enable() : h.disable();
    on ? m.touchZoomRotate.enableRotation() : m.touchZoomRotate.disableRotation();
    m.setMaxPitch(on ? 80 : 0);
    this._applyTerrain();
    m.easeTo(on ? { pitch: 60, duration: 800 } : { pitch: 0, bearing: 0, duration: 500 });
  }
  _fixCamera() {
    const m = this.map, t = m.transform;
    if (!this.is3D || !m.getTerrain() || this._fixing) return;
    this._fixing = true;
    try {
      const e = m.queryTerrainElevation(m.getCenter());
      if (e != null && Math.abs(m.getCenterElevation() - e) > 5) m.setCenterElevation(e);
      for (let i = 0; i < 14; i++) {
        const g = m.queryTerrainElevation(t.getCameraLngLat());
        if (g == null || t.getCameraAltitude() > g + 80) break;
        m.jumpTo({ pitch: Math.max(0, m.getPitch() - 5) });
      }
    } finally { this._fixing = false; }
  }
  _applyTerrain() {
    const m = this.map;
    if (!this.is3D) { m.setTerrain(null); return; }
    m.setTerrain({ source: this.region === 'ch' ? 'dem-ch' : 'dem-world', exaggeration: 1 });
    m.setSky({ 'sky-color': '#a9c8ec', 'horizon-color': '#e8eef4', 'fog-color': '#e8eef4', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.85 });
  }

  setMarker(lat, lon) {
    if (!this.marker) {
      const el = document.createElement('div');
      el.className = 'pt-marker';
      this.marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map);
    } else this.marker.setLngLat([lon, lat]);
  }

  // ---------------------------------------------------------------- Schattenebenen (WebGL-Canvas als Kartenquelle)
  // Mehrere Ebenen möglich (3D: 'far' grob bis zum Horizont, darüber 'near' fein). Reihenfolge = Aufrufreihenfolge.
  /** canvas: Zeichenfläche eines ShadowRenderer; b: {south, west, north, east} (Web-Mercator-Pixelgitter) */
  async setOverlay(id, canvas, b) {
    await this.ready;
    this.overlays ??= new Map();
    const coords = [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]];
    this.removeOverlay(id);
    const sid = `shadow-${id}`;
    this.map.addSource(sid, { type: 'canvas', canvas, coordinates: coords, animate: false });
    this.map.addLayer({ id: sid, type: 'raster', source: sid, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
    this.overlays.set(id, this.map.getSource(sid));
    this.overlayChanged(id);
  }
  /** Ebene id entfernen (ohne id: alle). */
  removeOverlay(id) {
    for (const k of id ? [id] : [...(this.overlays?.keys() ?? [])]) {
      const sid = `shadow-${k}`;
      if (this.map.getLayer(sid)) this.map.removeLayer(sid);
      if (this.map.getSource(sid)) this.map.removeSource(sid);
      this.overlays?.delete(k);
    }
  }
  /** Nach jedem Neuzeichnen aufrufen (ohne id: alle Ebenen): Inhalt in die Karte übernehmen.
   *  play/pause lädt das Canvas neu in die Textur. In 3D zeichnet MapLibre das Gelände über einen
   *  Zwischenspeicher (render to texture), der davon nichts merkt – setCoordinates meldet die Quelle als
   *  geändert, damit dieser Zwischenspeicher neu gezeichnet wird. */
  overlayChanged(id) {
    for (const [k, s] of this.overlays ?? []) {
      if (id && k !== id) continue;
      s.play();
      if (this.is3D) s.setCoordinates(s.coordinates);
      clearTimeout(s._pauseT);
      s._pauseT = setTimeout(() => s.pause(), 250);
    }
  }
}
