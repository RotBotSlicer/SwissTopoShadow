"""App-Test Weltweit in Headless-Chrome (braucht Netz): Punkt und Ausschnitt an Orten ausserhalb der Schweiz."""
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
    pg = b.new_page(viewport={"width": 400, "height": 620}, device_scale_factor=2)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and "tile.opentopomap" not in m.text and errs.append(m.text))
    pg.goto(f"http://127.0.0.1:{srv.server_port}/"); pg.wait_for_timeout(1500)
    pg.fill("#date", "2026-11-14"); pg.dispatch_event("#date", "change")
    # in der Schweiz-Einstellung ausserhalb: Hinweis
    pg.evaluate("__app.map.setView([47.5622, 13.6493], 14, {animate:false})"); pg.wait_for_timeout(800)
    print("CH ausserhalb:", pg.inner_text("#area"), "|", pg.inner_text("#region-info"))
    pg.click("#reg-world"); pg.wait_for_timeout(800)
    print("Weltweit Knopf:", pg.inner_text("#area"))
    for lat, lon, name in [(47.5622, 13.6493, "Hallstatt"), (27.8069, 86.7140, "Namche Bazar")]:
        pg.evaluate(f"__app.map.setView([{lat}, {lon}], 14, {{animate:false}})"); pg.wait_for_timeout(800)
        pg.evaluate("document.getElementById('summary').textContent=''")
        pg.evaluate(f"__app.showPoint({lat}, {lon})")
        pg.wait_for_function("document.getElementById('summary').textContent.length>0 || document.getElementById('status').textContent.startsWith('Fehler')", timeout=300000)
        print(name, "Punkt:", pg.inner_text("#where"), "|", pg.inner_text("#summary"), "|", pg.inner_text("#ivs").replace("\n", ", "), "|", pg.inner_text("#status"))
    pg.evaluate("__app.map.setView([47.5622, 13.6493], 14, {animate:false})"); pg.wait_for_timeout(800)
    pg.click("#area")
    pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel')||document.getElementById('area-status').textContent.includes('Fehler')", timeout=900000)
    print("Ausschnitt Hallstatt:", pg.inner_text("#area-status"), "| Zeit", pg.inner_text("#timelbl"))
    pg.wait_for_timeout(4000)
    pg.screenshot(path=f"{out}/welt_hallstatt.png")
    print("Fehler:", errs)
    b.close()
