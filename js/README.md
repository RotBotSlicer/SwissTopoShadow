# schatten-js – JavaScript-Kern

1:1-Port des Python-Kerns (`schatten_core`), als ES-Module für Browser und Node ≥ 18.
Ist die Rechenbasis der Web-App.

## Module (`src/`)
- `sun.js` – Sonnenstand (NOAA), identisch mit Python (< 1e-8°).
- `coords.js` – LV95 ↔ WGS84 (swisstopo-Näherungsformeln, < 5 m in ganz CH).
- `raster.js` – `Raster` (bilinear, Randverhalten wie scipy), `Terrain` (Level of Detail mit Rückfall).
- `tiles.js` – Kachelpyramide des Grobmodells lesen (`Pyramid`, `decodeTile`; gzip via `DecompressionStream`).
- `loaders.js` – swissALTI3D 2 m (STAC + GeoTIFF), swissALTIRegio 10 m (COG per HTTP-Range), `loadTerrainLod`,
  Level-Schemata `LOD_DEFAULT` / `LOD_10M` / `LOD_40M`, `lodForPixelSize`, `withSurface` und `loadSurface`
  (swissSURFACE3D, Übersichtsstufe 1 m/2 m per HTTP-Range). `Terrain` hat ein Boden-Level für die Standorthöhe.
- `horizon.js` – `pointHorizon`, `horizonMap`, `litDirect`, `litFromHorizon`, `litTimeline`, `intervals`, `sunHoursMap`.
- `gpu.js` – `ShadowRenderer` (WebGL2): Schatten je Sonnenstand und Sonnenstunden, gleiches Verfahren wie `litDirect`.
  Im Browser-Test (`tools/test_gpu.py`) 100 % gleiche Pixel wie die CPU, synthetisch und mit echten Daten.
- `area.js` – Rechengitter für einen Kartenausschnitt (Web-Mercator-Pixel mit LV95-Koordinaten).
- `sun.js` zusätzlich `sunPositionLv95` (Azimut im LV95-Gitter, inkl. Meridiankonvergenz) und
  `sunPositionLv95Grad` (plus Änderung pro Meter für grosse Ausschnitte).

Abhängigkeit: `geotiff` (GeoTIFF/COG lesen).

## Tests
    npm install
    npm test                                   # offline, gegen Python-Referenzwerte in test/fixtures
    SCHATTEN_NETWORK=1 SCHATTEN_PYRAMID=<ordner|url> npm test   # + echter Fall Bösbächibach

Ergebnisse (14.11.2026):
- Sonnenstand, Rasterabtastung, Kacheldekodierung: identisch mit Python (Rundung float32).
- Synthetisches Gelände: Horizont/Horizontkarte < 0.01° Abweichung, Schattenpixel ≥ 99.5 % gleich.
- Bösbächibach mit echten swisstopo-Daten (2 m live, 10 m live aus COG, Pyramide lokal):
  max. Horizontabweichung zu Python 0.0005°, Sonne 10:08–10:56.

## Laufzeit (CPU, Node, ein Kern)
~35 Mio. Geländeabtastungen/s. Ein Strahl bis 30 km hat ~600 Schritte (growth 1 %).
- Punkt (1440 Azimute): < 1 s → Tagesverlauf für einen Punkt direkt auf der CPU.
- Horizontkarte 100×100 px × 32 Azimute: 5.5 s; 3×3 km bei 5 m × 64 Azimute wären ~7 min
  → Karten in der App über WebGL (GPU) rechnen; dieser CPU-Code bleibt die Referenz dafür.

## Hinweise für den Browser
- Die Regio-COG-Abfrage braucht HTTP-Range über CORS; swisstopo setzt `Access-Control-Allow-Origin: *`.
  Ob alle mobilen Browser das mitmachen, wird in der App geprüft.
- Node hinter Proxy: `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) und ggf. `NODE_EXTRA_CA_CERTS`.
