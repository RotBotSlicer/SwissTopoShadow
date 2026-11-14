"""Grobmodell der Schweiz als Kachelpyramide (für Fernhorizont).

Quelle: swissALTIRegio (swisstopo, 10 m, Cloud-Optimized GeoTIFF, deckt CH, FL
und Grenzgebiete ab). Daraus werden Levels mit 40/80/160 m gebildet.
Aggregation = Maximum der 10-m-Zellen: Gipfel und Grate bleiben erhalten; die
Abweichung zum vollen 10-m-Modell wurde gemessen (siehe README).

Kachelformat (bewusst simpel, damit es in JS ohne Bibliothek lesbar ist)
------------------------------------------------------------------------
- Kachel = TILE×TILE Pixel (256), Level-Auflösung res (m).
- Kachel (tx, ty) deckt E ∈ [X0 + tx·T·res, X0 + (tx+1)·T·res),
  N ∈ (Y0 − (ty+1)·T·res, Y0 − ty·T·res]; Zeile 0 = Norden.
- Werte: int16 little-endian, ganze Meter (aufgerundet), keine Daten = −32768.
- Prädiktor: je Zeile erster Wert roh, danach Differenz zum linken Nachbarn
  (Arithmetik modulo 2^16).
- Datei: gzip, Pfad `{res}m/{ty}_{tx}.bin.gz`; leere Kacheln fehlen.
- `manifest.json` beschreibt Ursprung, Levels und vorhandene Kacheln.
"""
from __future__ import annotations

import gzip
import json
import os

import numpy as np

from .dem import Raster

COG_URL = ("https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/"
           "swissaltiregio_2056_5728.tif")
X0, Y0 = 2_385_000.0, 1_404_000.0  # Ursprung des COG (obere linke Ecke)
SRC_RES = 10.0
TILE = 256
LEVELS = (40, 80, 160)
NODATA = -32768


# ------------------------------------------------------------ Kodierung
def encode_tile(z: np.ndarray) -> bytes:
    """float-Höhen (NaN = keine Daten) -> gzip-Bytes gemäss Format oben."""
    ok = np.isfinite(z)
    v = np.where(ok, np.clip(np.ceil(np.where(ok, z, 0)), -32767, 32767), NODATA).astype(np.int16)
    u = v.view(np.uint16)
    d = u.copy()
    d[:, 1:] = u[:, 1:] - u[:, :-1]  # uint16-Überlauf = modulo 2^16
    return gzip.compress(d.astype("<u2").tobytes(), compresslevel=9, mtime=0)


def decode_tile(data: bytes, tile: int = TILE) -> np.ndarray:
    """gzip-Bytes -> float32-Höhen (NaN = keine Daten)."""
    d = np.frombuffer(gzip.decompress(data), dtype="<u2").reshape(tile, tile)
    u = np.cumsum(d, axis=1, dtype=np.uint16)  # modulo 2^16
    v = u.view(np.int16).astype(np.float32)
    v[u.view(np.int16) == NODATA] = np.nan
    return v


def aggregate_max(z: np.ndarray, f: int) -> np.ndarray:
    """Block-Maximum (f×f), NaN-tolerant; reine NaN-Blöcke bleiben NaN."""
    h, w = z.shape
    b = z.reshape(h // f, f, w // f, f)
    with np.errstate(all="ignore"):
        filled = np.where(np.isnan(b), -np.inf, b).max(axis=(1, 3))
    filled[np.isneginf(filled)] = np.nan
    return filled


# ------------------------------------------------------------ Aufbau
def build(out_dir: str, cog_url: str = COG_URL, workers: int = 6, log=print):
    """Liest das 10-m-COG blockweise und schreibt die Pyramide nach out_dir.

    Ein Arbeitsblock entspricht genau einer Kachel des gröbsten Levels
    (TILE · 160/10 = 4096 Pixel à 10 m); daraus entstehen 4×4 Kacheln à 40 m,
    2×2 à 80 m und 1 à 160 m.
    """
    import concurrent.futures as cf
    import threading

    import rasterio
    from rasterio.windows import Window

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    top = max(LEVELS)
    chunk = TILE * top // int(SRC_RES)
    src = cog_url if not cog_url.startswith("http") else "/vsicurl/" + cog_url
    with rasterio.open(src) as s:
        W, H = s.width, s.height
        nod = s.nodata
        x0, y0 = s.transform.c, s.transform.f
    nx, ny = -(-W // chunk), -(-H // chunk)
    for res in LEVELS:
        os.makedirs(os.path.join(out_dir, f"{res}m"), exist_ok=True)
    local = threading.local()
    tiles = {res: [] for res in LEVELS}
    lock = threading.Lock()

    def work(cx, cy):
        if not hasattr(local, "ds"):
            local.ds = rasterio.open(src)
        c0, r0 = cx * chunk, cy * chunk
        w, h = min(chunk, W - c0), min(chunk, H - r0)
        a = np.full((chunk, chunk), np.nan, np.float32)
        part = local.ds.read(1, window=Window(c0, r0, w, h)).astype(np.float32)
        part[(part == nod) | (part > 1e30) | (part < -1000)] = np.nan
        a[:h, :w] = part
        done = []
        if np.isfinite(a).any():
            for res in LEVELS:
                f = res // int(SRC_RES)
                g = aggregate_max(a, f)
                k = g.shape[0] // TILE
                for j in range(k):
                    for i in range(k):
                        t = g[j * TILE:(j + 1) * TILE, i * TILE:(i + 1) * TILE]
                        if not np.isfinite(t).any():
                            continue
                        tx, ty = cx * k + i, cy * k + j
                        with open(os.path.join(out_dir, f"{res}m", f"{ty}_{tx}.bin.gz"), "wb") as fh:
                            fh.write(encode_tile(t))
                        done.append((res, tx, ty))
        with lock:
            for res, tx, ty in done:
                tiles[res].append([tx, ty])
        return cx, cy

    jobs = [(cx, cy) for cy in range(ny) for cx in range(nx)]
    with cf.ThreadPoolExecutor(workers) as ex:
        for n, _ in enumerate(ex.map(lambda j: work(*j), jobs), 1):
            if log and (n % 10 == 0 or n == len(jobs)):
                log(f"{n}/{len(jobs)} Blöcke")

    manifest = {
        "source": "swisstopo swissALTIRegio (10 m), Aggregation Maximum",
        "crs": "EPSG:2056", "x0": x0, "y0": y0, "tile": TILE,
        "encoding": "int16 LE Meter (ceil), nodata -32768, Zeilen-Delta-Prädiktor mod 2^16, gzip",
        "path": "{res}m/{ty}_{tx}.bin.gz",
        "levels": [{"res": res, "tiles": sorted(tiles[res])} for res in LEVELS],
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, separators=(",", ":"))
    return manifest


# ------------------------------------------------------------ Lesen
class Pyramid:
    """Liest Kacheln aus einem lokalen Verzeichnis oder per HTTP (Basis-URL)."""

    def __init__(self, base: str):
        self.base = base.rstrip("/")
        m = json.loads(self._get("manifest.json"))
        self.x0, self.y0, self.tile = m["x0"], m["y0"], m["tile"]
        self.levels = {lv["res"]: {tuple(t) for t in lv["tiles"]} for lv in m["levels"]}

    def _get(self, rel):
        if self.base.startswith("http"):
            import urllib.request

            with urllib.request.urlopen(f"{self.base}/{rel}", timeout=60) as r:
                return r.read()
        with open(os.path.join(self.base, rel), "rb") as fh:
            return fh.read()

    def raster(self, res: int, bounds) -> Raster:
        """Mosaik der Kacheln eines Levels, das bounds (LV95) abdeckt."""
        T, size = self.tile, self.tile * res
        xmin, ymin, xmax, ymax = bounds
        tx0, tx1 = int((xmin - self.x0) // size), int((xmax - self.x0) // size)
        ty0, ty1 = int((self.y0 - ymax) // size), int((self.y0 - ymin) // size)
        z = np.full(((ty1 - ty0 + 1) * T, (tx1 - tx0 + 1) * T), np.nan, np.float32)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                if (tx, ty) in self.levels[res]:
                    z[(ty - ty0) * T:(ty - ty0 + 1) * T, (tx - tx0) * T:(tx - tx0 + 1) * T] = \
                        decode_tile(self._get(f"{res}m/{ty}_{tx}.bin.gz"), T)
        return Raster(z, self.x0 + tx0 * size, self.y0 - ty0 * size, float(res))
