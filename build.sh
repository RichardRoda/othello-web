#!/usr/bin/env bash
set -euo pipefail

echo "Building WASM module..."
wasm-pack build --target web --release

echo "Copying artifacts to www/..."
cp pkg/othello_web.js www/othello_web.js
cp pkg/othello_web_bg.wasm www/othello_web_bg.wasm

echo "Done. Serve www/ with nginx at /othello-web/"