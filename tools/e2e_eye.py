"""Höhe über Boden am Punkt: höher = Horizont tiefer = mehr Sonne; Wert bleibt gespeichert; kein Neuladen des Geländes."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = b.new_page(viewport={"width": 420, "height": 800}, locale="de-CH"); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("request", lambda r: "swisssurface3d" in r.url and reqs.append(r.url))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false')"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.fill("#date", "2026-11-15"); pg.dispatch_event("#date", "change")
    lat, lon = 46.686170746527125, 7.687102884026622  # Spiez, zwischen Häusern und Bäumen
    pg.evaluate(f"__app.setView({lat},{lon},16)"); pg.evaluate(f"__app.showPoint({lat},{lon})")
    pg.wait_for_function("document.getElementById('summary').textContent.length>0", timeout=600000)
    low = pg.inner_text("#summary"); hmean = lambda: pg.evaluate("__app.point.h.reduce((a,v)=>a+v,0)/__app.point.h.length")
    h1 = hmean(); n0 = len(reqs)
    pg.fill("#eye", "30"); pg.dispatch_event("#eye", "change")
    pg.wait_for_function("document.getElementById('summary').textContent.length>0 && __app.point && Math.abs(__app.point.h.reduce((a,v)=>a+v,0)/__app.point.h.length - %f) > 0.01" % h1, timeout=600000)
    high = pg.inner_text("#summary"); h2 = hmean()
    print(f"1.7 m: {low} (Horizont Ø {h1:.2f}°) | 30 m: {high} (Ø {h2:.2f}°) | neu geladen: {len(reqs) - n0} | {pg.inner_text('#canopy')}")
    assert h2 < h1 and len(reqs) == n0
    pg.reload(); pg.wait_for_timeout(2000); assert pg.input_value("#eye") == "30"
    print("Fehler:", errs); assert not errs
    b.close()
