"""3D-Abdeckung: Umriss der gerechneten Bereiche; Knopf meldet „Ansicht geändert“, wenn die Ansicht nicht mehr abgedeckt ist."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
done = "document.getElementById('area-status').textContent.includes('Pixel')||document.getElementById('area-status').textContent.includes('Fehler')"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = b.new_page(viewport={"width": 1000, "height": 760}, locale="de-CH"); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false')"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.evaluate("__app.setView(46.9682, 9.0062, 14)"); pg.wait_for_timeout(1500)
    pg.click("#area"); pg.wait_for_function(done, timeout=900000)
    print("2D gerechnet:", pg.inner_text("#area"), "| Umrisse:", pg.evaluate("__app.mv.map.getSource('outline').serialize().data.features.length"))
    assert "↻" not in pg.inner_text("#area")
    pg.click("#t3d"); pg.wait_for_timeout(3000)
    pg.evaluate("__app.mv.map.jumpTo({bearing: 60})"); pg.wait_for_timeout(3000)
    print("3D gedreht:", pg.inner_text("#area")); assert "↻" in pg.inner_text("#area")
    pg.click("#area"); pg.wait_for_function(done, timeout=900000); pg.wait_for_timeout(1500)
    print("3D neu gerechnet:", pg.inner_text("#area"), "| Ebenen:", pg.evaluate("__app.area.layers.length"),
          "| Umrisse:", pg.evaluate("__app.mv.map.getSource('outline').serialize().data.features.length"))
    assert "↻" not in pg.inner_text("#area")
    pg.evaluate("document.getElementById('sheet').classList.add('collapsed')"); pg.wait_for_timeout(5000)
    pg.screenshot(path="coverage.png")
    print("Fehler:", errs); assert not errs
    b.close()
