// Health wave — the deterministic brain of the Mounjaro module.
//
// Everything here is pure arithmetic over logged rows: no model calls, no
// stored derived state, transparent rules. Three laws, from the owner's
// spec and this repo's own history:
//
//   1. TRACKER, NOT DIAGNOSTIC. Outputs are "observed pattern in your
//      logs", never causation, never diagnosis.
//   2. GUARDED. Below the data thresholds a function returns null and the
//      UI says "not enough data yet" — a chart from 3 points is a lie with
//      axes (the same rule that killed the -100% badge).
//   3. ANCHORED TO EVENTS. Week 1 · day 0 is the FIRST LOGGED INJECTION,
//      not an assumed start date; the treatment clock derives from what
//      actually happened.

import { weightTrend, type CoachBodyStat } from './coach';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// ── Dose plan ────────────────────────────────────────────────

export interface DosePlanStep {
  week: number;
  /** null = checkpoint, nothing scheduled — the doctor decides. */
  mg: number | null;
  label?: string;
}

/** His stated plan: 4 weeks at 2.5, two at 5, then the doctor. Editable
 *  data, not code — nothing ever auto-escalates past the checkpoint. */
export const DEFAULT_DOSE_PLAN: DosePlanStep[] = [
  { week: 1, mg: 2.5 },
  { week: 2, mg: 2.5 },
  { week: 3, mg: 2.5 },
  { week: 4, mg: 2.5 },
  { week: 5, mg: 5 },
  { week: 6, mg: 5 },
  { week: 7, mg: null, label: 'Doctor review' },
];

/** Shared display names for symptom kinds — every surface must use these,
 *  never raw slugs (device-tester: "abdominal-pain" leaked into a card). */
export const SYMPTOM_LABEL: Record<string, string> = {
  nausea: 'Nausea', bloating: 'Bloating', gas: 'Gas', reflux: 'Reflux',
  burping: 'Burping', constipation: 'Constipation', diarrhea: 'Diarrhea',
  vomiting: 'Vomiting', 'abdominal-pain': 'Abdominal pain', fatigue: 'Fatigue',
  headache: 'Headache', dizziness: 'Dizziness',
  'appetite-suppression': 'Low appetite', fullness: 'Early fullness',
};

export interface InjectionLite {
  at: Date | string;
  doseMg: number;
  site: string;
}

export interface TreatmentClock {
  /** 1-based treatment week — CALENDAR days since the first logged
   *  injection, floor(days/7)+1. Display only; never used to pick a dose. */
  week: number;
  anchor: Date;
  lastInjection: Date;
  lastDoseMg: number;
  daysSinceLast: number;
  nextDue: Date;
  /** The plan slot for the NEXT dose — DOSE-indexed (slot n = the nth
   *  injection), so a dose taken hours early or a delayed week can never
   *  shift which slot applies, and the doctor-review checkpoint can never
   *  be walked past by wall-clock drift (adversary blocker). null when the
   *  plan has no slot for the next dose — see planExhausted. */
  nextPlanned: DosePlanStep | null;
  /** True when the plan simply ends before the next dose: the UI asks for
   *  a plan edit instead of looping the last step forever. */
  planExhausted: boolean;
  overdue: boolean;
}

const time = (d: Date | string) => new Date(d).getTime();

/** CALENDAR days, not elapsed 24h blocks — an evening dose on the 8th is
 *  2 days back on the morning of the 10th (the same rule the dynamic plan
 *  learned the hard way). */
const calendarDays = (later: Date, earlier: Date | string): number => {
  const a = new Date(later); a.setHours(12, 0, 0, 0);
  const b = new Date(earlier); b.setHours(12, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
};

/**
 * Null before the first injection is logged — the app shows "log your
 * first injection to start the clock" instead of inventing a schedule.
 *
 * `trueAnchor`: callers that fetch only a recent window of injections MUST
 * pass the real first-injection date (a one-row query) — otherwise the
 * anchor silently becomes "the oldest row in the window" and the treatment
 * week drifts (adversary). `doseCountOverride` likewise carries the true
 * total when `injections` is a truncated window.
 */
export function treatmentClock(
  injections: InjectionLite[],
  plan: DosePlanStep[],
  now: Date = new Date(),
  trueAnchor?: Date,
  doseCountOverride?: number,
): TreatmentClock | null {
  if (!injections.length) return null;
  const sorted = [...injections].sort((a, b) => time(a.at) - time(b.at));
  const anchor = trueAnchor ?? new Date(sorted[0].at);
  const last = sorted[sorted.length - 1];
  const week = Math.floor(Math.max(0, calendarDays(now, anchor)) / 7) + 1;
  const nextDue = new Date(time(last.at) + WEEK_MS);
  const nextDoseNumber = (doseCountOverride ?? injections.length) + 1;
  const nextPlanned = plan.find((s) => s.week === nextDoseNumber) ?? null;
  return {
    week,
    anchor,
    lastInjection: new Date(last.at),
    lastDoseMg: last.doseMg,
    daysSinceLast: calendarDays(now, last.at),
    nextDue,
    nextPlanned,
    planExhausted: nextPlanned === null,
    overdue: calendarDays(now, last.at) >= 8,
  };
}

// ── Injection-site rotation ──────────────────────────────────

export const SITES = [
  'abdomen-right',
  'abdomen-left',
  'thigh-right',
  'thigh-left',
  'arm-right',
  'arm-left',
] as const;

export const DEFAULT_ROTATION: string[] = [
  'abdomen-right',
  'abdomen-left',
  'thigh-right',
  'thigh-left',
];

export function siteLabel(slug: string): string {
  const [area, side] = slug.split('-');
  const areas: Record<string, string> = { abdomen: 'Abdomen', thigh: 'Thigh', arm: 'Upper arm' };
  const sides: Record<string, string> = { left: 'left', right: 'right' };
  return `${areas[area] ?? area} · ${sides[side] ?? side}`;
}

/** The next site in the rotation after the most recent injection's site.
 *  A site outside the rotation (one-off arm shot) doesn't derail it: the
 *  assistant resumes from the last rotation site used. */
export function nextSite(rotation: string[], injections: InjectionLite[]): string {
  const cycle = rotation.length ? rotation : DEFAULT_ROTATION;
  const recent = [...injections].sort((a, b) => time(b.at) - time(a.at));
  const lastInCycle = recent.find((i) => cycle.includes(i.site));
  if (!lastInCycle) return cycle[0];
  const idx = cycle.indexOf(lastInCycle.site);
  return cycle[(idx + 1) % cycle.length];
}

// ── Weight ───────────────────────────────────────────────────

export interface WeightSnapshot {
  currentKg: number;
  startKg: number;
  lostKg: number;
  pctLost: number;
  bmi: number;
  startBmi: number;
  /** 5/10/15/20/25% markers with achieved flags. */
  pctMilestones: Array<{ pct: number; kg: number; achieved: boolean }>;
  /** kg milestones (120/110/103 by default) with achieved flags. */
  kgMilestones: Array<{ kg: number; achieved: boolean }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function weightSnapshot(
  profile: { heightCm: number; startWeightKg: number; goalWeightKg: number },
  milestonesKg: number[],
  bodyStats: CoachBodyStat[],
): WeightSnapshot | null {
  const weights = bodyStats
    .filter((b) => b.weight != null)
    .sort((a, b) => time(a.date) - time(b.date));
  if (!weights.length) return null;
  const current = weights[weights.length - 1].weight as number;
  const start = profile.startWeightKg;
  const lost = round1(start - current);
  const pctLost = start > 0 ? round1(((start - current) / start) * 100) : 0;
  const h2 = (profile.heightCm / 100) ** 2;
  return {
    currentKg: current,
    startKg: start,
    lostKg: lost,
    pctLost,
    bmi: round1(current / h2),
    startBmi: round1(start / h2),
    pctMilestones: [5, 10, 15, 20, 25].map((pct) => ({
      pct,
      kg: round1(start * (1 - pct / 100)),
      achieved: pctLost >= pct,
    })),
    kgMilestones: milestonesKg.map((kg) => ({ kg, achieved: current <= kg })),
  };
}

export interface Projection {
  targetKg: number;
  /** null = beyond the honest horizon. */
  estimatedDate: Date | null;
  weeksAway: number | null;
}

/**
 * Rolling-trend projection. Null (as a whole) when there is no honest
 * basis: fewer than 4 weigh-ins in the last 60 days, or the trend is flat
 * or upward — "no downward trend to project" beats a fantasy date. A
 * target more than 18 months out reports estimatedDate null: the trend is
 * real but the date would be astrology.
 */
export function weightProjections(
  bodyStats: CoachBodyStat[],
  targetsKg: number[],
  now: Date = new Date(),
): Projection[] | null {
  const recent = bodyStats.filter(
    (b) => b.weight != null && now.getTime() - time(b.date) <= 60 * DAY_MS,
  );
  if (recent.length < 4) return null;
  const trend = weightTrend(bodyStats);
  if (trend.ema === null || trend.kgPerWeek === null || trend.kgPerWeek >= -0.05) return null;
  const rate = -trend.kgPerWeek; // kg lost per week, positive
  const HORIZON_WEEKS = 78; // 18 months
  return targetsKg
    .filter((t) => t < (trend.ema as number))
    .map((targetKg) => {
      const weeks = (trend.ema as number - targetKg) / rate;
      return {
        targetKg,
        weeksAway: round1(weeks),
        estimatedDate: weeks <= HORIZON_WEEKS ? new Date(now.getTime() + weeks * WEEK_MS) : null,
      };
    });
}

// ── Symptoms relative to injection day ───────────────────────

export interface SymptomLite {
  at: Date | string;
  kind: string;
  severity: number;
}

export interface DayRelativeCell {
  offset: number; // 0..7
  count: number;
  avgSeverity: number;
}

/**
 * kind → cells for day offsets 0..7 after the nearest PRECEDING injection.
 * Symptoms logged with no preceding injection, or 8+ days after one, are
 * excluded — they have no injection-relative meaning.
 */
export function dayRelativeSymptoms(
  symptoms: SymptomLite[],
  injections: InjectionLite[],
): Record<string, DayRelativeCell[]> {
  if (!injections.length) return {};
  const times = injections.map((i) => time(i.at)).sort((a, b) => a - b);
  const buckets: Record<string, Record<number, { total: number; n: number }>> = {};
  for (const s of symptoms) {
    const st = time(s.at);
    let prev: number | null = null;
    for (const t of times) {
      if (t <= st) prev = t;
      else break;
    }
    if (prev === null) continue;
    // CALENDAR days (the module's one law): a morning-after symptom of an
    // evening injection is day 1, never day 0 — elapsed-24h floors shifted
    // an evening injector's whole matrix a column left (adversary probe).
    const offset = calendarDays(new Date(st), new Date(prev));
    if (offset < 0 || offset > 7) continue;
    buckets[s.kind] ??= {};
    buckets[s.kind][offset] ??= { total: 0, n: 0 };
    buckets[s.kind][offset].total += s.severity;
    buckets[s.kind][offset].n += 1;
  }
  const out: Record<string, DayRelativeCell[]> = {};
  for (const [kind, byOffset] of Object.entries(buckets)) {
    out[kind] = Object.entries(byOffset)
      .map(([o, v]) => ({
        offset: Number(o),
        count: v.n,
        avgSeverity: Math.round((v.total / v.n) * 10) / 10,
      }))
      .sort((a, b) => a.offset - b.offset);
  }
  return out;
}

/** Average severity per kind at each dose level — "observed pattern"
 *  material for the 2.5→5 mg escalation question. Null under 3 logs per
 *  dose for a kind. */
export function severityByDose(
  symptoms: SymptomLite[],
  injections: InjectionLite[],
): Record<string, Array<{ doseMg: number; avgSeverity: number; n: number }>> {
  if (!injections.length) return {};
  const times = [...injections]
    .map((i) => ({ t: time(i.at), dose: i.doseMg }))
    .sort((a, b) => a.t - b.t);
  const agg: Record<string, Record<number, { total: number; n: number }>> = {};
  for (const s of symptoms) {
    const st = time(s.at);
    let dose: number | null = null;
    let doseAt: number | null = null;
    for (const i of times) {
      if (i.t <= st) { dose = i.dose; doseAt = i.t; }
      else break;
    }
    if (dose === null || doseAt === null) continue;
    // A symptom weeks after the last dose says nothing about that dose —
    // cap attribution at the weekly cadence, same window as day-relative.
    if (calendarDays(new Date(st), new Date(doseAt)) > 7) continue;
    agg[s.kind] ??= {};
    agg[s.kind][dose] ??= { total: 0, n: 0 };
    agg[s.kind][dose].total += s.severity;
    agg[s.kind][dose].n += 1;
  }
  const out: Record<string, Array<{ doseMg: number; avgSeverity: number; n: number }>> = {};
  for (const [kind, byDose] of Object.entries(agg)) {
    const rows = Object.entries(byDose)
      .filter(([, v]) => v.n >= 3)
      .map(([d, v]) => ({
        doseMg: Number(d),
        avgSeverity: Math.round((v.total / v.n) * 10) / 10,
        n: v.n,
      }))
      .sort((a, b) => a.doseMg - b.doseMg);
    if (rows.length) out[kind] = rows;
  }
  return out;
}

// ── AF ───────────────────────────────────────────────────────

export interface AfLite {
  startedAt: Date | string;
  bloating?: boolean | null;
  gas?: boolean | null;
  afterMeal?: boolean | null;
  sleepRelated?: boolean | null;
  caffeine?: boolean | null;
  stress?: boolean | null;
}

export interface AfStats {
  daysSinceLast: number | null;
  thisMonth: number;
  lastMonth: number;
  /** Newest-last [{monthKey, count}] for the trend bar. */
  perMonth: Array<{ month: string; count: number }>;
}

export function afStats(episodes: AfLite[], now: Date = new Date()): AfStats {
  const sorted = [...episodes].sort((a, b) => time(b.startedAt) - time(a.startedAt));
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const per = new Map<string, number>();
  for (const e of episodes) {
    const k = monthKey(new Date(e.startedAt));
    per.set(k, (per.get(k) ?? 0) + 1);
  }
  const thisKey = monthKey(now);
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  return {
    daysSinceLast: sorted.length ? calendarDays(now, sorted[0].startedAt) : null,
    thisMonth: per.get(thisKey) ?? 0,
    lastMonth: per.get(lastKey) ?? 0,
    perMonth: [...per.entries()].sort().map(([month, count]) => ({ month, count })),
  };
}

export interface AfCorrelate {
  label: string;
  /** episodes where the flag was true */
  hits: number;
  /** episodes where the flag was ANSWERED (true or false) — the honest
   *  denominator; unanswered episodes prove nothing either way. */
  answered: number;
}

/** Null until at least 5 episodes have the flag answered — under that,
 *  "3 of 4" is noise wearing a percentage. Correlation language only. */
export function afCorrelates(episodes: AfLite[], minAnswered = 5): AfCorrelate[] | null {
  const flags: Array<{ key: keyof AfLite; label: string }> = [
    { key: 'bloating', label: 'bloating logged' },
    { key: 'gas', label: 'gas logged' },
    { key: 'afterMeal', label: 'after a meal' },
    { key: 'sleepRelated', label: 'during/around sleep' },
    { key: 'caffeine', label: 'caffeine that day' },
    { key: 'stress', label: 'stress that day' },
  ];
  const rows: AfCorrelate[] = [];
  for (const f of flags) {
    const answered = episodes.filter((e) => e[f.key] === true || e[f.key] === false);
    if (answered.length < minAnswered) continue;
    rows.push({
      label: f.label,
      hits: answered.filter((e) => e[f.key] === true).length,
      answered: answered.length,
    });
  }
  return rows.length ? rows.sort((a, b) => b.hits / b.answered - a.hits / a.answered) : null;
}

// ── CPAP ─────────────────────────────────────────────────────

export interface CpapLite {
  night: Date | string;
  usageHours: number;
  ahi?: number | null;
}

export interface CpapStats {
  avgHours30d: number | null;
  nights30d: number;
  nightsOver4h30d: number;
  avgAhi30d: number | null;
  /** Consecutive nights (ending at the most recent logged night) with any use. */
  streak: number;
}

export function cpapStats(nights: CpapLite[], now: Date = new Date()): CpapStats {
  const recent = nights.filter((n) => now.getTime() - time(n.night) <= 30 * DAY_MS);
  const used = recent.filter((n) => n.usageHours > 0);
  const ahis = recent.filter((n) => n.ahi != null) as Array<{ ahi: number }>;
  const sorted = [...nights].sort((a, b) => time(b.night) - time(a.night));
  let streak = 0;
  let cursor: number | null = null;
  for (const n of sorted) {
    if (n.usageHours <= 0) break;
    const t = new Date(n.night).setHours(12, 0, 0, 0);
    if (cursor !== null && Math.round((cursor - t) / DAY_MS) !== 1) break;
    streak += 1;
    cursor = t;
  }
  return {
    avgHours30d: used.length
      ? Math.round((used.reduce((s, n) => s + n.usageHours, 0) / used.length) * 10) / 10
      : null,
    nights30d: used.length,
    nightsOver4h30d: used.filter((n) => n.usageHours >= 4).length,
    avgAhi30d: ahis.length
      ? Math.round((ahis.reduce((s, n) => s + n.ahi, 0) / ahis.length) * 10) / 10
      : null,
    streak,
  };
}

// ── Blood pressure ───────────────────────────────────────────

export interface BpLite {
  at: Date | string;
  systolic: number;
  diastolic: number;
}

export function bpAverage(
  readings: BpLite[],
  days: number,
  now: Date = new Date(),
): { systolic: number; diastolic: number; n: number } | null {
  const recent = readings.filter((r) => now.getTime() - time(r.at) <= days * DAY_MS);
  if (recent.length < 3) return null; // one reading is a moment, not a trend
  return {
    systolic: Math.round(recent.reduce((s, r) => s + r.systolic, 0) / recent.length),
    diastolic: Math.round(recent.reduce((s, r) => s + r.diastolic, 0) / recent.length),
    n: recent.length,
  };
}

// ── Safety notice (display gate only — never a judgment) ─────

const RED_FLAG_KINDS = new Set(['vomiting', 'abdominal-pain', 'dizziness']);

/**
 * True when the last 48h contain 2+ severity-3 logs of red-flag kinds.
 * The UI then shows a STATIC line recommending medical evaluation. The
 * app never judges whether the situation is safe — it only refuses to
 * stay silent on repeated severe entries.
 */
export function severeSymptomFlag(symptoms: SymptomLite[], now: Date = new Date()): boolean {
  const recent = symptoms.filter(
    (s) =>
      now.getTime() - time(s.at) <= 2 * DAY_MS &&
      s.severity >= 3 &&
      RED_FLAG_KINDS.has(s.kind),
  );
  return recent.length >= 2;
}
