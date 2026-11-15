"""3D: feiner Bereich (2 m + Wald/Gebäude) reicht weit ins Bild und schliesst den Boden unter der Kamera ein (Hügel im Vordergrund)."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")))
srv.RequestHandlerClass.log_message=lambda *a: None
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"],proxy={"server":os.environ["HTTPS_PROXY"],"bypass":"127.0.0.1"})
    pg=b.new_page(viewport={"width":1000,"height":760},locale="de-CH"); errs=[]; pg.on("pageerror",lambda e: errs.append(str(e)))
    u=f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false')"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.evaluate("__app.setView(47.4688, 8.7575, 15.5)"); pg.click("#base-air"); pg.click("#t3d"); pg.wait_for_timeout(4000)
    pg.evaluate("__app.mv.map.jumpTo({pitch:65, bearing:20})"); pg.wait_for_timeout(5000)
    print(pg.inner_text("#area"))
    pg.click("#area"); pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel')||document.getElementById('area-status').textContent.includes('Fehler')", timeout=900000)
    print(pg.inner_text("#area-status"))
    print(pg.evaluate("__app.area.layers.map(L=>[L.id, L.grid.w, L.grid.h, L.grid.pixelSize.toFixed(1)])"))
    pg.evaluate("(()=>{const t=document.getElementById('time');t.value=Math.floor(__app.suns.length*0.7);t.dispatchEvent(new Event('input'))})()")
    pg.wait_for_timeout(12000); pg.screenshot(path="near_area.png")
    L = pg.evaluate("__app.area.layers.map(L=>[L.id, L.grid.pixelSize])")
    assert L[-1][0] == "near" and L[-1][1] <= 4, L
    assert "Wald" in pg.inner_text("#area-status")
    print("Fehler", errs); assert not errs; b.close()
