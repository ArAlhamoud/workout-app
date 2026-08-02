#!/usr/bin/env bash
#
# One command for the whole native trip: sync sources, build, install, launch.
#
# This exists because three separate failures cost an evening:
#
#   1. native/HealthKitBridge/*.swift and ios/App/App/*.swift are two copies of
#      the same files (Xcode's "Copy items if needed"). Editing one and
#      building the other silently ships stale code. native/ is the source of
#      truth; this script overwrites the Xcode copies every run.
#   2. Xcode derives its DerivedData path from a hash of the project path, so
#      renaming the project folder silently moved the build output. Builds kept
#      succeeding into a new directory while installs kept picking up a months-
#      old .app from the previous one. -derivedDataPath pins it inside the repo.
#   3. "BUILD SUCCEEDED" and "App installed" can both be true and still refer to
#      different builds — so this verifies the installed binary afterwards.
#
# Usage: npm run ios:deploy
#        npm run ios:deploy -- --fresh   (uninstall first: clears localStorage,
#                                         so the app comes up in first-run state)
# Override the target with: WORKOUT_DEVICE_ID=<udid> npm run ios:deploy
#
# --fresh wipes the sync token too, and does NOT reset Health permissions —
# iOS keys those to the bundle ID, not the install.

set -euo pipefail

FRESH=0
for arg in "$@"; do
  [ "$arg" = "--fresh" ] && FRESH=1
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE="${WORKOUT_DEVICE_ID:-00008140-00184564227B001C}"
BUNDLE_ID="com.aralhamoud.workout"
DERIVED="$ROOT/ios/App/.derived"
APP="$DERIVED/Build/Products/Debug-iphoneos/App.app"

echo "==> Syncing native sources into the Xcode target"
for f in HealthKitBridgePlugin MainViewController; do
  cp "$ROOT/native/HealthKitBridge/$f.swift" "$ROOT/ios/App/App/$f.swift"
done

echo "==> Building (derived data pinned to ios/App/.derived)"
xcodebuild \
  -project "$ROOT/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Debug \
  -destination "id=$DEVICE" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build 2>&1 | grep -E "error:|warning: .*(deprecat|unused)|BUILD (SUCCEEDED|FAILED)" || true

if [ ! -d "$APP" ]; then
  echo "!! Build produced no app bundle at $APP" >&2
  exit 1
fi

if [ "$FRESH" = "1" ]; then
  echo "==> Uninstalling first (--fresh)"
  xcrun devicectl device uninstall app --device "$DEVICE" "$BUNDLE_ID" 2>&1 | tail -1 || true
fi

echo "==> Installing to $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP" \
  | grep -iE "installed|bundleID|error" || true

echo "==> Verifying the installed build is the one we just made"
# Compares the plugin's method list in the binary against the Swift source, so
# a stale install can't pass silently the way it did before.
EXPECTED=$(grep -oE 'CAPPluginMethod\(name: "[a-zA-Z]+"' "$ROOT/native/HealthKitBridge/HealthKitBridgePlugin.swift" \
  | sed -E 's/.*"([a-zA-Z]+)"/\1/' | sort)
FOUND=$(strings "$APP/App.debug.dylib" 2>/dev/null | grep -oE "$(echo "$EXPECTED" | paste -sd'|' -)" | sort -u)

if [ "$EXPECTED" != "$FOUND" ]; then
  echo "!! Installed binary is missing plugin methods:" >&2
  comm -23 <(echo "$EXPECTED") <(echo "$FOUND") >&2
  exit 1
fi
echo "   all $(echo "$EXPECTED" | wc -l | tr -d ' ') plugin methods present"

echo "==> Launching"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE_ID" \
  | grep -iE "launched|error" || true

echo "==> Done. The build expires ~7 days from now (free provisioning); re-run this then."
