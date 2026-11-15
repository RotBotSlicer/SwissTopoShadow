"""3D mit Nah- und Fernbereich: beim Verschieben der Zeit muss auch der Fernbereich neu gezeichnet werden.
Prüfung: Bild nach Zeitwechsel == Bild nach zusätzlichem Neuzeichnen der Karte (kleiner Zoom hin und zurück)."""
import functools, http.server, os, threading, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
def diff(a, b):  # Anzahl deutlich verschiedener Pixel im oberen Bildteil (Fernbereich)
    a, b = [Image.open(io.BytesIO(x)).convert("L") for x in (a, b)]
    w, h = a.size; box = (0, int(h * 0.05), w, int(h * 0.45))
    d = ImageChops.difference(a.crop(box), b.crop(box))
    return sum(1 for v in d.get_flattened_data() if v > 12)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = b.new_page(viewport={"width": 900, "height": 700}, locale="de-CH"); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear()"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.fill("#date", "2026-11-14"); pg.dispatch_event("#date", "change")
    import sys
    view = sys.argv[1] if len(sys.argv) > 1 else "glarus"
    if view == "zermatt":  # wie Bildschirmaufnahme: Luftbild, von Norden Richtung Matterhorn/Monte Rosa
        pg.click("#base-air"); pg.click("#t3d"); pg.wait_for_timeout(2000)
        pg.evaluate("__app.mv.map.jumpTo({center:[7.75,46.00], zoom:11.6, pitch:68, bearing:195})"); pg.wait_for_timeout(8000)
    else:
        pg.evaluate("__app.setView(46.9682, 9.0062, 13)"); pg.wait_for_timeout(800)
        pg.click("#t3d"); pg.wait_for_timeout(4000)
    pg.click("#area"); pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel')", timeout=900000)
    assert pg.evaluate("__app.area.layers.length") == 2, "kein Fernbereich"
    pg.evaluate("document.getElementById('sheet').classList.add('collapsed')")
    def at(frac):
        pg.evaluate(f"(()=>{{const t=document.getElementById('time');t.value=Math.floor(__app.suns.length*{frac});t.dispatchEvent(new Event('input'))}})()")
        pg.wait_for_timeout(9000); return pg.screenshot()
    def refreshed():
        z = pg.evaluate("__app.mv.map.getZoom()")
        pg.evaluate(f"__app.mv.map.jumpTo({{zoom:{z}+0.3}})"); pg.wait_for_timeout(3000)
        pg.evaluate(f"__app.mv.map.jumpTo({{zoom:{z}}})"); pg.wait_for_timeout(9000); return pg.screenshot()
    at(0.5); pg.wait_for_timeout(25000)  # erst alles laden lassen (Software-Rendering ist langsam)
    a = at(0.2); a2 = refreshed()
    bb = at(0.8); b2 = refreshed()
    print("Zeitwechsel ändert Fernbereich:", diff(a, bb), "| veraltet nach Zeitwechsel:", diff(bb, b2), "| Referenz (ohne Wechsel):", diff(a, a2))
    assert diff(a, bb) > 2000, "Fernbereich ändert sich nicht"
    assert diff(bb, b2) < max(500, 2 * diff(a, a2) + 200), "Fernbereich nach Zeitwechsel veraltet"
    print("Fehler:", errs); assert not errs
    b.close()
