# SwissTopoShadow

Schattenwurf durch das Gelände über den Tagesverlauf, berechnet aus den Höhenmodellen von swisstopo.
Für einen Punkt (und später für einen Kartenausschnitt) zeigt die App, wann dort direkte Sonne ist.

**Web-App:** https://rotbotslicer.github.io/SwissTopoShadow/

## Aufbau
| Ordner | Inhalt |
|---|---|
| `python/` | Referenzkern in Python (Sonnenstand, Gelände, Horizont, Schatten) mit Tests |
| `js/` | Gleicher Kern in JavaScript, getestet gegen die Python-Referenzwerte |
| `data/pyramid/` | Grobmodell der Schweiz (40/80/160 m) aus swissALTIRegio, eigenes Kachelformat |
| `web/` | Web-App (statisch, wird mit `js/src` und `data/` nach GitHub Pages gebaut) |
| `tools/` | `build_site.sh` (Webseite zusammenstellen) |

## Gelände (Level of Detail)
2 m swissALTI3D bis 1 km · 10 m swissALTIRegio bis 4 km · 40 m bis 12 km · 80 m bis 24 km · 160 m bis 30 km.
Genauigkeit und Messungen: siehe `python/README.md`.

## Lokal starten
    tools/build_site.sh
    python3 -m http.server -d _site 8000     # dann http://localhost:8000

## Tests
    cd python && pip install -e .[test] && pytest
    cd js && npm install && npm test

## Daten
Höhendaten © swisstopo (swissALTI3D, swissALTIRegio), Open Government Data der Schweiz.
Das Grobmodell in `data/pyramid/` ist daraus abgeleitet (`python/tools/build_pyramid.py`).
