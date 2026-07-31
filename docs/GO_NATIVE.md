# Go Native — build the iOS shell on your Mac

The repo already contains everything: `capacitor.config.ts`, the generated
`ios/` Xcode project (Capacitor 8, SPM — no CocoaPods), and the HealthKit
plugin sources in `native/HealthKitBridge/`. The Mac only wires, signs, and
builds.

## 1. Prerequisites

1. Xcode from the Mac App Store (15+; includes the iOS SDK). Launch it once and accept the license / install components.
2. Node 18+ (`node -v`).
3. An Apple ID signed into Xcode (Settings → Accounts).
   - Free Apple ID: works, but the app **expires every 7 days** — rebuild from Xcode to renew.
   - Paid Apple Developer ($99/yr): app lasts a year, no weekly rebuilds.
4. iPhone connected via cable (or on the same Wi-Fi after first cable pairing), Developer Mode on (Settings → Privacy & Security → Developer Mode — iOS prompts on first install).

## 2. Copy-paste prompt for local Claude Code

Open Claude Code **on your Mac** — either works:
- **Claude desktop app** → start a Claude Code session (a coding session with local file access, not a plain chat)
- **Terminal** → run `claude`

Then paste:

> Clone ArAlhamoud/workout-app, checkout feature/native-ios, run npm install.
> If the ios/ folder is missing, run npx cap add ios. Then follow
> native/HealthKitBridge/README.md exactly to wire the plugin: add the two
> Swift files to the App target, point Main.storyboard's root view controller
> at MainViewController, enable the HealthKit capability, and add the two
> Info.plist usage-description strings from the README. Then open Xcode via
> npx cap open ios, set my personal team under Signing & Capabilities, and
> build to my connected iPhone.

## 3. Manual fallback (doing it by hand)

1. `git clone <repo> && cd workout-app && git checkout feature/native-ios`
2. `npm install`
3. `ls ios` — if missing: `npx cap add ios`
4. `npx cap sync ios`
5. Follow `native/HealthKitBridge/README.md`:
   1. Add `HealthKitBridgePlugin.swift` + `MainViewController.swift` to the App target ("Copy items if needed").
   2. Main.storyboard → root view controller → Identity inspector → Custom Class `MainViewController`, Module `App`.
   3. Signing & Capabilities → + Capability → HealthKit.
   4. Info.plist → add `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` (exact strings in the README).
6. `npx cap open ios`
7. App target → Signing & Capabilities → Team = your personal team; let Xcode fix provisioning (bundle id `com.aralhamoud.workout` — change it if it collides).
8. Select your iPhone as run destination → ⌘R.

## 4. First run on the phone

1. If the app won't launch: Settings → General → VPN & Device Management → trust your developer certificate.
2. Open the app (it loads https://workout-app-gamma-rouge.vercel.app — needs internet).
3. Go to **Stats** → the "Apple Health" card appears (native shell only) → paste the sync token (same value as `HEALTH_SYNC_TOKEN` on Vercel) → Save.
4. Tap **Connect Health** → allow all requested Health permissions.
5. Tap **Sync now** → expect a terse status like `3 weights · 1 workout ↑`.

## Watch out

- The web app is loaded remotely from Vercel (`server.url` in `capacitor.config.ts`) — no local web build is ever bundled; `webDir: public` is a placeholder.
- HealthKit needs a real iPhone; the simulator has no Health data.
- Free-account builds: after 7 days the app icon greys out — plug in and ⌘R again.
