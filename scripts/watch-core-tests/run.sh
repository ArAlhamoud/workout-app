#!/usr/bin/env bash
# The Watch session core on the Mac: Models.swift + SessionCore.swift are
# Foundation-only, so plain swiftc builds them with this harness.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$(mktemp -d)/watch-core-tests"
swiftc -O -o "$OUT" \
  "$ROOT/ios/App/WatchApp/Models.swift" \
  "$ROOT/ios/App/WatchApp/SessionCore.swift" \
  "$ROOT/scripts/watch-core-tests/main.swift"
"$OUT"
