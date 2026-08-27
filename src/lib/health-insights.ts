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

export const BP_CONTEXT_LABEL: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  'before-med': 'Before med',
  'after-med': 'After med',
  clinic: 'Clinic',
};

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

/**
 * Per-context averages (morning / evening / before-med / …) over a window.
 * Only contexts that clear the 3-reading guard appear; untagged readings
 * never enter any bucket. Ordered by count so the fullest story leads.
 */
export function bpContextAverages(
  readings: Array<BpLite & { context?: string | null }>,
  days: number,
  now: Date = new Date(),
): Array<{ context: string; systolic: number; diastolic: number; n: number }> {
  const buckets = new Map<string, Array<BpLite>>();
  for (const r of readings) {
    if (!r.context) continue;
    if (now.getTime() - time(r.at) > days * DAY_MS) continue;
    const list = buckets.get(r.context) ?? [];
    list.push(r);
    buckets.set(r.context, list);
  }
  const out: Array<{ context: string; systolic: number; diastolic: number; n: number }> = [];
  for (const [context, list] of buckets) {
    if (list.length < 3) continue;
    out.push({
      context,
      systolic: Math.round(list.reduce((s, r) => s + r.systolic, 0) / list.length),
      diastolic: Math.round(list.reduce((s, r) => s + r.diastolic, 0) / list.length),
      n: list.length,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * Weekly averages over the last `weeks` calendar weeks (Monday-anchored,
 * local time), oldest first. A week below the 3-reading guard reports null
 * averages but keeps its count, so the page can say "2 readings — not
 * enough" instead of drawing a lie. Weeks with zero readings are skipped
 * entirely; the caller decides how much silence to show.
 */
export function bpWeeklyAverages(
  readings: BpLite[],
  weeks: number,
  now: Date = new Date(),
): Array<{ weekStart: Date; systolic: number | null; diastolic: number | null; n: number }> {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const firstStart = new Date(monday);
  firstStart.setDate(firstStart.getDate() - (weeks - 1) * 7);

  const byWeek = new Map<number, BpLite[]>();
  for (const r of readings) {
    const t = time(r.at);
    if (t < firstStart.getTime() || t >= monday.getTime() + 7 * DAY_MS) continue;
    const index = Math.floor((t - firstStart.getTime()) / (7 * DAY_MS));
    const list = byWeek.get(index) ?? [];
    list.push(r);
    byWeek.set(index, list);
  }

  const out: Array<{ weekStart: Date; systolic: number | null; diastolic: number | null; n: number }> = [];
  for (const [index, list] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const weekStart = new Date(firstStart);
    weekStart.setDate(weekStart.getDate() + index * 7);
    const enough = list.length >= 3;
    out.push({
      weekStart,
      systolic: enough ? Math.round(list.reduce((s, r) => s + r.systolic, 0) / list.length) : null,
      diastolic: enough ? Math.round(list.reduce((s, r) => s + r.diastolic, 0) / list.length) : null,
      n: list.length,
    });
  }
  return out;
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

// ── The journey layer — time and story, not tables ───────────
// The re-orientation (owner, Aug 25): a companion narrates a treatment
// journey; it does not hand over a grid of metrics. Everything below turns
// the same logged rows into (a) the day's ONE headline, (b) sentences, and
// (c) stations on a path. Deterministic, guarded, first-person-his-data.

export interface JourneyDay {
  /** 1-based day of the journey; null before the first dose. */
  day: number | null;
  week: number | null;
  /** Doses taken and the total the plan holds before its first checkpoint. */
  dosesTaken: number;
  dosesUntilCheckpoint: number | null;
}

export function journeyDay(
  clock: TreatmentClock | null,
  plan: DosePlanStep[],
  doseCount: number,
  now: Date = new Date(),
): JourneyDay {
  const checkpointAt = plan.find((s) => s.mg === null)?.week ?? null;
  return {
    day: clock ? calendarDays(now, clock.anchor) + 1 : null,
    week: clock ? clock.week : null,
    dosesTaken: doseCount,
    dosesUntilCheckpoint:
      checkpointAt !== null ? Math.max(0, checkpointAt - 1 - doseCount) : null,
  };
}

/** What the app knows about HIS day-after pattern — never a generic claim.
 *  Null until two doses have day-relative symptom data to speak from. */
export function ownPattern(
  symptoms: SymptomLite[],
  injections: InjectionLite[],
  now: Date = new Date(),
): string | null {
  if (injections.length < 2) return null;
  const rel = dayRelativeSymptoms(symptoms, injections);
  let worst: { kind: string; offset: number; avg: number } | null = null;
  for (const [kind, cells] of Object.entries(rel)) {
    for (const c of cells) {
      if (c.count >= 2 && (worst === null || c.avgSeverity > worst.avg)) {
        worst = { kind, offset: c.offset, avg: c.avgSeverity };
      }
    }
  }
  if (!worst || worst.avg < 1) return null;
  const last = [...injections].sort((a, b) => time(b.at) - time(a.at))[0];
  const daysSince = calendarDays(now, last.at);
  const label = (SYMPTOM_LABEL[worst.kind] ?? worst.kind).toLowerCase();
  if (daysSince === worst.offset) {
    return `In your logs, ${label} has been strongest on day ${worst.offset} after a dose — today is that day. It has passed each time.`;
  }
  if (daysSince === worst.offset - 1) {
    return `Tomorrow is day ${worst.offset} after your dose — the day ${label} has usually been strongest in your logs.`;
  }
  return null;
}

/** The story so far, in sentences. Only what the data can back; an empty
 *  array on day one is correct, not a failure. */
export function journeyStory(input: {
  snapshot: WeightSnapshot | null;
  af: AfStats;
  cpap: CpapStats;
  dosesTaken: number;
  daysIn: number | null;
}): string[] {
  const out: string[] = [];
  const { snapshot, af, cpap, dosesTaken, daysIn } = input;
  if (snapshot && snapshot.lostKg >= 0.5 && daysIn !== null) {
    out.push(
      `You started at ${snapshot.startKg} kg. ${daysIn} days in: ${snapshot.currentKg} kg — ${snapshot.lostKg} kg down, ${snapshot.pctLost}% of you.`,
    );
  } else if (snapshot && snapshot.lostKg <= -0.5) {
    out.push(
      `The scale is up ${Math.abs(snapshot.lostKg)} kg from your start — early weeks move for many reasons; the trend is what counts.`,
    );
  }
  if (af.lastMonth >= 2 && af.thisMonth < af.lastMonth) {
    out.push(
      `Your heart has been quieter: ${af.thisMonth} episode${af.thisMonth === 1 ? '' : 's'} this month against ${af.lastMonth} last month.`,
    );
  } else if (af.daysSinceLast !== null && af.daysSinceLast >= 14) {
    out.push(`${af.daysSinceLast} days since the last AF episode — your longest quiet stretch this treatment.`);
  }
  if (cpap.streak >= 5) {
    out.push(`${cpap.streak} nights running on the mask${cpap.avgAhi30d != null ? ` at AHI ${cpap.avgAhi30d}` : ''}.`);
  }
  if (!out.length && dosesTaken >= 1) {
    out.push(`Dose ${dosesTaken} is in. The story writes itself from here — log the small things and watch it build.`);
  }
  return out.slice(0, 3);
}

export type StationState = 'done' | 'next' | 'future' | 'gate';

export interface JourneyStation {
  kind: 'dose' | 'checkpoint';
  label: string;
  detail: string | null;
  state: StationState;
}

/** The treatment as stations on a path — each plan slot becomes a station,
 *  filled by what actually happened. The doctor review is a GATE, not a
 *  list row: the path visibly stops there until the plan is extended. */
export function journeyStations(
  plan: DosePlanStep[],
  injections: Array<InjectionLite & { site?: string }>,
  now: Date = new Date(),
): JourneyStation[] {
  const sorted = [...injections].sort((a, b) => time(a.at) - time(b.at));
  const out: JourneyStation[] = [];
  let doseIndex = 0;
  for (const step of plan) {
    if (step.mg === null) {
      out.push({
        kind: 'checkpoint',
        label: step.label ?? 'Doctor review',
        detail: 'the plan beyond this is yours and your doctor’s to write',
        state: doseIndex >= step.week - 1 ? 'next' : 'gate',
      });
      continue;
    }
    const taken = sorted[doseIndex];
    if (taken) {
      out.push({
        kind: 'dose',
        label: `Dose ${step.week} · ${taken.doseMg} mg`,
        detail: `${new Date(taken.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${taken.site ? ` · ${siteLabel(taken.site)}` : ''}`,
        state: 'done',
      });
      doseIndex += 1;
    } else {
      const isNext = doseIndex === sorted.length && out.every((s) => s.state !== 'next');
      out.push({
        kind: 'dose',
        label: `Dose ${step.week} · ${step.mg} mg`,
        detail: isNext && sorted.length
          ? `due ${new Date(time(sorted[sorted.length - 1].at) + WEEK_MS).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : null,
        state: isNext ? 'next' : 'future',
      });
    }
  }
  return out;
}

// ── Fuel (daily macros) ──────────────────────────────────────
// Suggested targets, derived transparently from his profile (169 cm,
// start 133 kg, goal 103, mid-40s, machine training 2x/week + walking):
//   protein 130 g  — ~1.5 g/kg adjusted body weight (adjusted ≈ 87 kg:
//                    ideal-at-BMI-25 71 kg + 25% of the excess), the
//                    muscle-preservation floor that matters most on a
//                    GLP-1 appetite. A floor, not a ceiling.
//   kcal    2200   — Mifflin-St Jeor BMR ≈ 2170 × light activity ≈ 2900
//                    TDEE, minus a ~700 deficit (≈ 0.7 kg/week early).
//   fat     85 g   — ~1 g/kg adjusted (hormone floor), 765 kcal.
//   carbs   230 g  — the remainder (920 kcal), fuels the training days.
// Starting points, editable on the Fuel page — a dietitian outranks this
// arithmetic, and the app never grades a day, it only counts it.

export interface FuelTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export const FUEL_DEFAULTS: FuelTargets = { kcal: 2200, proteinG: 130, carbsG: 230, fatG: 85 };

/** Merge stored profile targets over the suggested defaults. */
export function fuelTargets(targets: Record<string, unknown> | null): FuelTargets {
  const num = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
  return {
    kcal: num(targets?.kcal, 800, 6000) ?? FUEL_DEFAULTS.kcal,
    proteinG: num(targets?.fuelProteinG, 30, 400) ?? FUEL_DEFAULTS.proteinG,
    carbsG: num(targets?.carbsG, 0, 800) ?? FUEL_DEFAULTS.carbsG,
    fatG: num(targets?.fatG, 20, 400) ?? FUEL_DEFAULTS.fatG,
  };
}

export interface FuelDayLite {
  day: Date | string;
  kcal?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

export interface FuelWeek {
  daysLogged: number;
  /** Averages over days that logged the field — null under the 3-day guard. */
  avgKcal: number | null;
  avgProteinG: number | null;
  /** Days at or above the protein target, of the days that logged protein. */
  proteinHitDays: number;
  proteinLoggedDays: number;
}

/** The last `days` calendar days of macro logs, guarded like everything else. */
export function fuelWeek(
  logs: FuelDayLite[],
  targets: FuelTargets,
  days = 7,
  now: Date = new Date(),
): FuelWeek {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const recent = logs.filter((l) => {
    const t = new Date(l.day).getTime();
    return t >= start.getTime() && t <= now.getTime();
  });
  const kcals = recent.map((l) => l.kcal).filter((v): v is number => v != null);
  const prots = recent.map((l) => l.proteinG).filter((v): v is number => v != null);
  const avg = (xs: number[]) =>
    xs.length >= 3 ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null;
  return {
    daysLogged: recent.filter((l) => l.kcal != null || l.proteinG != null).length,
    avgKcal: avg(kcals),
    avgProteinG: avg(prots),
    proteinHitDays: prots.filter((p) => p >= targets.proteinG).length,
    proteinLoggedDays: prots.length,
  };
}
