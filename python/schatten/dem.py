"""Höhenmodell: swissALTI3D-Kacheln laden (STAC), Mosaik bilden, abtasten.

Koordinaten durchgehend LV95 (EPSG:2056), Meter.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import os
import urllib.request
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import map_coordinates

STAC_BASE = "https://data.geo.admin.ch/api/stac/v0.9/collections"
STAC = f"{STAC_BASE}/ch.swisstopo.swissalti3d/items"
STAC_SURFACE = f"{STAC_BASE}/ch.swisstopo.swisssurface3d-raster/items"  # Oberfläche inkl. Wald/Gebäude, 0.5 m
NODATA_Z = -1.0e4  # Ersatzwert: liegt so tief, dass er nie Schatten wirft


from .coords import lv95_to_wgs84  # noqa: E402,F401  (Kompatibilität)


@dataclass
class Raster:
    """Regelmässiges Höhenraster. (x0, y0) = obere linke Ecke, Zeile 0 = Norden."""

    z: np.ndarray  # float32, NaN = keine Daten
    x0: float
    y0: float
    res: float

    def __post_init__(self):
        self.z = np.asarray(self.z, dtype=np.float32)
        self._zf = np.where(np.isfinite(self.z), self.z, NODATA_Z).astype(np.float32)

    @property
    def shape(self):
        return self.z.shape

    @property
    def bounds(self):
        h, w = self.z.shape
        return (self.x0, self.y0 - h * self.res, self.x0 + w * self.res, self.y0)

    def coords(self):
        """Zentrumskoordinaten (E[w], N[h])."""
        h, w = self.z.shape
        return (self.x0 + (np.arange(w) + 0.5) * self.res,
                self.y0 - (np.arange(h) + 0.5) * self.res)

    def sample(self, E, N):
        """Bilineare Höhe an (E, N). Ausserhalb/ohne Daten -> NODATA_Z."""
        E = np.asarray(E, dtype=float)
        N = np.asarray(N, dtype=float)
        col = (E - self.x0) / self.res - 0.5
        row = (self.y0 - N) / self.res - 0.5
        out = map_coordinates(self._zf, [row.ravel(), col.ravel()], order=1,
                              mode="constant", cval=NODATA_Z)
        return out.reshape(E.shape)

    def save(self, path):
        np.savez_compressed(path, z=self.z, x0=self.x0, y0=self.y0, res=self.res)

    @classmethod
    def load(cls, path):
        d = np.load(path)
        return cls(d["z"], float(d["x0"]), float(d["y0"]), float(d["res"]))


# ---------------------------------------------------------------- Download
def find_tiles(bounds_lv95, res: float = 2.0, stac: str = STAC):
    """Neueste Kachel (GeoTIFF, Auflösung res) je km² im Rechteck -> {tile_id: url}.

    Standard swissALTI3D; mit stac=STAC_SURFACE, res=0.5 swissSURFACE3D-Raster.
    """
    xmin, ymin, xmax, ymax = bounds_lv95
    m = 1500  # Rand, damit Randkacheln trotz Projektion sicher erfasst werden
    from pyproj import Transformer

    tr = Transformer.from_crs(2056, 4326, always_xy=True)
    lons, lats = tr.transform([xmin - m, xmax + m, xmin - m, xmax + m],
                              [ymin - m, ymin - m, ymax + m, ymax + m])
    url = f"{stac}?bbox={min(lons)},{min(lats)},{max(lons)},{max(lats)}&limit=100"
    tag = f"_{res:g}_2056_5728.tif"
    best = {}
    while url:
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.load(r)
        for f in d["features"]:
            for key, a in f["assets"].items():
                if not key.endswith(tag):
                    continue
                _, year, tile = key.split("_")[:3]
                e, n = (int(v) * 1000 for v in tile.split("-"))
                if e + 1000 <= xmin or e >= xmax or n + 1000 <= ymin or n >= ymax:
                    continue
                if tile not in best or best[tile][0] < int(year):
                    best[tile] = (int(year), a["href"])
        url = next((l["href"] for l in d["links"] if l["rel"] == "next"), None)
    return {k: v[1] for k, v in best.items()}


def download_tiles(urls: dict, cache_dir: str, workers: int = 16):
    """Lädt fehlende Kacheln in cache_dir, gibt Liste der lokalen Pfade zurück."""
    os.makedirs(cache_dir, exist_ok=True)

    def get(u):
        p = os.path.join(cache_dir, u.rsplit("/", 1)[1])
        if not os.path.exists(p):
            tmp = p + ".part"
            urllib.request.urlretrieve(u, tmp)
            os.replace(tmp, p)
        return p

    with cf.ThreadPoolExecutor(workers) as ex:
        return list(ex.map(get, urls.values()))


def mosaic(paths, bounds_lv95, res: float) -> Raster:
    """Mosaik der Kacheln auf ein Raster mit Auflösung res (Mittelwert beim Vergröbern)."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.merge import merge

    srcs = [rasterio.open(p) for p in paths]
    try:
        arr, tr = merge(srcs, bounds=bounds_lv95, res=res, nodata=-9999,
                        resampling=Resampling.average)
    finally:
        for s in srcs:
            s.close()
    z = arr[0].astype(np.float32)
    z[z < -1000] = np.nan
    return Raster(z, tr.c, tr.f, res)


def read_surface(bounds_lv95, overview_level: int = 1) -> Raster:
    """swissSURFACE3D-Raster (Gelände + Wald + Gebäude) als Mosaik ganzer km-Kacheln.

    Gelesen wird nur eine Übersichtsstufe des COG (0 = 1 m, 1 = 2 m; per HTTP-Range),
    nicht die ganze 0.5-m-Kachel (15 MB). Die Übersichten sind gemittelt.
    """
    import rasterio

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    urls = find_tiles(bounds_lv95, 0.5, STAC_SURFACE)
    ids = {k: tuple(int(v) for v in k.split("-")) for k in urls}
    ex0, ex1 = min(i[0] for i in ids.values()), max(i[0] for i in ids.values())
    nx0, nx1 = min(i[1] for i in ids.values()), max(i[1] for i in ids.values())
    res = 0.5 * 2 ** (overview_level + 1)
    P = int(1000 / res)
    z = np.full(((nx1 - nx0 + 1) * P, (ex1 - ex0 + 1) * P), np.nan, np.float32)

    def get(item):
        k, u = item
        with rasterio.open("/vsicurl/" + u, overview_level=overview_level) as s:
            a = s.read(1).astype(np.float32)
            a[(a == s.nodata) | (a < -1000) | (a > 1e30)] = np.nan
        e, n = ids[k]
        r0, c0 = (nx1 - n) * P, (e - ex0) * P
        z[r0:r0 + P, c0:c0 + P] = a[:P, :P]

    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(get, urls.items()))
    return Raster(z, ex0 * 1000.0, (nx1 + 1) * 1000.0, res)


class Terrain:
    """Gelände in mehreren Auflösungsstufen (Level of Detail nach Distanz).

    ground_level: Index des Levels, aus dem die Höhe des Standorts selbst kommt
    (Standard 0). Mit Oberflächenmodell (Wald/Gebäude) als Level 0 ist das der Boden
    (swissALTI3D, Level 1): man steht unter den Bäumen, die Strahlen treffen die Kronen.

    levels: Liste von (Raster, r_bis) aufsteigend nach r_bis. Für eine Abtastung
    in Distanz r wird das erste Level mit r < r_bis verwendet; wo dieses keine
    Daten hat, wird auf das nächstgröbere ausgewichen. Das erste Level liefert
    auch die Höhe des Standorts selbst.
    """

    def __init__(self, levels, ground_level: int = 0):
        self.levels = [(ras, float(r)) for ras, r in levels]
        self.ground_level = ground_level

    @classmethod
    def two(cls, fine, coarse, r_split=1000.0):
        return cls([(fine, r_split), (coarse, np.inf)])

    @property
    def fine(self):
        return self.levels[0][0]

    @property
    def ground(self):
        """Raster für die Standorthöhe (Boden)."""
        return self.levels[self.ground_level][0]

    def level_index(self, r):
        for i, (_, rb) in enumerate(self.levels):
            if r < rb:
                return i
        return len(self.levels) - 1

    def res_at(self, r):
        return self.levels[self.level_index(r)][0].res

    def sample(self, E, N, r):
        i = self.level_index(r)
        E = np.asarray(E, dtype=float)
        N = np.asarray(N, dtype=float)
        z = self.levels[i][0].sample(E, N)
        for ras, _ in self.levels[i + 1:]:
            miss = z <= NODATA_Z + 1
            if not miss.any():
                break
            z[miss] = ras.sample(E[miss], N[miss])
        return z


def load_terrain(bounds_area, radius_far, cache_dir, res_fine=2.0, res_coarse=10.0,
                 r_split=1000.0) -> Terrain:
    """Lädt fein/grob für ein Zielrechteck (LV95 xmin, ymin, xmax, ymax).

    fein: Zielrechteck + r_split Rand; grob: Zielrechteck + radius_far Rand.
    Hinweis: Auch das grobe Raster wird hier aus 2-m-Kacheln gemittelt; für die
    Web-App kommt später ein vorab gerechnetes CH-weites Grobmodell.
    """
    xmin, ymin, xmax, ymax = bounds_area
    bf = (xmin - r_split, ymin - r_split, xmax + r_split, ymax + r_split)
    bc = (xmin - radius_far, ymin - radius_far, xmax + radius_far, ymax + radius_far)
    paths = download_tiles(find_tiles(bc), cache_dir)
    fine = mosaic([p for p in paths if _tile_hits(p, bf)], bf, res_fine)
    coarse = mosaic(paths, bc, res_coarse)
    return Terrain.two(fine, coarse, r_split)


def _tile_hits(path, b):
    tile = os.path.basename(path).split("_")[2]
    e, n = (int(v) * 1000 for v in tile.split("-"))
    return not (e + 1000 <= b[0] or e >= b[2] or n + 1000 <= b[1] or n >= b[3])


# ---------------------------------------------------------------- App-Schema
REGIO_COG = ("https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/"
             "swissaltiregio_2056_5728.tif")

# Distanzgrenzen der Levels (gemessen, siehe README "Level of Detail")
LOD_DEFAULT = {"fine_until": 1000.0, "regio_until": 4000.0,
               "pyramid": ((40, 12000.0), (80, 24000.0), (160, np.inf))}


def read_regio(bounds_lv95, cog_url: str = REGIO_COG) -> Raster:
    """swissALTIRegio 10 m für ein Rechteck direkt aus dem COG (HTTP-Range-Reads)."""
    import rasterio
    from rasterio.windows import Window

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    src = cog_url if not cog_url.startswith("http") else "/vsicurl/" + cog_url
    with rasterio.open(src) as s:
        X0, Y0, res = s.transform.c, s.transform.f, s.transform.a
        xmin, ymin, xmax, ymax = bounds_lv95
        c0 = int(np.floor((xmin - X0) / res)); r0 = int(np.floor((Y0 - ymax) / res))
        c1 = int(np.ceil((xmax - X0) / res)); r1 = int(np.ceil((Y0 - ymin) / res))
        z = s.read(1, window=Window(c0, r0, c1 - c0, r1 - r0), boundless=True,
                   fill_value=s.nodata).astype(np.float32)
        z[(z == s.nodata) | (z > 1e30) | (z < -1000)] = np.nan
    return Raster(z, X0 + c0 * res, Y0 - r0 * res, res)


def load_terrain_lod(bounds_area, cache_dir, pyramid, r_max=30000.0, lod=LOD_DEFAULT,
                     surface: bool = False) -> Terrain:
    """Gelände wie in der App: 2 m (swissALTI3D) -> 10 m (swissALTIRegio) -> Pyramide.

    pyramid: schatten.pyramid.Pyramid (lokal oder per URL).
    surface: zusätzlich swissSURFACE3D (2 m, Wald/Gebäude) als Level 0 im Nahbereich;
             Standorthöhe dann vom Boden (swissALTI3D).
    """
    xmin, ymin, xmax, ymax = bounds_area
    grow = lambda m: (xmin - m, ymin - m, xmax + m, ymax + m)
    bf = grow(lod["fine_until"])
    fine = mosaic(download_tiles(find_tiles(bf), cache_dir), bf, 2.0)
    regio = read_regio(grow(lod["regio_until"]))
    levels = [(fine, lod["fine_until"]), (regio, lod["regio_until"])]
    for res, until in lod["pyramid"]:
        levels.append((pyramid.raster(res, grow(min(until, r_max) + res)), until))
    if surface:
        return Terrain([(read_surface(bf), lod["fine_until"])] + levels, ground_level=1)
    return Terrain(levels)
