#!/usr/bin/env bash
# Downloads LongMemEval_S (cleaned) into evals/data/longmemeval/ and checks it byte for byte.
# Source: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned (MIT).
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/data/longmemeval"
mkdir -p "$dir"
base="https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main"
# Same file on this repo's release, for networks that block huggingface.co.
mirror="https://github.com/KealJones/long-con/releases/download/data-longmemeval-s"
file=longmemeval_s_cleaned.json
sha=d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442
[ -f "$dir/$file" ] || curl -fL --retry 3 -o "$dir/$file" "$base/$file" || curl -fL --retry 3 -o "$dir/$file" "$mirror/$file"
echo "$sha  $dir/$file" | sha256sum -c -
