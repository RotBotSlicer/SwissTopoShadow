import numpy as np
import pytest

from schatten.pyramid import TILE, Pyramid, aggregate_max, build, decode_tile, encode_tile


def test_roundtrip_with_nodata_and_extremes():
    rng = np.random.default_rng(3)
    z = rng.uniform(-400, 4800, (TILE, TILE)).astype(np.float32)
    z[::7, ::5] = np.nan
    z[0, :] = [4800 if i % 2 else -400 for i in range(TILE)]  # grosse Sprünge -> Überlauf im Prädiktor
    out = decode_tile(encode_tile(z))
    ok = np.isfinite(z)
    assert np.array_equal(np.isnan(out), ~ok)
    assert np.all(out[ok] == np.ceil(z[ok]))


def test_aggregate_max_handles_nan():
    z = np.arange(16, dtype=np.float32).reshape(4, 4)
    z[0:2, 0:2] = np.nan
    g = aggregate_max(z, 2)
    assert np.isnan(g[0, 0]) and g[0, 1] == 7 and g[1, 1] == 15


def test_build_and_read_small_cog(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    W, H = 5000, 4200  # > 1 Arbeitsblock (4096), mit Rand
    x0, y0 = 2_600_000.0, 1_250_000.0
    yy, xx = np.mgrid[0:H, 0:W]
    z = (1000 + 800 * np.sin(xx / 300) * np.cos(yy / 450)).astype(np.float32)
    z[:100, :100] = -9999  # keine Daten
    src = tmp_path / "dem.tif"
    with rasterio.open(src, "w", driver="GTiff", width=W, height=H, count=1, dtype="float32",
                       crs="EPSG:2056", transform=from_origin(x0, y0, 10, 10), nodata=-9999,
                       tiled=True, blockxsize=256, blockysize=256) as d:
        d.write(z, 1)
    out = tmp_path / "pyr"
    m = build(str(out), str(src), workers=2, log=None)
    per = TILE * 40 // 10  # 10-m-Pixel pro 40-m-Kachel
    assert len(m["levels"][0]["tiles"]) == -(-W // per) * -(-H // per)
    p = Pyramid(str(out))
    for res in (40, 80, 160):
        r = p.raster(res, (x0 + 2000, y0 - 30000, x0 + 45000, y0 - 2000))
        E, N = r.coords()
        # Stichprobe: Kachelwert = Max der 10-m-Zellen im Block
        f = res // 10
        i, j = 30, 40
        e0 = int((E[j] - res / 2 - x0) / 10); n0 = int((y0 - (N[i] + res / 2)) / 10)
        assert r.z[i, j] == np.ceil(z[n0:n0 + f, e0:e0 + f].max())
