# The Coach — the model in the loop

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
