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

_T = {}


def _tr(a, b):
    if (a, b) not in _T:
        from pyproj import Transformer

        _T[(a, b)] = Transformer.from_crs(a, b, always_xy=True)
    return _T[(a, b)]


def lv95_to_wgs84(E, N):
    lon, lat = _tr(2056, 4326).transform(E, N)
    return lat, lon


def wgs84_to_lv95(lat, lon):
    return _tr(4326, 2056).transform(lon, lat)


def grid_bearing_of_north(E, N, d=0.001):
    """Gitterazimut [°] der Richtung geografisch Nord am Ort (E, N).

    Eine Richtung mit geografischem Azimut A hat den Gitterazimut A + g.
    """
    lat, lon = lv95_to_wgs84(E, N)
    E2, N2 = wgs84_to_lv95(np.asarray(lat) + d, lon)
    return np.degrees(np.arctan2(E2 - np.asarray(E), N2 - np.asarray(N)))


def sun_position_lv95(unix_s, E, N, apparent=True):
    """Sonnenazimut im LV95-Gitter (Grad ab Gitter-Nord) und Sonnenhöhe am Ort (E, N)."""
    lat, lon = lv95_to_wgs84(E, N)
    az, el = sun_position(unix_s, lat, lon, apparent)
    return np.mod(az + grid_bearing_of_north(E, N), 360.0), el
