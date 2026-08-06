# The Coach — the model in the loop

> **Status (owner decision, Aug 2026): running at $0 — no API key, on
> purpose.** The coach layer is dormant, not misconfigured: every
> deterministic feature works identically without it, which was the
> design contract from day one. Do not re-raise the missing
> `ANTHROPIC_API_KEY` as a to-do. If he ever wants it on, the setup
> below takes two minutes; the cheap option is one code change
> (swap the coach model to Haiku, ~5× cheaper).

The app's intelligence layer used to be hand-coded rules. The Coach is the
layer only a frontier model can be: it reads the **entire** history —
every set, every RPE, sleep, resting HR, the streak, the holds — and
writes a morning brief in a coach's voice. And it can be argued with.

## What it does

- **Morning brief** — generated once per day (lazily, on the first app
  open), stored in `CoachNote`, shown as the Coach card on Home. 2–4
  sentences plus up to three directive chips. The model: `claude-opus-5`.
- **Ask the Coach** — `/coach`, a chat over the same full context. Guarded
  by the same token as health sync (chat turns cost real tokens).
- **Hard rules travel with every request** — the ramp caps, the RPE
  ladder, no back-to-back days, pin-based loads, the cross-gym rule,
  rescue-walks-are-not-training. The coach advises inside the program; it
  never overrides it. Directives are display-only: they never silently
  change a prefill.

## Degradation contract (the most important part)

No API key → no card, no chat, zero errors. Refusal, timeout, parse
failure → same. Every deterministic feature — verdict, streak, ramp,
records, Gap Guard — works identically with the coach dark. The coach is
additive, never a gate.

## Setup (one dashboard step)

1. Get an API key at console.anthropic.com.
2. Vercel → project → Settings → Environment Variables →
   `ANTHROPIC_API_KEY` = the key → redeploy.

Nothing else. The first home-screen visit after that generates the first
brief.

## Cost, honestly

One brief/day ≈ 6–10K input + <1K output tokens on `claude-opus-5`
($5/$25 per MTok) ≈ **$0.05–0.08/day**, under $3/month. Chat: roughly
$0.05–0.10 per exchange, mostly cache-read after the first turn (the
context block is prompt-cached). A month of heavy use stays under $10.

## Where the guardrails live

- `src/lib/coach-ai.ts` — `COACH_SYSTEM` (the constitution; trainer-agent
  reviewed), context caps, brief length caps (glance rule: 600 chars max).
- One `CoachNote` row per calendar day (unique key) bounds generation cost
  even though the brief route is unauthenticated.
- Chat requires the health-sync bearer token.

## Wave 4 — the coach's hands (and where their bounds live)

**Ladder copy** (`/api/coach/ladder-copy`, `src/lib/coach-ladder.ts`):
the day-7 and day-19 gap notifications are rewritten from his real state.
The static copy always arms first; generated copy must pass a code-level
acceptance gate — every number verbatim from the injected fact sheet,
title ≤48 / body ≤200 chars, banned shame lexicon, day-19 must state the
reset fact — or the static words stand. One generation per day
(row-as-lock on `CoachLadderCopy.day`), plus at most one regeneration if
a new session moves the anchor. No key → static ladder, forever, silently.

**Proposals**: the brief may carry ONE `{action, days, reason}` —
`declare-hold` or `end-hold` only. Rendered as an Approve button; nothing
executes without the tap, and `approveCoachHold` re-clamps in code: 3–14
days, never ending later than 20 days after the last training session,
so no approved hold can carry him across the day-21 ramp threshold.

**Directive deep links**: `session` and `rescue` chips navigate into the
existing logger routes. Navigation needs no approval machinery.

**gapReason**: his one-line answer to "what got in the way?" at the
welcome-back moment is the only causal gap fact the coach may cite —
the constitution forbids inventing gap stories, and the fact sheet for
ladder copy carries no "why" facts at all.

Cost delta: ladder copy ≈ $0.01–0.06 per active day (mostly cache-read),
nothing on days the app never opens. Still under $10/month all-in.
