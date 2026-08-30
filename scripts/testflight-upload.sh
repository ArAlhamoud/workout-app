#!/usr/bin/env bash
#
# One command: archive Release and upload to TestFlight.
#
#   npm run ios:testflight
#
# The internal group ("Internal", created 2026-08-12 via the ASC API) has
# access to all builds, so a successful upload IS the release: once Apple
# finishes processing (5–15 min), the build appears in the TestFlight app on
# the phone with an Update button. No App Store Connect clicking, no review —
# internal testing skips beta review entirely.
#
# Auth is an App Store Connect API key, NOT a signed-in Xcode account — that
# is what makes this work headless (the "Failed to Use Accounts" wall).
# The .p8 lives OUTSIDE the repo on purpose; only identifiers live here.
# If the key is ever revoked: App Store Connect → Users and Access →
# Integrations → generate a new one, drop it in the same folder, update
# KEY_ID below.
#
# Version numbers: manageAppVersionAndBuildNumber in ExportOptions.plist lets
# Xcode bump the build number (app and widget extension together — they must
# match) at export time. Bump MARKETING_VERSION in the pbxproj by hand when a
# version should read differently in TestFlight.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_ID="Q4C9KQJY37"
ISSUER_ID="3b3a22df-7fe5-4ad4-a523-1aa60fcd9eee"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
ARCHIVE="$ROOT/ios/App/.archive/App.xcarchive"

if [ ! -f "$KEY_PATH" ]; then
  echo "!! App Store Connect API key missing at $KEY_PATH" >&2
  exit 1
fi

echo "==> Syncing native sources into the Xcode target"
for f in HealthKitBridgePlugin RestActivityPlugin CloudBackupPlugin MainViewController; do
  cp "$ROOT/native/HealthKitBridge/$f.swift" "$ROOT/ios/App/App/$f.swift"
done

echo "==> Archiving (Release)"
rm -rf "$ARCHIVE"
set -o pipefail
# The API key rides the ARCHIVE step too: registering a new bundle id or
# capability (the watch app's HealthKit) needs ASC access, and headless
# Macs have no signed-in Xcode account ("No Accounts" otherwise).
xcodebuild \
  -project "$ROOT/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyIssuerID "$ISSUER_ID" \
  archive 2>&1 | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)"

echo "==> Uploading to App Store Connect"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$ROOT/scripts/ExportOptions.plist" \
  -exportPath "$ROOT/ios/App/.archive/export" \
  -allowProvisioningUpdates \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyIssuerID "$ISSUER_ID" 2>&1 | grep -E "error|Progress|Upload succeeded|EXPORT (SUCCEEDED|FAILED)"

echo "==> Done. Processing takes 5–15 min, then TestFlight on the phone shows it."
