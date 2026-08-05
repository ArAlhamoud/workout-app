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
  /** Top working set of that session, e.g. "Lat Pulldown 22.5 kg × 12", or null. */
  topSet: string | null;
  queuedDay: 'A' | 'B' | null;
  /** Longest gap in his logged history, in days (computed, not recalled). */
  longestGapDays: number | null;
}

export const TITLE_MAX = 48;
export const BODY_MAX = 200;

/**
 * The fact sheet is BOTH the model's context and the validation whitelist:
 * every number the copy is allowed to contain must appear here. One source
 * of truth — a fact the sheet doesn't state is a fact the copy can't use.
 */
export function buildLadderFactSheet(input: LadderFactsInput): string {
  const lines = [
    `Last training session: ${input.lastSessionName} on ${input.lastSessionDate}.`,
    input.topSet ? `Top set that day: ${input.topSet}.` : null,
    input.queuedDay ? `Queued next: Day ${input.queuedDay}.` : null,
    input.longestGapDays != null
      ? `Longest break in his logged history: ${input.longestGapDays} days.`
      : null,
    `Day-7 note fires 7 days after that session; 14 days would then remain before the day-21 program reset.`,
    `Day-19 note fires 19 days after that session; 2 days would then remain before the day-21 reset, after which the 4-week return ramp takes over.`,
    `A missed week is mendable: 2 sessions before Sunday night repair the streak.`,
    `The rescue session takes 15 minutes.`,
  ].filter(Boolean);
  return lines.join('\n');
}

/** Zero-shame, mechanically. Lowercased substring match on purpose — a
 *  banned stem inside a longer word ("failure") should also trip it. */
const BANNED_LEXICON = [
  'lazy', 'fail', 'excuse', 'guilt', 'shame', 'ashamed', 'weak', 'pathetic',
  'disappoint', 'wasted', 'should have', "shouldn't", 'quit', 'gave up',
  'no more excuses', 'slipping',
];

const NUMBER_RE = /\d+(?:\.\d+)?/g;

export function extractNumbers(text: string): Set<string> {
  return new Set(text.match(NUMBER_RE) ?? []);
}

/**
 * The acceptance gate. Returns null when the copy is safe to schedule, or a
 * short reason string when it must be rejected (the reason is for tests and
 * logs — the user never sees a rejection, only the static rung).
 */
export function validateLadderCopy(
  copy: LadderRungCopy,
  factSheet: string,
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
    if (lower.includes(banned)) return `banned word: "${banned}"`;
  }

  const allowed = extractNumbers(factSheet);
  for (const n of extractNumbers(`${title} ${body}`)) {
    if (!allowed.has(n)) return `number not in fact sheet: ${n}`;
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

- Day 7 of silence: the streak is still mendable (2 sessions before Sunday night). The job is pull, not push — one concrete fact from his data that makes tonight's small session feel worth it.
- Day 19 of silence: the last useful moment before the day-21 program reset. State plainly that 2 days remain before the 4-week return ramp takes over, and that one session keeps his normal program.

Use ONLY facts and numbers from the fact sheet — every number you write must appear there verbatim. Never speculate about why he has been away; you cannot see the reason. Zero shame: no guilt words, no disappointment, no "still waiting". Warm, direct, small next step.`;

/**
 * One structured call for both rungs. Null on ANY failure — the static
 * ladder is the permanent fallback, never an error state.
 */
export async function generateLadderCopy(factSheet: string): Promise<LadderRungCopy[] | null> {
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
        { type: 'text', text: `FACT SHEET (the only facts you may use):\n${factSheet}` },
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
      if (validateLadderCopy(rung, factSheet, day) !== null) return null;
      out.push({ day, title: rung.title.trim(), body: rung.body.trim() });
    }
    return out;
  } catch {
    return null;
  }
}
