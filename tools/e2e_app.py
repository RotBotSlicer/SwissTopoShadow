"""End-to-End-Test der App in Headless-Chrome (braucht Netz für swisstopo).

python tools/e2e_app.py [ausgabeordner_fuer_screenshots]
"""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
out = sys.argv[1] if len(sys.argv) > 1 else "."
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    kw = dict(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    if os.path.exists("/usr/bin/google-chrome"):
        kw["executable_path"] = "/usr/bin/google-chrome"
    if os.environ.get("HTTPS_PROXY"):
        kw["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1,localhost"}
    b = p.chromium.launch(**kw)
    ctx = b.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2)
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{srv.server_port}/")
    pg.evaluate("localStorage.clear()")
    pg.goto(f"http://127.0.0.1:{srv.server_port}/")
    pg.fill("#date", "2026-11-14"); pg.dispatch_event("#date", "change")
    pg.wait_for_timeout(2500)
    # Punkt: Bösbächibach
    pg.evaluate("__app.showPoint(46.968236, 9.006193)")
    pg.wait_for_function("document.getElementById('ivs').textContent.length > 0", timeout=120000)
    print("Punkt:", pg.inner_text("#summary"), "|", pg.inner_text("#ivs").replace("\n", ", "))
    pg.screenshot(path=f"{out}/e2e_punkt.png")
    # Ausschnitt
    pg.click("#area")
    pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel') || document.getElementById('area-status').textContent.includes('Fehler')", timeout=600000)
    print("Ausschnitt:", pg.inner_text("#area-status"))
    idx = pg.evaluate("__app.suns.findIndex(s => new Date(s.u*1000).toISOString().slice(11,16) === '11:30')")
    pg.evaluate(f"(() => {{ const t = document.getElementById('time'); t.value = {idx}; t.dispatchEvent(new Event('input')); }})()")
    pg.wait_for_timeout(4000)
    print("Zeit:", pg.inner_text("#timelbl"))
    pg.screenshot(path=f"{out}/e2e_schatten.png")
    pg.select_option("#mode", "hours")
    pg.wait_for_function("document.getElementById('area-status').textContent.startsWith('Sonnenstunden für')", timeout=900000)
    pg.screenshot(path=f"{out}/e2e_stunden.png")
    print("Fehler:", [e for e in errs if "favicon" not in e])
    b.close()
