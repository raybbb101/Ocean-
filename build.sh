#!/usr/bin/env bash
# Copies the static game into dist/ for Cloudflare Pages. (functions/ is picked up separately.)
set -euo pipefail
rm -rf dist && mkdir dist
cp -r index.html css js vendor _headers dist/
echo "Built dist/"
