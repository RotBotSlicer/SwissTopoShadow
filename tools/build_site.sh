#!/usr/bin/env bash
# Stellt die Webseite in _site/ zusammen (wird auch von GitHub Actions benutzt).
# Lokal testen:  tools/build_site.sh && python3 -m http.server -d _site 8000
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/data
cp -r web/. _site/
cp -r js/src _site/lib
cp -r data/pyramid _site/data/pyramid
touch _site/.nojekyll
echo "Site in _site/ ($(du -sh _site | cut -f1))"
