#!/usr/bin/env bash
# Кладёт ядро Xray-core для Windows в resources/bin/xray.exe.
# Версия закреплена в файле XRAY_VERSION — та же, что у мак-версии; другую
# можно передать аргументом: v26.10.21
set -euo pipefail

REPO="XTLS/Xray-core"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(tr -d '[:space:]' < "${ROOT}/XRAY_VERSION")}"
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
