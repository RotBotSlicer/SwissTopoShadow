#!/usr/bin/env bash
# Bündelt geotiff.js (aus js/node_modules) in eine einzelne ES-Datei für den Browser.
set -euo pipefail
cd "$(dirname "$0")/../js"
npm install --no-save esbuild
echo "export * from 'geotiff';" > .geo_entry.js
npx esbuild .geo_entry.js --bundle --format=esm --minify --platform=browser --outfile=../web/vendor/geotiff.js
rm .geo_entry.js
