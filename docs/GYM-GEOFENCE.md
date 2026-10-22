# Gym geofence — the server contract

Owner, 2026-10-22: "when I go to this location … start the check-in; when I
leave, it's automatically checked out." The server side is live; the native
side (region monitoring on the iPhone, prompts on the phone and Watch) is
the Mac session's.

## Endpoint

`POST /api/gym/visit` with JSON:

| field | value |
|---|---|
| `event` | `"enter"` or `"exit"` |
| `gym` | `"bfit"` (B_Fit) or `"work"` (Alrajhi Tower) |
| `atISO` | when the region event happened on the phone, ISO 8601 **with `Z` or an offset** (a bare local time is refused), **not** when it is sent |

Responses: `{ action: "created", visit }`, `{ action: "closed", visit }`, or
`{ action: "none" }`. `none` is a normal answer, not an error.

## Rules (src/lib/gym-visits.ts `geofenceEnter` / `geofenceExit`, tested)

- **Enter** opens a visit at the entry time. Send it when he taps *Check in*
  on the arrival prompt, with the time he ENTERED. Never a second open visit
  (a manual tap, a repeated event, or the other gym's open visit stands); a
  forgotten (> 6 h) visit does not block it; an entry older than 6 h opens
  nothing; a future time is clamped to now.
- **Exit** closes the open visit for THAT gym at the exit time. Send it on
  its own once he has been outside the region long enough (5–10 min) to rule
  out GPS drift. Nothing open, the other gym, an exit before the check-in,
  or a stay over 5 h → `none` (the "how long were you there?" card handles
  the last). A check-out already made on another device wins.
- **Send events in the order they happened, one at a time.** Queue them on
  the phone while offline and send the oldest first, waiting for each answer.
  An exit sent before its enter finds nothing open and is answered `none`;
  keep it queued and resend it after the enter is accepted.
- An enter whose time falls before the end of a visit already recorded (for
  example a late tap on an old prompt after a manual visit) → `none`.
- Enter and exit run under one database lock, so a retry or a phone and a
  Watch tap at the same moment cannot create two visits.
- Manual check-in/out and the 5-minute time fixes are unchanged.

## Privacy

The server never receives a location. Gym coordinates are set once on the
phone ("Set this as B_Fit") and stay on the device; no location history is
kept anywhere.

## The phone (native side)

Swift in `native/HealthKitBridge/` (copied into `ios/App/App/` by
`ios:deploy` / `ios:testflight`):

- `GymGeofenceCore.swift` — the queue as one pure, persisted value
  (pending exits, outbox, maybe-later exits). Tested on the Mac with
  `npm run test:geofence` (plain swiftc, like the Watch core).
- `GymGeofenceManager.swift` — `GymGeofence` (Core Location) and
  `GymNotifications` (the prompts and their delegate).
- `GymGeofencePlugin.swift` — `GymGeofence` to the web card: `status`,
  `requestAlways`, `setGym`, `clearGym`, `openSettings`, plus a
  `statusChange` event.

**Privacy.** Region monitoring (`CLCircularRegion`), never continuous GPS
and no background location mode. "Set this as B_Fit" takes ONE fix (refused
over 65 m accuracy: "GPS not precise enough — try again near the
entrance") and stores only that gym's latitude/longitude in UserDefaults
on the phone. Region events are reduced at once to {gym, enter|exit,
time}; no position is logged, stored or sent. Clear removes the
coordinates and stops watching.

**Two circles per gym.** 150 m (arrive / leave) and 600 m ("away").

- *Arriving* (150 m entered): a local notification "At B_Fit. Check in?"
  with **Check in** / **Not now** (category `GYM_ARRIVE`, background
  actions — iOS mirrors it to the Watch when the phone is locked). Check in
  queues an `enter` with the moment he ENTERED (carried in the
  notification) — but only when he taps within 30 min of it; a later tap
  sends the TAP time, unless a CONFIRMED exit after that entry is already
  known (the late tap after he left, which then closes at its real times).
  The prompt is withdrawn on the next wake once it is 30 min old, so a
  stale one cannot sit on the lock screen all day — which also makes the
  late-tap path rare at B_Fit: leaving wakes the app, and by then the
  prompt is usually gone. Re-entering after a pending exit follows the
  drift rule below: drift is the same stay (no exit, no second prompt); a
  departure sends that old exit first and prompts anew.
- *Leaving* (150 m exited): a **pending exit** {gym, exitAt} is stored, not
  sent. It is sent, with that original exitAt, when (a) the 600 m away
  circle is exited, or (b) the app wakes for any reason (launch, foreground,
  any region event, a notification action), it is ≥ 7 min old, AND iOS
  answers `requestState` with *outside* the 150 m circle (answers count only
  within 30 s of our own ask). *Inside* drops it as drift — unless it is a
  departure by the rule below, then it is sent (left yesterday, back
  today); *unknown* keeps it pending. iOS cannot run a timer while the app
  is suspended, which is why the away circle exists.
- **One drift rule** (every path: re-entry, the state answer, the late-tap
  bound). A pending exit is *confirmed* when the away circle was left or
  iOS answered *outside* for it; a confirmed exit is real and is sent with
  its original time. An *unconfirmed* pending exit younger than
  `driftWindow` (90 min) may be indoor GPS drift while he trains, so it is
  never what closes a visit or bounds a check-in; older than 90 min it is
  a departure the app slept through.
- **Alrajhi caveat:** that gym is inside his office tower; he may stay
  within 600 m all day, so the away circle never fires. There the exit goes
  out on the next wake after 7 min (the next time he opens the app or any
  region event arrives) — still with the real exit time. And a gym inside
  a building he spends the day in prompts "Check in?" on EVERY arrival at
  the building, workday or not (the 30-min tap rule keeps an 08:00 arrival
  from becoming the check-in). Setting Alrajhi is optional: left unset,
  that gym is simply manual.
- *Closed*: "Checked out of B_Fit · 1 h 23" — a quiet notification (no
  sound), duration from the visit the server returned.

**Precise location.** With approximate location iOS cannot watch a 150 m
circle: the card says "Precise location off" with a Settings link, setGym
refuses with the same words, and no circle is monitored.

**Sending.** One at a time, oldest event first, waiting for each answer;
offline or 5xx keeps the event for the next wake; a 4xx drops it (it would
block the queue for good). Each send runs inside a background task. An exit
answered `none` is kept up to 6 h in a maybe-later list for its gym; when an
`enter` for that gym is answered `created` (the late tap on an old prompt
after he left), the kept exits after that entry are re-sent, oldest first.
The base URL is the shell's own `server.url` from the bundled
`capacitor.config.json` — a simulator build pointed at a local mock sends
there.

**Closed app.** iOS relaunches the app in the background for a region event
with no scene and no webview. `AppDelegate.didFinishLaunching` calls
`GymGeofence.shared.launch(launchOptions)` first, which creates the
`CLLocationManager` + delegate and installs the notification delegate, so
the event, the prompt and the send never need the bridge.

**Notification delegate.** Capacitor's bridge makes its NotificationRouter
the `UNUserNotificationCenter` delegate when the view loads.
`GymNotifications` handles only notifications carrying `gymGeofence` in
their userInfo and forwards everything else to the delegate it replaced; it
installs at launch and again in `MainViewController.capacitorDidLoad`.
A non-gym notification that cold-launches the app (a rest-timer action, a
Gap Guard tap) arrives before the router exists; it is held and replayed
once the router is wrapped, never completed early. The
LocalNotifications plugin's `registerActionTypes` (rest timer) replaces the
whole category set, so a guard keeps `GYM_ARRIVE` in every set; every set
runs under one lock, and ours is skipped when a newer one already went
through the guard.

**Permission.** The card explains in two lines, then the plugin asks
When-In-Use and, once granted, Always. iOS 27 shows the second prompt
without resigning the app and reports nothing when he keeps While Using,
so `requestAlways` resolves once the prompt is up and the card follows the
`statusChange` event. Without Always everything stays manual: the card
says "Auto check-in off · location not allowed" with a Settings link.

**Simulator.** The iOS 27 simulator cannot monitor regions at all
(`isMonitoringAvailable` is false; CLMonitor reports `conditionUnsupported`).
Debug builds take `-GymSimulate enter:bfit,exit:bfit@-480,away:bfit,outside:bfit,inside:bfit,checkin:bfit,categories`
as a launch argument, which feeds the SAME handlers (`checkin` uses the
delivered prompt's userInfo, as the action does). Real arrival, the action
buttons and the background relaunch can only be checked on the phone.
