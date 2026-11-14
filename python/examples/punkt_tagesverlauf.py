"""Beispiel: Sonnen-/Schattenzeiten für einen Punkt an einem Tag.

python examples/punkt_tagesverlauf.py 2719286 1203098 2026-11-14
"""
import os
import sys

import numpy as np
import pandas as pd

from schatten.dem import load_terrain
from schatten.horizon import intervals, lit_timeline, point_horizon
from schatten.sun import to_unix

E, N = float(sys.argv[1]), float(sys.argv[2])
day = sys.argv[3] if len(sys.argv) > 3 else pd.Timestamp.now().strftime("%Y-%m-%d")
cache = os.environ.get("SCHATTEN_CACHE", os.path.expanduser("~/.cache/schatten/swissalti3d"))

terrain = load_terrain((E - 300, N - 300, E + 300, N + 300), radius_far=10000, cache_dir=cache)
az = np.arange(0, 360, 0.25)
h = point_horizon(terrain, E, N, az, eye=1.7, r_max=10000)
t = pd.date_range(f"{day} 00:00", f"{day} 23:59", freq="1min", tz="Europe/Zurich")
u = to_unix(t)
lit, saz, sel, hz = lit_timeline(az, h, u, E, N)
fmt = lambda x: pd.Timestamp(x, unit="s", tz="UTC").tz_convert("Europe/Zurich").strftime("%H:%M")
print(f"Punkt {E:.0f}/{N:.0f}, {day}")
for a, b in intervals(u, lit):
    print(f"  Sonne {fmt(a)} – {fmt(b)}")
print(f"  total {lit.sum() / 60:.2f} h direkte Sonne")
