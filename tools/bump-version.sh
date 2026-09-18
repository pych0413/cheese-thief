#!/usr/bin/env bash
# Stamp a new ?v= on every asset URL and module import.
#
# GitHub Pages serves everything with Cache-Control: max-age=600 and lets
# you change nothing about that. Without a version stamp a visitor who
# opened the page in the last 10 minutes gets the NEW index.html with the
# OLD css/js — a half-broken screen. Run this before pushing any change
# that touches styles.css or js/.
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-$(date +%Y%m%d%H%M)}"
sed -i -E "s/(styles\.css|js\/app\.js)\?v=[0-9]+/\1?v=${V}/g" index.html
sed -i -E "s/(\.\/[a-z]+\.js)\?v=[0-9]+/\1?v=${V}/g" js/*.js
echo "asset version -> ${V}"
grep -o '?v=[0-9]*' index.html js/*.js | sort -u
