# Mac native trips — exact specs

Everything the roadmap needs from Xcode, batched so each trip is one sitting.
The standing rule (ROADMAP.md): the native half stays inert — plist entries,
tiny frozen targets — and behaviour lives web-side, because Mac-owned code
updates only when the Mac is next opened.

## Trip 1 — plist-only (30 minutes, no new targets)

### 1a. Home-icon quick actions

`ios/App/App/Info.plist`, static shortcut items routed through the existing
`workout://` scheme (`DeepLinkHandler.tsx` already allowlists `resume` and
`start`):

```xml
<key>UIApplicationShortcutItems</key>
<array>
  <dict>
    <key>UIApplicationShortcutItemTitle</key><string>Resume workout</string>
    <key>UIApplicationShortcutItemType</key><string>workout://resume</string>
    <key>UIApplicationShortcutItemIconType</key>
    <string>UIApplicationShortcutIconTypePlay</string>
  </dict>
  <dict>
    <key>UIApplicationShortcutItemTitle</key><string>Start Day A</string>
    <key>UIApplicationShortcutItemType</key><string>workout://start?day=A&amp;dur=45</string>
  </dict>
  <dict>
    <key>UIApplicationShortcutItemTitle</key><string>Start Day B</string>
    <key>UIApplicationShortcutItemType</key><string>workout://start?day=B&amp;dur=45</string>
  </dict>
</array>
```

In `AppDelegate.swift`, forward the shortcut's `type` string into the webview
as a URL open (same path Capacitor uses for the custom scheme).

### 1b. Service worker in the shell (offline cold start)

The remote-URL shell never runs the service worker — WKWebView requires
App-Bound Domains. Two additions:

- `Info.plist`:
  ```xml
  <key>WKAppBoundDomains</key>
  <array><string>workout-app-gamma-rouge.vercel.app</string></array>
  ```
- `capacitor.config.ts`: `ios: { limitsNavigationsToAppBoundDomains: true }`

After this lands, the cloud session ships a precaching service worker so the
logger opens with zero signal. (The save path is already offline-safe via the
outbox; this fixes the *cold start*.)

Owner setup, no code: an NFC sticker + Back Tap via the Shortcuts app, both
opening `workout://start?...` — ten minutes, works today.

## Trip 2 — Widget extension (one sitting)

New WidgetKit extension target ("WorkoutWidget"), Lock Screen accessory +
small Home Screen family.

- Data: `GET /api/verdict?token=<HEALTH_SYNC_TOKEN>` — already deployed.
  Fields: `lead`, `day`, `queuedDay`, `daysSince`, `updatedISO`.
- Render: verdict lead + day letter, and the days-since counter. Nothing
  else — glance rule applies harder here than anywhere in the app.
- Staleness: if `updatedISO` is older than 24 h at render time, show "—" for
  the verdict (a stale "TRAIN TODAY" after this morning's session is the app
  lying at a glance). Keep the days-since counter, which iOS can advance
  date-mathematically without a network fetch.
- Refresh: timeline `.atEnd` with ~4 h policy + reload on app background
  (`applicationDidEnterBackground` → `WidgetCenter.shared.reloadAllTimelines()`).
- Tap → `workout://resume`.
- Token storage: App Group `group.com.aralhamoud.workout`, written by a tiny
  bridge method (or hardcode once — single-user app, owner's call).

Optional rider on the same trip: ActivityKit rest-timer Live Activity. Only
worth it if the trip has spare time; the actionable notification covers the
locked-screen case (ROADMAP.md rejected list has the reasoning).

## Trip 3 — Apple Watch v1 (own project, scope frozen)

Standalone watchOS app. Three capabilities, **nothing else**:

1. Start button → `HKWorkoutSession` + `HKLiveWorkoutBuilder`
   (`.traditionalStrengthTraining`) — turns on live HR capture, closes rings.
2. Finish button → end session, save the HKWorkout.
3. Repeat-tap rest timer: one button arming 60/90/120 s, wrist haptic
   (`WKInterfaceDevice.current().play(.notification)`) at zero.

Deliberately absent, and why:

- **No WatchConnectivity.** Relaying into a possibly-suspended WKWebView is
  the flakiest path in this architecture. The phone app ingests the Watch
  session through HealthKit — `queryWorkouts` spots it, `queryWorkoutStats`
  and the hr-series capture read its HR. The data path already exists.
- **No set logging on the wrist.** Sets/weights/RPE stay on the phone. A
  watch UI versioned against a web app that redeploys in a minute goes stale
  in weeks (adversary's warning — it is correct).
- **No exercise names.** Nothing on the watch depends on the exercise list.

Widening any of this is a new decision with the adversary in the room, not a
"while I'm in Xcode" addition.

## After any trip

`npm run ios:deploy`, then commit `ios/` + `capacitor.config.ts` from the Mac
session per `docs/WORKFLOW.md`.
