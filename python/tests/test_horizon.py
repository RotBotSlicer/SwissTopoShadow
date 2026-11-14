import numpy as np
import pytest

from schatten.dem import Raster, Terrain
from schatten.horizon import (horizon_map, lit_direct, lit_from_horizon, point_horizon,
                              ray_distances)

E0, N0 = 2_600_000.0, 1_200_000.0
AZ = np.arange(0, 360, 1.0)


def make_terrain(fn, half=3000.0, res_f=2.0, res_c=10.0, r_split=500.0):
    def ras(res):
        n = int(2 * half / res)
        c = E0 - half + (np.arange(n) + 0.5) * res
        r = N0 + half - (np.arange(n) + 0.5) * res
        EE, NN = np.meshgrid(c, r)
        return Raster(fn(EE - E0, NN - N0), E0 - half, N0 + half, res)
    return Terrain.two(ras(res_f), ras(res_c), r_split)


def test_flat_plane_has_horizon_just_below_zero():
    t = make_terrain(lambda x, y: np.zeros_like(x))
    h = point_horizon(t, E0, N0, AZ, eye=1.7, r_max=2500)
    assert h.max() < 0 and h.min() > -1.0


def test_wall_in_the_south():
    H, d = 100.0, 400.0  # 100 m hohe Wand, 400 m südlich
    t = make_terrain(lambda x, y: np.where(y < -d, H, 0.0))
    h = point_horizon(t, E0, N0, [180.0], eye=1.7, r_max=2500)[0]
    expected = np.degrees(np.arctan((H - 1.7) / d))
    assert abs(h - expected) < 0.3, (h, expected)
    # Richtung Norden: frei
    assert point_horizon(t, E0, N0, [0.0], eye=1.7, r_max=2500)[0] < 0


@pytest.mark.parametrize("slope_deg", [10.0, 30.0])
def test_inclined_plane(slope_deg):
    s = np.tan(np.radians(slope_deg))
    t = make_terrain(lambda x, y: -s * y)  # steigt nach Süden an
    h = point_horizon(t, E0, N0, [180.0, 90.0], eye=1.0, r_max=2500)
    assert abs(h[0] - slope_deg) < 0.3, h
    assert abs(h[1]) < 0.5, h  # quer zum Hang ~ horizontal


def test_coarse_used_beyond_split_and_as_fallback():
    # feines Raster nur im Zentrum vorhanden, Berg nur im groben Raster
    t = make_terrain(lambda x, y: np.where(np.hypot(x, y + 2000) < 300, 500.0, 0.0))
    small = make_terrain(lambda x, y: np.zeros_like(x), half=400)
    t = Terrain.two(small.fine, t.levels[1][0], r_split=1000)
    h = point_horizon(t, E0, N0, [180.0], eye=1.0, r_max=2500)[0]
    assert h > 10


def test_ray_distances_growth():
    t = Terrain.two(Raster(np.zeros((2, 2)), 0, 0, 2.0), Raster(np.zeros((2, 2)), 0, 0, 10.0), 1000)
    r0 = ray_distances(t, 15000, growth=0.0)
    r1 = ray_distances(t, 15000, growth=0.01)
    assert np.allclose(np.diff(r0)[:10], 2.0) and np.allclose(np.diff(r0)[-10:], 10.0)
    assert len(r1) < len(r0) / 3 and r1[-1] <= 15000


def hills(x, y):
    rng = np.random.default_rng(1)
    z = np.zeros_like(x)
    for _ in range(25):
        cx, cy = rng.uniform(-2500, 2500, 2)
        a, w = rng.uniform(50, 400), rng.uniform(150, 600)
        z += a * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * w * w))
    return z


def test_horizon_map_matches_direct_raytrace():
    t = make_terrain(hills, res_f=5.0, res_c=20.0)
    xs = E0 + np.arange(-500, 500, 25.0)
    ys = N0 + np.arange(500, -500, -25.0)
    EE, NN = np.meshgrid(xs, ys)
    hm = horizon_map(t, EE, NN, n_az=180, r_max=2800, growth=0.0)
    agree = []
    for el, az in [(5, 120), (12, 150), (20, 181), (8, 233), (15, 270), (3, 95)]:
        a = lit_from_horizon(hm, el, az)
        b = lit_direct(t, EE, NN, el, az, r_max=2800, growth=0.0)
        agree.append((a == b).mean())
    assert min(agree) > 0.98, agree


# ---------------------------------------------------------------- Oberfläche (Wald/Gebäude)
def make_surface_terrain(forest, half=1500.0):
    """Level 0: Oberfläche (Boden + Wald), Level 1: Boden (flach), Level 2: grob."""
    def ras(res, fn):
        n = int(2 * half / res)
        c = E0 - half + (np.arange(n) + 0.5) * res
        r = N0 + half - (np.arange(n) + 0.5) * res
        EE, NN = np.meshgrid(c, r)
        return Raster(fn(EE - E0, NN - N0), E0 - half, N0 + half, res)
    flat = lambda x, y: np.zeros_like(x)
    surf = lambda x, y: np.where(forest(x, y), 25.0, 0.0)
    return Terrain([(ras(2.0, surf), 1000), (ras(2.0, flat), 1000), (ras(10.0, flat), np.inf)], ground_level=1)


def test_forest_edge_casts_shadow_on_open_ground():
    t = make_surface_terrain(lambda x, y: y < -100)  # Waldrand 100 m südlich
    h = point_horizon(t, E0, N0, [180.0], eye=1.7, r_max=1400)[0]
    assert abs(h - np.degrees(np.arctan((25 - 1.7) / 100))) < 0.5, h


def test_under_canopy_is_shaded_but_canopy_top_is_not():
    t = make_surface_terrain(lambda x, y: np.hypot(x, y) < 300)  # Wald um den Punkt
    h_ground = point_horizon(t, E0, N0, [90.0, 180.0, 270.0], eye=1.7, r_max=1400)
    assert h_ground.min() > 80  # unter den Kronen: Strahl trifft sofort Kronen
    top = Terrain(t.levels, ground_level=0)  # Standort auf Kronenhöhe
    assert point_horizon(top, E0, N0, [180.0], eye=1.7, r_max=1400)[0] < 1


def test_surface_gaps_fall_back_to_ground():
    t = make_surface_terrain(lambda x, y: y < -100)
    z = t.levels[0][0].z.copy(); z[:] = np.nan  # Oberfläche ohne Daten
    t2 = Terrain([(Raster(z, t.levels[0][0].x0, t.levels[0][0].y0, 2.0), 1000)] + t.levels[1:], ground_level=1)
    assert point_horizon(t2, E0, N0, [180.0], eye=1.7, r_max=1400)[0] < 0
