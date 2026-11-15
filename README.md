# SwissTopoShadow

Schattenwurf durch das Gelände über den Tagesverlauf, berechnet aus den Höhenmodellen von swisstopo.

- **Ort antippen:** Sonnenzeiten am Punkt. Profil oben über der Karte (Schalter „Profil“): Horizont, Sonnenbahn des
  gewählten Tages sowie des längsten und kürzesten Tages; beim Zeitschieber zeigt ein Kreis den aktuellen Sonnenstand.
  Auf der Südhalbkugel ist Norden in der Mitte.
- **Schatten für Ausschnitt:** Schatten über der Landeskarte mit Zeitschieber und Animation,
  oder Sonnenstunden des Tages als Farbkarte. Gerechnet auf der Grafikkarte (WebGL2).
- **3D-Ansicht (Schalter „3D“):** Gelände in 3D (Schweiz: swissALTI3D-Regio/feines Gelände des Ausschnitts, weltweit
  Copernicus), Hintergrund Landeskarte oder Luftbild (Schweiz) bzw. OpenTopoMap; Schatten, Zeitschieber und Sonnenstunden
  liegen auf dem 3D-Gelände. Das 3D-Gelände ist immer der Boden (ohne Wald/Gebäude); der Wald-Schalter wirkt auf den Schatten.
  Höhenkacheln entstehen im Browser (js/src/demtiles.js, MapLibre-Protokoll).
- **Gebiet Schweiz / Weltweit (Schalter):** Schweiz mit swisstopo (Landeskarte, Gelände bis 2 m, Wald).
  Weltweit mit offenen Daten: Copernicus DEM GLO-30 (30 m, Oberflächenmodell; Kopie bei OpenTopography, weil die
  AWS-Kopie keinen Browserzugriff erlaubt) und OpenTopoMap; gerechnet in einer lokalen Transversalen Mercator um den
  Ausschnitt, Zeiten in der Zeitzone des Ortes (tz-lookup).
- **Wald und Gebäude (Schalter):** swissSURFACE3D im Nahbereich bis 1 km (Ausschnitt 2 m, Punkt 1 m bis 300 m).
  Der Standort bleibt am Boden (swissALTI3D + Augenhöhe), die Strahlen treffen Kronen und Dächer.
  Nur bei feinem Gelände (Ausschnitt bis ca. 3 km).

**Web-App:** https://rotbotslicer.github.io/SwissTopoShadow/

## Aufbau
| Ordner | Inhalt |
|---|---|
| `python/` | Referenzkern in Python (Sonnenstand, Gelände, Horizont, Schatten) mit Tests |
| `js/` | Gleicher Kern in JavaScript, getestet gegen die Python-Referenzwerte |
| `data/pyramid/` | Grobmodell der Schweiz (40/80/160 m) aus swissALTIRegio, eigenes Kachelformat |
| `web/` | Web-App (MapLibre GL; statisch, wird mit `js/src` und `data/` nach GitHub Pages gebaut), `web/proto3d/` 3D-Prototypen |
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

## Weltweit: wie genau? (Vergleich mit swisstopo an Schweizer Orten, 14.11. / 21.12. / 21.6.)
| Ort | Copernicus 30 m | swisstopo |
|---|---|---|
| Zermatt, 14.11. | 10:29–15:29 | 10:34–15:28 |
| Davos, 14.11. | 08:23–10:08, 10:34–15:55 | 08:24–10:07, 10:35–15:55 |
| Lauterbrunnen, 21.6. | 10:59–16:06 | 10:59–16:42 |
| Bösbächibach (Graben), 14.11. | 09:42–10:49 | 10:08–10:56 |

In offenem Gelände meist auf wenige Minuten genau; in engen Tälern, Gräben und an Felswänden (30-m-Raster,
Oberflächenmodell mit Wald) bis eine halbe Stunde daneben.

## Wald und Gebäude: Hinweise
- Bäume erscheinen so, wie sie bei der Befliegung waren (am Testort 2017). Laubbäume werfen auch im Winter vollen Schatten.
- Die Übersichtsstufen (1 m / 2 m) sind gemittelt; direkt neben Bäumen oder Häusern (ein, zwei Meter) zählt der
  Standort schon als „darunter“. Die App zeigt das beim Punkt an.
- Referenz Bösbächibach 14.11.2026: ohne Wald 10:08–10:56, mit Wald 10:14–10:16 und 10:20–10:50 (Strauch/Baum am Punkt, 5 m).
  Im 1×1-km-Testgebiet liegen mit Wald um 12:30 nur noch 14 % statt 28 % der Fläche in der Sonne.

## Koordinaten
Gerechnet wird im LV95-Gitter. Der Sonnenazimut wird um die Meridiankonvergenz gedreht
(Gitter-Nord ≠ geografisch Nord, in Glarus −1.1°, im Engadin −2.2°).
Die Schattenebene wird in Web-Mercator-Pixeln gerechnet (jeder Pixel mit seiner LV95-Koordinate),
damit sie deckungsgleich über der Landeskarte liegt.

## Daten
Höhendaten © swisstopo (swissALTI3D, swissALTIRegio), Open Government Data der Schweiz.
Das Grobmodell in `data/pyramid/` ist daraus abgeleitet (`python/tools/build_pyramid.py`).
