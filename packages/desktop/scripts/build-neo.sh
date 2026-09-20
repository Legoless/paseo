#!/usr/bin/env bash
# Build Paseo Neo for macOS with mandatory notarization.
#
# Why this exists: electron-builder silently skips notarization when the
# APPLE_* env vars are missing, and an unnotarized build silently loses macOS
# features — app.setBadgeCount() reports success while the dock shows nothing
# (see electron-builder.neo.yml). This script fails loudly instead.
#
# Values below are Apple *identifiers*, safe to commit; the secret is the .p8
# key file in ~/.appstoreconnect/private_keys (same key Operator's
# build-developer-id.sh uses). Env vars override the defaults.
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${APPLE_ID:-}" ]]; then
  : "${APPLE_API_KEY:="$HOME/.appstoreconnect/private_keys/AuthKey_PR94U68YBS.p8"}"
  : "${APPLE_API_KEY_ID:=PR94U68YBS}"
  : "${APPLE_API_ISSUER:=69a6de76-d1c1-47e3-e053-5b8c7c11a4d1}"
  if [[ ! -r "$APPLE_API_KEY" ]]; then
    echo "error: cannot read $APPLE_API_KEY" >&2
    echo "Set APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID." >&2
    exit 1
  fi
  export APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
fi

cd "$DESKTOP_DIR"
npm --prefix ../.. run build:desktop:neo

APP="release/mac-arm64/Paseo Neo.app"
if ! spctl -a -vv "$APP" 2>&1 | grep -q "Notarized"; then
  echo "error: build finished but $APP failed notarization check:" >&2
  spctl -a -vv "$APP" >&2 || true
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
DMG="release/Paseo-Neo-${VERSION}-arm64.dmg"
if [[ ! -f "$DMG" ]]; then
  echo "error: expected $DMG after the Neo build" >&2
  ls -lh release/Paseo-Neo-*-arm64.dmg >&2 || true
  exit 1
fi
DEST="$HOME/Downloads/$(basename "${DMG%.dmg}")-$(date +%Y%m%d).dmg"
cp "$DMG" "$DEST"
echo "notarized: $APP"
echo "copied:    $DEST"
