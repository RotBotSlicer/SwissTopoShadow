// Kartenansicht auf Basis von MapLibre GL (2D, später 3D).
// Kapselt alles Kartenspezifische, damit app.js nur mit Breite/Länge und einfachen Aufrufen arbeitet.
// Zoomstufen nach aussen wie bei 256-Pixel-Kacheln (Leaflet/OSM-Zählung); MapLibre zählt intern um 1 tiefer.
/* global maplibregl */

const SWISSTOPO = l => `https://wmts.geo.admin.ch/1.0.0/${l}/default/current/3857/{z}/{x}/{y}.${l.includes('wanderwege') ? 'png' : 'jpeg'}`;
const ATTR_CH = '© <a href="https://www.swisstopo.admin.ch">swisstopo</a>';
const ATTR_OTM = 'Karte © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM';

export class MapView {
  constructor(container, { lat, lon, zoom }) {
    this.map = new maplibregl.Map({
      container, center: [lon, lat], zoom: zoom - 1, maxPitch: 80, attributionControl: { compact: true },
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
      style: {
        version: 8,
        sources: {
          lk: { type: 'raster', tiles: [SWISSTOPO('ch.swisstopo.pixelkarte-farbe')], tileSize: 256, maxzoom: 18, attribution: ATTR_CH },
          luft: { type: 'raster', tiles: [SWISSTOPO('ch.swisstopo.swissimage')], tileSize: 256, maxzoom: 19, attribution: ATTR_CH },
          wander: { type: 'raster', tiles: [SWISSTOPO('ch.swisstopo.swisstlm3d-wanderwege')], tileSize: 256, maxzoom: 18 },
          otm: { type: 'raster', tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), tileSize: 256, maxzoom: 17, attribution: ATTR_OTM },
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
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.ready = new Promise(r => this.map.on('load', r));
    this.region = 'ch'; this.base = 'map';
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

  onClick(cb) { this.map.on('click', e => cb(e.lngLat.lat, e.lngLat.lng)); }
  onMoveEnd(cb) { this.map.on('moveend', cb); }

  // ---------------------------------------------------------------- Ebenen
  setRegion(region) { this.region = region; this._applyLayers(); }
  setBase(base) { this.base = base; this._applyLayers(); }
  async _applyLayers() {
    await this.ready;
    const ch = this.region === 'ch', vis = (id, on) => this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('lk', ch && this.base === 'map'); vis('luft', ch && this.base === 'air'); vis('wander', ch); vis('otm', !ch);
  }

  setMarker(lat, lon) {
    if (!this.marker) {
      const el = document.createElement('div');
      el.className = 'pt-marker';
      this.marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map);
    } else this.marker.setLngLat([lon, lat]);
  }

  // ---------------------------------------------------------------- Schattenebene (WebGL-Canvas als Kartenquelle)
  /** canvas: Zeichenfläche des ShadowRenderer; b: {south, west, north, east} (Web-Mercator-Pixelgitter) */
  async setOverlay(canvas, b) {
    await this.ready;
    const coords = [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]];
    this.removeOverlay();
    this.map.addSource('shadow', { type: 'canvas', canvas, coordinates: coords, animate: false });
    this.map.addLayer({ id: 'shadow', type: 'raster', source: 'shadow', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
    this.overlay = this.map.getSource('shadow');
    this.overlayChanged();
  }
  removeOverlay() {
    if (this.map.getLayer('shadow')) this.map.removeLayer('shadow');
    if (this.map.getSource('shadow')) this.map.removeSource('shadow');
    this.overlay = null;
  }
  /** Nach jedem Neuzeichnen des Canvas aufrufen: Inhalt in die Karte übernehmen. */
  overlayChanged() {
    const s = this.overlay;
    if (!s) return;
    s.play();
    cancelAnimationFrame(this._pause);
    this._pause = requestAnimationFrame(() => { this._pause = requestAnimationFrame(() => s.pause()); });
  }
}
