"""Baut die Grobmodell-Pyramide (40/80/160 m) aus swissALTIRegio.

python tools/build_pyramid.py <ausgabeordner>     (~8 min, ~130 MB)
"""
import sys
import time

from schatten.pyramid import build

t = time.time()
build(sys.argv[1], log=lambda m: print(f"{time.time() - t:6.0f}s {m}", flush=True))
