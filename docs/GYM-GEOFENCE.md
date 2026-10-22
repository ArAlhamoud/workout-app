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
