# Working across two Claude sessions

Two sessions touch this repo. They do not overlap, and neither keeps a private
copy of anything — **GitHub `main` is the single source of truth.**

| Session | Owns | Effect of a change |
|---|---|---|
| **Cloud session** (app development) | `src/`, `prisma/`, `scripts/`, `.github/`, `docs/` | Push to `main` → Vercel deploys → live on the phone in ~1 min |
| **Mac session** (native) | `ios/`, `native/`, `capacitor.config.ts` | Needs an Xcode rebuild + reinstall on the phone |

## Why the phone updates without rebuilding

`capacitor.config.ts` points the iOS shell at the deployed site:

```ts
server: { url: 'https://workout-app-gamma-rouge.vercel.app' }
```

The app on the phone is a window onto the live site, not a copy of it. So any
change to `src/` reaches the phone through Vercel — **no Xcode, no reinstall.**
The Xcode build only bundles the shell and the Swift bridge.

## What actually needs the Mac

Only these. Everything else is web-side.

- `native/HealthKitBridge/*.swift` — the HealthKit bridge
- `capacitor.config.ts` — app id, allowed hosts, server URL
- New native capability (push notifications, camera, background tasks)
- Native app icon / launch screen
- Re-signing (a free Apple ID certificate expires every 7 days)

## The rules

1. **Always push to `main`.** Never leave work sitting uncommitted on either machine.
2. **`git pull` before you start** in either session.
3. **Say when the Mac pushed something**, so the cloud session pulls it before editing.

Conflicts are unlikely because the two sessions edit different directories. The
only shared seam is the Health feature, and even there the files are split:
`src/lib/native-health.ts` + `src/components/NativeHealthCard.tsx` are web-side,
`native/HealthKitBridge/` is Mac-side.

## Requesting a change

Describe what you want in the cloud session. It builds on a branch, you review
the Vercel preview on your phone, and it merges to `main` when you approve.

Database schema changes cannot run from the sandbox — they ship as a
manually-triggered GitHub Action (**Apply schema**), which prints a diff of what
would change before applying it.

## Never put `prisma db push` in the build script

It looks like a convenience. It is a production outage waiting to happen, and it
has already caused two:

- `e4fa396` — the build pushed the deployed commit's schema against the live
  database and tripped Prisma's data-loss guard. Every deploy failed.
- `7840432` — reintroduced while streamlining the scripts. Same failure, same day
  a unique constraint was added.

Why it always breaks: the build runs on **every deploy**, against the **live**
database. Any change Prisma considers risky — a unique constraint, a dropped or
renamed column — makes it refuse and exit non-zero, which fails the deploy even
though the app code was fine. And a deploy should never silently decide to alter
a schema.

Schema changes go through the **Apply schema** Action, which prints a
`migrate diff` preview first and only passes `--accept-data-loss` when you
explicitly ask for it. `npm run db:push` does the same thing locally.

The cloud session can trigger this Action itself (GitHub API) and read the
preview from the run logs — the gate is that SOMEONE reads the diff before
accepting, not that a human clicks the button. The rules the session follows:

- Dispatch on the **branch** that carries the schema change, before merge.
- First run WITHOUT `accept_data_loss`; read the printed diff in the logs.
- Accept only when the diff is purely additive (ADD COLUMN / CREATE TABLE /
  CREATE INDEX — no DROP, no ALTER TYPE, no RENAME).
- A "data loss" warning about a unique index on a brand-new column is the
  known false alarm (all existing rows are NULL); anything else stops and
  goes to the owner.
## Staging (not yet set up — needs the Vercel dashboard)

Every deploy currently lands on the app you train with; there is no environment
between a push and your phone. This cannot be configured from a session, so it
is a manual step:

1. Vercel → project → **Settings → Git** → confirm the production branch is
   `main`.
2. Push feature work to a branch rather than `main`. Vercel builds a **preview**
   deployment automatically and gives it its own URL.
3. To exercise a preview in the native shell, point `capacitor.config.ts` at the
   preview URL and run `npm run ios:deploy`. Revert before the next real build —
   the committed config must keep pointing at production.

Until that is set up, treat a push to `main` as a deploy to the phone you train
with, and prefer pushing before a session rather than during one.


## Mac backlog (owner-approved, cloud session cannot build these)

- **TestFlight build 8 is VALID (2026-09-02, Mac session) — ALL FOUR wrist
  items are built, E2E-verified and shipped**, including item 4: the live
  handoff was exercised on the Ultra sim with curl playing the phone
  (Continue row shown, phone ticks honored, watch set synced back with
  source "watch", finish produced one merged 3-set workout, live row
  closed and pruned; synthetic rows deleted). The two-device field dance
  (phone pill, 30 s tick sync, jump-to-saved) remains for the owner's
  next real session. Superseded note follows:
- **TestFlight build 7 is VALID (2026-09-02, Mac session)** — carries the
  three wrist features (occupied-machine swipe, keep-awake via the
  recovered HKWorkoutSession, crown init) plus a Mac-side fix: finish()
  could hang on "Saving…" forever when HealthKit's finishWorkout callback
  never fires; WorkoutManager.end() now has a 10 s hard deadline. Note
  for the cloud: WKExtension.frontmostTimeoutExtended is deprecated/no-op
  since watchOS 7 and was removed — the workout session is the only real
  keep-awake mechanism. Sim E2E: swipe POST verified set-by-set in the DB
  (test row deleted), kill/relaunch resumed mid-session, Plank opened at
  21 s. Item 4 (live handoff) awaits the branch + Apply-schema; the Mac
  session builds and runs its script when it lands on main.

- **FIRST — Watch: occupied-machine swipe (owner from the gym floor,
  2026-08-31).** The cloud session wrote the Swift (SessionStore
  `skipToNextMachine`/`backToPreviousMachine` rotating the pending
  exercise groups; `DragGesture` on SetCardView; hint line) but cannot
  compile it. Mac: build the WatchApp target, drive the simulator through
  swipe-left mid-exercise → log a set on the next machine → swipe-right
  back → finish the session → confirm the POST carries every set with
  correct exerciseId/setNumber. Same build carries **keep-awake**
  (`SessionStore.keepAwake` + `WorkoutManager.recoverOrBegin`, owner
  2026-09-01): on the simulator confirm it compiles and a force-quit
  mid-session resumes with the workout running; the wrist-down behaviour
  itself only shows on the real watch — start a session, lower the
  wrist for a minute, raise it: the set card must be there, not the
  clock. And **live session handoff** (owner, 2026-09-01; Swift in
  Models/API/SessionStore/Views/WatchApp): with a phone session open at
  `/workouts/new` (tick two sets), the Watch Start screen must show
  "Continue Day X · 2 sets on the phone"; tap it → those sets are ticked,
  the card is on the next pending set, log one → it appears on the phone
  within 30 s; finish on the Watch → the phone jumps to the saved
  workout carrying all three sets. Reverse: start on the Watch, log a
  set, open the phone → pill "Day X on the Watch · Continue here" → tick
  a set → Watch shows it after wrist-raise → finish on the phone → Watch
  lands on "Finished on the phone". Then `npm run ios:testflight`.

- ~~Volt simulator pass~~ **DONE (Mac session, 2026-08-30, iPhone 17 sim
  / WKWebView on production).** All four checks passed: (1) status-bar
  text adapts per ground — white over Volt black on /train and /stats,
  black again on light Home, no native change needed; (2) bottom nav +
  draft pill clear the home indicator, dark variants render on Volt;
  (3) Home ↔ Train domain switch is clean both directions with no
  wrong-ground residue; (4) date pickers on /workouts/new and /stats
  open native calendars over the dark ground, fields seed and render
  their values correctly. Non-defects noted: the draft pill floats over
  page content near the bottom (by design, dismissible), and section
  chips scroll under the Dynamic Island like any content.
- ~~Home-screen widget~~ and ~~Watch quick-log~~ — DECLINED by the owner
  (2026-08-31, "no need for both"). Do not re-propose; the backlog is empty.
