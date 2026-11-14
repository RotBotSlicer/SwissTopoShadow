#!/usr/bin/env bash
# Bündelt die Browser-Bibliotheken nach web/vendor/ (aus js/node_modules):
# geotiff.js (GeoTIFF/COG lesen), tz-lookup (Zeitzone aus Koordinaten), Leaflet (Karte).
set -euo pipefail
cd "$(dirname "$0")/../js"
npm install --no-save esbuild @photostructure/tz-lookup leaflet@1.9.4
echo "export * from 'geotiff';" > .entry.js
npx esbuild .entry.js --bundle --format=esm --minify --platform=browser --outfile=../web/vendor/geotiff.js
echo "export { default as tzlookup } from '@photostructure/tz-lookup';" > .entry.js
npx esbuild .entry.js --bundle --format=esm --minify --platform=browser --outfile=../web/vendor/tz-lookup.js
rm .entry.js
mkdir -p ../web/vendor/leaflet
cp node_modules/leaflet/dist/leaflet.js node_modules/leaflet/dist/leaflet.css ../web/vendor/leaflet/
cp -r node_modules/leaflet/dist/images ../web/vendor/leaflet/
