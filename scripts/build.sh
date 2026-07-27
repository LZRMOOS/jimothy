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

# Set empty password for signing key (no password required)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

echo "==> Building macOS universal binary..."

rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true

# Build per-architecture binaries (uncomment if needed for debugging)
# echo "  -> Building aarch64-apple-darwin..."
# npx tauri build --target aarch64-apple-darwin
# echo "  -> Building x86_64-apple-darwin..."
# npx tauri build --target x86_64-apple-darwin

# Build universal binary directly
echo "  -> Building universal binary..."
npx tauri build --target universal-apple-darwin

BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
UNIVERSAL_APP="$BUNDLE_DIR/macos/Jimothy.app"

if [[ ! -d "$UNIVERSAL_APP" ]]; then
  echo "ERROR: Universal binary build missing at $UNIVERSAL_APP"
  exit 1
fi

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
