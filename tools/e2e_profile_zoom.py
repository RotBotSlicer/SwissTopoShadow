"""Profil zoomen: Pinch mit zwei Fingern (Touch-Ereignisse über CDP), Verschieben, Doppeltipp setzt zurück."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    ctx = b.new_context(locale="de-CH", viewport={"width": 420, "height": 800}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear()"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.evaluate("__app.setView(47.0405, 9.0680, 14)"); pg.wait_for_timeout(500)
    pg.evaluate("__app.showPoint(47.0405, 9.0680)")
    pg.wait_for_function("document.getElementById('summary').textContent.length>0", timeout=600000)
    if pg.get_attribute("#ptoggle", "aria-pressed") != "true": pg.click("#ptoggle")
    pg.wait_for_timeout(500)
    pg.locator("#profile").screenshot(path="zoom0.png")
    bx = pg.locator("#chart").bounding_box(); cx, cy = bx["x"] + bx["width"] * 0.7, bx["y"] + bx["height"] * 0.6
    cdp = ctx.new_cdp_session(pg)
    def touch(kind, ps): cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(ps)]})
    touch("touchStart", [(cx - 20, cy), (cx + 20, cy)])
    for s in range(1, 11): touch("touchMove", [(cx - 20 - 10 * s, cy - 3 * s), (cx + 20 + 10 * s, cy + 3 * s)])
    touch("touchEnd", [])
    pg.wait_for_timeout(300)
    labels = pg.evaluate("[...document.querySelectorAll('#chart text')].map(t=>t.textContent)")
    k = pg.evaluate("document.getElementById('preset').hidden")
    print("nach Pinch: Zurück-Knopf sichtbar:", not k, "| Achsen:", [l for l in labels if '°' in l][:12])
    assert not k
    pg.locator("#profile").screenshot(path="zoom1.png")
    before = pg.evaluate("document.querySelector('#chart path[fill=\"#9b9d96\"]').getAttribute('d').slice(0,40)")
    touch("touchStart", [(cx, cy)])
    for s in range(1, 8): touch("touchMove", [(cx - 15 * s, cy)])
    touch("touchEnd", []); pg.wait_for_timeout(200)
    after = pg.evaluate("document.querySelector('#chart path[fill=\"#9b9d96\"]').getAttribute('d').slice(0,40)")
    print("verschoben:", before != after); assert before != after
    for _ in range(2): touch("touchStart", [(cx, cy)]); touch("touchEnd", []); pg.wait_for_timeout(80)
    pg.wait_for_timeout(200)
    print("Doppeltipp zurückgesetzt:", pg.evaluate("document.getElementById('preset').hidden"))
    assert pg.evaluate("document.getElementById('preset').hidden")
    print("Fehler:", errs); assert not errs
    b.close()
