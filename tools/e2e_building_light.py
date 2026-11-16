"""3D-Gebäude: Beleuchtung nach Sonnenstand. Mittags (Sonne im Süden) sind Südfassaden hell, Nordfassaden dunkel.
Blick nach Norden zeigt die Südfassaden, Blick nach Süden die Nordfassaden – verglichen wird die Helligkeit der Wandpixel."""
import functools, http.server, os, threading, io
from playwright.sync_api import sync_playwright
from PIL import Image
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
def walls(png):  # helle, gelbliche Wandpixel (Luftbild hat davon kaum welche): Anteil und Helligkeit
    im = Image.open(io.BytesIO(png)).convert("RGB"); v = []
    for r, g, b in im.get_flattened_data():
        if r > 150 and g > 140 and abs(r - g) < 30 and 30 <= r - b <= 120: v.append((r + g + b) / 3)
    white = sum(1 for r, g, b in im.crop((60, 0, 840, 380)).get_flattened_data() if r > 248 and g > 248 and b > 245)  # überbelichtet (ohne Knöpfe/Menü)
    return len(v), round(sum(v) / max(1, len(v)), 1), white
with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                           proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    res = {}
    for bearing in (0, 180):
        pg = br.new_page(viewport={"width": 900, "height": 700}, locale="de-CH"); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        u = f"http://127.0.0.1:{srv.server_port}/"
        pg.goto(u); pg.wait_for_timeout(1500)
        pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false'); localStorage.setItem('date', JSON.stringify('2026-06-21')); localStorage.setItem('dateSet', JSON.stringify('2026-06-21'))")
        pg.goto(u); pg.wait_for_timeout(1500)
        pg.fill("#date", "2026-06-21"); pg.dispatch_event("#date", "change")
        pg.click("#base-air"); pg.evaluate("__app.setView(47.4688, 8.7575, 16.3)"); pg.click("#t3d"); pg.wait_for_timeout(3000)
        pg.evaluate(f"__app.mv.map.jumpTo({{pitch:60, bearing:{bearing}}})"); pg.wait_for_timeout(5000)
        pg.check("#bld"); pg.wait_for_timeout(25000)
        shot = pg.screenshot(clip={"x": 0, "y": 0, "width": 900, "height": 450})
        open(f"/tmp/light_{bearing}.png", "wb").write(shot)
        res[bearing] = walls(shot); print(bearing, res[bearing], errs, flush=True)
        pg.close()
    print("helle Wandpixel – Südfassaden (Blick N):", res[0][0], "| Nordfassaden (Blick S):", res[180][0])
    assert max(res[0][2], res[180][2]) < 400, f"überbelichtete Dächer/Wände: {res[0][2]}, {res[180][2]} Pixel reinweiss"
    assert res[0][0] > 2 * res[180][0] + 50, "Südfassaden mittags nicht heller als Nordfassaden"
    br.close()
