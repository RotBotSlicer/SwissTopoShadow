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
      const { MapboxOverlay, Tile3DLayer, Tiles3DLoader, LightingEffect, AmbientLight, DirectionalLight } = await load();
      this.light = { LightingEffect, AmbientLight, DirectionalLight };
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
      this._applyLight();
      this.map.on('zoomend', () => this._apply());
    }
    this._apply();
  }

  /** Sonnenstand (geografisch: az ab Nord im Uhrzeigersinn, el über dem Horizont, Grad) für die Beleuchtung der Häuser. */
  setSun(az, el) {
    this.sun = { az, el };
    this._applyLight();
  }

  _applyLight() {
    if (!this.overlay || !this.light || !this.sun) return;
    const { LightingEffect, AmbientLight, DirectionalLight } = this.light, { az, el } = this.sun;
    const r = Math.PI / 180, day = Math.min(1, Math.max(0, Math.sin(el * r)) / Math.sin(10 * r)); // tiefe Sonne: weniger direktes Licht
    // Richtung ZUR Sonne (x Ost, y Nord, z oben). So wirkt sie in der Karte (MapLibre + deck.gl, interleaved) richtig:
    // im Test hellt [0, -1, ·] die Südfassaden auf und [0, 0, 1] die Dächer. (Die SunLight von deck.gl zeigte hier verkehrt.)
    const e = Math.max(el, 0.5) * r, a = az * r;
    const effect = new LightingEffect({
      sky: new AmbientLight({ color: [235, 240, 255], intensity: 0.45 + 0.1 * day }),
      sun: new DirectionalLight({ color: [255, 244, 225], intensity: el > -0.8 ? 0.3 + 1.8 * day : 0, // nicht zu stark: helle Flachdächer laufen sonst ins Weisse
        direction: [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)] }),
    });
    this.overlay.setProps({ effects: [effect] });
  }

  _apply() {
    if (!this.overlay) return;
    const vis = this.on && this.map.getZoom() >= MIN_ZOOM;
    this.overlay.setProps({ layers: [this.layer({ visible: vis })] });
  }
}
