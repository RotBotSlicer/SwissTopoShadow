"""Sonnenstand nach dem NOAA-Algorithmus (Meeus-Näherung).

Bewusst ohne Abhängigkeiten ausser numpy und in einfachen Formeln gehalten,
damit dieselbe Rechnung 1:1 nach JavaScript portiert werden kann.
Genauigkeit gegenüber SPA/pvlib: typ. < 0.01° für 1950–2050.

Konventionen
------------
- Zeit: Unix-Sekunden (UTC). Hilfsfunktion `to_unix` nimmt datetime/str/np.datetime64.
- Azimut: Grad ab Norden im Uhrzeigersinn (90 = Ost, 180 = Süd).
- Höhe: Grad über dem mathematischen Horizont; `apparent=True` inkl. Refraktion.
"""
from __future__ import annotations

import numpy as np

DEG = np.pi / 180.0


def to_unix(t) -> np.ndarray:
    """Zeitangabe(n) -> Unix-Sekunden (float). Naive Zeiten gelten als UTC."""
    try:
        import pandas as pd  # optional, bequem für Zeitzonen

        idx = pd.DatetimeIndex(np.atleast_1d(t))
        if idx.tz is not None:
            idx = idx.tz_convert("UTC").tz_localize(None)
        return idx.values.astype("datetime64[ns]").astype(np.int64) / 1e9
    except ImportError:  # pragma: no cover
        return np.atleast_1d(np.asarray(t, dtype="datetime64[ns]")).astype(np.int64) / 1e9


def refraction_deg(elev_true_deg):
    """Atmosphärische Refraktion (NOAA-Näherung) in Grad."""
    e = np.asarray(elev_true_deg, dtype=float)
    te = np.tan(np.clip(e, -89.0, 89.0) * DEG)
    r = np.zeros_like(e)  # Bogensekunden
    m1 = (e > 5.0) & (e <= 85.0)
    r[m1] = 58.1 / te[m1] - 0.07 / te[m1] ** 3 + 0.000086 / te[m1] ** 5
    m2 = (e > -0.575) & (e <= 5.0)
    x = e[m2]
    r[m2] = 1735.0 + x * (-518.2 + x * (103.4 + x * (-12.79 + x * 0.711)))
    m3 = e <= -0.575
    r[m3] = -20.772 / te[m3]
    return r / 3600.0


def sun_position(unix_s, lat_deg: float, lon_deg: float, apparent: bool = True):
    """Sonnenazimut und -höhe in Grad.

    Parameters
    ----------
    unix_s : array_like  Unix-Sekunden (UTC)
    lat_deg, lon_deg : float  WGS84 (Ost positiv)

    Returns
    -------
    azimuth_deg, elevation_deg : np.ndarray
    """
    u = np.asarray(unix_s, dtype=float)
    jd = u / 86400.0 + 2440587.5
    T = (jd - 2451545.0) / 36525.0

    L0 = np.mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360.0)
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = M * DEG
    C = (np.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
         + np.sin(2 * Mr) * (0.019993 - 0.000101 * T)
         + np.sin(3 * Mr) * 0.000289)
    true_long = L0 + C
    omega = (125.04 - 1934.136 * T) * DEG
    lam = (true_long - 0.00569 - 0.00478 * np.sin(omega)) * DEG

    eps0 = 23.0 + (26.0 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60.0) / 60.0
    eps = (eps0 + 0.00256 * np.cos(omega)) * DEG

    decl = np.arcsin(np.sin(eps) * np.sin(lam))

    y = np.tan(eps / 2.0) ** 2
    L0r = L0 * DEG
    eot_min = 4.0 / DEG * (y * np.sin(2 * L0r) - 2 * e * np.sin(Mr)
                           + 4 * e * y * np.sin(Mr) * np.cos(2 * L0r)
                           - 0.5 * y * y * np.sin(4 * L0r) - 1.25 * e * e * np.sin(2 * Mr))

    minutes_utc = np.mod(u, 86400.0) / 60.0
    tst = np.mod(minutes_utc + eot_min + 4.0 * lon_deg, 1440.0)
    ha = (tst / 4.0 - 180.0) * DEG

    lat = lat_deg * DEG
    cosz = np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(ha)
    zen = np.arccos(np.clip(cosz, -1.0, 1.0))
    elev = 90.0 - zen / DEG

    az = np.arctan2(np.sin(ha), np.cos(ha) * np.sin(lat) - np.tan(decl) * np.cos(lat)) / DEG + 180.0
    az = np.mod(az, 360.0)

    if apparent:
        elev = elev + refraction_deg(elev)
    return az, elev
