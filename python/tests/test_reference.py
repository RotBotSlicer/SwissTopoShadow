"""Referenzfall: Bösbächibach (GL), 14.11.2026 – beobachteter Schatten um ca. 12:30."""
import numpy as np
import pandas as pd
import pytest

from schatten.dem import load_terrain, lv95_to_wgs84
from schatten.horizon import (horizon_map, intervals, lit_direct, lit_from_horizon,
                              lit_timeline, point_horizon)
from schatten.sun import sun_position, to_unix

E, N = 2_719_286.0, 1_203_098.0
pytestmark = pytest.mark.network


@pytest.fixture(scope="module")
def terrain(cache_dir):
    return load_terrain((E - 300, N - 300, E + 300, N + 300), radius_far=10000, cache_dir=cache_dir)


def test_sun_window_boesbaechi(terrain):
    lat, lon = lv95_to_wgs84(E, N)
    az = np.arange(0, 360, 0.25)
    h = point_horizon(terrain, E, N, az, eye=1.7, r_max=10000)
    t = pd.date_range("2026-11-14 06:00", "2026-11-14 18:00", freq="1min", tz="Europe/Zurich")
    u = to_unix(t)
    lit, *_ = lit_timeline(az, h, u, lat, lon)
    iv = intervals(u, lit)
    assert len(iv) == 1
    start = pd.Timestamp(iv[0][0], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    end = pd.Timestamp(iv[0][1], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    # Erstrechnung vom 14.11.: 10:08–10:50
    assert abs((start - pd.Timestamp("2026-11-14 10:08", tz="Europe/Zurich")).total_seconds()) < 300
    assert abs((end - pd.Timestamp("2026-11-14 10:50", tz="Europe/Zurich")).total_seconds()) < 300
    # Beobachtung: um 12:30 Schatten
    i = t.get_loc(pd.Timestamp("2026-11-14 12:30", tz="Europe/Zurich"))
    assert not lit[i]


def test_horizon_map_vs_direct_real_terrain(terrain):
    lat, lon = lv95_to_wgs84(E, N)
    xs = E + np.arange(-250, 250, 10.0)
    ys = N + np.arange(250, -250, -10.0)
    EE, NN = np.meshgrid(xs, ys)
    hm = horizon_map(terrain, EE, NN, n_az=180, r_max=10000, growth=0.01)
    for hhmm in ["10:30", "12:30", "14:30"]:
        u = to_unix(pd.Timestamp(f"2026-11-14 {hhmm}", tz="Europe/Zurich"))
        az, el = sun_position(u, lat, lon)
        a = lit_from_horizon(hm, el[0], az[0])
        b = lit_direct(terrain, EE, NN, el[0], az[0], r_max=10000, growth=0.01)
        assert (a == b).mean() > 0.97, hhmm


@pytest.fixture(scope="module")
def terrain_lod(cache_dir):
    import os

    from schatten.dem import load_terrain_lod
    from schatten.pyramid import Pyramid

    base = os.environ.get("SCHATTEN_PYRAMID")
    if not base:
        pytest.skip("SCHATTEN_PYRAMID (Pfad/URL der Kachelpyramide) nicht gesetzt")
    return load_terrain_lod((E - 50, N - 50, E + 50, N + 50), cache_dir, Pyramid(base), r_max=30000)


def test_sun_window_boesbaechi_lod(terrain_lod):
    """Gleicher Referenzfall mit dem App-Geländeschema (2 m / 10 m / Pyramide, 30 km)."""
    lat, lon = lv95_to_wgs84(E, N)
    az = np.arange(0, 360, 0.25)
    h = point_horizon(terrain_lod, E, N, az, eye=1.7, r_max=30000)
    t = pd.date_range("2026-11-14 06:00", "2026-11-14 18:00", freq="1min", tz="Europe/Zurich")
    u = to_unix(t)
    lit, *_ = lit_timeline(az, h, u, lat, lon)
    iv = intervals(u, lit)
    assert len(iv) == 1
    start = pd.Timestamp(iv[0][0], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    end = pd.Timestamp(iv[0][1], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    assert abs((start - pd.Timestamp("2026-11-14 10:08", tz="Europe/Zurich")).total_seconds()) < 180
    assert abs((end - pd.Timestamp("2026-11-14 10:50", tz="Europe/Zurich")).total_seconds()) < 180
