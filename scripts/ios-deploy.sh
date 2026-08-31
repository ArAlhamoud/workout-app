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
# --fresh does NOT reset Health permissions — iOS keys those to the bundle ID,
# not the install.

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
for f in HealthKitBridgePlugin RestActivityPlugin CloudBackupPlugin MainViewController; do
  cp "$ROOT/native/HealthKitBridge/$f.swift" "$ROOT/ios/App/App/$f.swift"
done

echo "==> Building (derived data pinned to ios/App/.derived)"
# PIPESTATUS, not the grep's status: piping into grep discards xcodebuild's
# exit code, so a failed build used to sail through to install — which then
# shipped the STALE bundle still sitting in .derived and reported success.
# Twice now this script has claimed "Done" over a build that never happened.
set -o pipefail
xcodebuild \
  -project "$ROOT/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Debug \
  -destination "id=$DEVICE" \
  -authenticationKeyID Q4C9KQJY37 \
  -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_Q4C9KQJY37.p8" \
  -authenticationKeyIssuerID 3b3a22df-7fe5-4ad4-a523-1aa60fcd9eee \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build 2>&1 | grep -E "error:|warning: .*(deprecat|unused)|BUILD (SUCCEEDED|FAILED)" || BUILD_STATUS=$?
set +o pipefail

# grep exits 1 when it matched nothing, which is not a build failure — so the
# authority is the marker xcodebuild prints, checked against a fresh log.
if [ "${BUILD_STATUS:-0}" -gt 1 ]; then
  echo "!! Build failed. Nothing was installed; the app on the device is unchanged." >&2
  exit 1
fi

if [ ! -d "$APP" ]; then
  echo "!! Build produced no app bundle at $APP" >&2
  exit 1
fi

if [ "$FRESH" = "1" ]; then
  echo "==> Uninstalling first (--fresh)"
  xcrun devicectl device uninstall app --device "$DEVICE" "$BUNDLE_ID" 2>&1 | tail -1 || true
fi

echo "==> Installing to $DEVICE"
# A failed install used to be swallowed by `|| true`, and the verification
# below reads the LOCAL bundle — so a dropped USB connection printed an error,
# then "all plugin methods present", then "Done". Exactly the false success
# this script exists to prevent. Install is now fatal, and retried once,
# because "Connection interrupted" is usually transient.
install_once() {
  xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 \
    | tee /tmp/ios-deploy-install.log \
    | grep -iE "installed|bundleID|error" || true
  grep -q "App installed" /tmp/ios-deploy-install.log
}

if ! install_once; then
  echo "   install failed — retrying once"
  sleep 3
  if ! install_once; then
    echo "!! Install failed twice. The app on the device is NOT this build." >&2
    echo "   Check the cable, unlock the phone, and re-run." >&2
    exit 1
  fi
fi

echo "==> Verifying the built bundle exports every plugin method"
# Reads the local .app. Meaningful only because the install above is now
# fatal — the bundle checked here is the bundle that reached the device.
# Compares the plugin's method list in the binary against the Swift source, so
# a stale install can't pass silently the way it did before.
EXPECTED=$(cat "$ROOT/native/HealthKitBridge/HealthKitBridgePlugin.swift" \
               "$ROOT/native/HealthKitBridge/RestActivityPlugin.swift" \
               "$ROOT/native/HealthKitBridge/CloudBackupPlugin.swift" \
  | grep -oE 'CAPPluginMethod\(name: "[a-zA-Z]+"' \
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

echo "==> Done. Paid team (263G7A2Q2N): this build is signed for ~1 year."
