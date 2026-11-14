# SwissTopoShadow

Schattenwurf durch das Gelände über den Tagesverlauf, berechnet aus den Höhenmodellen von swisstopo.

- **Ort antippen:** Sonnenzeiten am Punkt, Diagramm Horizont gegen Sonnenbahn.
- **Schatten für Ausschnitt:** Schatten über der Landeskarte mit Zeitschieber und Animation,
  oder Sonnenstunden des Tages als Farbkarte. Gerechnet auf der Grafikkarte (WebGL2).

**Web-App:** https://rotbotslicer.github.io/SwissTopoShadow/

## Aufbau
| Ordner | Inhalt |
|---|---|
| `python/` | Referenzkern in Python (Sonnenstand, Gelände, Horizont, Schatten) mit Tests |
| `js/` | Gleicher Kern in JavaScript, getestet gegen die Python-Referenzwerte |
| `data/pyramid/` | Grobmodell der Schweiz (40/80/160 m) aus swissALTIRegio, eigenes Kachelformat |
| `web/` | Web-App (statisch, wird mit `js/src` und `data/` nach GitHub Pages gebaut) |
| `tools/` | `build_site.sh` (Webseite zusammenstellen), `test_gpu.py` (WebGL vs. CPU im Browser), `e2e_app.py` (App-Test), `vendor_geotiff.sh` |

## Gelände (Level of Detail)
2 m swissALTI3D bis 1 km · 10 m swissALTIRegio bis 4 km · 40 m bis 12 km · 80 m bis 24 km · 160 m bis 30 km.
Genauigkeit und Messungen: siehe `python/README.md`.

Für Kartenausschnitte richtet sich das feinste Gelände nach der Pixelgrösse (max. 900 Pixel pro Seite,
Ausschnitt bis 50 km): Pixel ≤ 4 m → ab 2 m, ≤ 15 m → ab 10 m, sonst ab 40 m. Gemessen am Glarner
Testgebiet (3 × 3 km, 5 Tageszeiten, Referenz = mit 2 m): ab 10 m 98.5 % gleiche Schattenpixel, ab 40 m 95 %
(Unterschiede an den Schattenrändern). Bei grossen Ausschnitten variiert der Sonnenstand über die Fläche;
der Shader rechnet ihn je Pixel linear nach (40 km: 99.9–100 % gleich wie exakt je Pixel, ohne Korrektur 99.6 %).

## Lokal starten
    tools/build_site.sh
    python3 -m http.server -d _site 8000     # dann http://localhost:8000

## Tests
    cd python && pip install -e .[test] && pytest
    cd js && npm install && npm test
    python tools/test_gpu.py [--real]       # WebGL-Schatten vs. CPU-Referenz in Headless-Chrome (100 % gleiche Pixel)
    tools/build_site.sh && python tools/e2e_app.py   # ganze App im Browser

## Koordinaten
Gerechnet wird im LV95-Gitter. Der Sonnenazimut wird um die Meridiankonvergenz gedreht
(Gitter-Nord ≠ geografisch Nord, in Glarus −1.1°, im Engadin −2.2°).
Die Schattenebene wird in Web-Mercator-Pixeln gerechnet (jeder Pixel mit seiner LV95-Koordinate),
damit sie deckungsgleich über der Landeskarte liegt.

## Daten
Höhendaten © swisstopo (swissALTI3D, swissALTIRegio), Open Government Data der Schweiz.
Das Grobmodell in `data/pyramid/` ist daraus abgeleitet (`python/tools/build_pyramid.py`).
