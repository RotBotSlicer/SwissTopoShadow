"""Referenzfall: Bösbächibach (GL), 14.11.2026 – beobachteter Schatten um ca. 12:30."""
import numpy as np
import pandas as pd
import pytest

from schatten.coords import sun_position_lv95
from schatten.dem import load_terrain
from schatten.horizon import (horizon_map, intervals, lit_direct, lit_from_horizon,
                              lit_timeline, point_horizon)
from schatten.sun import to_unix

E, N = 2_719_286.0, 1_203_098.0
pytestmark = pytest.mark.network


@pytest.fixture(scope="module")
def terrain(cache_dir):
    return load_terrain((E - 300, N - 300, E + 300, N + 300), radius_far=10000, cache_dir=cache_dir)


def test_sun_window_boesbaechi(terrain):
    az = np.arange(0, 360, 0.25)
    h = point_horizon(terrain, E, N, az, eye=1.7, r_max=10000)
    t = pd.date_range("2026-11-14 06:00", "2026-11-14 18:00", freq="1min", tz="Europe/Zurich")
    u = to_unix(t)
    lit, *_ = lit_timeline(az, h, u, E, N)
    iv = intervals(u, lit)
    assert len(iv) == 1
    start = pd.Timestamp(iv[0][0], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    end = pd.Timestamp(iv[0][1], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    # mit Meridiankonvergenz: 10:08–10:56 (ohne: 10:08–10:50)
    assert abs((start - pd.Timestamp("2026-11-14 10:08", tz="Europe/Zurich")).total_seconds()) < 300
    assert abs((end - pd.Timestamp("2026-11-14 10:56", tz="Europe/Zurich")).total_seconds()) < 300
    # Beobachtung: um 12:30 Schatten
    i = t.get_loc(pd.Timestamp("2026-11-14 12:30", tz="Europe/Zurich"))
    assert not lit[i]


def test_horizon_map_vs_direct_real_terrain(terrain):
    xs = E + np.arange(-250, 250, 10.0)
    ys = N + np.arange(250, -250, -10.0)
    EE, NN = np.meshgrid(xs, ys)
    hm = horizon_map(terrain, EE, NN, n_az=180, r_max=10000, growth=0.01)
    for hhmm in ["10:30", "12:30", "14:30"]:
        u = to_unix(pd.Timestamp(f"2026-11-14 {hhmm}", tz="Europe/Zurich"))
        az, el = sun_position_lv95(u, E, N)
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
    az = np.arange(0, 360, 0.25)
    h = point_horizon(terrain_lod, E, N, az, eye=1.7, r_max=30000)
    t = pd.date_range("2026-11-14 06:00", "2026-11-14 18:00", freq="1min", tz="Europe/Zurich")
    u = to_unix(t)
    lit, *_ = lit_timeline(az, h, u, E, N)
    iv = intervals(u, lit)
    assert len(iv) == 1
    start = pd.Timestamp(iv[0][0], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    end = pd.Timestamp(iv[0][1], unit="s", tz="UTC").tz_convert("Europe/Zurich")
    assert abs((start - pd.Timestamp("2026-11-14 10:08", tz="Europe/Zurich")).total_seconds()) < 180
    assert abs((end - pd.Timestamp("2026-11-14 10:56", tz="Europe/Zurich")).total_seconds()) < 180


def test_sun_window_boesbaechi_with_surface(terrain_lod):
    """Mit Wald/Gebäude (swissSURFACE3D 1 m bis 300 m, 2 m bis 1 km): Strauch/Baum am Punkt kürzt die Sonne."""
    from schatten.dem import Terrain, read_surface

    s1 = read_surface((E - 350, N - 350, E + 350, N + 350), overview_level=0)
    s2 = read_surface((E - 1050, N - 1050, E + 1050, N + 1050), overview_level=1)
    t = Terrain([(s1, 300), (s2, 1000)] + terrain_lod.levels, ground_level=2)
    az = np.arange(0, 360, 0.25)
    h = point_horizon(t, E, N, az, eye=1.7, r_max=30000)
    tt = pd.date_range("2026-11-14 06:00", "2026-11-14 18:00", freq="1min", tz="Europe/Zurich")
    u = to_unix(tt)
    lit, *_ = lit_timeline(az, h, u, E, N)
    fmt = lambda x: pd.Timestamp(x, unit="s", tz="UTC").tz_convert("Europe/Zurich").strftime("%H:%M")
    assert [f"{fmt(a)}–{fmt(b)}" for a, b in intervals(u, lit)] == ["10:14–10:16", "10:20–10:50"]


def test_sun_window_boesbaechi_world_copernicus():
    """Weltweit-Modus am selben Ort: Copernicus 30 m in lokaler TM (09:42–10:49, swisstopo: 10:08–10:56)."""
    from schatten.coords import local_tm
    from schatten.world import load_terrain_world

    lat, lon = 46.968236, 9.006193
    p = local_tm(round(lat, 4), round(lon, 4))
    e, n = p.from_latlon(lat, lon)
    t = load_terrain_world((e - 50, n - 50, e + 50, n + 50), p, r_max=30000)
    az = np.arange(0, 360, 0.25)
    h = point_horizon(t, e, n, az, eye=1.7, r_max=30000)
    tt = pd.date_range("2026-11-14 06:00", "2026-11-14 18:00", freq="1min", tz="Europe/Zurich")
    u = to_unix(tt)
    lit, *_ = lit_timeline(az, h, u, e, n, p)
    fmt = lambda x: pd.Timestamp(x, unit="s", tz="UTC").tz_convert("Europe/Zurich").strftime("%H:%M")
    assert [f"{fmt(a)}–{fmt(b)}" for a, b in intervals(u, lit)] == ["09:42–10:49"]
