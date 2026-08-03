// Pure, testable coaching intelligence over the workout shape used across
// the app (workouts with sets, each set carrying its exercise). No Prisma,
// no IO — everything here also runs under ts-node against exported JSON
// history (see scripts/coach-tests.ts).

import { getMondayOfWeek, RPE_LABELS } from './format';
import {
  alternateDay,
  getDayTemplate,
  PROGRESSION,
  recoveryActivity,
  RETURN_PROGRAM,
  WEEKLY_SESSION_TARGET,
  type DynamicPlan,
  type TrainingStatus,
} from './program';

export interface CoachExercise {
  id: string;
  name: string;
  category: string;
}

export interface CoachSet {
  exerciseId: string;
  reps: number;
  weight: number;
  rpe: number | null;
  exercise: CoachExercise;
}

export interface CoachWorkout {
  date: Date | string;
  sets: CoachSet[];
}

export interface CoachBodyStat {
  date: Date | string;
  weight: number | null;
}

const DAY_MS = 86400000;
const time = (d: Date | string) => new Date(d).getTime();
const round2 = (n: number) => Math.round(n * 100) / 100;

interface SessionTop {
  date: number;
  top: number;
  topRpe: number | null; // hardest RPE recorded at the session's top weight
}

/** Chronological per-session top weights (and their RPE) for every exercise. */
function sessionTops(workouts: CoachWorkout[]): Record<string, SessionTop[]> {
  const chrono = [...workouts].sort((a, b) => time(a.date) - time(b.date));
  const tops: Record<string, SessionTop[]> = {};
  for (const w of chrono) {
    const perSession: Record<string, { top: number; topRpe: number | null }> = {};
    for (const s of w.sets) {
      if (s.weight <= 0) continue;
      const rpe = s.rpe != null && s.rpe > 0 ? s.rpe : null;
      const cur = perSession[s.exerciseId];
      if (!cur || s.weight > cur.top) {
        perSession[s.exerciseId] = { top: s.weight, topRpe: rpe };
      } else if (s.weight === cur.top && rpe != null && (cur.topRpe == null || rpe > cur.topRpe)) {
        cur.topRpe = rpe;
      }
    }
    for (const [id, entry] of Object.entries(perSession)) {
      (tops[id] ??= []).push({ date: time(w.date), top: entry.top, topRpe: entry.topRpe });
    }
  }
  return tops;
}

/**
 * Learns each machine's pin spacing from history: the smallest positive
 * jump between consecutive session-max weights. An exercise with no weight
 * change yet simply isn't in the result.
 */
export function learnPinIncrements(workouts: CoachWorkout[]): Record<string, number> {
  const learned: Record<string, number> = {};
  for (const [id, tops] of Object.entries(sessionTops(workouts))) {
    let best: number | undefined;
    for (let i = 1; i < tops.length; i++) {
      const diff = round2(Math.abs(tops[i].top - tops[i - 1].top));
      if (diff > 0 && (best === undefined || diff < best)) best = diff;
    }
    if (best !== undefined) learned[id] = best;
  }
  return learned;
}

/** Manual override on the exercise wins, else the learned value, else 2.5 kg. */
export function combineIncrement(
  learned: number | undefined,
  override?: number | null,
): number {
  if (override != null && override > 0) return override;
  if (learned != null && learned > 0) return learned;
  return 2.5;
}

export interface PlateauResult {
  plateaued: boolean;
  sessions: number; // length of the trailing streak at the same top weight
  weight: number | null;
  suggestion: string | null;
}

/**
 * A lift is plateaued when the last 3+ sessions share the same top weight
 * AND at least one of those top sets was rated Hard or worse — same weight
 * at Easy effort is just patience, not a stall.
 */
export function detectPlateau(workouts: CoachWorkout[], exerciseId: string): PlateauResult {
  const tops = sessionTops(workouts)[exerciseId] ?? [];
  if (!tops.length) return { plateaued: false, sessions: 0, weight: null, suggestion: null };

  const last = tops[tops.length - 1];
  let streak = 1;
  while (streak < tops.length && tops[tops.length - 1 - streak].top === last.top) streak++;

  const streakTops = tops.slice(tops.length - streak);
  const anyHard = streakTops.some((t) => t.topRpe != null && t.topRpe >= 3);
  const plateaued = streak >= 3 && anyHard;

  // First response to a stall is cheap volume; if it persists, deload a pin.
  const suggestion = !plateaued
    ? null
    : streak === 3
      ? 'add a rep to every set before adding weight'
      : 'drop one pin for a week and rebuild — momentum beats grinding';

  return { plateaued, sessions: streak, weight: last.top, suggestion };
}

export type Rpe = 1 | 2 | 3 | 4;

export interface EffortDistribution {
  total: number; // RPE-tagged sets inside the window
  counts: Record<Rpe, number>;
  share: Record<Rpe, number>; // 0–1, zero when total is 0
  hardShare: number; // share of sets at RPE 3–4
}

/**
 * Share of RPE-tagged sets per RPE 1–4 over the trailing `days`. The window
 * is anchored to the most recent workout (not the clock) so the card stays
 * meaningful across breaks.
 */
export function effortDistribution(
  workouts: CoachWorkout[],
  days = 28,
  now?: Date,
): EffortDistribution {
  const counts: Record<Rpe, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const anchor =
    now?.getTime() ??
    (workouts.length ? Math.max(...workouts.map((w) => time(w.date))) : Date.now());
  const cutoff = anchor - days * DAY_MS;

  for (const w of workouts) {
    if (time(w.date) < cutoff || time(w.date) > anchor) continue;
    for (const s of w.sets) {
      if (s.rpe === 1 || s.rpe === 2 || s.rpe === 3 || s.rpe === 4) counts[s.rpe]++;
    }
  }
  const total = counts[1] + counts[2] + counts[3] + counts[4];
  const share: Record<Rpe, number> = {
    1: total ? counts[1] / total : 0,
    2: total ? counts[2] / total : 0,
    3: total ? counts[3] / total : 0,
    4: total ? counts[4] / total : 0,
  };
  return { total, counts, share, hardShare: share[3] + share[4] };
}

export type WeightClassification = 'on_track' | 'slow' | 'too_fast' | 'gaining' | 'no_data';

export interface WeightTrend {
  ema: number | null; // EMA (alpha 0.3) over all weigh-ins
  kgPerWeek: number | null; // from first/last weigh-in of the trailing 28 days
  classification: WeightClassification;
  message: string;
}

/**
 * Fat-loss trend for a ~133 kg lifter: -0.5 to -1.3 kg/week is the lane.
 * The 28-day window is anchored to the latest weigh-in so stale data still
 * reads as a trend rather than "no change since last month".
 */
export function weightTrend(bodyStats: CoachBodyStat[]): WeightTrend {
  const pts = bodyStats
    .filter((s): s is CoachBodyStat & { weight: number } => s.weight != null)
    .map((s) => ({ t: time(s.date), w: s.weight }))
    .sort((a, b) => a.t - b.t);

  if (!pts.length) {
    return { ema: null, kgPerWeek: null, classification: 'no_data', message: 'Log a weigh-in to start the trend.' };
  }

  let ema = pts[0].w;
  for (let i = 1; i < pts.length; i++) ema = 0.3 * pts[i].w + 0.7 * ema;
  ema = round2(ema);

  if (pts.length < 2) {
    return { ema, kgPerWeek: null, classification: 'no_data', message: 'One weigh-in logged — one more and the trend starts.' };
  }

  const anchor = pts[pts.length - 1].t;
  const window = pts.filter((p) => p.t >= anchor - 28 * DAY_MS);
  const [first, last] =
    window.length >= 2 ? [window[0], window[window.length - 1]] : [pts[pts.length - 2], pts[pts.length - 1]];
  const spanDays = Math.max(1, (last.t - first.t) / DAY_MS);
  const kgPerWeek = round2(((last.w - first.w) / spanDays) * 7);

  let classification: WeightClassification;
  let message: string;
  if (kgPerWeek > 0) {
    classification = 'gaining';
    message = `Weight trend is up (+${kgPerWeek} kg/week) — review intake.`;
  } else if (kgPerWeek > -0.5) {
    classification = 'slow';
    message = `Losing ${Math.abs(kgPerWeek)} kg/week — slow. Tighten nutrition, keep lifting.`;
  } else if (kgPerWeek >= -1.3) {
    classification = 'on_track';
    message = `Down ${Math.abs(kgPerWeek)} kg/week — on track for fat loss.`;
  } else {
    classification = 'too_fast';
    message = `Down ${Math.abs(kgPerWeek)} kg/week — too fast. Protect muscle: eat a bit more protein/calories.`;
  }
  return { ema, kgPerWeek, classification, message };
}

// ── Home verdict ─────────────────────────────────────────────
// The single instruction line at the top of the home screen. Composed from
// the DYNAMIC PLAN (what his log says to do today) and the training status
// (which ramp/phase the loads come from) — plus, optionally, a readiness
// signal computed elsewhere from health data.

/** The PROGRESSION row covering a program week ("3–4" ranges included). */
export function phaseForWeek(week: number): (typeof PROGRESSION)[number] {
  return (
    PROGRESSION.find((p) => {
      const parts = p.weeks.split('–').map((s) => parseInt(s.trim(), 10));
      const [start, end] = parts.length === 2 ? parts : [parts[0], parts[0]];
      return week >= start && week <= end;
    }) ?? PROGRESSION[0]
  );
}

export type VerdictTone = 'return' | 'train' | 'rest' | 'done';

/**
 * A health-derived read on today, computed elsewhere (see health-metrics).
 * The coach only consumes it: a 'hold' softens a TRAIN order into recovery
 * wording, and the note becomes the verdict's sub-line. Absent → the verdict
 * is exactly what the program and the log alone would say.
 */
export interface ReadinessSignal {
  verdict: 'push' | 'proceed' | 'hold';
  note: string;
}

export interface HomeVerdict {
  tone: VerdictTone;
  /** The order itself — "TRAIN TODAY" / "REST". */
  lead: string;
  /** Short qualifiers rendered after the lead, separated by "·". */
  parts: string[];
  /** At most one muted sub-line; null when the lead says enough. */
  sub: string | null;
  /** Queued day, when there is one — drives the Aurora day accent. */
  day: 'A' | 'B' | null;
}

/**
 * Tells him what to do today in one line, off his own log:
 *   "TRAIN TODAY · Day B · 60% · cap Med"   (plan says train, return ramp)
 *   "TRAIN TODAY · Day A · Wk 3 BUILD"      (plan says train, main program)
 *   "RECOVER · 20 min walk"                 (trained yesterday, or held)
 *   "DONE TODAY · Day A logged"             (already trained today)
 *
 * `readiness` is optional and computed elsewhere. When it is absent this
 * behaves exactly as it does without it; when present its note becomes the
 * sub-line, and a 'hold' downgrades a TRAIN order into recovery wording.
 */
export function homeVerdict(
  status: TrainingStatus,
  plan: DynamicPlan,
  now: Date = new Date(),
  readiness?: ReadinessSignal,
): HomeVerdict {
  void now; // the plan already carries the date maths; kept for call-site symmetry
  // The freshest signal owns the sub-line — it is the one thing the program
  // alone could not have known.
  const sub = (base: string | null) => (readiness?.note ? readiness.note : base);

  if (plan.mode === 'done-today') {
    return {
      tone: 'done',
      lead: 'DONE TODAY',
      parts: [plan.day ? `Day ${plan.day} logged` : 'Session logged'],
      sub: sub(`Recover tomorrow · Day ${alternateDay(plan.day ?? plan.lastDay)} next`),
      day: plan.day,
    };
  }

  // Either his log says recover, or the health read says hold. Both are
  // advice: the day cards stay startable, this line just isn't the order.
  if (plan.mode === 'recover' || readiness?.verdict === 'hold') {
    const next = plan.day ?? alternateDay(plan.lastDay);
    return {
      tone: 'rest',
      lead: 'RECOVER',
      parts: [recoveryActivity(plan.lastDay)],
      sub: sub(`Day ${next} next`),
      day: null,
    };
  }

  const parts = [plan.day ? `Day ${plan.day}` : 'Day A or B'];

  if (status.mode === 'return') {
    parts.push(`${status.returnWeek.loadPct}%`, `cap ${RPE_LABELS[status.returnWeek.rpeCap]}`);
    return {
      tone: 'return',
      lead: 'TRAIN TODAY',
      parts,
      sub: sub(
        `Return week ${status.week} of ${RETURN_PROGRAM.length} · ${status.returnWeek.phase} · ${status.returnWeek.sessions} sessions`,
      ),
      day: plan.day,
    };
  }

  parts.push(`Wk ${status.week} ${phaseForWeek(status.week).phase}`);
  return {
    tone: 'train',
    lead: 'TRAIN TODAY',
    parts,
    sub: sub(plan.day ? getDayTemplate(plan.day).focus : null),
    day: plan.day,
  };
}

/** A glanceable number for the report's default surface. */
export interface ReportNumber {
  label: string;
  value: string;
}

export interface WeeklyReport {
  headline: string;
  /** The ONE thing to do next — the only prose the report shows by default. */
  instruction: string;
  /** At most three numbers shown beside the instruction. */
  numbers: ReportNumber[];
  /** Full prose, for the "Full report" disclosure only. */
  wins: string[];
  focus: string[];
  nextSession: string[];
}

/** The coach's weekly read: sessions, volume, plateaus, effort, weight. */
export function weeklyReport(
  workouts: CoachWorkout[],
  bodyStats: CoachBodyStat[],
  status: TrainingStatus,
  now: Date = new Date(),
): WeeklyReport {
  const wins: string[] = [];
  const focus: string[] = [];
  const nextSession: string[] = [];

  const weekStart = getMondayOfWeek(now).getTime();
  const lastWeekStart = weekStart - 7 * DAY_MS;
  const volume = (ws: CoachWorkout[]) =>
    ws.reduce((sum, w) => sum + w.sets.reduce((s, x) => s + x.weight * x.reps, 0), 0);

  const thisWeek = workouts.filter((w) => time(w.date) >= weekStart);
  const lastWeek = workouts.filter((w) => time(w.date) >= lastWeekStart && time(w.date) < weekStart);
  const sessionsThisWeek = thisWeek.length;

  const targetLabel = status.mode === 'return' ? status.returnWeek.sessions : `${WEEKLY_SESSION_TARGET}`;
  const targetNum = parseInt(targetLabel, 10) || WEEKLY_SESSION_TARGET;

  // Sessions vs target
  if (sessionsThisWeek >= targetNum) {
    wins.push(`${sessionsThisWeek} session${sessionsThisWeek === 1 ? '' : 's'} this week — weekly target hit.`);
  } else {
    focus.push(`${sessionsThisWeek}/${targetLabel} sessions so far this week — schedule the next one.`);
  }

  // Volume week over week
  const thisVol = volume(thisWeek);
  const lastVol = volume(lastWeek);
  let volPct: number | null = null;
  if (lastVol > 0 && thisVol > 0) {
    const pct = Math.round(((thisVol - lastVol) / lastVol) * 100);
    volPct = pct;
    if (pct >= 0) wins.push(`Volume up ${pct}% week over week.`);
    else focus.push(`Volume down ${Math.abs(pct)}% week over week.`);
  }

  // Plateaus
  const namesById = new Map<string, string>();
  for (const w of workouts) for (const s of w.sets) namesById.set(s.exerciseId, s.exercise.name);
  const plateaus = [...namesById]
    .map(([id, name]) => ({ name, result: detectPlateau(workouts, id) }))
    .filter((p) => p.result.plateaued);
  for (const p of plateaus.slice(0, 3)) {
    focus.push(`${p.name} stuck at ${p.result.weight} kg for ${p.result.sessions} sessions — ${p.result.suggestion}.`);
  }

  // Effort balance (trailing 4 weeks, anchored to the last workout)
  const effort = effortDistribution(workouts);
  let hardPct: number | null = null;
  if (effort.total >= 6) {
    hardPct = Math.round(effort.hardShare * 100);
    if (effort.hardShare > 0.5) {
      focus.push(`${hardPct}% of rated sets in the last 4 weeks were Hard/Grind — dial one pin back where form slips.`);
    } else {
      wins.push(`Effort balance is sustainable — ${hardPct}% of rated sets were Hard/Grind.`);
    }
  }

  // Body-weight trend
  const trend = weightTrend(bodyStats);
  if (trend.classification === 'on_track') wins.push(trend.message);
  else if (trend.classification !== 'no_data') focus.push(trend.message);

  // Next session guidance
  if (status.mode === 'return') {
    nextSession.push(`Load ~${status.returnWeek.loadPct}% of pre-break weights.`);
    nextSession.push(`Cap effort at ${RPE_LABELS[status.returnWeek.rpeCap]} — the ramp is about showing up, not PRs.`);
    nextSession.push(`Target ${status.returnWeek.sessions} sessions this week; two clean sessions advance the ramp.`);
  } else {
    nextSession.push('Take the next pin on anything that was Easy last session.');
    if (plateaus.length) nextSession.push(`On ${plateaus[0].name}: ${plateaus[0].result.suggestion}.`);
    nextSession.push('Leave 1–2 reps in reserve — Grind sets are a signal, not a goal.');
  }

  const headline =
    status.mode === 'return'
      ? `Return ramp week ${status.week} of ${RETURN_PROGRAM.length} — ${status.returnWeek.phase} at ${status.returnWeek.loadPct}% loads.`
      : `Program week ${status.week} — ${sessionsThisWeek}/${targetLabel} sessions logged this week.`;

  if (!wins.length && workouts.length) {
    wins.push(`${workouts.length} sessions in the book — consistency is the engine.`);
  }

  // ── Default surface: one instruction, at most three numbers ──
  // Everything above stays available for the "Full report" disclosure; this
  // is only about what the glance layer is allowed to show. No new maths —
  // every value here was already computed for the prose.
  const instruction = nextSession[0];
  const numbers: ReportNumber[] = [{ label: 'Sessions', value: `${sessionsThisWeek}/${targetLabel}` }];
  if (volPct !== null) {
    numbers.push({ label: 'Volume', value: `${volPct >= 0 ? '+' : ''}${volPct}%` });
  }
  if (hardPct !== null) {
    numbers.push({ label: 'Hard+', value: `${hardPct}%` });
  }
  if (numbers.length < 3 && trend.kgPerWeek !== null) {
    numbers.push({ label: 'Weight', value: `${trend.kgPerWeek > 0 ? '+' : ''}${trend.kgPerWeek} kg/wk` });
  }

  return { headline, instruction, numbers: numbers.slice(0, 3), wins, focus, nextSession };
}

export interface NextTarget {
  weight: number;
  action: 'add' | 'hold' | 'back_off';
  note: string;
}

/**
 * Pin-aware next-session target from the last top set. Uses the machine's
 * real increment — never a hardcoded +2.5.
 */
export function nextTarget(topWeight: number, topRpe: number | null, increment: number): NextTarget {
  if (topRpe != null && topRpe >= 4) {
    return {
      weight: round2(Math.max(0, topWeight - increment)),
      action: 'back_off',
      note: 'Last top set was a Grind — drop one pin and rebuild.',
    };
  }
  if (topRpe === 3) {
    return {
      weight: round2(topWeight),
      action: 'hold',
      note: 'Hold the weight — add a rep to every set first.',
    };
  }
  return {
    weight: round2(topWeight + increment),
    action: 'add',
    note: 'Clean and easy last time — take the next pin.',
  };
}
