# AR Health · Watch companion — build spec (Mac session)

The owner's ask, verbatim: **"log exercise without the need to open my
phone."** His watch is an **Apple Watch Ultra 3** — design for the 49 mm
always-on screen and put the **Action Button** to work.

The cloud session has already shipped the server half (branch
`claude/setup-workout-tracker-repo-ACS8i`): two REST endpoints, the
detect-and-confirm fallback flow, and the logger's HKWorkout-uuid
plumbing. This document is everything the watchOS app needs; nothing
below requires re-deriving app logic.

## The design in one paragraph

The watch never does data entry — it does **confirm/adjust**. The server
already knows today's day (A/B), the machine order, the prefill weight
per machine at his gym, each machine's pin spacing, and the return-ramp
scaling. So a session on the wrist is: tap start → a stack of set cards,
each pre-loaded → crown to nudge weight **by pins** → tap to log → rest
timer with haptic → next card. Sets queue locally; the finished session
posts in one shot.

## Architecture

- **watchOS SwiftUI app**, new watch target inside the existing Xcode
  project (`ios/App`). Companion of the Capacitor shell app.
- **Networking: the watch talks to the server directly** over
  `URLSession` (Wi-Fi/LTE — Ultra has both). Do NOT route through
  WatchConnectivity/the phone: the whole point is the phone stays in the
  locker. WatchConnectivity is optional later for instant phone refresh.
- **No auth.** Single user, open access — the owner's standing decision
  for the whole app (documented in CLAUDE.md). Do not add a token.
- Base URL: `https://workout-app-gamma-rouge.vercel.app` (production).
  Make it a build setting so a preview URL can be tested.

## Server contract (already live on the branch)

### `GET /api/watch/plan?day=A|B&dur=30|45|60&gym=bfit|work` — all params optional

Omitting `day` returns the dynamic plan's queued day; omitting `dur`
returns 60 (45 during a return ramp). Response:

```json
{
  "day": "B",
  "mode": "train",
  "focus": "Day B",
  "durationMin": 60,
  "loadPct": 100,
  "rpeCap": 4,
  "exercises": [
    {
      "exerciseId": "ckq…",
      "name": "Lat Pulldown",
      "machine": "Life Fitness pulldown",
      "order": 0,
      "sets": 3,
      "repsMin": 10,
      "repsMax": 12,
      "unit": "reps",
      "prefillKg": 55,
      "prefillReps": 10,
      "pinKg": 2.5
    }
  ]
}
```

- `prefillKg` is **already ramp-scaled** (floored to the pin during a
  ramp — conservative, matching the phone) — display it as is. `null`
  means no history: the watch shows `— kg` and the crown starts from 0
  in `pinKg` steps.
- Pins and prefills are **per gym** — pass `gym=work` at Alrajhi or the
  numbers describe the wrong building's stacks.
- `pinKg` is that machine's **learned pin increment** (CLAUDE.md rule 4:
  stacks move in pins, not kilograms — the crown must step by `pinKg`,
  never by a fixed 2.5).
- `rpeCap` < 4 during a ramp: grey out RPE buttons above the cap.
- Fetch the plan when the session starts; **cache the last plan on the
  watch** so a dead-signal gym still opens with yesterday's numbers.

### `POST /api/watch/log` — the finished session, one shot

```json
{
  "day": "B",
  "name": "Day B — Watch · Sep 1",
  "startISO": "2026-09-01T17:04:00Z",
  "localDay": "2026-09-01",
  "durationSec": 3120,
  "gym": "bfit",
  "healthWorkoutUuid": "<uuid of the HKWorkout the watch recorded>",
  "clientSaveId": "<uuid generated once per session, kept across retries>",
  "sets": [
    { "exerciseId": "ckq…", "setNumber": 1, "reps": 10, "weight": 55, "rpe": 2, "isWarmup": false }
  ]
}
```

- `localDay` is the wrist's local calendar day — REQUIRED in practice:
  the server cannot know the watch's timezone, and every other workout
  sits at UTC midnight of the local day. Omit it and a post-midnight
  session files under the wrong day.
- A `startISO` more than 10 minutes in the future is rejected (400) —
  fix the clock, don't retry. `healthWorkoutUuid` over 64 chars is
  rejected. `gym` must be exactly `bfit` or `work`.
- Response `{ id }` or `{ id, deduped: true }`. **Idempotent twice
  over**: `clientSaveId` (retry-safe) and `healthWorkoutUuid` (a
  phone-side detect of the same HKWorkout can never duplicate it).
  Retry on failure with the SAME clientSaveId until a 2xx.
- RPE is the app's 1–4 scale (Easy/Med/Hard/Grind).
- `gym` defaults to bfit server-side; add a gym toggle on the watch only
  if he ever asks.

## Screens (49 mm, always-on)

1. **Start** — one big button: `Day B · 60 min` (from the plan; crown
   flips A/B, taps 30/45/60). Starting it ALSO starts an
   `HKWorkoutSession` (traditional strength training) so HR, rings and
   the always-on session UI come free.
2. **Set card** (the core screen, one per set):
   - Machine name small, `55 kg × 10` huge (SF Rounded, tabular).
   - **Crown = weight in `pinKg` steps.** Tap reps to cycle
     repsMin…repsMax. One green button: **Log set**.
   - After logging: **rest screen** — countdown (default 90 s), haptic
     `.notification` at zero, next set card behind it. Skip by tap.
3. **RPE strip** after each exercise's last set: four buttons
   Easy · Med · Hard · Grind (respect `rpeCap`).
4. **Finish** — summary (sets · top weights · duration), ends the
   HKWorkoutSession, POSTs the payload. If the POST fails, bank it
   (below) and say "saved on watch — will upload."

## Action Button (Ultra 3)

Register an App Intent `StartTrainingIntent` and surface it for the
Action Button: **one press in the gym = plan fetched, session started,
first set card up** — zero taps on screen. Also expose it to Siri
("Start my workout") and as a Smart Stack widget for dose-day glances
later.

## Offline rules (non-negotiable, same spirit as the phone outbox)

- Every logged set is appended to local storage immediately; the app
  process dying mid-session loses nothing.
- The finished-session payload goes into a small on-watch outbox; flush
  on finish, on next launch, and on connectivity restore. Same
  `clientSaveId` across every retry.
- The plan cache serves stale-but-usable numbers when offline.

## HealthKit on the watch

- Record the session as `HKWorkoutSession` +
  `HKWorkoutBuilder` (`.traditionalStrengthTraining`).
- Send its UUID as `healthWorkoutUuid` in the POST — this is the
  dedupe key against the phone's auto-detect.
- The watch app's bundle writes under the same team; the phone-side
  detect already ignores `com.aralhamoud.workout`-authored sessions —
  give the watch workout writer the same bundle prefix so the filter
  catches it, and the fallback uuid dedupe catches whatever slips.

## The fallback that already ships (no watch app needed)

If the watch app isn't built yet or he skips it some day: he starts the
built-in Workout app on the wrist, and the phone app's Home shows
"Trained 52 min at 10:12 — fill in the sets →" on next open, landing in
the logger prefilled with the session's real duration, date and
HKWorkout uuid attached. That flow is live on the branch — the watch app
must not break it, only outrank it.

## Acceptance checklist

- [ ] Action Button press → first set card in under 5 s on gym Wi-Fi
- [ ] Crown steps match the machine's `pinKg` (verify Leg Press ≠ 2.5)
- [ ] Airplane-mode session: all sets logged, POST lands after landing
- [ ] Kill the app mid-session: relaunch resumes the set stack
- [ ] Same session never appears twice (watch POST + phone detect)
- [ ] Rest haptic fires with the screen down (wrist motion off)
- [ ] Return-ramp week: prefills scaled, RPE buttons capped


## Live session — start on one device, continue on the other (owner, 2026-09-01)

The SERVER owns the picture of a session in progress: one `LiveSession`
row keyed by the client save id both devices finish with. Every set
logged on either device is pushed as it happens; the other device reads
the row and carries on. The finish posts with the same id, so the two
halves merge into ONE workout. Machine order stays per device — only
logged sets sync (the occupied-machine swipe stays simple).

Contract (`/api/live`, no auth — single user):

- `GET /api/live` → `{ live }`: the open, fresh session or null. Fresh =
  not closed, started < 4 h ago, touched < 2 h ago. `?id=<csid>` returns
  that row whatever its state (closed rows say `closedAt` + `workoutId`).
- `POST /api/live` `{ clientSaveId, source: 'phone'|'watch', day?,
  durationMin?, gym?, startedAt?, sets: [ {exerciseId, setNumber, reps,
  weight, rpe?, isWarmup?, completedAt} | {exerciseId, setNumber,
  remove: true} ] }` → `{ live }` merged. Opening a new id closes every
  other open row (one session at a time). A closed id writes nothing and
  answers with the closed row — stop.
- `POST /api/live/close` `{ clientSaveId }` — discarded on a device.

Merge rule (`src/lib/live-session.ts`, tested): a device owns what it
logs; same key (exercise + TEMPLATE set number, warm-ups keyed apart as
setNumber 0) → the LATER completion wins; keys the update never
mentions are untouched; a row holds ≤ 200 keys and only sets whose
exerciseId exists. The phone's save keeps the template numbers too —
renumbering 1..n across a warm-up once dropped a Watch set and doubled a
phone set. Gym and source are FIRST-writer-wins: the opening device
tagged the building (rule 2); the Watch sends no gym. On finish,
`createWorkout` unions any live set from the OTHER device the poster
never saw (poster wins ties; its own live sets are never re-added, so a
failed un-tick stays un-ticked) and closes the row; a second finish
under the same id adds the sets the saved workout lacks — in one
transaction — and returns `deduped`: a success, not an error.

Watch side: the Start screen shows **Continue Day X · N sets on the
phone** when a phone-born row is open; `continueLive` builds the slots
from the plan for that day/length, ticks the phone's sets (they move to
the head), keeps the phone's save id, and backdates the HKWorkout to the
phone's start (owner's call — the phone half has no HR curve). Every
`logCurrentSet`/RPE posts its set; `refreshLive` on wrist-raise notices a
row the phone finished: it first posts its own sets under the same id
(the server adds what the workout lacks), then lands on Done.
Phone-origin sets are marked, never rated on the wrist, and dropped if
the phone un-ticks or discards them. Phone side: the logger applies a
live row on open (draft precedence: same id → overlay; a draft with ANY
ticked set wins; else live wins and the draft's date/start/gym reset),
pushes a debounced diff of ticked sets (started-at = first tick), polls
every 30 s / on visibility, and when the Watch finished first it posts
its own un-pushed sets under the same id before following to the
workout. Only a bare `/workouts/new` open follows a Watch row's day; an
explicit `?day=` wins (a kept other-day draft must not ping-pong). The
draft pill offers **⌚ Day X · N sets · Continue →** elsewhere, and its
Discard closes the live row too. Known gap: when the phone did a
machine's last set the wrist never shows that machine's RPE strip.

## Staying on the wrist (owner, 2026-09-01)

First gym session: between sets the watch dropped to the clock and the
next wrist-raise landed on the face, not the set card. Two layers keep
the app up for the whole session (`SessionStore.keepAwake`):

1. **A running `HKWorkoutSession`.** watchOS treats the app as the active
   workout: it stays frontmost with no timeout, and the always-on display
   shows the current screen dimmed when the wrist is down, rest countdown
   still ticking. After a relaunch mid-session `WorkoutManager.
   recoverOrBegin` reattaches to HealthKit's live session (or starts a
   fresh one) so a resumed session behaves the same.
2. ~~Extended frontmost timeout~~ — REMOVED (Mac session, build 7):
   `frontmostTimeoutExtended` is deprecated since watchOS 7 and a no-op.
   `keepAwake` is an explicit no-op kept as the seam; do not restore
   the call. The running workout session is the one real mechanism.

No app can hold the backlight itself on; that is a watch setting. On the
watch: **Settings → Display & Brightness → Always On: on**, and **Wake
Duration: Wake for 70 seconds** (the default is 15). With both, the card
never disappears — it dims with the wrist down and is bright on raise.

## Known gap: one RPE tap per exercise vs the overload rule

The wrist rates only the last set of each exercise (honest, per the
trainer). The phone's Overload-by-default rule needs ≥2 rated sets per
exercise-session, so wrist-only history can never earn a pin after the
ramp. Either the strip asks per set or the rule accepts a deliberately
rated last set — decide when the ramp ends (trainer note, 2026-09-01).

## Occupied machine (owner, first wrist session, 2026-08-31)

Update 2026-09-02 (first field use): the swipe alone was missed on the
gym floor, and the busy machine is discovered on the REST screen, not
the set card. Build 9 answered that with a real button row on the set
card.

**Update 2026-09-07 (owner, settled): the swipe IS the interaction —
but every hint that names the target is tappable.** He asked for the
gesture, not button chrome; the 09-02 failure was having no fallback
when a swipe is missed, not the absence of buttons. So both screens
carry one quiet `.plain` line, no chrome, that also works as a tap:
set card `<next machine> ›`, rest screen `<machine he is walking to>
taken? ›`. Tap always goes FORWARD; back is swipe-right only.

Four things the review pass fixed, each worth not relearning:

1. **ONE chevron, trailing.** The first cut read `‹ <next> ›`, and the
   leading ‹ lied — the whole row goes forward, so the glyph meaning
   "back" advanced him, and tapping again to undo advanced him again.
2. **The rest screen names the machine AT RISK, not the destination.**
   It labels with `currentSlot.exerciseName` — the machine he is
   walking to. `nextMachineName` is where a switch LANDS him, so using
   it asked "Plank taken?" while he stood at an occupied Mid Row.
3. **`.id(slot.id)` on SetCardView** (RootView). A rotation changes the
   slot without changing the phase, so SwiftUI reused the view and threw
   away `init`'s crown seed. Rotating a 0 kg card into the seconds Plank
   card left the crown at 0, outside the 5…180 range, and the clamp
   wrote a phantom 5 s hold — the 10 s plank bug (e9be317) by another
   road. Verified fixed: Mid Row → Plank now shows 21 s, not 5 s.
4. **Hit regions.** `.plain` hit-tests the glyphs, not the frame, so the
   padded row was dead at the edges and a near-miss on the rest screen
   fell through to the parent's tap and destroyed the rest with no undo.
   Both lines now carry `.contentShape(Rectangle())` over a full-width
   frame; the rest-screen drag is gated on `pendingMachineCount > 1`
   because `switchMachineFromRest` kills the timer BEFORE
   `rotatePending`'s own guard runs.

Sim-verified after the fixes: tap the hint → next machine; tap the far
LEFT edge of the row → still rotates (contentShape works); swipe right
→ back; a swipe STARTING on the hint still swipes (highPriorityGesture
beats the button); rest-screen near-miss at the far right → rotates
instead of killing the rest.

**The "End" badge vs the machine label (fixed 2026-09-07).** The badge
is a fixed top-LEFT overlay at x 15.5…48 pt, y 21…53. The set card's
VStack is vertically CENTRED, so it grows upward as content is added
and the machine label drifts up into the badge: worst on the
zero-weight card, which adds the "turn the crown" line and pushed the
label to y 43.5, rendering "Lif⬤ess Dual Adjustable Pulley…".

The fix is horizontal, and the reason matters. Content already ends at
y 241 of 251, so pushing the card DOWN needs ~17 pt that does not
exist; buying it back by tightening the stack would undo the hint-row
clearance above the Log set button. Insetting the label past the
badge's width (`.padding(.leading, 50)`, trailing 8) clears it at every
vertical position, in every state, and costs zero vertical space. The
tail that truncation now eats — "(seated Back Extension)" — is the part
line 2 already says, so the readable information went UP.

Measured before/after in all six states (normal, long name,
zero-weight, zero-weight+single, seconds/Plank, single-machine): in the
badge's own y band, ink now starts at x 15.5 (the badge's own edge)
where it previously started at x 6.0 (the label's clipped glyphs). Hint
row and Log set bands are byte-identical before and after.

Sim states are staged by writing `Documents/active-session.json` into
the app container and relaunching — `onLaunch` restores straight to
`.active` and only issues GETs, so no card state needs a logged set and
nothing touches the production database.

**Update 2026-09-12 — "the swipe does not work on my watch": it was
delivery, not the gesture.** The owner reported build 9's swipe did
nothing on the wrist. The real cause: **no TestFlight build had ever
reached his devices.** The sole tester (ar.alhamoud@gmail.com) was still
`state=INVITED` with no devices, so builds 5–10 uploaded and went
nowhere, and the phone and watch were still on the 2026-08-31 dev
install (phone `CFBundleVersion` 2). Build 9's gesture was never on his
wrist. Delivered by `npm run ios:deploy` over the network instead.

A detour worth not repeating. On the sim, the build 9 gesture
(`DragGesture(minimumDistance: 40)`) rotated on a slow 1 s drag but not
on a 0.3 s injected flick. That was read as "fast flicks fail", and the
gesture was changed to a 20 pt minimum judged by
`predictedEndTranslation`. The adversary then reproduced, in SwiftUI's
real gesture engine:
- Because the drag is HIGH priority over the buttons, a sideways press
  on Log set switched machines instead of logging, and a reflexive
  second tap logged the set under the wrong machine at the wrong weight.
- The predicted vector turned curled flicks, hooked vertical wipes
  (which on the rest screen also kill the rest) and rebounds into wrong
  rotations.

It also showed that a straight swipe ending ≥ 40 pt from its start DOES
fire with the 40 pt gesture, so the sim result was most likely an
artifact of how the tool injects touches. Reverted the same night, back
to build 9's gesture.

Lessons:
1. **Before blaming the code for "the update didn't change anything",
   prove the update arrived** (tester state, installed build number,
   the footer below).
2. **A simulator swipe tool is not a thumb.** Don't loosen a
   high-priority gesture that sits over a data-writing button on the
   strength of an injected flick.
3. **What is still unverified is the 40 pt swipe on real hardware.**
   That needs his wrist, now that the build is actually there.

**Which build is on the wrist.** The Start screen's footer reads
`build N` from `CFBundleVersion`. That is the TestFlight number on a
TestFlight install, because `scripts/ExportOptions.plist` sets
`manageAppVersionAndBuildNumber` and the export renumbers the whole
bundle, Watch app included. A local sim/dev build shows the project's
own number (currently 2), which is expected. Added because "the fix did
not reach my watch" was unanswerable from the wrist: the Mac could not
reach the watch (`ddiServicesAvailable: false`), and the phone was
locked.


A horizontal swipe on the set card rotates the PENDING machines: swipe
left → the next machine's sets come up now and this one's remaining
sets go to the back of the queue; swipe right → the reverse. Logged
sets never move; finishing a machine removes it from the rotation. The
card advertises the swipe only while more than one machine still has
pending sets. 40 pt minimum drag so crown nudges and sleeve brushes
never trigger it.
