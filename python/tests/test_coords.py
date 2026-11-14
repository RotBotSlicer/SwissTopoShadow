import numpy as np
import pytest

from schatten.coords import grid_bearing_of_north, sun_position_lv95
from schatten.sun import sun_position

pyproj = pytest.importorskip("pyproj")


@pytest.mark.parametrize("E,N", [(2600000, 1200000), (2719286, 1203098), (2830000, 1180000), (2500000, 1120000)])
def test_grid_bearing_matches_pyproj_convergence(E, N):
    from schatten.coords import lv95_to_wgs84

    lat, lon = lv95_to_wgs84(E, N)
    conv = pyproj.Proj("EPSG:2056").get_factors(lon, lat).meridian_convergence
    assert abs(grid_bearing_of_north(E, N) + conv) < 0.002


def test_bern_has_no_convergence_glarus_about_minus_1_14():
    assert abs(grid_bearing_of_north(2600000, 1200000)) < 0.01
    assert abs(grid_bearing_of_north(2719286, 1203098) + 1.144) < 0.01


def test_sun_position_lv95_rotates_azimuth_only():
    from schatten.coords import lv95_to_wgs84

    u = np.array([1.79e9])
    E, N = 2719286, 1203098
    lat, lon = lv95_to_wgs84(E, N)
    a0, e0 = sun_position(u, lat, lon)
    a1, e1 = sun_position_lv95(u, E, N)
    assert np.allclose(e0, e1) and abs((a1 - a0)[0] + 1.144) < 0.01
