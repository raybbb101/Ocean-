#!/usr/bin/env bash
# Copies the static game into dist/ for Cloudflare Pages. (functions/ is picked up separately.)
set -euo pipefail
rm -rf dist && mkdir dist
cp -r index.html manifest.webmanifest sw.js css js vendor assets _headers dist/
# Stamp a unique version so installed apps pick up the new release.
VERSION="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
sed -i "s/const VERSION = 'dev';/const VERSION = '${VERSION}';/" dist/sw.js
echo "Built dist/ (version ${VERSION})"
