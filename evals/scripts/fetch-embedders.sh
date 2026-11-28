#!/usr/bin/env bash
# Downloads the static embedding models (model2vec, MIT) into evals/data/models/<name>/ and checks them by sha256.
# Source: huggingface.co/minishlab. Reads this repo's models-static-embedders release first, since it holds the exact
# files the sums pin (filled by .github/workflows/mirror-embedders.yml, which records each model's revision in the
# release notes), then huggingface.co.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mirror="https://github.com/KealJones/beep/releases/download/models-static-embedders"
sums="$root/scripts/embedders.sha256"
while read -r sha file; do
  name="${file%%--*}"; f="${file#*--}"
  dir="$root/data/models/$name"; mkdir -p "$dir"
  [ -f "$dir/$f" ] || curl -fL --retry 3 -o "$dir/$f" "$mirror/$file" \
    || curl -fL --retry 3 -o "$dir/$f" "https://huggingface.co/minishlab/$name/resolve/main/$f"
  echo "$sha  $dir/$f" | sha256sum -c -
done < "$sums"
