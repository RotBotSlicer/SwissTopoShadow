import numpy as np

from schatten.coords import local_tm
from schatten.world import GeoTile, cop30_tile_name, geo_bounds_of, resample_to_grid, sample_geo, sample_geo_grid

f = lambda lat, lon: 1000 + 2000 * (lat - 46) + 500 * (lon - 9)


def tile(lat0, lon0, w, h):
    dlon, dlat = 1 / w, 1 / h
    lat = lat0 + 1 - (np.arange(h) + 0.5) * dlat
    lon = lon0 + (np.arange(w) + 0.5) * dlon
    LO, LA = np.meshgrid(lon, lat)
    return GeoTile(lon0, lat0 + 1, dlon, dlat, f(LA, LO))


def test_tile_names():
    assert cop30_tile_name(46, 9) == "Copernicus_DSM_10_N46_00_E009_00_DEM"
    assert cop30_tile_name(-34, -71) == "Copernicus_DSM_10_S34_00_W071_00_DEM"


def test_sample_geo_interior_and_border():
    tiles = [tile(46, 9, 360, 360), tile(46, 10, 240, 360), GeoTile(11, 47, 1, 1, np.zeros((1, 1)), sea=True)]
    for lat, lon, tol in [(46.5, 9.5, 1e-6), (46.123, 9.987, 1e-6), (46.9, 10.3, 1e-6), (46.2, 10.9, 1e-6), (46.31, 9.9995, 0.5), (46.31, 10.0004, 0.5)]:
        assert abs(sample_geo(tiles, lat, lon) - f(lat, lon)) < tol
    assert sample_geo(tiles, 46.5, 11.5) == 0
    rng = np.random.default_rng(0)
    lat = rng.uniform(46.01, 46.99, 400); lon = rng.uniform(9.0, 10.99, 400)
    g = sample_geo_grid(tiles, lat, lon)
    s = np.array([sample_geo(tiles, a, b) for a, b in zip(lat, lon)])
    assert np.allclose(g, s, atol=1e-9)


def test_resample_to_grid_local_tm():
    p = local_tm(46.5, 9.5)
    r = resample_to_grid([tile(46, 9, 360, 360)], p, (-3000, -3000, 3000, 3000), 30)
    E, N = r.coords()
    EE, NN = np.meshgrid(E, N)
    lat, lon = p.to_latlon(EE, NN)
    assert np.abs(r.z - f(lat, lon)).max() < 0.02
    s, w, n, e = geo_bounds_of(p, (-3000, -3000, 3000, 3000))
    assert s < 46.473 and n > 46.527 and w < 9.461 and e > 9.539
