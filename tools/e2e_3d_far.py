"""3D: Schatten deckt die ganze schräge Ansicht ab (feiner Nahbereich + grober Fernbereich bis zum Horizont)."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
root=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=root))
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"],proxy={"server":os.environ["HTTPS_PROXY"],"bypass":"127.0.0.1"})
    pg=b.new_page(viewport={"width":420,"height":800},device_scale_factor=1); errs=[]
    pg.on("pageerror",lambda e: errs.append(str(e)))
    pg.on("console",lambda m: m.type=="error" and errs.append(m.text))
    u=f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear()"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.fill("#date","2026-11-14"); pg.dispatch_event("#date","change")
    pg.evaluate("__app.setView(46.9682, 9.0062, 13)"); pg.wait_for_timeout(800)
    pg.click("#t3d"); pg.wait_for_timeout(6000)
    print("pitch", pg.evaluate("__app.mv.map.getPitch()"), pg.inner_text("#area"))
    print("near", pg.evaluate("__app.mv.nearBounds()")); 
    pg.click("#area"); pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel')",timeout=900000)
    print(pg.inner_text("#area-status"))
    print("layers", pg.evaluate("__app.area.layers.map(L=>[L.id,L.grid.w,L.grid.h,L.renderer.hole])"))
    pg.evaluate("(()=>{const t=document.getElementById('time');t.value=Math.floor(__app.suns.length*0.25);t.dispatchEvent(new Event('input'))})()")
    pg.wait_for_timeout(15000)
    pg.evaluate("document.getElementById('sheet').classList.add('collapsed')"); pg.wait_for_timeout(3000)
    pg.screenshot(path="./far.png"); assert len(pg.evaluate("__app.area.layers")) == 2, "kein Fernbereich"
    print("Fehler:",errs); b.close()
