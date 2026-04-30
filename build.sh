#!/usr/bin/env bash
set -euo pipefail

echo "Building WASM module..."
wasm-pack build --target web --release

mkdir -p www

echo "Copying artifacts to www/..."
cp pkg/othello_web.js www/othello_web.js
cp pkg/othello_web_bg.wasm www/othello_web_bg.wasm

echo "Copying static sources to www/..."
cp static/index.html www/index.html
cp static/style.css www/style.css
cp static/main.js www/main.js
cp static/worker.js www/worker.js
cp static/service-worker.js www/service-worker.js

echo "Done. Serve www/ with nginx at /othello-web/"