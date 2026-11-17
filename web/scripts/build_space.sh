#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:?usage: scripts/build_space.sh <web model directory> [output directory]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$ROOT/space}"
TAG="s64_12c"

[ -f "$MODEL/jevol.json" ] || { echo "no jevol.json in $MODEL" >&2; exit 1; }
cd "$ROOT"
rm -rf "$OUT"
JEVOL_BACKEND=webgpu JEVOL_OUT="$OUT" pnpm exec vite build
JEVOL_BACKEND=webgpu JEVOL_OUT="$OUT" JEVOL_PAGE=diagnose pnpm exec vite build
mkdir -p "$OUT/models/jevol-web/$TAG"
for f in "$MODEL"/*; do
  name="$(basename "$f")"
  case "$name" in lm_cpu|*.log|jevol.json|embed.f16.bin) continue ;; esac
  cp -cR "$f" "$OUT/models/jevol-web/$TAG/" 2>/dev/null || cp -R "$f" "$OUT/models/jevol-web/$TAG/"
done
node -e '
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
const meta = JSON.parse(fs.readFileSync(src, "utf8"));
meta.checkpoint = meta.checkpoint ? meta.checkpoint.split("/").filter(Boolean).slice(-2, -1)[0] ?? "" : "";
fs.writeFileSync(dst, JSON.stringify(meta));
' "$MODEL/jevol.json" "$OUT/models/jevol-web/$TAG/jevol.json"
"${PYTHON:-python3}" "$ROOT/scripts/quantize_embed.py" "$MODEL" "$OUT/models/jevol-web/$TAG"
find "$OUT" -name .DS_Store -delete
cp -R "$ROOT/space-files/." "$OUT/"
du -sh "$OUT"
