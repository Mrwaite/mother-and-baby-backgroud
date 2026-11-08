#!/usr/bin/env bash
# 把小程序仓库的 miniprogram/shared/ 复制到 src/shared/（以小程序仓库为准）
# 用法：scripts/sync-shared.sh          同步
#       scripts/sync-shared.sh --check  只比较，不一致时退出码为 1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SHARED_SRC:-$ROOT/../mother-and-baby-mini-program/miniprogram/shared}"
DEST="$ROOT/src/shared"
HEADER="// 自动生成，勿改：由 scripts/sync-shared.sh 从 mother-and-baby-mini-program/miniprogram/shared/ 同步"

if [ ! -d "$SRC" ]; then
  echo "找不到共享代码目录：$SRC（可用 SHARED_SRC 指定）" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for f in "$SRC"/*.ts; do
  { echo "$HEADER"; cat "$f"; } > "$TMP/$(basename "$f")"
done

if [ "${1:-}" = "--check" ]; then
  if diff -r "$TMP" "$DEST" > /dev/null 2>&1; then
    echo "shared/ 一致"
  else
    echo "shared/ 与小程序仓库不一致，请执行 npm run sync-shared" >&2
    diff -r "$TMP" "$DEST" || true
    exit 1
  fi
else
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp "$TMP"/*.ts "$DEST"/
  echo "已同步到 src/shared/"
fi
