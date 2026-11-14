"""Geländehorizont, Schatten und Sonnenstunden.

Prinzip
-------
Für einen Ort P und eine Richtung (Azimut) läuft ein Strahl über das Gelände;
der Horizontwinkel ist das Maximum von atan((z(r) - z_P - eye - drop(r)) / r).
drop(r) = r² / (2R) · (1 - k) berücksichtigt Erdkrümmung und terrestrische
Refraktion (k ≈ 0.13).

Ein Ort ist besonnt, wenn die (scheinbare) Sonnenhöhe über dem Horizontwinkel
in Sonnenrichtung liegt. Alle Azimute hier sind Gitterazimute (LV95); der
Sonnenazimut wird dafür mit coords.sun_position_lv95 umgerechnet. Die Horizontkarte (n_az Richtungen je Pixel) wird
einmal gerechnet; danach ist der Schatten für jede Sonnenposition nur noch
eine Interpolation in Azimutrichtung.
"""
from __future__ import annotations

import numpy as np

from .coords import sun_position_grid

R_EARTH = 6371000.0
K_REFRACTION = 0.13


def ray_distances(terrain_or_res, r_max, growth=0.0, r_min=None):
    """Abtastdistanzen entlang eines Strahls.

    Schrittweite = Auflösung des an dieser Distanz verwendeten Levels
    (terrain.res_at(r)), bei growth > 0 mindestens growth·r.
    Statt eines Terrain-Objekts kann eine feste Auflösung übergeben werden.
    """
    res_at = (terrain_or_res.res_at if hasattr(terrain_or_res, "res_at")
              else (lambda r: float(terrain_or_res)))
    r = res_at(0.0) if r_min is None else r_min
    out = []
    while r <= r_max:
        out.append(r)
        r += max(res_at(r), growth * r)
    return np.asarray(out)


def _drop(r):
    return r * r / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)


def _rays(terrain, r_max, growth):
    return ray_distances(terrain, r_max, growth)


def point_horizon(terrain, E, N, az_deg, eye=1.7, r_max=15000.0, growth=0.0):
    """Horizontwinkel [°] eines einzelnen Punkts für die Azimute az_deg."""
    az = np.radians(np.asarray(az_deg, dtype=float))
    z0 = float(terrain.ground.sample(np.array([E]), np.array([N]))[0]) + eye
    best = np.full(az.shape, -np.inf)
    sa, ca = np.sin(az), np.cos(az)
    for r in _rays(terrain, r_max, growth):
        z = terrain.sample(E + sa * r, N + ca * r, r)
        np.maximum(best, (z - z0 - _drop(r)) / r, out=best)
    return np.degrees(np.arctan(best))


def horizon_map(terrain, E, N, n_az=72, eye=1.0, r_max=15000.0, growth=0.01, progress=None):
    """Horizontkarte für ein Gitter von Orten.

    E, N : 2D-Arrays (LV95). Rückgabe: float32-Array (n_az, *E.shape) in Grad,
    Azimute k·360/n_az, k = 0..n_az-1.
    """
    E = np.asarray(E, dtype=float)
    N = np.asarray(N, dtype=float)
    z0 = terrain.ground.sample(E, N) + eye
    rs = _rays(terrain, r_max, growth)
    drops = _drop(rs)
    out = np.empty((n_az,) + E.shape, dtype=np.float32)
    for k in range(n_az):
        a = np.radians(k * 360.0 / n_az)
        sa, ca = np.sin(a), np.cos(a)
        best = np.full(E.shape, -np.inf)
        for r, d in zip(rs, drops):
            z = terrain.sample(E + sa * r, N + ca * r, r)
            np.maximum(best, (z - z0 - d) / r, out=best)
        out[k] = np.degrees(np.arctan(best))
        if progress:
            progress(k + 1, n_az)
    return out


def lit_direct(terrain, E, N, sun_el, sun_az, eye=1.0, r_max=15000.0, growth=0.01):
    """Besonnt ja/nein durch direktes Abtasten in Sonnenrichtung (Referenz)."""
    E = np.asarray(E, dtype=float)
    N = np.asarray(N, dtype=float)
    if sun_el <= -1.0:
        return np.zeros(E.shape, bool)
    z0 = terrain.ground.sample(E, N) + eye
    a = np.radians(sun_az)
    t = np.tan(np.radians(sun_el))
    lit = np.ones(E.shape, bool)
    for r in _rays(terrain, r_max, growth):
        z = terrain.sample(E + np.sin(a) * r, N + np.cos(a) * r, r)
        lit &= (z - z0 - _drop(r)) / r < t
    return lit


def horizon_at(hmap, sun_az):
    """Horizontwinkel aus der Horizontkarte in Richtung sun_az (linear interpoliert)."""
    n = hmap.shape[0]
    x = (np.mod(sun_az, 360.0) / 360.0) * n
    k0 = int(np.floor(x)) % n
    f = x - np.floor(x)
    return (1 - f) * hmap[k0] + f * hmap[(k0 + 1) % n]


def lit_from_horizon(hmap, sun_el, sun_az):
    return sun_el > horizon_at(hmap, sun_az)


def lit_timeline(az_deg, horizon_deg, unix_s, E, N, proj=None):
    """Für einen Punkt (E, N) mit Horizontprofil (Gitterazimute): besonnt je Zeitpunkt.

    Rückgabe: lit, Sonnenazimut (Gitter), Sonnenhöhe, Horizont in Sonnenrichtung.
    """
    saz, sel = sun_position_grid(unix_s, E, N, proj)
    hz = np.interp(saz, az_deg, horizon_deg, period=360.0)
    return (sel > hz) & (sel > -0.833), saz, sel, hz


def intervals(unix_s, flags):
    """Zusammenhängende True-Abschnitte -> Liste (start, ende) in Unix-Sekunden."""
    flags = np.asarray(flags, bool)
    out, start = [], None
    for t, f in zip(unix_s, flags):
        if f and start is None:
            start = t
        if not f and start is not None:
            out.append((start, t))
            start = None
    if start is not None:
        out.append((start, unix_s[-1]))
    return out


def sun_hours_map(hmap, unix_day, E, N, step_min=5.0, proj=None):
    """Stunden direkter Sonne je Pixel über die Zeitpunkte unix_day (Schritt step_min).

    (E, N): Bezugsort für den Sonnenstand (z. B. Mitte des Ausschnitts).
    """
    saz, sel = sun_position_grid(unix_day, E, N, proj)
    acc = np.zeros(hmap.shape[1:], np.float32)
    for a, e in zip(saz, sel):
        if e > -0.833:
            acc += lit_from_horizon(hmap, e, a)
    return acc * step_min / 60.0
