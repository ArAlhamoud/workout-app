# HealthKitBridge — wiring the plugin in Xcode

Hand-rolled Capacitor plugin (Capacitor 6+/8 conventions) exposing HealthKit to
the web app as `HealthKitBridge`. The two Swift files in this folder are
ready-to-add sources — they compile against the SPM-based `ios/App` project
that `npx cap add ios` generates (Capacitor 8 links the `CapApp-SPM` package,
so app-target code can `import Capacitor` directly; no CocoaPods involved).

## 1. Add the source files to the App target

1. Open the project: `npx cap open ios` (opens `ios/App/App.xcodeproj`).
2. In Xcode's Project navigator, right-click the `App` group (the yellow folder
   containing `AppDelegate.swift`) → **Add Files to "App"…**
3. Select both files from `native/HealthKitBridge/`:
   - `HealthKitBridgePlugin.swift`
   - `MainViewController.swift`
4. In the add dialog: check **Copy items if needed**, and make sure the **App**
   target is checked under "Add to targets".

## 2. Register the plugin with the Capacitor bridge

Capacitor's iOS runtime loads plugins two ways:

- **npm-installed plugins** are auto-registered: `npx cap sync` writes their
  class names into `packageClassList` in the generated
  `ios/App/App/capacitor.config.json`, and the bridge instantiates each listed
  class at startup (resolved via `NSClassFromString`, which is why the plugin
  class carries `@objc(HealthKitBridgePlugin)`).
- **App-target plugins** (our case) use the official custom-code hook: subclass
  `CAPBridgeViewController`, override `capacitorDidLoad()`, and call
  `bridge?.registerPluginInstance(...)`. `MainViewController.swift` already
  does exactly this — you only need to point the storyboard at it:

1. Open `App/Base.lproj/Main.storyboard`.
2. Select the single view controller (currently `CAPBridgeViewController`).
3. In the Identity inspector (⌥⌘3), set **Custom Class → Class** to
   `MainViewController` and **Module** to `App` (or tick "Inherit Module From
   Target").

Do **not** hand-edit `packageClassList` for this plugin: `npx cap sync`
regenerates `capacitor.config.json` from installed npm plugins and would drop
the entry (and the entry is unnecessary — `registerPluginInstance` in
`capacitorDidLoad()` is the supported mechanism for app-target plugins). If you
ever ship this plugin as an npm package instead, its class name would land in
`packageClassList` automatically and `MainViewController` could go back to
plain `CAPBridgeViewController`.

## 3. Enable the HealthKit capability

1. Select the **App** project → **App** target → **Signing & Capabilities**.
2. Click **+ Capability** → add **HealthKit**.
   (This creates the `com.apple.developer.healthkit` entitlement; the default
   options are fine — no background delivery or clinical records needed.)

## 4. Info.plist usage descriptions

Add these two keys to `ios/App/App/Info.plist` (Target → Info tab → “+”, or
paste into the XML). Both are required — the app reads *and* writes Health data
and iOS crashes the app on first Health API touch without them:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Workout reads your weight, heart rate, and active energy from Apple Health to chart trends and enrich your logged sessions.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Workout saves your strength-training sessions and their energy burn to Apple Health.</string>
```

## 5. Build

Build to a real iPhone (HealthKit is not fully functional in the simulator —
it exists but has no real data). First call from the web app is
`requestAuthorization`, which pops the Health permission sheet.

## JS API (already wired in `src/lib/native-health.ts`)

| Method | Input | Output |
| --- | --- | --- |
| `requestAuthorization()` | – | `{ granted: boolean }` |
| `queryWeight({ sinceISO? })` | default: last 90 days | `{ samples: [{ value /* kg */, dateISO }] }` ascending |
| `queryWorkoutStats({ startISO, endISO })` | required window | `{ avgHr, maxHr, activeKcal }` (nulls when no data) |
| `saveWorkout({ startISO, endISO, kcal?, name? })` | – | `{ saved: true }` |
