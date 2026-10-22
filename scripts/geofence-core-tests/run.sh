#!/usr/bin/env bash
# The gym-geofence queue on the Mac: GymGeofenceCore.swift is Foundation-only,
# so plain swiftc builds it with this harness (same shape as watch-core-tests).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$(mktemp -d)/geofence-core-tests"
swiftc -O -o "$OUT" \
  "$ROOT/native/HealthKitBridge/GymGeofenceCore.swift" \
  "$ROOT/scripts/geofence-core-tests/main.swift"
"$OUT"
