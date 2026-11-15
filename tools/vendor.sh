#!/usr/bin/env bash
# Bündelt die Browser-Bibliotheken nach web/vendor/ (aus js/node_modules):
# geotiff.js (GeoTIFF/COG lesen), tz-lookup (Zeitzone aus Koordinaten), MapLibre GL (Karte 2D/3D).
set -euo pipefail
cd "$(dirname "$0")/../js"
npm install --no-save esbuild @photostructure/tz-lookup maplibre-gl@5
echo "export * from 'geotiff';" > .entry.js
npx esbuild .entry.js --bundle --format=esm --minify --platform=browser --outfile=../web/vendor/geotiff.js
echo "export { default as tzlookup } from '@photostructure/tz-lookup';" > .entry.js
npx esbuild .entry.js --bundle --format=esm --minify --platform=browser --outfile=../web/vendor/tz-lookup.js
rm .entry.js
mkdir -p ../web/vendor/maplibre ../web/proto3d/vendor
cp node_modules/maplibre-gl/dist/maplibre-gl.js node_modules/maplibre-gl/dist/maplibre-gl.css ../web/vendor/maplibre/
cp node_modules/maplibre-gl/dist/maplibre-gl.js node_modules/maplibre-gl/dist/maplibre-gl.css ../web/proto3d/vendor/
