#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$repo_root/crates/renderer"
asset_root="$repo_root/app/assets/renderer"

wasm-pack build "$crate" \
  --target web \
  --release \
  --out-dir "$asset_root/pkg" \
  --out-name pam_viewer_renderer \
  --locked

rm -f "$asset_root/pkg/.gitignore"
