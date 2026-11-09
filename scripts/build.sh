#!/bin/sh
# Packages src/ into dist/arn0-launcher.wgt (unsigned; Apps2Samsung signs it on install).
set -eu
cd "$(dirname "$0")/.."

[ -f src/icon.png ] || node scripts/make-icon.mjs
# index.html always loads this; an absent file would only be a console error, but there is no
# reason to ship one. Gitignored, so creating it here cannot dirty the tree.
[ -f src/js/config.local.js ] || echo '/* No local overrides. See config.local.example.js. */' > src/js/config.local.js
node scripts/build-marks.mjs
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
node scripts/personal-wallpapers.mjs "$stage"

mkdir -p dist
rm -f dist/arn0-launcher.wgt
archive="$PWD/dist/arn0-launcher.wgt"
(cd "$stage" && zip -q -r -X "$archive" . -x '*.DS_Store' -x '.*' -x 'img/marks/*')

echo "Built dist/arn0-launcher.wgt"
unzip -l dist/arn0-launcher.wgt
