# Roadmap

# Roadmap

## Wave 5 — Aurora Health (BUILT)

The second domain: Mounjaro treatment as the spine (clock anchored at
the first logged injection; dose plan 2.5×4 → 5×2 → doctor-review
checkpoint, editable, never auto-escalating), with weight goals
(133 → 120 → 110 → 103), GI/side-effect logs on one stream, AF episodes
with tri-state circumstance flags, CPAP nights (Löwenstein prisma APP
numbers), BP, labs, medications, a unified timeline, a day-relative
side-effect matrix, AF correlates with answered-only denominators, and
a printable English + Arabic doctor report with CSV export. All
deterministic, all guarded ("not enough data yet"), $0. The app is now
**Aurora Health**. See docs/HEALTH.md for the laws.

Wave 7 — the owner's five picks (BUILT)

Earned Ramp (clean spaced sessions lift the calendar clamp; rest-day
spacing + ~4-day phase floor keep time in the loop — fastest disciplined
comeback ≈2.5 weeks, exit lands at BUILD), Comeback Contract (day-2 rung
whose payoff line is computed by the same gates that pay it, projected to
fire time; replaces day 3 while armed), Overload by default (+1 learned
pin after 2× all-Easy-at-target-reps days, undo chip, dead on ramp/
rescue/deload/gym-switch/exercise-swap/readiness-hold), effort pills in
the rest capsule (capped pills stay tappable — the cap instructs, never
censors), and the capsule's true next set + scroll-on-done (scan wraps;
"All sets done" cannot lie).

Panel catches worth remembering: capsule pills were born disabled above
the cap while ratings buy acceleration (trainer blocker — the sensor must
be able to say Hard); the earned ramp had no time axis (6 consecutive
clean days → 100% at day 7 for a 133 kg lifter); the contract could
promise what the math wouldn't pay; rung id 2007 collided with the
stuck-save alert and killed that safety net on every open; the exercise
swap kept an undo that wrote the old machine's weight into the new one.

Accepted residuals: the 00:00–03:00 bare-UTC clean-session window
(self-heals), the overload fold's global take-cap (revisit inside the
getWorkouts redesign), the Live Activity's frozen exercise name (by
design).


## Wave 6 — measure, then optimize (BUILT)

A five-lens audit workflow (28 findings → 7 confirmed ship-now) plus two
blind reviewers over the diff. Shipped: the dormant coach no longer costs
Home a round trip or a daily junk row (brief AND ladder-copy); the session
clock is its own component (the 1 Hz tick re-rendered the entire logger
every second for a whole session); draft autosave is debounced with
kill-proof flushes (was: full stringify + sync write per keystroke); the
mid-workout gym switch is one round trip; rep records fold in SQL; the
logger and post-save pages lost their serial fetch waves; holds ride every
copy of the record.

Review catches worth remembering: the debounce nearly shipped a
ghost-draft-resurrection race that could duplicate a saved workout
(adversary, fixed + probe-proven), and an exerciseIds bound on rep records
nearly re-shipped the fake-PR class (steward veto, removed).

Deliberately deferred, recorded for the next wave: App-Bound Domains + a
precaching service worker as one pair (the only finding about a failure —
dead-signal gym = white screen); the getWorkouts split by consumer
(medium risk, needs the assertion suite as guard); React.memo card
boundaries (only if taps still lag after this wave — measure first).

The feature panel (16 proposals, 3 killed in judging) produced a top-5
awaiting the owner's pick: Comeback Contract, Earned Ramp, Overload by
default, effort pills in the rest capsule, capsule-knows-next. Panel's
recommendation: Earned Ramp first — it makes the Comeback Contract's
promise true.


## Wave 5 — the paid team unlocks (BUILT)

The Saudi developer-program membership (team 263G7A2Q2N) lifted the
free-team restrictions; this wave shipped the three unlocks that fit one
Mac trip, verified end to end on the simulator:

- **Rest-timer Live Activity** — the countdown in the Dynamic Island and
  on the Lock Screen, drawn by the OS so it survives app suspension.
  Start-or-update on every deadline change; ends at 0:00, on skip/Done,
  and on unmount; `staleDate` covers the app-killed case. Shipped under
  the kill-list's own "reconsider as a rider" clause — the objection
  (counting rest for skipped sets) is answered by ending on dismiss.
- **Verdict widget** ("Today's Verdict") — /api/verdict on systemSmall +
  Lock Screen accessories. No computation in the widget; >24 h stale
  renders a dash, never a wrong instruction. Live production data
  confirmed on the simulator Home Screen, Aurora dark.
- **Universal links** — associated-domains + AASA (excludes /api/* so an
  export link still downloads in Safari); https links route through the
  same allowlist as workout:// (src/lib/deep-links.ts, 8 assertions).

Two bugs found by USING the app, invisible to 344 green tests: the rest
timer's 4 s auto-close never fired (inline onDismiss identity reset the
timeout on every parent re-render), and an expired Live Activity rendered
as a shattered Island (inverted `Text(timerInterval:)` range — clamped).

Same-day follow-through: **TestFlight** is live (app record
"Ar Workout personal", internal group with all-builds access, uploads via
`npm run ios:testflight` with an ASC API key — no cable, 90-day signatures,
no beta review for internal testing), and the **iCloud Drive backup** ships
the third copy of the history (workout-backup.json, daily on app open,
visible in Files.app). Still deliberately not built: APNs (nothing to push —
the coach is dormant and gap notifications are local), HealthKit background
delivery (would resurrect a public HTTP route the token removal just
deleted), Watch app (Trip 3, its own sitting).

## Wave 4 — the coach in the silence (BUILT)

Product of a 10-agent panel (5 proposal lenses → synthesis → 3 judges →
adversary) asked "what does a frontier model uniquely add?". What
survived, reshaped by the adversary:

- **The Voice Through the Door** — the day-7/day-19 gap-ladder rungs are
  rewritten by the coach at app-open (`/api/coach/ladder-copy`,
  row-as-lock, ≤2 calls/day). Guards are code, not prompt: static copy
  always arms first; generated copy passes an acceptance gate (every
  number must appear in the injected fact sheet, length caps, banned
  shame lexicon, day-19 must carry the reset fact) or the static words
  stand. No "why he stopped" facts are injected — nothing to anchor an
  invented story to.
- **One-Tap Levers** — brief directives split by mechanism: session/rescue
  chips are plain deep links; `declare-hold`/`end-hold` arrive as ONE
  approvable proposal whose bounds live in the server action (3–14 days,
  and never past lastSession+20d — no hold can silently cross the day-21
  ramp threshold).
- **The descent ladder** — constitution rule: full session → 30-min →
  rescue → walk, one rung per decline, stop after two, end with grace.
- **"What got in the way?"** — one optional line at the welcome-back
  moment (`Workout.gapReason`), the only causal gap fact the coach may
  ever cite. Hold reasons now reach the coach too.
- **Alrajhi cold start (demoted to experiment)** — a chip on the work-gym
  toggle preseeds /coach with the starting-pins question. Chat text only;
  nothing touches per-gym weight memory. Build the structured version
  only if the chat logs show real use.

Killed by the panel, with reasons: **Sunday Read** (8 workouts can't
support weekly synthesis; the pitch hallucinated its own flagship insight
against documented ground truth; the daily brief already owns
reconciliation), **Plate reader** (pivots the app into half a diet app —
the shame class the kill-list already executed).

## Wave 3 — the Coach (BUILT)

The layer only a frontier model can be: `claude-opus-5` reads the entire
history + recovery data and writes the morning brief; `/coach` is a chat
you can argue with. Hard program rules travel in the system prompt;
degradation is total (no key → app identical to before). See
`docs/COACH.md` — needs `ANTHROPIC_API_KEY` in Vercel to light up.

## Wave 2 — the researched 20 (BUILT, commit 7bedd02)

Product of a five-cluster web research pass over ~30 leading fitness apps
(Strong, Hevy, Fitbod, Whoop, MacroFactor, Gentler Streak, Duolingo's
streak research, …), critiqued for fit against this one user. All twenty
shipped in one wave:

**Gap war:** forgiving weekly streak · streak mend · welcome-back moment ·
rescue sessions (machine + walk) · one-tap compression · momentum bank ·
declared holds.
**Progress:** per-rep-range records + live toast · lifetime tonnage ·
bodyweight milestone ladder · time-decayed trend engine · re-entry
explainers · Month/Year in Iron.
**Coaching:** readiness-scaled sessions · micro-deloads + tempo step ·
auto warm-up sets · sleep debt in hours · mid-workout history drawer.
**Insurance:** waist trend surfacing · /api/export JSON+CSV.

Killed with reasons: plate calculator (no barbells), daily streaks
(guilt-driven abandonment), CTL/fitness-age curves (endurance pseudo-math
+ shame instrument), voice logging (split-brain), photo capture (needs the
Filesystem plugin — moved to Mac trip 1).

# Wave 1 — the team's 10

Product of a five-role review (trainer, device-tester, editor, data-steward,
adversary; definitions in `.claude/agents/`) against the real history in
`data/`. Owner's framing: **native iPhone — use the phone's resources.**

The unanimous finding: session quality is fine; **gaps between sessions are
the failure mode** (May: 6 sessions at a 2–7-day rhythm → 17-day sickness
gap → one session → 43-day gap that regained 3 kg → one session). Features
are ranked by how hard they attack that, then by build lane.

## Lane 1 — ships from the cloud session (web layer, ~1 min to phone)

1. **Gap Guard** — local-notification ladder armed at every save/open
   (day 3 / 5 / 7 / 19 — day 19 because `BREAK_THRESHOLD_DAYS = 21` resets
   the program to the return ramp). Cancelled the moment a session is
   logged. Works in airplane mode; no server, no push infra.
2. **Offline armor** — drafts mirrored to native storage
   (`@capacitor/preferences`), failed saves queued in an outbox and
   replayed on network restore (idempotent via `Workout.clientSaveId`),
   and the silent 24-hour draft deletion becomes an explicit resume
   prompt. Repairs the offline page's currently-false promise that drafts
   sync.
3. **Silent weigh-ins** — the bridge already reads Health `bodyMass`;
   import automatically on app open instead of nudging him to type a
   number his scale already sent. The weigh-in nudge card stops firing on
   its own.
4. **Actionable rest notification** — “+30 s / Done” buttons on the
   existing rest-over notification. v1 opens the app into the right state
   (`foreground: true`) — reliable in remote-URL mode, unlike
   background-action delivery into a suspended WebView.
5. **Real HR + honest sync** — pull the per-session heart-rate curve
   (permission already granted) into a downsampled series on the workout,
   fill `avgHr`/`maxHr`/`activeKcal` at save, and make the sync surface
   report **counts delivered**, not timestamps. (Found during review: all
   8 workouts showed “synced” with zero data delivered.)
6. **Own the recovery history** — persist daily resting HR, sleep, HRV,
   VO₂max, wrist temp as `HealthSample` rows (vocabulary widening only —
   the model already fits). Today these are read each morning and thrown
   away; the phone is the only holder.
7. **Sick-day protocol** — elevated RHR + wrist temperature for 2+ days →
   “sick — planned rest” (Gap Guard pauses); RHR back at baseline 2 days →
   comeback notification into the return ramp. Detection runs at app-open
   (no background wake exists in this architecture — honest limit).

## Lane 2 — ten minutes of setup + a few plist lines (one Mac visit)

8. **Instant entry** — NFC sticker / Back Tap / long-press icon shortcuts
   riding the existing `workout://` scheme and `DeepLinkHandler`
   allowlist. Shortcuts-app pieces need no build at all.

## Lane 3 — one planned Xcode session each (specs in MAC_NATIVE_TRIP.md)

9. **Lock Screen widget** — verdict + days-since counter, fed by
   `/api/verdict` (built in Lane 1 so the Mac trip is pure Swift). Glance
   rule applies hardest here: verdict lead + day letter, degrade to a dash
   on stale data.
10. **Apple Watch v1** — standalone start/finish + wrist-tap rest timer
    via `HKWorkoutSession`. Deliberately no WatchConnectivity, no set
    logging, no web sync: the existing HealthKit bridge ingests the
    result. Scope frozen; every widening is a new decision.

## Rejected, with reasons (so they don't come back)

- **Camera stack-reading** — slower than the existing prefill; OCR misread
  writes wrong data into the record.
- **Location gym auto-tag** — his workplace *is* the second gym's
  building; a mis-fire corrupts per-gym weight memory (corrupts-data
  class). The manual toggle cannot mis-fire.
- **Siri voice logging** — split-brain with an open draft (double-logged
  sessions); exercise vocabulary compiles into the intent and goes stale
  against a web-deployed exercise list.
- ~~**Live Activity countdown**~~ — shipped in Wave 5 under this entry's
  own reconsider clause; the skipped-set objection is answered (the
  activity ends on skip/Done/0:00, and staleDate reaps the app-killed
  case).

## Standing rule for native work

Prefer features whose native half is **inert** (plist entry,
already-installed plugin, frozen tiny target) and whose behaviour lives
web-side. Anything the Mac session owns updates on the timescale of
“whenever the Mac is next opened” — the history shows that is weeks.

## Wave 6b — Live session handoff (2026-09-01)

Built: start a workout on the phone and continue on the Watch, or the
reverse. One server-owned `LiveSession` row per session (additive table,
Apply-schema Action), `/api/live` pipe, per-set push from both devices,
finish-merge under one client save id, "Continue" on the Watch Start
screen and a "Continue here" pill on the phone. Decisions: HKWorkout on
the Watch backdated to the phone's start; machine order per device,
only logged sets sync. Rejected: WatchConnectivity (direct phone↔watch)
— works offline but needs Swift on both sides plus a Capacitor plugin;
the gym has signal and the Watch already depends on the server.
