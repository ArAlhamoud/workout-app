# Connect Your iPhone & Apple Watch

Apple Health sync is built into the native app. There is no setup: no token,
no Shortcuts, no Vercel environment variable. Two taps, once.

> This guide used to describe a Shortcuts pipeline against
> `/api/health/{import,workouts,detect,hr-series}`, guarded by a sync token
> you pasted into the app after every reinstall. Those routes are gone — the
> app talks to the server through server actions, which are same-origin and
> need no key. The only place `HEALTH_SYNC_TOKEN` still lives is `/api/export`
> (see below).

---

## a) Turn it on

1. Open the app on the phone → **Stats**.
2. The **Apple Health** card appears (native shell only — never on the web).
3. Tap **Connect Health** → allow everything on the iOS sheet.
4. Tap **Sync now**.

Expect a terse status: `3 weights · 1 workout ↑`, or **Everything already in
sync** when there is nothing to move — which is the normal steady state, not a
failure.

**Recheck access** re-runs the permission request. Do that after any native
build that widens the requested Health types: iOS freezes the read set at
request time, and only asks about types you haven't answered yet.

## b) What moves, and which way

| Data | Direction | When |
| --- | --- | --- |
| Body weight | Health → app | Every sync, rolling 30-day window |
| Gym sessions | App → Health | Once each, then marked as pushed |
| Avg/max HR, active energy | Health → app | Attached to the session it overlaps |
| Unlogged sessions | Health → offer | Auto-detected, 14-day window |

Weight is re-pulled over a fixed window rather than "since the last sync": a
weigh-in can be entered on Wednesday but dated Monday, and a since-cursor
moves past Monday and drops that sample forever. Re-sending overlap is free —
the import upserts on (type, date, source).

A weight you logged by hand always wins over a synced one for the same day.
The synced value is still stored; it just doesn't overwrite yours.

## c) Sessions you trained but never logged

The card checks Apple Health for sessions the log doesn't have and offers
them, unprompted. Strength sessions open the normal logger pre-filled with the
date and duration — sets and effort still get typed in. Swims and other cardio
import in one tap. Anything you dismiss is never offered again on that device.

Sessions this app wrote are filtered out by bundle id, so nothing is ever
offered back to you twice.

## d) Apple Watch during workouts

Nothing to build — just a habit:

1. Wear the watch at the gym.
2. Start a **Traditional Strength Training** workout on it. End it when done.

The watch writes heart rate and active calories to Health; the next sync
attaches average HR, max HR and calories to the session logged that day.

The app deliberately does **not** write a calorie value to the workouts it
pushes into Health. The watch already logged energy for that window, and
writing an app-side estimate on top double-counts the session.

## e) Data export

`/api/export` (JSON, or `?format=csv`) is the one route that still needs the
token — it is reached by URL rather than by the app, and unguarded it would be
a public copy of the whole history:

```
https://YOUR-APP.vercel.app/api/export?token=$HEALTH_SYNC_TOKEN
```

## f) Troubleshooting

**"Connect Health" spins forever**
The native bridge isn't answering. Force-quit and reopen; if it persists, the
installed build is stale — `npm run ios:deploy`.

**The Apple Health card isn't on Stats**
You're on the web build, not the native app. The card renders only inside the
Capacitor shell.

**Sync says "Everything already in sync" and you expected numbers**
That is the normal result. Weight only flows Health → app and you usually
enter weigh-ins in the app; workouts only flow app → Health, once each.

**Nothing syncs after reinstalling**
Health permissions are keyed to the bundle id, not the install, so they
survive — but tap **Recheck access** once to be sure.
