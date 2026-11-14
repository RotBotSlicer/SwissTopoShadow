// Schattenberechnung auf der Grafikkarte (WebGL2).
// Gleiches Verfahren wie litDirect() in horizon.js: pro Pixel ein Strahl in Sonnenrichtung durch die
// Gelände-Levels; Pixel ist im Schatten, sobald das Gelände über der Sonnenhöhe liegt.
// Koordinaten im Shader relativ zu einem Bezugspunkt (ref), damit float32 genau genug bleibt.
import { R_EARTH, K_REFRACTION, gridCoords } from './horizon.js';
import { NODATA_Z } from './raster.js';

const MAX_LEVELS = 7;
// Textureinheiten: 0..6 Levels, 7 Koordinaten, 8 Summe (Anzeige), 9 Zwischenspeicher
const U_COORD = 7, U_ACC = 8, U_FBO = 9;

const VS = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uL0, uL1, uL2, uL3, uL4, uL5, uL6, uCoord, uAcc;
uniform vec2 uOrig[${MAX_LEVELS}];
uniform float uRes[${MAX_LEVELS}];
uniform float uUntil[${MAX_LEVELS}];
uniform ivec2 uSize[${MAX_LEVELS}];
uniform int uNL, uMode, uGround;
uniform vec2 uDir0;               // Sonnenrichtung am Bezugspunkt (sin az, cos az), Azimut im LV95-Gitter
uniform float uTan0, uEl0;        // tan(Sonnenhöhe), Sonnenhöhe [rad] am Bezugspunkt
uniform vec2 uAzG, uElG;          // Änderung je Meter (E, N) [rad/m] – für grosse Ausschnitte
uniform float uEye, uRMax, uGrowth, uAccScale;
uniform vec4 uShadow;
out vec4 o;
const float NOD = ${NODATA_Z.toFixed(1)};
const float DROPK = ${((1 - K_REFRACTION) / (2 * R_EARTH)).toExponential(10)};

float fetchL(int i, ivec2 ij) {
  if (i == 0) return texelFetch(uL0, ij, 0).r;
  if (i == 1) return texelFetch(uL1, ij, 0).r;
  if (i == 2) return texelFetch(uL2, ij, 0).r;
  if (i == 3) return texelFetch(uL3, ij, 0).r;
  if (i == 4) return texelFetch(uL4, ij, 0).r;
  if (i == 5) return texelFetch(uL5, ij, 0).r;
  return texelFetch(uL6, ij, 0).r;
}
// bilinear zwischen Pixelzentren, ausserhalb NOD (wie Raster.sample)
float sampleL(int i, vec2 p) {
  vec2 cr = vec2((p.x - uOrig[i].x) / uRes[i] - 0.5, (uOrig[i].y - p.y) / uRes[i] - 0.5);
  vec2 mx = vec2(uSize[i] - 1);
  if (cr.x < 0.0 || cr.y < 0.0 || cr.x > mx.x || cr.y > mx.y) return NOD;
  ivec2 c0 = min(ivec2(floor(cr)), uSize[i] - 2);
  vec2 f = cr - vec2(c0);
  float a = fetchL(i, c0), b = fetchL(i, c0 + ivec2(1, 0));
  float c = fetchL(i, c0 + ivec2(0, 1)), d = fetchL(i, c0 + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
int levelAt(float r) {
  for (int i = 0; i < ${MAX_LEVELS}; i++) { if (i >= uNL - 1 || r < uUntil[i]) return i; }
  return uNL - 1;
}
float sampleT(vec2 p, int i0) {
  for (int i = 0; i < ${MAX_LEVELS}; i++) {
    if (i < i0 || i >= uNL) continue;
    float z = sampleL(i, p);
    if (z > NOD + 1.0) return z;
  }
  return NOD;
}
vec3 ramp(float t) { // Sonnenstunden: blau (0) -> grün -> gelb -> orange (max)
  vec3 c0 = vec3(0.16, 0.20, 0.45), c1 = vec3(0.20, 0.55, 0.55), c2 = vec3(0.95, 0.85, 0.30), c3 = vec3(0.93, 0.45, 0.10);
  t = clamp(t, 0.0, 1.0);
  return t < 0.33 ? mix(c0, c1, t / 0.33) : t < 0.66 ? mix(c1, c2, (t - 0.33) / 0.33) : mix(c2, c3, (t - 0.66) / 0.34);
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  if (uMode == 3) { // Sonnenstunden anzeigen
    float h = texelFetch(uAcc, px, 0).r * 255.0 * uAccScale;
    o = vec4(ramp(h), 1.0) * 0.62;
    return;
  }
  vec2 p = texelFetch(uCoord, px, 0).xy;
  // Sonne am Pixel: Bezugswert (auf der CPU in double gerechnet) plus lineare Korrektur
  float da = dot(uAzG, p), de = dot(uElG, p);
  vec2 uDir = uDir0 + da * vec2(uDir0.y, -uDir0.x);
  float uTanEl = uTan0 + de * (1.0 + uTan0 * uTan0);
  float el = uEl0 + de;
  float z0 = sampleL(uGround, p) + uEye; // Standort: Boden-Level
  bool lit = el > -0.0175; // Sonne unter ca. -1°: Nacht
  float r = uRes[0];
  for (int k = 0; k < 8192 && lit; k++) {
    if (r > uRMax) break;
    int i = levelAt(r);
    float z = sampleT(p + uDir * r, i);
    if ((z - z0 - DROPK * r * r) / r >= uTanEl) lit = false;
    r += max(uRes[i], uGrowth * r);
  }
  if (uMode == 0) o = lit ? vec4(0.0) : uShadow;            // Anzeige (vormultipliziertes Alpha)
  else if (uMode == 1) o = vec4(lit ? 1.0 : 0.0, 0.0, 0.0, 1.0); // Maske
  else o = vec4(lit ? 1.0 / 255.0 : 0.0, 0.0, 0.0, 0.0);        // Summieren (Blending ONE, ONE)
}`;

export class ShadowRenderer {
  /** canvas: HTMLCanvasElement (wird direkt als Kartenebene angezeigt) */
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 nicht verfügbar');
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Programm: ' + gl.getProgramInfoLog(prog));
    this.prog = prog; gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = new Proxy({}, { get: (c, k) => (c[k] ??= gl.getUniformLocation(prog, k)) });
    for (let i = 0; i < MAX_LEVELS; i++) gl.uniform1i(this.u[`uL${i}`], i);
    gl.uniform1i(this.u.uCoord, U_COORD); gl.uniform1i(this.u.uAcc, U_ACC);
    this.textures = [];
    this.dummy = this._tex(U_ACC, 1, 1, gl.RGBA8, gl.UNSIGNED_BYTE, new Uint8Array(4)); // Platzhalter für uAcc
  }

  _tex(unit, w, h, fmt, type, data) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt === gl.R32F ? gl.RED : fmt === gl.RG32F ? gl.RG : gl.RGBA, type, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** terrain: Terrain (raster.js); ref: {E, N} Bezugspunkt */
  setTerrain(terrain, ref) {
    const gl = this.gl;
    if (terrain.levels.length > MAX_LEVELS) throw new Error(`max. ${MAX_LEVELS} Levels`);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.ref = ref; this.terrain = terrain;
    const orig = [], res = [], until = [], size = [];
    this.textures.forEach(t => gl.deleteTexture(t));
    terrain.levels.forEach(({ raster: r, until: u }, i) => {
      if (r.w > max || r.h > max) throw new Error(`Level ${i} zu gross (${r.w}×${r.h} > ${max})`);
      this.textures[i] = this._tex(i, r.w, r.h, gl.R32F, gl.FLOAT, r.zf);
      orig.push(r.x0 - ref.E, r.y0 - ref.N); res.push(r.res); until.push(Number.isFinite(u) ? u : 1e9); size.push(r.w, r.h);
    });
    for (let i = terrain.levels.length; i < MAX_LEVELS; i++) {
      this.textures[i] = this._tex(i, 1, 1, gl.R32F, gl.FLOAT, new Float32Array([NODATA_Z]));
      orig.push(0, 0); res.push(1); until.push(1e9); size.push(1, 1);
    }
    gl.uniform2fv(this.u['uOrig[0]'], orig); gl.uniform1fv(this.u['uRes[0]'], res);
    gl.uniform1fv(this.u['uUntil[0]'], until); gl.uniform2iv(this.u['uSize[0]'], size);
    gl.uniform1i(this.u.uNL, terrain.levels.length);
    gl.uniform1i(this.u.uGround, terrain.groundLevel ?? 0);
  }

  /** grid: {w, h, coords:Float64Array(2wh) LV95 je Pixel, Zeile 0 = oben}  oder {x0,y0,res,w,h} (LV95-Gitter) */
  setGrid(grid) {
    const gl = this.gl, { w, h } = grid;
    const c = new Float32Array(2 * w * h);
    for (let r = 0; r < h; r++) for (let col = 0; col < w; col++) {
      const i = r * w + col, j = (h - 1 - r) * w + col; // GL: Zeile 0 = unten
      const [E, N] = grid.coords ? [grid.coords[2 * i], grid.coords[2 * i + 1]] : gridCoords(grid, i);
      c[2 * j] = E - this.ref.E; c[2 * j + 1] = N - this.ref.N;
    }
    if (this.coordTex) gl.deleteTexture(this.coordTex);
    this.coordTex = this._tex(U_COORD, w, h, gl.RG32F, gl.FLOAT, c);
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    // Zwischenspeicher (RGBA8) für Maske und Summe
    if (this.fboTex) { gl.deleteTexture(this.fboTex); gl.deleteFramebuffer(this.fbo); }
    this.fboTex = this._tex(U_FBO, w, h, gl.RGBA8, gl.UNSIGNED_BYTE, null);
    gl.activeTexture(gl.TEXTURE0 + U_FBO); gl.bindTexture(gl.TEXTURE_2D, null); // nicht an Sampler gebunden (keine Rückkopplung)
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** grad: {azE, azN, elE, elN} in Grad pro Meter (Sonnenstand variiert über grosse Ausschnitte), Standard 0. */
  _sun(sunAz, sunEl, { eye = 1.0, rMax = 30000, growth = 0.01, grad = null } = {}) {
    const gl = this.gl, D = Math.PI / 180, g = grad ?? { azE: 0, azN: 0, elE: 0, elN: 0 };
    gl.uniform2f(this.u.uDir0, Math.sin(sunAz * D), Math.cos(sunAz * D));
    gl.uniform1f(this.u.uTan0, Math.tan(Math.max(sunEl, -80) * D)); gl.uniform1f(this.u.uEl0, sunEl * D);
    gl.uniform2f(this.u.uAzG, g.azE * D, g.azN * D); gl.uniform2f(this.u.uElG, g.elE * D, g.elN * D);
    gl.uniform1f(this.u.uEye, eye); gl.uniform1f(this.u.uRMax, rMax); gl.uniform1f(this.u.uGrowth, growth);
  }

  _draw(mode, toFbo) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, toFbo ? this.fbo : null);
    gl.viewport(0, 0, this.w, this.h);
    gl.uniform1i(this.u.uMode, mode);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Schatten für eine Sonnenposition (Gitterazimut!) auf die Anzeige zeichnen. */
  renderShadow(sunAz, sunEl, opts = {}) {
    const gl = this.gl, c = opts.color ?? [0.10, 0.13, 0.32, 0.55];
    gl.disable(gl.BLEND);
    gl.uniform4f(this.u.uShadow, c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);
    this._sun(sunAz, sunEl, opts);
    this._draw(0, false);
  }

  /** Maske besonnt (1) / Schatten (0), Zeile 0 = oben (wie grid). */
  litMask(sunAz, sunEl, opts = {}) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    this._sun(sunAz, sunEl, opts);
    this._draw(1, true);
    const px = this._read();
    const out = new Uint8Array(this.w * this.h);
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) out[r * this.w + c] = px[4 * ((this.h - 1 - r) * this.w + c)] > 127 ? 1 : 0;
    return out;
  }

  /** Sonnenstunden schrittweise summieren (für flüssige Oberfläche): begin, dann add(batch) beliebig oft. */
  beginSunHours() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.accSteps = 0;
  }

  addSunHours(suns, opts = {}) {
    const gl = this.gl;
    if (this.accSteps + suns.length > 255) throw new Error('max. 255 Zeitschritte');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (const s of suns) { if (s.el > -1.5) { this._sun(s.az, s.el, { ...opts, grad: s.grad ?? opts.grad }); this._draw(2, true); this.accSteps++; } }
    gl.disable(gl.BLEND);
  }

  /** Sonnenstunden je Pixel (Zeile 0 = oben) über Sonnenpositionen [{az, el}] mit Zeitschritt stepMin. */
  sunHours(suns, stepMin, opts = {}) {
    this.beginSunHours();
    this.addSunHours(suns, opts);
    const px = this._read();
    const out = new Float32Array(this.w * this.h);
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) out[r * this.w + c] = px[4 * ((this.h - 1 - r) * this.w + c)] * stepMin / 60;
    return out;
  }

  /** Zuletzt gerechnete Sonnenstunden farbig anzeigen (Skala 0..maxHours). */
  showSunHours(stepMin, maxHours) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + U_ACC); gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1f(this.u.uAccScale, stepMin / 60 / Math.max(maxHours, 1e-6));
    gl.disable(gl.BLEND);
    this._draw(3, false);
    gl.bindTexture(gl.TEXTURE_2D, this.dummy); // wieder lösen, sonst Rückkopplung beim nächsten Summieren
  }

  _read() {
    const gl = this.gl, px = new Uint8Array(4 * this.w * this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }
}
