// Höhenraster und Gelände mit Level of Detail – Port von schatten/dem.py (Raster, Terrain).
export const NODATA_Z = -1.0e4; // liegt so tief, dass er nie Schatten wirft

/** Regelmässiges Raster. (x0, y0) = obere linke Ecke (LV95), Zeile 0 = Norden. */
export class Raster {
  constructor(z, w, h, x0, y0, res) {
    this.w = w; this.h = h; this.x0 = x0; this.y0 = y0; this.res = res;
    this.z = z instanceof Float32Array ? z : Float32Array.from(z); // NaN = keine Daten
    this.zf = new Float32Array(this.z.length);
    for (let i = 0; i < this.z.length; i++) this.zf[i] = Number.isFinite(this.z[i]) ? this.z[i] : NODATA_Z;
  }
  get bounds() { return [this.x0, this.y0 - this.h * this.res, this.x0 + this.w * this.res, this.y0]; }

  /** Bilineare Höhe zwischen Pixelzentren; ausserhalb davon NODATA_Z (wie scipy map_coordinates mode='constant'). */
  sample(E, N) {
    const c = (E - this.x0) / this.res - 0.5, r = (this.y0 - N) / this.res - 0.5;
    if (!(c >= 0 && r >= 0 && c <= this.w - 1 && r <= this.h - 1)) return NODATA_Z;
    const c0 = Math.min(Math.floor(c), this.w - 2), r0 = Math.min(Math.floor(r), this.h - 2);
    const fc = c - c0, fr = r - r0, i = r0 * this.w + c0, z = this.zf;
    return (1 - fr) * ((1 - fc) * z[i] + fc * z[i + 1]) + fr * ((1 - fc) * z[i + this.w] + fc * z[i + this.w + 1]);
  }
}

/** Gelände aus Levels [{raster, until}] aufsteigend nach Distanz; Rückfall auf gröbere Levels ohne Daten. */
export class Terrain {
  constructor(levels) { this.levels = levels.map(l => ({ raster: l.raster, until: l.until ?? Infinity })); }
  get fine() { return this.levels[0].raster; }
  levelIndex(r) {
    for (let i = 0; i < this.levels.length; i++) if (r < this.levels[i].until) return i;
    return this.levels.length - 1;
  }
  resAt(r) { return this.levels[this.levelIndex(r)].raster.res; }
  sample(E, N, r) {
    for (let i = this.levelIndex(r); i < this.levels.length; i++) {
      const z = this.levels[i].raster.sample(E, N);
      if (z > NODATA_Z + 1) return z;
    }
    return NODATA_Z;
  }
}
