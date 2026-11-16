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

// ---- Teil 2: unsere berechnete Schattenkarte auf die Häuser legen ----
// Die Schattenkarten (Nah- und Fernbereich) sind dieselben Canvas wie die Karten-Overlays: Alpha > 0 = Schatten.
// Dächer: Schattenkarte an der Stelle des Dachs (das 2-m-Oberflächenmodell kennt die Dachhöhe → genau).
// Wände: Mittel aus Dachrand (oberer Teil) und Boden vor der Wand (unterer Teil) → Näherung.
// Im Schatten fällt das direkte Sonnenlicht weg; übrig bleibt das Himmelslicht (Faktor amb / (amb + dir·cos)).
const shade = { ver: 0, on: false, maps: [], toSun: [0, 0, 1], amb: 0.5, dir: 0, alphaMax: 0.55, dbg: 0 };

const SHADE_UNIFORMS = /* glsl */ `\
layout(std140) uniform bshadeUniforms {
  vec2 origin;
  vec4 nearRect;
  vec4 farRect;
  vec3 toSun;
  float amb;
  float dir;
  float alphaMax;
  float wallOff;
  int on;
  int hasFar;
  int dbg;
} bshade;
`;
const shadeModule = {
  name: 'bshade',
  vs: SHADE_UNIFORMS + 'out vec2 bshade_p;\nout vec2 bshade_q;\nout vec3 bshade_n;\n',
  fs: SHADE_UNIFORMS + 'in vec2 bshade_p;\nin vec2 bshade_q;\nin vec3 bshade_n;\nuniform sampler2D bshade_near;\nuniform sampler2D bshade_far;\n' + /* glsl */ `
float bshade_sample(sampler2D t, vec4 r, vec2 p) {
  vec2 uv = vec2((p.x - r.x) / (r.z - r.x), (r.w - p.y) / (r.w - r.y)); // Zeile 0 = Nord
  return texture(t, uv).a;
}
bool bshade_in(vec4 r, vec2 p) { return p.x >= r.x && p.y >= r.y && p.x <= r.z && p.y <= r.w; }
float bshade_at(vec2 p) {
  if (bshade_in(bshade.nearRect, p)) return bshade_sample(bshade_near, bshade.nearRect, p);
  if (bshade.hasFar == 1 && bshade_in(bshade.farRect, p)) return bshade_sample(bshade_far, bshade.farRect, p);
  return 0.0;
}
`,
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': /* glsl */ `
    {
      vec3 n = normalize(geometry.normal);
      vec2 p = geometry.position.xy + bshade.origin, q = p;
      float h = length(n.xy);
      if (n.z < 0.6 && h > 1e-3) { // Wand: oben = Dachrand dahinter, unten = Boden davor
        vec2 d = n.xy / h * project.commonUnitsPerMeter.xy;
        p -= d * bshade.wallOff * 0.7; q += d * bshade.wallOff;
      }
      bshade_p = p; bshade_q = q; bshade_n = n;
    }`,
    'fs:DECKGL_FILTER_COLOR': /* glsl */ `
    if (bshade.on == 1 && bshade.dbg >= 0) {
      float s = clamp(0.5 * (bshade_at(bshade_p) + bshade_at(bshade_q)) / bshade.alphaMax, 0.0, 1.0);
      float ndl = max(dot(normalize(bshade_n), bshade.toSun), 0.0);
      float f = bshade.amb / (bshade.amb + bshade.dir * ndl);
      if (bshade.dbg == 1) color.rgb = vec3(ndl, 0.0, 0.0);
      else if (bshade.dbg == 2) color.rgb = vec3(s, 0.0, 1.0 - s);
      else if (bshade.dbg == 3) { vec4 r = bshade.nearRect; color.rgb = vec3((bshade_p.x - r.x) / (r.z - r.x), (r.w - bshade_p.y) / (r.w - r.y), 0.0); }
      else color.rgb *= mix(1.0, f, s);
    }`,
  },
  getUniforms: o => o ?? {},
  uniformTypes: {
    origin: 'vec2<f32>', nearRect: 'vec4<f32>', farRect: 'vec4<f32>', toSun: 'vec3<f32>',
    amb: 'f32', dir: 'f32', alphaMax: 'f32', wallOff: 'f32', on: 'i32', hasFar: 'i32', dbg: 'i32',
  },
};

function makeShadeExtension(LayerExtension, project) {
  class BuildingShade extends LayerExtension {
    getShaders() { return { modules: [shadeModule] }; }
    draw(params) {
      const dev = this.context.device, st = (dev.__bshade ??= { ver: -1, tex: [] });
      const empty = (st.empty ??= dev.createTexture({ width: 1, height: 1, data: new Uint8Array(4) }));
      const pp = params.shaderModuleProps?.project, vp = pp?.viewport;
      const maps = shade.on && vp ? shade.maps : [];
      if (st.ver !== shade.ver) { // Schattenkarten neu hochladen (einmal je Zeitschritt, nicht je Kachel)
        st.ver = shade.ver;
        shade.maps.forEach((m, i) => {
          const c = m.canvas;
          let t = st.tex[i];
          if (!t || t.width !== c.width || t.height !== c.height) {
            t?.destroy();
            t = st.tex[i] = dev.createTexture({ width: c.width, height: c.height, format: 'rgba8unorm',
              sampler: { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' } });
          }
          const gl = dev.gl;
          gl?.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          t.copyExternalImage({ image: c });
        });
      }
      let u = { on: 0, hasFar: 0, origin: [0, 0], nearRect: [0, 0, 1, 1], farRect: [0, 0, 1, 1], toSun: shade.toSun,
        amb: shade.amb, dir: shade.dir, alphaMax: shade.alphaMax, wallOff: 3.0, dbg: shade.dbg };
      if (maps.length) {
        const P = (lon, lat) => vp.projectFlat([lon, lat]);
        const nb = maps[0].b, ref = P(nb.west, nb.south);
        const rect = b => { const a = P(b.west, b.south), c = P(b.east, b.north); return [a[0] - ref[0], a[1] - ref[1], c[0] - ref[0], c[1] - ref[1]]; };
        const co = project.getUniforms(pp).commonOrigin;
        u = { ...u, on: 1, origin: [co[0] - ref[0], co[1] - ref[1]], nearRect: rect(nb),
          hasFar: maps[1] ? 1 : 0, farRect: maps[1] ? rect(maps[1].b) : u.farRect };
      }
      const props = { bshade: { ...u, bshade_near: (maps.length && st.tex[0]) || empty, bshade_far: (maps[1] && st.tex[1]) || empty } };
      for (const m of this.getModels()) m.shaderInputs.setProps(props);
    }
  }
  BuildingShade.extensionName = 'BuildingShade';
  return new BuildingShade();
}

function matte(gltf) {
  if (globalThis.__noMatte) return; // nur für den Test (Gegenprobe)
  for (const m of gltf?.materials ?? []) {
    const p = m.pbrMetallicRoughness ??= {};
    p.roughnessFactor = 0.9; p.metallicFactor = 0;
  }
}

export class Buildings {
  constructor(map) { this.map = map; this.overlay = null; this.on = false; }

  async set(on) {
    this.on = on;
    if (!on) { this._apply(); return; }
    if (!this.overlay) {
      const { MapboxOverlay, Tile3DLayer, Tiles3DLoader, LightingEffect, AmbientLight, DirectionalLight, LayerExtension, project } = await load();
      const ext = makeShadeExtension(LayerExtension, project);
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
        // Die swisstopo-Kacheln haben roughnessFactor 0 (spiegelglatt). Mit Sonnenlicht ergibt das in der PBR-Beleuchtung
        // reinweisse Flächen (Glanzpunkt ohne Ausdehnung). Matt machen, bevor deck.gl die Kachel zeichnet.
        onTileLoad: tile => matte(tile?.content?.gltf),
        extensions: [ext],
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

  /** Schattenkarten der Rechnung (Nahbereich zuerst, dann Fernbereich): [{canvas, b:{west,east,south,north}}].
   *  Leer = keine Schatten auf den Häusern (z. B. im Modus Sonnenstunden). */
  setShadowMaps(maps) {
    shade.maps = maps ?? []; shade.on = shade.maps.length > 0; shade.ver++;
    this.map.triggerRepaint();
  }

  _applyLight() {
    if (!this.overlay || !this.light || !this.sun) return;
    const { LightingEffect, AmbientLight, DirectionalLight } = this.light, { az, el } = this.sun;
    const r = Math.PI / 180, day = Math.min(1, Math.max(0, Math.sin(el * r)) / Math.sin(10 * r)); // tiefe Sonne: weniger direktes Licht
    // Richtung ZUR Sonne (x Ost, y Nord, z oben). So wirkt sie in der Karte (MapLibre + deck.gl, interleaved) richtig:
    // im Test hellt [0, -1, ·] die Südfassaden auf und [0, 0, 1] die Dächer. (Die SunLight von deck.gl zeigte hier verkehrt.)
    const e = Math.max(el, 0.5) * r, a = az * r;
    shade.toSun = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
    shade.amb = 0.45 + 0.1 * day; shade.dir = el > -0.8 ? 0.3 + 1.8 * day : 0;
    const effect = new LightingEffect({
      sky: new AmbientLight({ color: [235, 240, 255], intensity: shade.amb }),
      sun: new DirectionalLight({ color: [255, 244, 225], intensity: shade.dir, // nicht zu stark: helle Flachdächer laufen sonst ins Weisse
        direction: shade.toSun }),
    });
    this.overlay.setProps({ effects: [effect] });
  }

  _apply() {
    if (!this.overlay) return;
    const vis = this.on && this.map.getZoom() >= MIN_ZOOM;
    this.overlay.setProps({ layers: [this.layer({ visible: vis })] });
  }
}

// nur für Tests: Diagnose-Darstellung (1 = Sonnenseite rot, 2 = Schattenkarte, 3 = Kartenkoordinaten, -1 = ohne Schatten)
export function _shadeDebug(d) { shade.dbg = d; shade.ver++; }
