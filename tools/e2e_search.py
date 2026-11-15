"""Ortssuche im Browser. Die Suchdienste werden mit festen Antworten nachgebildet (in der Testumgebung nicht erreichbar)."""
import functools, http.server, json, os, threading
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
GEO = {"results": [{"attrs": {"label": "<i>Gipfel</i> <b>Glärnisch</b> (GL)", "lat": 46.9989, "lon": 8.9986, "origin": "gazetteer"}}]}
PH = {"features": [{"properties": {"name": "Matterhorn", "state": "Valais", "country": "Italia", "osm_value": "peak"},
                    "geometry": {"type": "Point", "coordinates": [7.6586, 45.9763]}},
                   {"properties": {"name": "Zugspitze", "country": "Deutschland", "osm_value": "peak"},
                    "geometry": {"type": "Point", "coordinates": [10.9863, 47.4211]}}]}
calls = []
def geo(route):
    calls.append(route.request.url)
    body = GEO if "Gl%C3%A4rnisch" in route.request.url or "Glärnisch" in route.request.url else {"results": []}
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))
def ph(route):
    calls.append(route.request.url)
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(PH))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = b.new_page(viewport={"width": 420, "height": 800}); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/api3.geo.admin.ch/**", geo); pg.route("**/photon.komoot.io/**", ph)
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear()"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.click("#sbtn"); pg.fill("#sq", "Glärnisch"); pg.wait_for_selector("#sres li")
    print("Treffer CH:", pg.inner_text("#sres").replace("\n", " | "))
    pg.keyboard.press("Enter"); pg.wait_for_timeout(500)
    c = pg.evaluate("__app.mv.center()"); assert abs(c["lat"] - 46.9989) < 1e-3 and pg.is_hidden("#search"), c
    pg.wait_for_function("document.getElementById('summary').textContent.length>0", timeout=600000)
    print("Punkt:", pg.inner_text("#summary"))
    pg.click("#sbtn"); pg.fill("#sq", "Matterhorn"); pg.wait_for_selector("#sres li >> text=Zugspitze")
    print("Treffer (Rückfall weltweit):", pg.inner_text("#sres").replace("\n", " | "))
    pg.click("#sres li >> text=Zugspitze"); pg.wait_for_timeout(500)
    reg = pg.get_attribute("#reg-world", "aria-checked")
    print("Gebiet weltweit:", reg); assert reg == "true"
    assert len([c for c in calls if "geo.admin" in c]) >= 2 and any("photon" in c for c in calls)
    pg.screenshot(path="search.png")
    print("Fehler:", errs); assert not errs
    b.close()
