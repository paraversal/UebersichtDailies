#!/bin/bash
# Build dailies.widget.zip at the repo root: the widget folder, ready to unzip into
# Übersicht's widgets folder. The Übersicht gallery reads this file from the repo.
# usage: scripts/zip.sh [git-ref]      (default: HEAD)
#
# Built from committed files only (git archive), so a personal config.json, which holds
# your secret calendar links, and stray files like .DS_Store can never end up in it.
# The zip holds one top-level folder, dailies.widget/, plus the license text.
set -euo pipefail

ref="${1:-HEAD}"
cd "$(dirname "$0")/.."

out="$PWD/dailies.widget.zip"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

git archive --prefix=dailies.widget/ "$ref:dailies.widget" | tar -x -C "$stage"
git show "$ref:LICENSE" > "$stage/dailies.widget/LICENSE"

rm -f "$out"
(cd "$stage" && zip -r -X -q "$out" dailies.widget)

echo "built dailies.widget.zip from $ref ($(git rev-parse --short "$ref"))"
unzip -Z1 "$out" | sed 's/^/  /'
