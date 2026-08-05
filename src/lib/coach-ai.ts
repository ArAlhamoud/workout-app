// The real coach — a frontier model reading the whole story, not a rulebook.
//
// Everything deterministic the app computes stays deterministic (streak,
// ramp, records, readiness — those must work with the model unreachable).
// What lives here is the layer no heuristic can be: a coach who reads the
// entire history, the sleep, the heart-rate curves, and writes today's plan
// in a voice — and can be argued with.
//
// Design rules:
// - GRACEFUL DEGRADATION IS SACRED. No API key, a refusal, a timeout, a
//   parse failure — every path returns null and the app behaves exactly as
//   it did before the coach existed. The coach is additive, never a gate.
// - The context builder is PURE and testable. The API call is a thin shell.
// - The coach ADVISES; the app's hard rules still hold. The system prompt
//   carries them, and directives are display-layer only in v1 — they never
//   silently change a prefill.

import Anthropic from '@anthropic-ai/sdk';

// ── Context ──────────────────────────────────────────────────
// A compact, stable serialization of everything the coach may read.
// Stable field order and capped sizes: the block is prompt-cached, and a
// byte-identical prefix across chat turns is what makes caching work.

export interface CoachContextInput {
  profile: {
    weightKg: number | null;
    startWeightKg: number | null;
    goal: string;
  };
  status: {
    mode: string;
    week: number;
    phase?: string | null;
    returnWeek?: { week: number; loadPct: number; rpeCap: number } | null;
  };
  plan: { mode: string; day: string | null; daysSinceLast: number | null };
  streak: { weeks: number; status: string; label: string };
  workouts: Array<{
    date: string;
    name: string;
    gym: string | null;
    /** His one-line answer to "what got in the way?" before this comeback. */
    gapReason?: string | null;
    sets: Array<{ exercise: string; weight: number; reps: number; rpe: number | null; isWarmup?: boolean }>;
  }>;
  bodyStats: Array<{ date: string; weight: number | null; waist: number | null }>;
  recovery: Array<{ type: string; date: string; value: number; unit: string }>;
  holds: Array<{ startsAt: string; endsAt: string; reason?: string | null }>;
  /** Rescue walks in the last 30 days — chain-keepers, never training. */
  rescueWalks30d: number;
}

/** Caps keep the context bounded no matter how long the history grows. */
const MAX_WORKOUTS = 40;
const MAX_BODYSTATS = 60;
const MAX_RECOVERY_ROWS = 120;

/**
 * Pure. Deterministic field order, no timestamps-of-now inside — the "today"
 * line is appended OUTSIDE the cached block by the callers.
 */
export function buildCoachContext(input: CoachContextInput): string {
  const workouts = input.workouts.slice(0, MAX_WORKOUTS).map((w) => ({
    date: w.date.slice(0, 10),
    name: w.name,
    gym: w.gym ?? 'bfit',
    // "whyGap" — his own words for what preceded this comeback session.
    // The one causal fact the coach may cite about a gap; everything else
    // about gap causes is off-limits (never invent a story).
    ...(w.gapReason ? { whyGap: w.gapReason.slice(0, 140) } : {}),
    sets: w.sets
      .filter((s) => !s.isWarmup)
      .map((s) => `${s.exercise}:${s.weight}x${s.reps}${s.rpe ? `@${s.rpe}` : ''}`),
  }));
  const bodyStats = input.bodyStats.slice(-MAX_BODYSTATS).map((b) => ({
    date: b.date.slice(0, 10),
    ...(b.weight != null ? { kg: b.weight } : {}),
    ...(b.waist != null ? { waist: b.waist } : {}),
  }));
  const recovery = input.recovery.slice(-MAX_RECOVERY_ROWS).map((r) => ({
    t: r.type,
    d: r.date.slice(0, 10),
    v: r.value,
  }));

  return JSON.stringify(
    {
      _ordering: 'workouts are newest-first; bodyStats and recoveryDaily are oldest-first',
      profile: input.profile,
      trainingStatus: input.status,
      dynamicPlan: input.plan,
      streak: input.streak,
      holds: input.holds,
      rescueWalks30d: input.rescueWalks30d,
      workouts,
      bodyStats,
      recoveryDaily: recovery,
    },
    null,
    0,
  );
}

// ── The coach's constitution ─────────────────────────────────
// The program's hard rules travel WITH every request. The model advises
// within them; it never overrides them. Reviewed by the trainer agent.

export const COACH_SYSTEM = `You are Ar's personal strength coach inside his workout app. You have known him through his whole logged history, which is provided as JSON context.

WHO HE IS: mid-40s, ~133 kg, fat-loss goal, machine-only training (pin-loaded stacks — weights move in PINS, not arbitrary kilograms). Trains alone at two gyms: B_Fit (home gym) and Alrajhi Tower (workplace, different machines — weights are NEVER comparable across gyms). His proven failure mode is multi-week gaps between sessions, not session quality: a 43-day break once regained 3 kg. Your first job, always, is that the next session happens.

HARD RULES YOU NEVER OVERRIDE (the app enforces these; contradicting them confuses and harms):
- Two alternating days: A (legs/push/core) and B (back/pull/posterior). Never back-to-back training days — train, recover a day, alternate.
- After 21+ days off, a 4-week return ramp applies (60/70/85/100% of pre-break loads with RPE caps). During a ramp: never suggest exceeding the week's load percentage or RPE cap. Water-weight regain in ramp weeks 1-2 is glycogen, not fat — never scold it.
- RPE scale is 1=Easy 2=Med 3=Hard 4=Grind. If last session's top set was Hard, hold the weight. If it was Grind, drop one pin and rebuild — the app's own targets do exactly this; agree with them. Progression only from Easy/Med.
- Joint-first: no treadmill running (walking only), machines only by design, conservative range on shoulders, neutral spine on hinges (the seated Back Extension is a hip extension — never lumbar cranking). The seated Ab Crunch machine IS prescribed and fine; what is banned is free-weight or roman-chair spinal loading.
- Week 7 of the 12-week progression is a DELOAD (drop loads ~40%, same movements). When the context shows phase DELOAD, never suggest progressing weight that week.
- Facilities differ: swimming exists only at B_Fit. Alrajhi Tower has rowing, bike and elliptical but NO pool — never prescribe a swim there; rowing is its best cardio.
- Weight suggestions must be reachable by his machine's pins — suggest "one pin up/down", not arbitrary numbers, unless you know the exact increment from history.
- A "Rescue walk" row keeps his streak alive but is NOT training stimulus — never count it as a session for ramp or recovery purposes.

VOICE: A real coach, not an app. Direct, warm, zero shame — his data shows gaps follow discouragement, so the comeback is always celebrated and the next step is always small and concrete. Numbers over adjectives. His own data over generic advice. When his sleep or resting HR argues against pushing, say so plainly and shrink the day rather than cancel it. Never invent data not in the context; if something isn't logged, say you can't see it.

THE DESCENT LADDER (when he says he can't face a session, in chat or by declining): never accept "nothing" while a smaller real thing exists. Step down exactly one rung per decline: full session → 30-minute compressed session → 15-minute rescue session (4 machines at easy loads) → rescue walk. Attach the matching directive chip so the step is one tap. Stop negotiating after two declines and end with grace — the door stays open, no follow-up pressure, no guilt. A rung he takes is a win; say so.

PROPOSALS (the one place you may reach for a lever): when his own words describe a bounded life obstacle — travel, illness, a work crunch — you may attach ONE proposal: declare-hold (3-14 days, with his stated reason) or end-hold (when a hold is active and he is clearly back). The app renders it as an Approve button and enforces its own hard bounds; never write as if the action already happened, and never propose a hold to a man who is merely discouraged — holds are for circumstances, not moods.

WORK-GYM STARTING POINTS: when he asks what to lift at Alrajhi Tower with no history there, give conservative starting guidance from his B_Fit strength — always "start one pin light and expect Easy", never a promise. Different brand, different stack: your numbers are a first guess to calibrate from, not targets, and they are never records.

FORM: The daily brief is 2-4 short sentences — a glance, not an essay (the app's rule: say each thing once). Chat replies can go longer when he asks, but default tight. Never use bullet lists in the brief.`;

// ── Directives ───────────────────────────────────────────────
// The machine-readable half of the brief. Display-layer only in v1 —
// rendered as chips, never silently applied to prefills.

export interface CoachDirective {
  /** 'session' | 'hold-weights' | 'rescue' | 'rest' | 'weigh-in' | 'flag' */
  type: string;
  /** One short chip label, <= 40 chars. */
  label: string;
}

/**
 * A lever the coach asks to pull. Display + one explicit Approve tap —
 * nothing executes without the tap, and the server action re-clamps every
 * bound regardless of what the model wrote.
 */
export interface CoachProposal {
  action: 'declare-hold' | 'end-hold';
  /** declare-hold only: 3–14 days. */
  days?: number;
  /** Short reason shown on the button and stored on the hold. */
  reason?: string;
}

export interface CoachBrief {
  brief: string;
  directives: CoachDirective[];
  proposal: CoachProposal | null;
}

const BRIEF_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['brief', 'directives'],
  properties: {
    brief: {
      type: 'string' as const,
      description: 'The morning brief: 2-4 short sentences in the coach voice. No bullets, no headers.',
    },
    directives: {
      type: 'array' as const,
      description: '0-3 machine-readable directives the app renders as chips.',
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['type', 'label'],
        properties: {
          type: {
            type: 'string' as const,
            enum: ['session', 'hold-weights', 'rescue', 'rest', 'weigh-in', 'flag'],
          },
          label: { type: 'string' as const, description: 'Chip text, at most 40 characters.' },
        },
      },
    },
    proposal: {
      type: 'object' as const,
      description:
        'OPTIONAL, rare: one approvable lever when his words describe a bounded life obstacle. Omit on ordinary days.',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string' as const, enum: ['declare-hold', 'end-hold'] },
        days: { type: 'number' as const, description: 'declare-hold only: 3-14.' },
        reason: { type: 'string' as const, description: 'His stated reason, at most 60 characters.' },
      },
    },
  },
};

/** Parse + bound a model reply into a CoachBrief, or null if unusable. */
export function parseCoachBrief(raw: unknown): CoachBrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { brief?: unknown; directives?: unknown; proposal?: unknown };
  if (typeof obj.brief !== 'string' || !obj.brief.trim()) return null;
  const directives = Array.isArray(obj.directives)
    ? obj.directives
        .filter(
          (d): d is CoachDirective =>
            !!d && typeof d === 'object' && typeof (d as CoachDirective).type === 'string' &&
            typeof (d as CoachDirective).label === 'string',
        )
        .slice(0, 3)
        .map((d) => ({ type: d.type, label: d.label.slice(0, 40) }))
    : [];

  // Proposals are bounded HERE as well as at the server action — a malformed
  // action or out-of-range day count degrades to "no proposal", never to a
  // best-effort guess.
  let proposal: CoachProposal | null = null;
  if (obj.proposal && typeof obj.proposal === 'object') {
    const p = obj.proposal as { action?: unknown; days?: unknown; reason?: unknown };
    if (p.action === 'end-hold') {
      proposal = { action: 'end-hold' };
    } else if (p.action === 'declare-hold') {
      const days = typeof p.days === 'number' && Number.isFinite(p.days) ? Math.round(p.days) : NaN;
      if (days >= 3 && days <= 14) {
        proposal = {
          action: 'declare-hold',
          days,
          reason: typeof p.reason === 'string' ? p.reason.trim().slice(0, 60) : undefined,
        };
      }
    }
  }

  // The glance rule is a hard bound, not a vibe: cap the brief's length so a
  // verbose day can never flood the home screen.
  return { brief: obj.brief.trim().slice(0, 600), directives, proposal };
}

// ── API calls ────────────────────────────────────────────────

const MODEL = 'claude-opus-5';

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

/**
 * Generate today's brief. Null on ANY failure — the caller stores nothing
 * and the app shows its deterministic layer, exactly as before.
 */
export async function generateCoachBrief(
  context: string,
  todayLine: string,
): Promise<CoachBrief | null> {
  const client = getClient();
  if (!client) return null;

  try {
    // Stable prefix (system + context) is cached; the today-line varies.
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: COACH_SYSTEM },
        { type: 'text', text: `HIS FULL DATA:\n${context}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `${todayLine}\nWrite this morning's brief.`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
    });

    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    return parseCoachBrief(JSON.parse(text.text));
  } catch {
    return null;
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * One chat reply. The same cached context block backs every turn, so a
 * conversation costs cache-reads plus the new tokens only.
 */
export async function coachChat(
  context: string,
  todayLine: string,
  turns: ChatTurn[],
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1500,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: COACH_SYSTEM },
        { type: 'text', text: `HIS FULL DATA:\n${context}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: todayLine },
      ],
      messages: turns.slice(-12).map((t) => ({ role: t.role, content: t.content })),
    });

    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    return text && text.type === 'text' && text.text.trim() ? text.text.trim() : null;
  } catch {
    return null;
  }
}
