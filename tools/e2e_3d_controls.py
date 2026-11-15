"""3D-Steuerung: Knöpfe drehen/kippen (tippen und halten), Safari-Trackpad-Gesten (gesture*), Umschalt/Option + scrollen."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = b.new_page(viewport={"width": 1100, "height": 800}, locale="de-CH"); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false')"); pg.goto(u); pg.wait_for_timeout(1500)
    cam = lambda: pg.evaluate("({b: __app.mv.map.getBearing(), p: __app.mv.map.getPitch(), z: __app.mv.map.getZoom()})")
    pg.evaluate("__app.setView(46.9682, 9.0062, 15)"); pg.wait_for_timeout(800)  # fester Ort (Software-Rendering ist bei grossem Gelände zu langsam)
    assert pg.is_hidden(".orbit-ctrl"), "Steuerung in 2D sichtbar"
    pg.click("#t3d"); pg.wait_for_timeout(2500)
    assert pg.is_visible(".orbit-ctrl") and pg.is_visible("#toast")
    print("Hinweis:", pg.inner_text("#toast"))
    print("Knöpfe:", pg.evaluate("[...document.querySelectorAll('.orbit-ctrl button')].map(b=>b.getAttribute('aria-label'))"))
    c0 = cam()
    pg.click(".orbit-ctrl button[data-i18n-aria=orbitRight]"); pg.wait_for_timeout(500)
    c1 = cam(); print("Tippen rechts:", round(c1["b"] - c0["b"], 1)); assert 12 < c1["b"] - c0["b"] < 18
    btn = pg.locator(".orbit-ctrl button[data-i18n-aria=orbitLeft]"); bb = btn.bounding_box()
    pg.mouse.move(bb["x"] + 10, bb["y"] + 10); pg.mouse.down(); pg.wait_for_timeout(1500); pg.mouse.up(); pg.wait_for_timeout(300)
    c2 = cam(); print("Halten links 1.5 s:", round(c2["b"] - c1["b"], 1), flush=True); assert c2["b"] - c1["b"] < -40
    pg.click(".orbit-ctrl button[data-i18n-aria=tiltDown]"); pg.wait_for_timeout(500)
    c3 = cam(); print("Kippen von oben:", round(c3["p"] - c2["p"], 1)); assert c3["p"] < c2["p"] - 5
    # Safari-Gesten nachbilden
    pg.evaluate("""(() => { const el = __app.mv.map.getContainer(), ev = (t, o) => { const e = new Event(t, {cancelable: true}); Object.assign(e, o); el.dispatchEvent(e); };
      ev('gesturestart', {rotation: 0, scale: 1}); ev('gesturechange', {rotation: 30, scale: 2}); ev('gestureend', {rotation: 30, scale: 2}); })()""")
    c4 = cam(); print("Geste drehen 30°, Zoom ×2:", round(c4["b"] - c3["b"], 1), round(c4["z"] - c3["z"], 2))
    assert abs((c4["b"] - c3["b"]) % 360 - 330) < 1 and abs(c4["z"] - c3["z"] - 1) < 0.05
    box = pg.locator("#map").bounding_box(); pg.mouse.move(box["x"] + 500, box["y"] + 300)
    pg.keyboard.down("Shift"); pg.mouse.wheel(0, -100); pg.keyboard.up("Shift"); pg.wait_for_timeout(200)
    c5 = cam(); print("Umschalt+scrollen:", round(c5["p"] - c4["p"], 1), "Zoom gleich:", abs(c5["z"] - c4["z"]) < 0.01)
    assert c5["p"] > c4["p"] + 5 and abs(c5["z"] - c4["z"]) < 0.01
    pg.screenshot(path="/tmp/controls.png")
    pg.click("#t3d"); pg.wait_for_timeout(800); assert pg.is_hidden(".orbit-ctrl")
    print("Fehler:", errs); assert not errs
    b.close()
