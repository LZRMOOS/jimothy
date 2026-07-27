#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -f "$HOME/.tauri/scratch.key" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/scratch.key")"
  else
    echo "ERROR: TAURI_SIGNING_PRIVATE_KEY not set and ~/.tauri/scratch.key not found."
    echo "Generate with: npx tauri signer generate -w ~/.tauri/scratch.key"
    exit 1
  fi
fi

echo "==> Building macOS universal binary..."

rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true

echo "  -> Building aarch64-apple-darwin..."
npx tauri build --target aarch64-apple-darwin

echo "  -> Building x86_64-apple-darwin..."
npx tauri build --target x86_64-apple-darwin

echo "  -> Creating universal binary..."
BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
mkdir -p "$BUNDLE_DIR"

ARM_APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Jimothy.app"
X86_APP="src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Jimothy.app"

if [[ ! -d "$ARM_APP" || ! -d "$X86_APP" ]]; then
  echo "ERROR: One or both arch builds missing."
  echo "  arm64: $ARM_APP"
  echo "  x86_64: $X86_APP"
  exit 1
fi

UNIVERSAL_APP="$BUNDLE_DIR/macos/Jimothy.app"
rm -rf "$UNIVERSAL_APP"
cp -R "$ARM_APP" "$UNIVERSAL_APP"

lipo -create \
  "$ARM_APP/Contents/MacOS/Jimothy" \
  "$X86_APP/Contents/MacOS/Jimothy" \
  -output "$UNIVERSAL_APP/Contents/MacOS/Jimothy"

echo "  -> Universal .app: $UNIVERSAL_APP"

DMG_PATH="$BUNDLE_DIR/dmg/Jimothy_universal.dmg"
mkdir -p "$(dirname "$DMG_PATH")"
rm -f "$DMG_PATH"

hdiutil create -volname "Jimothy" \
  -srcfolder "$UNIVERSAL_APP" \
  -ov -format UDZO \
  "$DMG_PATH"

echo "  -> Universal .dmg: $DMG_PATH"
echo "==> macOS universal build complete!"
