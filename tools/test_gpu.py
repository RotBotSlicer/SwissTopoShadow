"""Führt js/test/browser/gpu.html in Headless-Chrome aus (Vergleich GPU vs. CPU).

python tools/test_gpu.py [--real | --surface]   (mit echten swisstopo-Daten, braucht Netz)
"""
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/js/test/browser/gpu.html" + ("#real" if "--real" in sys.argv else "#surface" if "--surface" in sys.argv else "")
with sync_playwright() as p:
    kw = dict(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    if os.path.exists("/usr/bin/google-chrome"):
        kw["executable_path"] = "/usr/bin/google-chrome"
    if os.environ.get("HTTPS_PROXY"):
        kw["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1,localhost"}
    b = p.chromium.launch(**kw)
    pg = b.new_page()
    pg.on("console", lambda m: m.type == "error" and print("console:", m.text))
    pg.goto(url)
    pg.wait_for_function("window.__results && window.__results.at(-1) === 'FERTIG'", timeout=900000)
    res = pg.evaluate("window.__results")
    b.close()
bad = False
for r in res:
    print(json.dumps(r, ensure_ascii=False))
    if isinstance(r, dict):
        bad |= "error" in r or (r.get("test") != "lod-vergleich" and r.get("agree", 1) < 0.995) or r.get("maxdiff_h", 0) > 10 / 60 + 1e-6
sys.exit(1 if bad else 0)
