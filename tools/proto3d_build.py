"""Daten für den 3D-Prototyp (fester Ort, feste Zeiten).

Erzeugt unter web/proto3d/data/:
  dtm/{z}/{x}/{y}.png   Höhenkacheln Boden (Terrarium-Kodierung), z10–15
  dsm/{z}/{x}/{y}.png   Höhenkacheln Oberfläche mit Wald/Gebäuden (nur z14–15, darunter = Boden)
  shadow_{dtm|dsm}_{hhmm}.png   Schattenebene (Web-Mercator-ausgerichtet) für einige Zeiten
  meta.json

python tools/proto3d_build.py      (braucht Netz; Cache wie die Tests: $SCHATTEN_CACHE)
"""
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
from schatten.coords import lv95_to_wgs84, sun_position_lv95, wgs84_to_lv95  # noqa: E402
from schatten.dem import Terrain, load_terrain_lod, read_regio  # noqa: E402
from schatten.horizon import lit_direct  # noqa: E402
from schatten.pyramid import Pyramid  # noqa: E402
from schatten.sun import to_unix  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "web", "proto3d", "data")
CACHE = os.environ.get("SCHATTEN_CACHE", os.path.expanduser("~/.cache/schatten/swissalti3d"))
E0, N0 = 2719286.0, 1203098.0           # Bösbächibach
DAY, TIMES = "2026-11-14", ["10:30", "12:30", "14:30"]
SHADOW_HALF = 2000.0                      # Schattenebene ±2 km
SHADOW_PX = 900
RADIUS = {15: 3000, 14: 6000, 13: 12000, 12: 25000, 11: 40000, 10: 40000}  # Kachelumkreis je Zoom


def tile_range(z, lat, lon, r_m):
    n = 2 ** z
    mpp = 40075016.686 * math.cos(math.radians(lat)) / n  # Meter pro Kachel
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    d = r_m / mpp
    return range(int(x - d), int(x + d) + 1), range(int(y - d), int(y + d) + 1)


def tile_latlon(z, x, y, size=256):
    n = 2 ** z
    px = (np.arange(size) + 0.5) / size
    lon = (x + px) / n * 360 - 180
    yy = (y + px) / n
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * yy))))
    LON, LAT = np.meshgrid(lon, lat)
    return LAT, LON


def terrarium(h):
    v = np.round(np.nan_to_num(h, nan=0.0) * 10) / 10 + 32768
    r = np.floor(v / 256)
    g = np.floor(v) - r * 256
    b = np.floor((v - np.floor(v)) * 256)
    return np.dstack([r, g, b]).clip(0, 255).astype(np.uint8)


def main():
    t0 = time.time()
    lat0, lon0 = lv95_to_wgs84(E0, N0)
    pyr = Pyramid(os.path.join(ROOT, "data", "pyramid"))
    area = (E0 - SHADOW_HALF, N0 - SHADOW_HALF, E0 + SHADOW_HALF, N0 + SHADOW_HALF)
    print("Lade Gelände …", flush=True)
    tS = load_terrain_lod(area, CACHE, pyr, r_max=30000, surface=True)  # Oberfläche, Boden, 10 m, Pyramide
    t0D = Terrain(tS.levels[1:])                                        # nur Boden
    regio_wide = read_regio((E0 - 13000, N0 - 13000, E0 + 13000, N0 + 13000))
    p40 = pyr.raster(40, (E0 - 45000, N0 - 45000, E0 + 45000, N0 + 45000))
    dsm, dtm = tS.levels[0][0], tS.levels[1][0]
    print(f"  {time.time() - t0:.0f} s", flush=True)

    def sample(srcs, E, N):
        z = np.full(E.shape, np.nan)
        for ras in srcs:
            miss = ~np.isfinite(z)
            if not miss.any():
                break
            v = ras.sample(E[miss], N[miss]).astype(float)
            v[v < -1000] = np.nan
            z[miss] = v
        return z

    # ---------------------------------------------------------------- Höhenkacheln
    n_tiles = 0
    for z, r in RADIUS.items():
        xs, ys = tile_range(z, lat0, lon0, r)
        for x in xs:
            for y in ys:
                LAT, LON = tile_latlon(z, x, y)
                E, N = wgs84_to_lv95(LAT, LON)
                E, N = np.asarray(E), np.asarray(N)
                srcs = [dtm, regio_wide, p40] if z >= 13 else [regio_wide, p40]
                h = sample(srcs, E, N)
                for name, hh in [("dtm", h)] + ([("dsm", sample([dsm], E, N))] if z >= 14 else []):
                    if name == "dsm":
                        hh = np.where(np.isfinite(hh), hh, h)
                    d = os.path.join(OUT, name, str(z), str(x))
                    os.makedirs(d, exist_ok=True)
                    Image.fromarray(terrarium(hh)).save(os.path.join(d, f"{y}.png"), optimize=True)
                    n_tiles += 1
        print(f"  Zoom {z}: fertig ({time.time() - t0:.0f} s)", flush=True)

    # ---------------------------------------------------------------- Schattenebene
    lat_s, lon_w = lv95_to_wgs84(E0 - SHADOW_HALF, N0 - SHADOW_HALF)
    lat_n, lon_e = lv95_to_wgs84(E0 + SHADOW_HALF, N0 + SHADOW_HALF)
    south, north, west, east = min(lat_s, lat_n), max(lat_s, lat_n), min(lon_w, lon_e), max(lon_w, lon_e)
    my = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
    yy = my(north) + (my(south) - my(north)) * (np.arange(SHADOW_PX) + 0.5) / SHADOW_PX
    lat = np.degrees(2 * np.arctan(np.exp(yy)) - np.pi / 2)
    lon = west + (east - west) * (np.arange(SHADOW_PX) + 0.5) / SHADOW_PX
    LON, LAT = np.meshgrid(lon, lat)
    E, N = (np.asarray(v) for v in wgs84_to_lv95(LAT, LON))
    suns = {}
    for hhmm in TIMES:
        u = to_unix(pd.Timestamp(f"{DAY} {hhmm}", tz="Europe/Zurich"))
        az, el = sun_position_lv95(u, E0, N0)
        suns[hhmm] = {"az": float(az[0]), "el": float(el[0])}
        for name, ter in [("dtm", t0D), ("dsm", tS)]:
            lit = lit_direct(ter, E, N, float(el[0]), float(az[0]), eye=1.0, r_max=30000, growth=0.01)
            rgba = np.zeros(lit.shape + (4,), np.uint8)
            rgba[~lit] = (26, 33, 82, 150)
            Image.fromarray(rgba).save(os.path.join(OUT, f"shadow_{name}_{hhmm.replace(':', '')}.png"), optimize=True)
            print(f"  Schatten {name} {hhmm}: {lit.mean() * 100:.0f} % besonnt ({time.time() - t0:.0f} s)", flush=True)

    meta = {"center": [lon0, lat0], "day": DAY, "times": TIMES, "sun": suns,
            "shadow_bounds": [[west, north], [east, north], [east, south], [west, south]],
            "zoom": [min(RADIUS), max(RADIUS)], "tiles": n_tiles}
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
    print("fertig", meta, f"{time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
