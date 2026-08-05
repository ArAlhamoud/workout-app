// The Voice Through the Door — coach-written copy for the gap ladder.
//
// The gap window is the one place the coach is otherwise mute: briefs
// generate lazily on app-open, and during a relapse he does not open the
// app. Pre-scheduled local notifications are the only channel that reaches
// a closed app, so the words must be composed days before they fire.
//
// The deterministic skeleton is untouchable: same rung days, same ids, same
// routes, same pause rules (gap-guard.ts). What this file adds is WORDS —
// and because they are delivered unsupervised to a discouraged man's lock
// screen days after generation, the guards are code, not prompt discipline:
//
//   1. The static copy always arms first. Generated copy only overwrites
//      rungs 7 and 19 (the two worth the risk), and only after passing the
//      acceptance gate below. Any failure anywhere keeps the static ladder.
//   2. Every number in the copy must literally appear in the injected fact
//      sheet — the model cannot invent a weight, a day count, or a kilogram.
//   3. A banned-lexicon lint enforces the zero-shame rule mechanically.
//   4. Day 19 must carry the ramp-reset fact — it is the whole point of
//      that rung.
//   5. No "why he stopped" facts are injected at all, so a causal story
//      about the gap has nothing to anchor to (n=2 gaps: one sickness, one
//      unknown — any "why" would be invention).

import Anthropic from '@anthropic-ai/sdk';
import { COACH_SYSTEM } from './coach-ai';

/** The rungs the coach may rewrite. Day 3/5 stay static until the static
 *  ladder is ever observed failing — regenerating them daily solves an
 *  unobserved problem (adversary). */
export const GENERATED_RUNG_DAYS = [7, 19] as const;

export interface LadderRungCopy {
  day: number;
  title: string;
  body: string;
}

export interface LadderFactsInput {
  /** Bare date of the last training session, e.g. "2026-07-29". */
  lastSessionDate: string;
  lastSessionName: string;
  /** Top working set of that session, e.g. "Lat Pulldown 22.5 kg × 12 at B_Fit", or null. */
  topSet: string | null;
  queuedDay: 'A' | 'B' | null;
  /** Longest gap in his logged history, in days (computed, not recalled). */
  longestGapDays: number | null;
}

/** The sheet the model reads, plus the whitelist and flags the gate checks. */
export interface LadderFacts {
  sheet: string;
  /** The ONLY number tokens the copy may contain — built from fact VALUES
   *  (weights, reps, gap length, rung constants), never from the raw sheet
   *  text: date fragments and "45m" in a session name are not facts, and a
   *  token pool over the whole sheet let '29' from "Jul 29" become a
   *  hallucinated 29 kg (trainer probe). */
  allowed: Set<string>;
  /** Whether the streak-mend offer is feasible on the day-7 fire date —
   *  2 sessions with a rest day between need 3+ days left before Sunday
   *  night (same rule streak.ts applies). */
  mendOffer: boolean;
}

export const TITLE_MAX = 48;
export const BODY_MAX = 200;

const NUMBER_RE = /\d+(?:\.\d+)?/g;

export function extractNumbers(text: string): Set<string> {
  return new Set(text.match(NUMBER_RE) ?? []);
}

export function buildLadderFacts(input: LadderFactsInput): LadderFacts {
  // Mend feasibility on the day-7 fire date. The rung fires exactly 7 days
  // after the anchor, so its weekday equals the anchor's weekday; Monday
  // weeks end Sunday night, and 2 sessions with a rest day between need at
  // least 3 calendar days (fire day inclusive).
  const anchor = new Date(`${input.lastSessionDate}T12:00:00`);
  const fireDow = Number.isNaN(anchor.getTime()) ? 1 : anchor.getDay(); // 0=Sun
  const daysLeftInclusive = fireDow === 0 ? 1 : 8 - fireDow;
  const mendOffer = daysLeftInclusive >= 3;

  const lines = [
    `Last training session: ${input.lastSessionName} on ${input.lastSessionDate}.`,
    input.topSet ? `Top set that day: ${input.topSet}.` : null,
    input.queuedDay ? `Queued next: Day ${input.queuedDay}.` : null,
    input.longestGapDays != null
      ? `Longest break in his logged history: ${input.longestGapDays} days.`
      : null,
    `Day-7 note fires 7 days after that session; 14 days would then remain before the day-21 program reset.`,
    `Day-19 note fires 19 days after that session; 2 days would then remain before the day-21 reset, after which the 4-week return ramp takes over.`,
    mendOffer
      ? `A missed week is mendable: 2 sessions before Sunday night repair the streak, with a rest day between them.`
      : `The week cannot be mended by the time this fires (too few days left) — do NOT mention mending; a fresh week starts Monday.`,
    `The rescue session takes 15 minutes.`,
  ].filter(Boolean);

  const allowed = new Set<string>(['7', '19', '14', '2', '21', '4', '15']);
  if (input.topSet) for (const n of extractNumbers(input.topSet)) allowed.add(n);
  if (input.longestGapDays != null) allowed.add(String(input.longestGapDays));

  return { sheet: lines.join('\n'), allowed, mendOffer };
}

/** Zero-shame, mechanically. Stems match as substrings on purpose (a banned
 *  stem inside "failure" should trip it); short words that collide with
 *  innocent ones ("quit"/"quite", "weak"/"tweak") match on word boundaries. */
const BANNED_LEXICON: RegExp[] = [
  /lazy/, /fail/, /excuse/, /guilt/, /shame/, /ashamed/, /\bweak\b/, /pathetic/,
  /disappoint/, /wasted/, /should have/, /shouldn't/, /\bquit\b/, /gave up/,
  /slipping/, /still waiting/, /waiting on you/,
];

const KG_RE = /(\d+(?:\.\d+)?)\s*kg/gi;
const MEND_RE = /2 sessions?|mend/;
const REST_DAY_RE = /rest day|day between|day of rest/;

/**
 * The acceptance gate. Returns null when the copy is safe to schedule, or a
 * short reason string when it must be rejected (the reason is for tests and
 * logs — the user never sees a rejection, only the static rung).
 */
export function validateLadderCopy(
  copy: LadderRungCopy,
  facts: LadderFacts,
  rungDay: number,
): string | null {
  if (copy.day !== rungDay) return `day mismatch: ${copy.day} != ${rungDay}`;
  const title = copy.title.trim();
  const body = copy.body.trim();
  if (!title || !body) return 'empty title or body';
  if (title.length > TITLE_MAX) return `title too long (${title.length})`;
  if (body.length > BODY_MAX) return `body too long (${body.length})`;

  const lower = `${title} ${body}`.toLowerCase();
  for (const banned of BANNED_LEXICON) {
    if (banned.test(lower)) return `banned word: ${banned}`;
  }

  for (const n of extractNumbers(`${title} ${body}`)) {
    if (!facts.allowed.has(n)) return `number not in fact whitelist: ${n}`;
  }

  // Unit-aware check: a number may be legal (43 is the gap length) and still
  // be a hallucinated WEIGHT ("your 43 kg pulldown"). Any "<n> kg" in the
  // copy must appear as "<n> kg" in the sheet itself.
  for (const m of `${title} ${body}`.matchAll(KG_RE)) {
    if (!facts.sheet.includes(`${m[1]} kg`)) return `invented weight: ${m[1]} kg`;
  }

  if (rungDay === 7 && MEND_RE.test(lower)) {
    // The mend offer carries two hard conditions: it must be feasible on the
    // fire date, and it must carry the rest-day-between cue — two back-to-back
    // sessions at 133 kg is what the static words were written to prevent.
    if (!facts.mendOffer) return 'mend offer on an unmendable week';
    if (!REST_DAY_RE.test(lower)) return 'mend offer missing the rest-day cue';
  }

  // The day-19 rung exists to say ONE thing: the reset is 2 days away.
  if (rungDay === 19 && !lower.includes('21') && !lower.includes('2 day')) {
    return 'day-19 copy missing the ramp-reset fact';
  }

  return null;
}

// ── Generation (server-only; the route is the only caller) ───

const MODEL = 'claude-opus-5';

const LADDER_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['rungs'],
  properties: {
    rungs: {
      type: 'array' as const,
      description: 'One entry per requested rung day, in the given order.',
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['day', 'title', 'body'],
        properties: {
          day: { type: 'number' as const, description: 'The rung day this copy is for (7 or 19).' },
          title: { type: 'string' as const, description: 'Notification title, at most 48 characters.' },
          body: { type: 'string' as const, description: 'Notification body, at most 200 characters.' },
        },
      },
    },
  },
};

const LADDER_TASK = `TASK: Write lock-screen notification copy for two future moments of silence. These fire on a CLOSED app — he has not trained and has not opened the app. Each is one glance: title <= 48 characters, body <= 200 characters, no bullets, no emoji.

- Day 7 of silence: the job is pull, not push — one concrete fact from his data that makes tonight's small session feel worth it. Mention the streak mend ONLY if the fact sheet offers it, and then always with the rest-day-between condition (never imply two back-to-back training days). If the sheet says the week cannot be mended, anchor on the queued day instead.
- Day 19 of silence: the last useful moment before the day-21 program reset. State plainly that 2 days remain before the 4-week return ramp takes over, and that one session keeps his normal program.

Use ONLY facts and numbers from the fact sheet — every number you write must appear there verbatim, and never attach "kg" to a number that is not a weight in the sheet. Never speculate about why he has been away; you cannot see the reason. Zero shame: no guilt words, no disappointment, no "still waiting". Warm, direct, small next step.`;

/**
 * One structured call for both rungs. Null on ANY failure — the static
 * ladder is the permanent fallback, never an error state.
 */
export async function generateLadderCopy(facts: LadderFacts): Promise<LadderRungCopy[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        // Same constitution as the brief/chat — and the same cacheable
        // prefix, so this call rides the coach's existing cache entry.
        { type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `FACT SHEET (the only facts you may use):\n${facts.sheet}` },
      ],
      messages: [{ role: 'user', content: LADDER_TASK }],
      output_config: { format: { type: 'json_schema', schema: LADDER_SCHEMA } },
    });

    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = JSON.parse(text.text) as { rungs?: unknown };
    if (!Array.isArray(parsed.rungs)) return null;

    const out: LadderRungCopy[] = [];
    for (const day of GENERATED_RUNG_DAYS) {
      const rung = parsed.rungs.find(
        (r): r is LadderRungCopy =>
          !!r && typeof r === 'object' &&
          (r as LadderRungCopy).day === day &&
          typeof (r as LadderRungCopy).title === 'string' &&
          typeof (r as LadderRungCopy).body === 'string',
      );
      if (!rung) return null; // both rungs or nothing — a half ladder is confusing
      if (validateLadderCopy(rung, facts, day) !== null) return null;
      out.push({ day, title: rung.title.trim(), body: rung.body.trim() });
    }
    return out;
  } catch {
    return null;
  }
}
