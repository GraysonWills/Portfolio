#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v sips >/dev/null || { echo "sips is required (macOS)." >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required to remove the PNG alpha channel." >&2; exit 1; }

sips -s format png "$ROOT_DIR/mobile-assets/app-icon.svg" --out "$TMP_DIR/app-icon-alpha.png" >/dev/null
sips -s format png "$ROOT_DIR/mobile-assets/splash.svg" --out "$TMP_DIR/splash-alpha.png" >/dev/null
ffmpeg -loglevel error -y -i "$TMP_DIR/app-icon-alpha.png" -vf format=rgb24 "$TMP_DIR/app-icon.png"
ffmpeg -loglevel error -y -i "$TMP_DIR/splash-alpha.png" -vf format=rgb24 "$TMP_DIR/splash.png"

ICON_TARGET="$ROOT_DIR/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
SPLASH_DIR="$ROOT_DIR/ios/App/App/Assets.xcassets/Splash.imageset"
cp "$TMP_DIR/app-icon.png" "$ICON_TARGET"
cp "$TMP_DIR/splash.png" "$SPLASH_DIR/splash-2732x2732.png"
cp "$TMP_DIR/splash.png" "$SPLASH_DIR/splash-2732x2732-1.png"
cp "$TMP_DIR/splash.png" "$SPLASH_DIR/splash-2732x2732-2.png"

if ! sips -g hasAlpha "$ICON_TARGET" | grep -q 'hasAlpha: no'; then
  echo "Generated app icon still contains an alpha channel." >&2
  exit 1
fi

echo "Generated opaque iOS app icon and splash assets."
