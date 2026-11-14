"""Weltweites Gelände aus Copernicus DEM GLO-30 (Referenz für js/src/copernicus.js).

Die 1°×1°-Kacheln (geografisch, ~30 m, Oberflächenmodell) werden fensterweise per HTTP-Range
gelesen und auf ein Metergitter einer lokalen Transversalen Mercator umgerechnet. Grobe Levels
kommen aus den Übersichtsstufen der COGs. Fehlende Kacheln gelten als Meer (0 m).
Gleiche Logik wie in JS (inkl. Interpolation über Kachelgrenzen), damit beide vergleichbar sind.
"""
from __future__ import annotations

import concurrent.futures as cf
import math
import os
from dataclasses import dataclass

import numpy as np

from .dem import Raster, Terrain

COP30 = "https://copernicus-dem-30m.s3.amazonaws.com"
LOD_WORLD = ((30, 0, 6000.0), (60, 1, 12000.0), (120, 2, math.inf))  # (res, Übersicht, bis)


def cop30_tile_name(lat_s: int, lon_w: int) -> str:
    return (f"Copernicus_DSM_COG_10_{'S' if lat_s < 0 else 'N'}{abs(lat_s):02d}_00_"
            f"{'W' if lon_w < 0 else 'E'}{abs(lon_w):03d}_00_DEM")


@dataclass
class GeoTile:
    lon0: float
    lat0: float  # obere linke Pixelecke
    dlon: float
    dlat: float
    z: np.ndarray  # (h, w) float64
    sea: bool = False

    @property
    def w(self):
        return self.z.shape[1]

    @property
    def h(self):
        return self.z.shape[0]


def load_geo_tiles(south, west, north, east, overview=0, base=COP30):
    import rasterio
    from rasterio.windows import Window

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")

    def one(la, lo):
        name = cop30_tile_name(la, lo)
        url = f"/vsicurl/{base}/{name}/{name}.tif"
        try:
            full = rasterio.open(url)
        except Exception:
            return GeoTile(lo, la + 1, 1.0, 1.0, np.zeros((1, 1)), sea=True)
        with full:
            ox, oy = full.transform.c, full.transform.f  # GDAL: immer Pixelecke
            rx, ry = full.transform.a, -full.transform.e
            nod = full.nodata
            n_ov = len(full.overviews(1))
            ov = min(overview, n_ov)
            src = full if ov == 0 else rasterio.open(url, overview_level=ov - 1)
            try:
                W, H = src.width, src.height
                dlon, dlat = rx * full.width / W, ry * full.height / H
                c0 = max(0, math.floor((west - ox) / dlon) - 2); c1 = min(W, math.ceil((east - ox) / dlon) + 2)
                r0 = max(0, math.floor((oy - north) / dlat) - 2); r1 = min(H, math.ceil((oy - south) / dlat) + 2)
                if c1 <= c0 or r1 <= r0:
                    return None
                a = src.read(1, window=Window(c0, r0, c1 - c0, r1 - r0)).astype(np.float64)
            finally:
                if src is not full:
                    src.close()
        bad = (a == nod) | ~((a > -1000) & (a < 10000))
        a[bad] = 0.0
        return GeoTile(ox + c0 * dlon, oy - r0 * dlat, dlon, dlat, a)

    jobs = [(la, lo) for la in range(math.floor(south), math.floor(north) + 1)
            for lo in range(math.floor(west), math.floor(east) + 1)]
    with cf.ThreadPoolExecutor(8) as ex:
        return [t for t in ex.map(lambda j: one(*j), jobs) if t is not None]


def _tile_at(tiles, lat, lon):
    for t in tiles:
        if t.lon0 <= lon <= t.lon0 + t.w * t.dlon and t.lat0 - t.h * t.dlat <= lat <= t.lat0:
            return t
    return None


def _value_at(tiles, t, r, c):
    if 0 <= r < t.h and 0 <= c < t.w:
        return t.z[r, c]
    lat, lon = t.lat0 - (r + 0.5) * t.dlat, t.lon0 + (c + 0.5) * t.dlon
    n = _tile_at(tiles, lat, lon)
    if n is not None and n is not t:
        if n.sea:
            return 0.0
        rr = min(max(math.floor((n.lat0 - lat) / n.dlat), 0), n.h - 1)
        cc = min(max(math.floor((lon - n.lon0) / n.dlon), 0), n.w - 1)
        return n.z[rr, cc]
    return t.z[min(max(r, 0), t.h - 1), min(max(c, 0), t.w - 1)]


def sample_geo(tiles, lat, lon):
    """Bilinear wie sampleGeo in JS (skalar; Referenz, nicht schnell)."""
    t = _tile_at(tiles, lat, lon)
    if t is None or t.sea:
        return 0.0
    c = (lon - t.lon0) / t.dlon - 0.5
    r = (t.lat0 - lat) / t.dlat - 0.5
    c0, r0 = math.floor(c), math.floor(r)
    fc, fr = c - c0, r - r0
    v = lambda rr, cc: _value_at(tiles, t, rr, cc)
    return ((1 - fr) * ((1 - fc) * v(r0, c0) + fc * v(r0, c0 + 1))
            + fr * ((1 - fc) * v(r0 + 1, c0) + fc * v(r0 + 1, c0 + 1)))


def sample_geo_grid(tiles, lat, lon):
    """Vektorisierte Variante für Gitter: innen bilinear je Kachel, Randpixel skalar wie oben."""
    lat = np.asarray(lat, float); lon = np.asarray(lon, float)
    out = np.zeros(lat.shape)
    done = np.zeros(lat.shape, bool)
    for t in tiles:
        m = (~done) & (lon >= t.lon0) & (lon <= t.lon0 + t.w * t.dlon) & (lat <= t.lat0) & (lat >= t.lat0 - t.h * t.dlat)
        if not m.any():
            continue
        done |= m
        if t.sea:
            continue
        c = (lon[m] - t.lon0) / t.dlon - 0.5
        r = (t.lat0 - lat[m]) / t.dlat - 0.5
        inner = (c >= 0) & (r >= 0) & (c <= t.w - 1) & (r <= t.h - 1)
        vals = np.empty(c.shape)
        c0 = np.minimum(np.floor(c[inner]).astype(int), t.w - 2); r0 = np.minimum(np.floor(r[inner]).astype(int), t.h - 2)
        fc = c[inner] - c0; fr = r[inner] - r0
        z = t.z
        vals[inner] = ((1 - fr) * ((1 - fc) * z[r0, c0] + fc * z[r0, c0 + 1]) + fr * ((1 - fc) * z[r0 + 1, c0] + fc * z[r0 + 1, c0 + 1]))
        idx = np.nonzero(~inner)[0]
        la, lo = lat[m][~inner], lon[m][~inner]
        for k, (a, b) in enumerate(zip(la, lo)):
            vals[idx[k]] = sample_geo(tiles, a, b)
        out[m] = vals
    return out


def geo_bounds_of(proj, b):
    xmin, ymin, xmax, ymax = b
    s = np.linspace(0, 1, 9)
    E = np.concatenate([xmin + (xmax - xmin) * s, xmin + (xmax - xmin) * s, np.full(9, xmin), np.full(9, xmax)])
    N = np.concatenate([np.full(9, ymin), np.full(9, ymax), ymin + (ymax - ymin) * s, ymin + (ymax - ymin) * s])
    lat, lon = proj.to_latlon(E, N)
    m = 0.002
    return lat.min() - m, lon.min() - m, lat.max() + m, lon.max() + m


def resample_to_grid(tiles, proj, b, res) -> Raster:
    xmin, ymin, xmax, ymax = b
    w, h = math.ceil((xmax - xmin) / res), math.ceil((ymax - ymin) / res)
    E, N = np.meshgrid(xmin + (np.arange(w) + 0.5) * res, ymax - (np.arange(h) + 0.5) * res)
    lat, lon = proj.to_latlon(E, N)
    return Raster(sample_geo_grid(tiles, lat, lon).astype(np.float32), xmin, ymax, float(res))


def load_terrain_world(b_area, proj, r_max=30000.0, lod=LOD_WORLD, base=COP30) -> Terrain:
    xmin, ymin, xmax, ymax = b_area
    levels = []
    for res, ov, until in lod:
        m = min(until, r_max) + 2 * res
        b = [round(v / res) * res for v in (xmin - m, ymin - m, xmax + m, ymax + m)]
        tiles = load_geo_tiles(*geo_bounds_of(proj, b), overview=ov, base=base)
        levels.append((resample_to_grid(tiles, proj, b, res), until))
    return Terrain(levels)
