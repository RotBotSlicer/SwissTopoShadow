// Kachelpyramide des Grobmodells – Format siehe schatten/pyramid.py.
import { Raster } from './raster.js';

export const NODATA_I16 = -32768;

async function gunzip(bytes) {
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

/** gzip-Bytes -> Float32Array (tile×tile, NaN = keine Daten). */
export async function decodeTile(bytes, tile = 256) {
  const raw = await gunzip(bytes);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Float32Array(tile * tile);
  for (let r = 0; r < tile; r++) {
    let acc = 0;
    for (let c = 0; c < tile; c++) {
      const i = r * tile + c;
      acc = (acc + dv.getUint16(2 * i, true)) & 0xffff; // Zeilen-Prädiktor mod 2^16
      const v = acc >= 0x8000 ? acc - 0x10000 : acc;      // als int16
      out[i] = v === NODATA_I16 ? NaN : v;
    }
  }
  return out;
}

export class Pyramid {
  /** get(rel) -> Promise<ArrayBuffer|Uint8Array>, z. B. rel => fetch(base + '/' + rel).then(r => r.arrayBuffer()) */
  constructor(manifest, get) {
    this.get = get;
    this.x0 = manifest.x0; this.y0 = manifest.y0; this.tileSize = manifest.tile; this.path = manifest.path;
    this.levels = new Map(manifest.levels.map(l => [l.res, new Set(l.tiles.map(([x, y]) => `${x}_${y}`))]));
    this.cache = new Map();
  }

  static async open(base, fetchFn = fetch) {
    const get = async rel => new Uint8Array(await (await fetchFn(`${base.replace(/\/$/, '')}/${rel}`)).arrayBuffer());
    const manifest = JSON.parse(new TextDecoder().decode(await get('manifest.json')));
    return new Pyramid(manifest, get);
  }

  async tile(res, tx, ty) {
    const key = `${res}/${ty}_${tx}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.levels.get(res)?.has(`${tx}_${ty}`)
        ? this.get(this.path.replace('{res}', res).replace('{ty}', ty).replace('{tx}', tx)).then(b => decodeTile(b, this.tileSize))
        : Promise.resolve(null));
    }
    return this.cache.get(key);
  }

  /** Mosaik eines Levels über bounds [xmin, ymin, xmax, ymax] (LV95). */
  async raster(res, [xmin, ymin, xmax, ymax]) {
    const T = this.tileSize, size = T * res;
    const tx0 = Math.floor((xmin - this.x0) / size), tx1 = Math.floor((xmax - this.x0) / size);
    const ty0 = Math.floor((this.y0 - ymax) / size), ty1 = Math.floor((this.y0 - ymin) / size);
    const w = (tx1 - tx0 + 1) * T, h = (ty1 - ty0 + 1) * T;
    const z = new Float32Array(w * h).fill(NaN);
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(this.tile(res, tx, ty).then(t => {
        if (!t) return;
        const oc = (tx - tx0) * T, or = (ty - ty0) * T;
        for (let r = 0; r < T; r++) z.set(t.subarray(r * T, (r + 1) * T), (or + r) * w + oc);
      }));
    }
    await Promise.all(jobs);
    return new Raster(z, w, h, this.x0 + tx0 * size, this.y0 - ty0 * size, res);
  }
}
