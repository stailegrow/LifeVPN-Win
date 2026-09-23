#!/usr/bin/env bash
# Кладёт ядро Xray-core для Windows в resources/bin/xray.exe.
# Версия та же, что в мак-версии; другую можно передать аргументом: v26.6.1
set -euo pipefail

REPO="XTLS/Xray-core"
TAG="${1:-v26.6.1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/resources/bin"
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Скачиваю Xray ${TAG} для Windows x64..." >&2
curl -fsSL "https://github.com/${REPO}/releases/download/${TAG}/Xray-windows-64.zip" -o "$TMP/xray.zip"
unzip -o -q "$TMP/xray.zip" -d "$TMP/x"
cp "$TMP/x/xray.exe" "$DEST/xray.exe"
cp "$TMP/x/LICENSE" "$DEST/xray-LICENSE.txt"
echo "Готово: $DEST/xray.exe"
