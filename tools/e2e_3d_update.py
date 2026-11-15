"""Prüft, dass sich die Schattenebene in 3D mit der Zeit ändert (Bilddifferenz 08:30 vs 14:30 > 0)."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
root=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=root))
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,args=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"],proxy={"server":os.environ["HTTPS_PROXY"],"bypass":"127.0.0.1"})
    pg=b.new_page(viewport={"width":420,"height":800},device_scale_factor=1, locale="de-CH"); errs=[]
    pg.on("pageerror",lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{srv.server_port}/"); pg.wait_for_timeout(1500)
    pg.evaluate("localStorage.clear()"); pg.goto(f"http://127.0.0.1:{srv.server_port}/"); pg.wait_for_timeout(1500)
    pg.fill("#date","2026-11-14"); pg.dispatch_event("#date","change")
    pg.evaluate("__app.setView(46.9682, 9.0062, 12)"); pg.wait_for_timeout(800)
    pg.click("#t3d"); pg.wait_for_timeout(6000)
    pg.click("#area"); pg.wait_for_function("document.getElementById('area-status').textContent.includes('Pixel')",timeout=900000)
    print(pg.inner_text("#area-status"))
    shots=[]
    for hhmm in ["08:30","11:30","14:30"]:
        idx=pg.evaluate(f"__app.suns.findIndex(s => new Date((s.u+3600)*1000).toISOString().slice(11,16) === '{hhmm}')")
        pg.evaluate(f"(()=>{{const t=document.getElementById('time');t.value={idx};t.dispatchEvent(new Event('input'))}})()"); pg.wait_for_timeout(12000)
        f=f"./upd_{hhmm.replace(':','')}.png"; pg.screenshot(path=f, clip={"x":0,"y":0,"width":420,"height":520}); shots.append(f)
        print(hhmm, pg.inner_text("#timelbl"))
    a,c=Image.open(shots[0]).convert("L"),Image.open(shots[2]).convert("L")
    d = ImageChops.difference(a, c)
    n = sum(1 for v in (d.get_flattened_data() if hasattr(d, "get_flattened_data") else d.getdata()) if v > 20)
    print("Bilddifferenz 08:30 vs 14:30:", n)
    assert n > 1000, "Schattenebene ändert sich nicht mit der Zeit"
    print("Fehler:",errs); b.close()
