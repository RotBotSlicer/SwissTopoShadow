"""Profil: Horizont nach Ursache eingefärbt (Gelände grau, Wald grün, Gebäude rot). Aufruf: lat lon bild.png"""
import functools, http.server, os, threading, sys
from playwright.sync_api import sync_playwright
root=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=root))
srv.RequestHandlerClass.log_message=lambda *a: None
threading.Thread(target=srv.serve_forever,daemon=True).start()
lat,lon=float(sys.argv[1]),float(sys.argv[2])
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"],proxy={"server":os.environ["HTTPS_PROXY"],"bypass":"127.0.0.1"})
    pg=b.new_page(viewport={"width":420,"height":800},device_scale_factor=2, locale="de-CH"); errs=[]
    pg.on("pageerror",lambda e: errs.append(str(e))); pg.on("console",lambda m: m.type=="error" and errs.append(m.text))
    u=f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false')"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.fill("#date","2026-11-15"); pg.dispatch_event("#date","change")
    if not pg.is_checked("#surface"): pg.check("#surface")
    pg.evaluate(f"__app.setView({lat},{lon},16)"); pg.wait_for_timeout(1000)
    pg.evaluate(f"__app.showPoint({lat},{lon})")
    pg.wait_for_function("document.getElementById('summary').textContent.length>0",timeout=600000)
    if pg.get_attribute("#ptoggle","aria-pressed")!="true": pg.click("#ptoggle")
    pg.wait_for_timeout(1000)
    print(pg.inner_text("#psum"), "|", pg.inner_text("#lg-obj"))
    print("Klassen:", pg.evaluate("(()=>{const c=__app.point.cls;const n=[0,0,0];c.forEach(v=>n[v]++);return n})()"))
    pg.locator("#profile").screenshot(path=sys.argv[3])
    print("Fehler:",errs); b.close()
