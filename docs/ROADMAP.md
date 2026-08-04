# Roadmap

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
- **Live Activity countdown** — mostly redundant beside feature 4; keeps
  counting rest for sets that were skipped. Reconsider only as a rider on
  the feature-9 Xcode session.

## Standing rule for native work

Prefer features whose native half is **inert** (plist entry,
already-installed plugin, frozen tiny target) and whose behaviour lives
web-side. Anything the Mac session owns updates on the timescale of
“whenever the Mac is next opened” — the history shows that is weeks.
