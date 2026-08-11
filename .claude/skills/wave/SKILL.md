---
name: wave
description: >
  Run a full "wave" of work on the workout app the way the best sessions in
  this repo's history ran: frame the goal and constraints, check the ambitious
  version before settling for the incremental one, build in small verified
  steps, put the diff through the repo's adversarial review roles, record
  decisions in CLAUDE.md, and ship through PR + CI with an honest report.
  Use this whenever the owner asks to build, add, improve, fix, or "make
  better" anything non-trivial in this app — a feature, a screen, a refactor,
  a wave of ideas — even if he doesn't say "/wave". Not for one-line questions
  or pure conversation.
---

# /wave — build like the best sessions built

This repo was built in waves (see docs/ROADMAP.md), and the good ones all
followed the same shape. This skill is that shape, written down so it costs
one command instead of a lucky prompt. The steps are ordered; each exists
because skipping it has already burned this project at least once.

## 1. Frame — goal and constraints before code

Restate what he asked for as a goal plus the standing constraints, because
the constraints are where this app's quality comes from:

- One user, no login, by deliberate decision. $0 to run (the coach layer is
  dormant by owner choice — never treat the missing API key as a to-do).
- Zero shame. His gaps follow discouragement; any surface that grades,
  scolds, or red-badges him is a bug even when the math is right.
- Weights are per-gym and move in pins. Warm-ups count for nothing.
- Push to main deploys to the phone he trains with in about a minute.

Only ask him a question when the decision is genuinely his (scope, taste,
his body, his money). Everything else: pick the sensible default and say so.

## 2. Ceiling check — before building the small version

State in two sentences: the *most ambitious* version of this ask that a
frontier model makes possible, and the *minimal* version. This repo's best
feature (the coach) exists because the owner asked "what's your potential?"
instead of accepting increments. If the ambitious version is clearly right
and in scope, build it; if it changes scope or cost, ask him — that decision
is his.

## 3. Build small, verify constantly — claims are not implementation

Slice the work into steps that each end in a verifiable state. After every
meaningful chunk:

- `npm test` — typecheck plus the assertion suite against real history.
- `npm run lint`.
- `DATABASE_URL="postgresql://user:pass@127.0.0.1:1/db" npm run build` —
  the build MUST pass with the database unreachable. A local dev database
  hides exactly the failure CI catches; this exact line has already saved
  one broken deploy.
- If the change touches layout or components: screenshot it at iPhone
  viewport (a device-tester pass), because three real UI bugs in this repo
  were invisible in a desktop browser.

Never report a step done on the strength of intention. Rule 5 of CLAUDE.md
exists because a commit message once described CI that was never committed.

## 4. Adversarial review — assume the diff is wrong

Before shipping, run the repo's review roles (.claude/agents/) over the
diff — in parallel where possible. Always the **adversary**; add by area:

- **trainer** — program logic, loads, scheduling, recovery, coach prompts.
- **data-steward** — prisma/, workflows, scripts that touch the database,
  anything writing rows.
- **device-tester** — layout, components, CSS.
- **editor** — any user-facing words.

Fix every confirmed finding; say plainly which findings were rejected and
why. The value is real: a Wave-4 diff with 336 green tests still yielded 26
confirmed defects, one of them a safety issue. Green tests measure what you
thought to test; the adversary measures what you didn't.

## 5. Schema and data discipline

- Schema changes ship ONLY through the Apply-schema GitHub Action: dispatch
  on the branch with `accept_data_loss: false`, read the migrate-diff from
  the job logs, verify it is purely additive, and only then accept. Never
  `prisma db push` toward production from anywhere else.
- Anything that rewrites logged history ships as a dry-run-default script
  behind a preview-first `workflow_dispatch` Action, and never guesses at
  values it cannot know (flag those for the owner instead).

## 6. Memory — make the project smarter than the session

Before shipping, ask: did this work teach a rule, or did the owner make a
decision? If yes, write it down where future sessions read it — CLAUDE.md
for rules and decisions, docs/ROADMAP.md for what was built and what was
*rejected with reasons* (the kill-list is how dead ideas stay dead). A
lesson that lives only in the conversation is a lesson the next session
pays for again.

## 7. Ship and report honestly

- Work on the designated branch; PR to main; merge only when CI is green
  AND the owner has said the word (his standing "do everything" counts;
  silence does not).
- The final report leads with what happened, in plain sentences: what
  shipped, what was verified and how, what was found-and-fixed, what he
  still has to do by hand, and what was deliberately not done. If something
  failed or was skipped, that goes in the report too — the report is for
  trust, not applause.
