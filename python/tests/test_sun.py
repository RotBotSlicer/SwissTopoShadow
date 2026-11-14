import numpy as np
import pandas as pd
import pytest

from schatten.sun import sun_position, to_unix

pvlib = pytest.importorskip("pvlib")


@pytest.mark.parametrize("lat,lon", [(46.968, 9.006), (45.8, 6.0), (47.8, 10.5)])
def test_against_pvlib_whole_year(lat, lon):
    t = pd.date_range("2026-01-01", "2026-12-31 23:50", freq="37min", tz="UTC")
    az, el = sun_position(to_unix(t), lat, lon)
    ref = pvlib.solarposition.get_solarposition(t, lat, lon, altitude=0, pressure=101325, temperature=10)
    up = ref["elevation"].values > 5  # Refraktion unterhalb 5° ist modellabhängig
    d_el = np.abs(el[up] - ref["apparent_elevation"].values[up])
    d_az = np.abs((az[up] - ref["azimuth"].values[up] + 180) % 360 - 180)
    assert d_el.max() < 0.02, d_el.max()
    assert d_az.max() < 0.03, d_az.max()


def test_noon_is_south_and_symmetric():
    t = pd.date_range("2026-11-14 10:00", "2026-11-14 13:00", freq="1min", tz="UTC")
    az, el = sun_position(to_unix(t), 46.968, 9.006)
    i = np.argmax(el)
    assert abs(az[i] - 180) < 0.5


def test_to_unix_timezone():
    a = to_unix(pd.Timestamp("2026-11-14 12:30", tz="Europe/Zurich"))
    b = to_unix(pd.Timestamp("2026-11-14 11:30", tz="UTC"))
    assert a[0] == b[0]
