// 3D-Gebäude der Schweiz (swissBUILDINGS3D als 3D Tiles von swisstopo), gezeichnet mit deck.gl in der MapLibre-Karte.
// Wird erst geladen, wenn die Gebäude eingeschaltet werden (deck.gl ist gross).
// Höhen: Die Kacheln enthalten Gebrauchshöhen (über Meer) als Ellipsoidhöhe – passt direkt zu unserem Gelände.

export const BUILDINGS_URL = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json';
const MIN_ZOOM = 13; // MapLibre-Zoom: darunter keine Gebäude (zu viele, zu klein)

let lib = null;
async function load() {
  lib ??= import(new URL('./vendor/deck/deck-tiles.js', import.meta.url).href);
  return lib;
}

export class Buildings {
  constructor(map) { this.map = map; this.overlay = null; this.on = false; }

  async set(on) {
    this.on = on;
    if (!on) { this._apply(); return; }
    if (!this.overlay) {
      const { MapboxOverlay, Tile3DLayer, Tiles3DLoader } = await load();
      const libs = new URL('./vendor/deck/', import.meta.url).href;
      this.layer = props => new Tile3DLayer({
        id: 'buildings3d', data: BUILDINGS_URL, loader: Tiles3DLoader, pickable: false,
        loadOptions: {
          worker: false, // Draco lokal dekodieren, keine Worker/Bibliotheken vom CDN
          modules: { 'draco_wasm_wrapper.js': libs + 'draco_wasm_wrapper.js', 'draco_decoder.wasm': libs + 'draco_decoder.wasm' },
          '3d-tiles': { loadGLTF: true },
          // weniger und gröber laden: schont Speicher (Handy) – ferne Häuser sind ohnehin klein
          tileset: { maximumScreenSpaceError: 24, maximumMemoryUsage: 96, viewDistanceScale: 1.5 },
        },
        onTileError: e => console.warn('Gebäude-Kachel', e?.message ?? e),
        ...props,
      });
      this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      this.map.addControl(this.overlay);
      this.map.on('zoomend', () => this._apply());
    }
    this._apply();
  }

  _apply() {
    if (!this.overlay) return;
    const vis = this.on && this.map.getZoom() >= MIN_ZOOM;
    this.overlay.setProps({ layers: [this.layer({ visible: vis })] });
  }
}
