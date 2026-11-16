"""3D-Gebäude: Flachdächer dürfen bei tiefer Sonne nicht reinweiss werden (swisstopo-Material roughness 0).
Gegenprobe mit globalThis.__noMatte: dann müssen weisse Pixel auftreten."""
import functools, http.server, os, threading, io
from playwright.sync_api import sync_playwright
from PIL import Image
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")))
srv.RequestHandlerClass.log_message=lambda *a: None
threading.Thread(target=srv.serve_forever,daemon=True).start()
def run(p, nomatte):
    br=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"],proxy={"server":os.environ["HTTPS_PROXY"],"bypass":"127.0.0.1"})
    pg=br.new_page(viewport={"width":900,"height":700},locale="en-GB"); errs=[]; pg.on("pageerror",lambda e: errs.append(str(e)))
    u=f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear(); localStorage.setItem('buildings3d','false')"); pg.goto(u); pg.wait_for_timeout(1500)
    pg.fill("#date","2026-12-16"); pg.dispatch_event("#date","change")
    pg.click("#base-air"); pg.evaluate("__app.setView(47.4688, 8.7575, 16.3)"); pg.click("#t3d"); pg.wait_for_timeout(3000)
    pg.evaluate("__app.mv.map.jumpTo({pitch:60, bearing:-30})"); pg.wait_for_timeout(5000)
    pg.click("#area"); pg.wait_for_function("document.getElementById('area-status').textContent.includes('pixels')", timeout=600000)
    pg.evaluate("(()=>{const t=document.getElementById('time');const i=__app.suns.findIndex(s=>new Date(s.u*1000).getUTCHours()*60+new Date(s.u*1000).getUTCMinutes()>=14*60+10);t.value=i;t.dispatchEvent(new Event('input'))})()")
    if nomatte: pg.evaluate("globalThis.__noMatte=true")
    pg.check("#bld"); pg.wait_for_timeout(25000)
    print(pg.inner_text("#timelbl"), "| eye label:", pg.inner_text(".eye-row span") if pg.locator(".eye-row span").count() else "-")
    shot=pg.screenshot(clip={"x":0,"y":0,"width":900,"height":420})
    im=Image.open(io.BytesIO(shot)).convert("RGB").crop((60,0,840,380))
    w=sum(1 for r,g,b in im.get_flattened_data() if r>248 and g>248 and b>245)
    print("matt" if not nomatte else "spiegelnd (Gegenprobe)", "reinweiss:", w, "Fehler", errs); assert not errs
    br.close(); return w
with sync_playwright() as p:
    a = run(p, False); b = run(p, True)
    assert a < 100 and b > 500, (a, b)
