"""Sprache umschalten (DE/EN): statische Texte, Punkt, Profil, Knopf; Wahl bleibt nach Neuladen erhalten."""
import functools, http.server, os, threading
from playwright.sync_api import sync_playwright
root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=root))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                          proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1"})
    pg = b.new_page(viewport={"width": 420, "height": 800}, locale="de-CH"); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    u = f"http://127.0.0.1:{srv.server_port}/"
    pg.goto(u); pg.wait_for_timeout(1500); pg.evaluate("localStorage.clear()"); pg.goto(u); pg.wait_for_timeout(1500)
    assert pg.inner_text("#reg-world") == "Weltweit"
    pg.evaluate("__app.setView(47.0405, 9.0680, 14)"); pg.wait_for_timeout(500)
    pg.evaluate("__app.showPoint(47.0405, 9.0680)")
    pg.wait_for_function("document.getElementById('summary').textContent.length>0", timeout=600000)
    de = [pg.inner_text(s) for s in ("#summary", "#where", "#lg-sum", "#area", "#credits")]
    pg.click("#lang-en"); pg.wait_for_timeout(500)
    en = [pg.inner_text(s) for s in ("#summary", "#where", "#lg-sum", "#area", "#credits")]
    for a, c in zip(de, en): print(f"  {a}  →  {c}")
    assert "sun" in en[0] or "No direct" in en[0]
    assert "a.s.l." in en[1] and en[2].startswith("longest day") and en[3].startswith("Shadows")
    assert pg.inner_text("#reg-world") == "Worldwide" and pg.inner_text("#hint").startswith("Tap")
    axes = pg.evaluate("[...document.querySelectorAll('#chart text')].map(t=>t.textContent)")
    assert "SE" in axes and "SO" not in axes, axes
    pg.reload(); pg.wait_for_timeout(1500)
    assert pg.inner_text("#reg-world") == "Worldwide", "Sprache nicht gespeichert"
    pg.click("#lang-de"); pg.wait_for_timeout(300); assert pg.inner_text("#reg-world") == "Weltweit"
    print("Fehler:", errs); assert not errs
    b.close()
