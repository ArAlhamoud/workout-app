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

- Home-screen widget: `day N · next dose · latest kg` without opening the app.
- Apple Watch quick-log: water / protein / weight from the wrist.
