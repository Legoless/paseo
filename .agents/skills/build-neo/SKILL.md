---
name: build-neo
description: Build a notarized Paseo Neo DMG for macOS and copy it to ~/Downloads. Use when the user says "build neo", "neo dmg", "rebuild neo", or "/build-neo". Prevents the silent-unnotarized-build bug that kills the dock badge.
user-invocable: true
---

# Build Neo

Run `packages/desktop/scripts/build-neo.sh`. Do not run `npm run build:neo` directly:
electron-builder silently skips notarization when `APPLE_*` env vars are missing, and
unnotarized builds silently lose macOS features (dock badge renders nothing).

The script exports the App Store Connect key (default `~/.appstoreconnect/private_keys/AuthKey_*.p8`,
env-overridable), builds, verifies with `spctl` that the app is notarized, and copies the DMG to
`~/Downloads/Paseo-Neo-<version>-arm64-<yyyymmdd>.dmg`.
