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
