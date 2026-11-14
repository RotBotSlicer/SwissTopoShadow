"""Koordinaten LV95 <-> WGS84 und Sonnenstand im LV95-Gitter.

Wichtig: Der Sonnenazimut bezieht sich auf geografisch Nord, die Strahlen im
Höhenmodell laufen aber im LV95-Gitter. Gitter-Nord und geografisch Nord
unterscheiden sich um die Meridiankonvergenz (in der Schweiz bis ~±2.5°,
z. B. Glarus −1.14°). Ohne Korrektur verschieben sich Sonnenzeiten an Hängen
um mehrere Minuten.
"""
from __future__ import annotations

import numpy as np

from .sun import sun_position

class Projection:
    """Ebenes Metergitter mit Umrechnung von/nach WGS84 (über pyproj)."""

    def __init__(self, crs, name=None):
        from pyproj import Transformer

        self.name = name or str(crs)
        self._inv = Transformer.from_crs(crs, 4326, always_xy=True)
        self._fwd = Transformer.from_crs(4326, crs, always_xy=True)

    def to_latlon(self, E, N):
        lon, lat = self._inv.transform(E, N)
        return lat, lon

    def from_latlon(self, lat, lon):
        return self._fwd.transform(lon, lat)


_LV95 = None


def lv95():
    """Schweiz: LV95 (EPSG:2056)."""
    global _LV95
    if _LV95 is None:
        _LV95 = Projection(2056, "LV95")
    return _LV95


def local_tm(lat0, lon0):
    """Weltweit: lokale Transversale Mercator (WGS84, k=1), Ursprung (lat0, lon0) = (0, 0)."""
    return Projection(f"+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84",
                      f"TM({lat0:.4f},{lon0:.4f})")


def lv95_to_wgs84(E, N):
    return lv95().to_latlon(E, N)


def wgs84_to_lv95(lat, lon):
    return lv95().from_latlon(lat, lon)


def grid_bearing_of_north(E, N, d=0.001, proj=None):
    """Gitterazimut [°] der Richtung geografisch Nord am Ort (E, N).

    Eine Richtung mit geografischem Azimut A hat den Gitterazimut A + g.
    """
    proj = proj or lv95()
    lat, lon = proj.to_latlon(E, N)
    E2, N2 = proj.from_latlon(np.asarray(lat) + d, lon)
    return np.degrees(np.arctan2(E2 - np.asarray(E), N2 - np.asarray(N)))


def sun_position_grid(unix_s, E, N, proj=None, apparent=True):
    """Sonnenazimut im Gitter (Grad ab Gitter-Nord) und Sonnenhöhe am Ort (E, N)."""
    proj = proj or lv95()
    lat, lon = proj.to_latlon(E, N)
    az, el = sun_position(unix_s, lat, lon, apparent)
    return np.mod(az + grid_bearing_of_north(E, N, proj=proj), 360.0), el


def sun_position_lv95(unix_s, E, N, apparent=True):
    return sun_position_grid(unix_s, E, N, lv95(), apparent)
