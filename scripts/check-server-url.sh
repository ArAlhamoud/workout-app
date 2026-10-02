#!/usr/bin/env bash
#
# Refuse to build a shell that points anywhere but the live site.
#
# Simulator testing bakes another server into ios/App/App/capacitor.config.json
# (CAP_SERVER_URL=<url> npx cap copy ios). A build made before that is undone
# would put a phone app on his wrist-side that loads a preview, or localhost.
# Nothing checked for it until the 2026-10-02 review. Undo with a bare
# `npx cap copy ios`. A deliberate non-live build: ALLOW_NON_PROD_SERVER=1.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="https://workout-app-gamma-rouge.vercel.app"
CONFIG="$ROOT/ios/App/App/capacitor.config.json"
URL=$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("server",{}).get("url",""))' "$CONFIG")

if [ "$URL" != "$LIVE" ]; then
  if [ "${ALLOW_NON_PROD_SERVER:-}" = "1" ]; then
    echo "!! Building against $URL (ALLOW_NON_PROD_SERVER=1)" >&2
    exit 0
  fi
  echo "!! The app shell points at: ${URL:-<nothing>}" >&2
  echo "   It must point at $LIVE. Run: npx cap copy ios" >&2
  exit 1
fi
