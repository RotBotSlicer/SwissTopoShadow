#!/usr/bin/env bash
# Stellt die Webseite in _site/ zusammen (wird auch von GitHub Actions benutzt).
# Lokal testen:  tools/build_site.sh && python3 -m http.server -d _site 8000
#
# Cache: GitHub Pages lässt Browser Dateien 10 min zwischenspeichern. Damit nie eine neue index.html mit altem
# Code zusammentrifft (oder umgekehrt), liegt der ganze Code in einem Ordner pro Version: _site/v/<version>/.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(git rev-parse --short=10 HEAD 2>/dev/null || date +%s)
if [ -n "$(git status --porcelain -- web js/src 2>/dev/null)" ]; then VER="$VER-dev$(date +%s)"; fi
rm -rf _site
mkdir -p "_site/v/$VER" _site/data
cp -r web/app.js web/mapview.js web/app.css web/vendor "_site/v/$VER/"
cp -r js/src "_site/v/$VER/lib"
sed -e "s#\./vendor/#./v/$VER/vendor/#g" -e "s#\./app\.css#./v/$VER/app.css#g" -e "s#\./app\.js#./v/$VER/app.js#g" \
    -e "s#__VERSION__#$VER#g" web/index.html > _site/index.html
cp -r data/pyramid _site/data/pyramid
[ -d web/proto3d ] && cp -r web/proto3d _site/proto3d  # 3D-Prototypen (fester Ort)
touch _site/.nojekyll
echo "Site in _site/ (Version $VER, $(du -sh _site | cut -f1))"
