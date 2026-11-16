"""3D-Gebäude Teil 2: unsere Schattenkarte liegt auf den Häusern.
Ablauf: Ausschnitt rechnen (Gebäude aus), Zeit wählen, dann Gebäude einschalten (keine Kamerafahrt mehr – SwiftShader).
Bilder: normal, Diagnose 1 (Sonnenseite rot), Diagnose 2 (Schattenkarte: rot = Schatten, blau = Sonne), ohne Schatten (Gegenprobe).
Prüft: Häuser im Schatten sind dunkler als ohne Schattenkarte, und die Diagnose zeigt beide Fälle."""
import functools, http.server, os, sys, threading, io
from playwright.sync_api import sync_playwright
from PIL import Image
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
LAT, LON, DATE, FRAC, BEAR = float(os.environ.get("LAT", 47.4688)), float(os.environ.get("LON", 8.7575)), os.environ.get("DATE", "2026-12-16"), float(os.environ.get("FRAC", 0.8)), int(os.environ.get("BEAR", 0))
def img(png): return Image.open(io.BytesIO(png)).convert("RGB")
def dbg(page, d): page.evaluate(f"__app.shadeDebug({d}).then(() => __app.mv.map.triggerRepaint())"); page.wait_for_timeout(2500)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                           proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = br.new_page(viewport={"width": 900, "height": 700}, locale="de-CH"); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500)
    pg.evaluate(f"localStorage.clear(); localStorage.setItem('buildings3d','false'); localStorage.setItem('date', JSON.stringify('{DATE}')); localStorage.setItem('dateSet', JSON.stringify('{DATE}'))")
    pg.goto(u); pg.wait_for_timeout(1500)
    pg.fill("#date", DATE); pg.dispatch_event("#date", "change")
    pg.click("#base-air"); pg.evaluate(f"__app.setView({LAT}, {LON}, 16.3)"); pg.click("#t3d"); pg.wait_for_timeout(3000)
    pg.evaluate(f"__app.mv.map.jumpTo({{pitch:60, bearing:{BEAR}}})"); pg.wait_for_timeout(5000)
    pg.click("#area"); pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel')||document.getElementById('area-status').textContent.includes('Fehler')", timeout=900000)
    pg.evaluate(f"(()=>{{const t=document.getElementById('time');t.value=Math.floor(__app.suns.length*{FRAC});t.dispatchEvent(new Event('input'))}})()")
    pg.wait_for_timeout(4000)
    pg.check("#bld"); pg.wait_for_timeout(25000)
    clip = {"x": 0, "y": 0, "width": 900, "height": 450}
    shots = {}
    for name, d in (("normal", 0), ("sonnenseite", 1), ("karte", 2), ("aus", -1)):
        dbg(pg, d); shots[name] = img(pg.screenshot(clip=clip)); shots[name].save(f"/tmp/shade_{name}.png")
    print("Fehler:", errs, flush=True)
    br.close()
k = shots["karte"]; red = blue = 0
for r, g, b in k.get_flattened_data():
    if g < 40 and r > 150 and b < 100: red += 1
    elif g < 40 and b > 150 and r < 100: blue += 1
print("Diagnose Schattenkarte – Hauspixel im Schatten:", red, "| an der Sonne:", blue)
# Gegenprobe: dieselben Hauspixel (im Schatten laut Diagnose) mit und ohne Schattenkarte
def mean(im, sel): v = [sum(im.getpixel(xy)) / 3 for xy in sel]; return round(sum(v) / max(1, len(v)), 1)
W, H = k.size
inS = [(x, y) for y in range(0, H, 2) for x in range(0, W, 2) if (lambda c: c[1] < 40 and c[0] > 150 and c[2] < 100)(k.getpixel((x, y)))]
inL = [(x, y) for y in range(0, H, 2) for x in range(0, W, 2) if (lambda c: c[1] < 40 and c[2] > 150 and c[0] < 100)(k.getpixel((x, y)))]
mS, aS, mL, aL = mean(shots["normal"], inS), mean(shots["aus"], inS), mean(shots["normal"], inL), mean(shots["aus"], inL)
print("Helligkeit Häuser im Schatten – mit:", mS, "ohne:", aS, "| an der Sonne – mit:", mL, "ohne:", aL)
assert not errs, errs
assert red > 200 and blue > 200, "Schattenkarte auf den Häusern zeigt nicht beide Fälle"
assert mS < aS - 3, "Häuser im Schatten werden nicht dunkler"
assert abs(mL - aL) < 4, "Häuser an der Sonne verändern sich"
