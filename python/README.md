# schatten – Referenzkern

Sonnenstand, Geländehorizont und Schattenwurf aus swissALTI3D (swisstopo).
Dient als geprüfte Referenz für die spätere Web-App (JS/WebGL-Portierung).

## Module
- `schatten/sun.py` – Sonnenstand (NOAA-Algorithmus, nur numpy). Abweichung zu pvlib/SPA < 0.01° Höhe, < 0.02° Azimut (Sonne > 5°).
- `schatten/dem.py` – swissALTI3D-Kacheln über STAC suchen, cachen, mosaikieren; `Raster` (bilineare Abtastung), `Terrain` (fein im Nahbereich < r_split, grob für den Fernhorizont).
- `schatten/pyramid.py` – Grobmodell der ganzen Schweiz (+ Grenzgebiete) als Kachelpyramide 40/80/160 m aus swissALTIRegio, eigenes einfaches Kachelformat (in JS ohne Bibliothek lesbar).
- `schatten/horizon.py` – Horizont eines Punkts, Horizontkarte für ein Gitter, Schatten direkt bzw. aus Horizontkarte, Sonnenzeiten, Sonnenstundenkarte. Erdkrümmung + terrestrische Refraktion (k = 0.13) berücksichtigt.

## Gelände: Level of Detail (wie in der App)
| Distanz | Daten | Quelle |
|---|---|---|
| < 1 km | 2 m | swissALTI3D-Kacheln (live) |
| 1–4 km | 10 m | swissALTIRegio-COG (live, HTTP-Range) |
| 4–12 km | 40 m | eigene Pyramide |
| 12–24 km | 80 m | eigene Pyramide |
| > 24 km (bis r_max, Standard 30 km) | 160 m | eigene Pyramide |

Gemessen (Horizontwinkel, 120 zufällige Punkte im Glarnerland, Referenz = 10 m durchgehend bis 20 km):
mittlere Abweichung +0.01°, RMS 0.04°, 99 %-Quantil 0.16°, Maximum 0.7°. Max-Aggregation war besser
als Mittelwert oder Ausdünnen (die COG-eigenen Übersichten sind ausgedünnt → nicht verwendet).
Nahbereich: 2 m bis 1 km gegenüber 2 m bis 2 km: RMS 0.04°, 99 %-Quantil 0.17°; nur 10 m wäre im
Nahbereich unbrauchbar (Fehler bis > 30° in Gräben).
Zum Vergleich: die Sonnenhöhe ändert sich um höchstens ~0.15°/min → typ. Zeitfehler < 1 min.

## Kachelformat Pyramide
Siehe Docstring `schatten/pyramid.py`: 256×256 int16-Meter (aufgerundet), Zeilen-Delta-Prädiktor,
gzip, `{res}m/{ty}_{tx}.bin.gz`, `manifest.json`. Gesamt ~126 MB (40 m: 2268, 80 m: 567, 160 m: 154 Kacheln).
Neu bauen: `python tools/build_pyramid.py <ordner>` (~8 min).

## Konventionen
LV95 (EPSG:2056) in Metern; Zeiten intern Unix-Sekunden (UTC).
Azimute im Horizont sind **Gitterazimute** (ab LV95-Gitter-Nord). Der Sonnenazimut (ab geografisch Nord)
wird mit `coords.sun_position_lv95` um die Meridiankonvergenz gedreht (Bern 0°, Glarus −1.14°, Engadin bis −2.2°).
Ohne diese Korrektur lagen die Sonnenzeiten am Referenzpunkt um 6 min daneben.
Augenhöhe: Punkt 1.7 m, Karten 1.0 m über Gelände.

## Tests
    pip install -e .[test]
    pytest                     # synthetisch, offline (~5 s)
    pytest --network           # inkl. Referenzfall Bösbächibach (lädt ~500 MB Kacheln, Cache: $SCHATTEN_CACHE)
                               # mit SCHATTEN_PYRAMID=<ordner|url> zusätzlich Test mit App-Geländeschema

Synthetische Tests: Ebene, Wand (analytischer Winkel), schiefe Ebene, fein/grob-Umschaltung,
Horizontkarte vs. direkter Strahl (> 98 % gleiche Pixel).
Referenzfall: Bösbächibach 2'719'286 / 1'203'098, 14.11.2026 → Sonne 10:08–10:56, um 12:30 Schatten (beobachtet).

## Beispiel
    python examples/punkt_tagesverlauf.py 2719286 1203098 2026-11-14

## Bekannte Grenzen
- Reines Geländemodell: Wald und Gebäude werfen keinen Schatten (swissSURFACE3D wäre die Erweiterung).
- `load_terrain` (nur 2-m-Kacheln, viel Download) bleibt als Referenz; im Alltag `load_terrain_lod`.
- Ausserhalb der swissALTIRegio-Abdeckung kein Gelände (für Orte in CH irrelevant).
- Horizontkarte in numpy ist langsam (Minuten für grosse Gitter) – Rechenleistung kommt in der App aus WebGL.
