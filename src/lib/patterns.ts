// Patterns — what his own logs show side by side.
//
// Every analysis on /health/analytics is a pure function here: plain rows
// and `now` in, a result out, or null for "not enough data yet". The page
// only fetches and renders. Tracker, not diagnosis (docs/HEALTH.md): these
// are things seen together in his logs, never a reason and never advice.
//
// One day clock (CLAUDE.md rule 12). How each row is stored decides how it
// is bucketed:
//   · an injection, a weigh-in: an instant → HIS calendar day (ownerDayKey);
//   · a diet row, a session: UTC midnight of his 04:00 activity day → the
//     key is the ISO date itself;
//   · a CPAP night: UTC midnight of the morning the night ENDED → same;
//   · a BP reading: an instant → for "the day after a night" it is filed
//     under his activity day, so a 01:00 reading stays with the evening
//     it was part of.
// Thin data: an average needs 3 values, a chart 4 points, a share 5 items,
// and every number carries its count. A day without a weigh-in is missing;
// nothing here fills one in.

import { bpWeightStory, CPAP_ADHERENT_HOURS, ownerActivityDayUtc, ownerDayKey, ownerMonthKey } from './health-insights';
import { monthLabel, signedKg } from './health-format';
import { MIN_TREND_POINTS, type ChartSpec } from './report-charts';

const DAY_MS = 86_400_000;

/** Fewest values behind any average shown. */
export const MIN_AVG = 3;
/** Fewest items behind any percentage shown. */
export const MIN_SHARE_ITEMS = 5;
/** A week of food counts with this many logged days. */
export const MIN_WEEK_DAYS = 5;
/** A change on the scale is read off two weigh-ins at least this far apart. */
export const MIN_WEIGH_SPAN_DAYS = 5;
/** Fewest nights on each side of the 4-hour line. */
export const MIN_SIDE_NIGHTS = 4;

type When = Date | string;
export interface DoseIn { at: When; doseMg: number }
export interface DietIn { day: When; kcal?: number | null; proteinG?: number | null }
export interface WeighIn { date: When; weight: number | null }
export interface NightIn { night: When; usageHours: number; ahi?: number | null; p95Pressure?: number | null }
export interface BpIn { at: When; systolic: number; diastolic: number }
export interface SessionIn { date: When; rpes: Array<number | null> }

// ── Days as whole numbers, on the right clock for each store ──

const dayNum = (key: string): number => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
const dayKey = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** An instant → his calendar day. */
const instantDay = (d: When): number => dayNum(ownerDayKey(new Date(d)));
/** A row stored at UTC midnight of its day → that day. */
const storedDay = (d: When): number => dayNum(new Date(d).toISOString().slice(0, 10));
/** The last diet or session day that has begun (04:00 rollover). */
const activityToday = (now: Date): number => storedDay(ownerActivityDayUtc(now));

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
const round1 = (n: number): number => Math.round(n * 10) / 10 + 0; // + 0: never −0
const avgOrNull = (xs: number[], round: (n: number) => number): number | null =>
  xs.length >= MIN_AVG ? round(mean(xs)) : null;

/** One weight per calendar day from the ONE weight store; the later
 *  weigh-in of a day stands for it. Nothing after `now`. */
function weightByDay(weights: WeighIn[], now: Date): Map<number, number> {
  const rows = weights
    .filter((w) => w.weight != null && new Date(w.date).getTime() <= now.getTime())
    .map((w) => ({ t: new Date(w.date).getTime(), kg: w.weight as number }))
    .sort((a, b) => a.t - b.t);
  const out = new Map<number, number>();
  for (const r of rows) out.set(instantDay(new Date(r.t)), r.kg);
  return out;
}

/** Doses in order, one per calendar day (law 8: a dose is on a calendar day). */
function doseDays(doses: DoseIn[], now: Date): Array<{ day: number; doseMg: number }> {
  const byDay = new Map<number, number>();
  [...doses]
    .filter((d) => new Date(d.at).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .forEach((d) => byDay.set(instantDay(d.at), d.doseMg));
  return [...byDay.entries()].map(([day, doseMg]) => ({ day, doseMg })).sort((a, b) => a.day - b.day);
}

/** The dose a day belongs to: the latest one on or before it, 6 days back
 *  at most. A day further out than that belongs to no dose week. */
function doseIndexFor(ds: Array<{ day: number }>, day: number): number {
  let idx = -1;
  for (let i = 0; i < ds.length && ds[i].day <= day; i++) idx = i;
  return idx >= 0 && day - ds[idx].day <= 6 ? idx : -1;
}

/** kg per 7 days between the first and last weigh-in inside [from, to]. */
function scaleChange(byDay: Map<number, number>, from: number, to: number): number | null {
  let first = -1;
  let last = -1;
  for (let d = from; d <= to; d++) {
    if (!byDay.has(d)) continue;
    if (first < 0) first = d;
    last = d;
  }
  if (first < 0 || last - first < MIN_WEIGH_SPAN_DAYS) return null;
  return (((byDay.get(last) as number) - (byDay.get(first) as number)) / (last - first)) * 7;
}

// ── 1 · The week after a dose ────────────────────────────────

export interface DoseDay {
  /** Days since the injection: 0 is the dose day on his calendar. */
  offset: number;
  kcal: number | null;
  nKcal: number;
  /** Against the weigh-in of the dose day. */
  kgChange: number | null;
  nKg: number;
}
export interface WeekAfterDose {
  days: DoseDay[];
  /** Dose weeks that gave at least one logged day. */
  weeks: number;
  low: { offset: number; kcal: number; n: number };
  /** The highest day after the low one; when the low day is the last, the
   *  highest day before it (`after` false). */
  other: { offset: number; kcal: number; n: number; after: boolean } | null;
}

/**
 * By day since the injection: average kcal eaten, and the scale against
 * the dose-day weigh-in, across every dose week with data. A week whose
 * dose day has no weigh-in gives no weight values — never filled in.
 * Null until four of the seven days have an average.
 */
export function weekAfterDose(doses: DoseIn[], diet: DietIn[], weights: WeighIn[], now: Date = new Date()): WeekAfterDose | null {
  const ds = doseDays(doses, now);
  if (!ds.length) return null;
  const kcal: number[][] = Array.from({ length: 7 }, () => []);
  const kg: number[][] = Array.from({ length: 7 }, () => []);
  const counted = new Set<number>();
  const last = activityToday(now);
  for (const row of diet) {
    if (row.kcal == null) continue;
    const day = storedDay(row.day);
    if (day > last) continue;
    const i = doseIndexFor(ds, day);
    if (i < 0) continue;
    kcal[day - ds[i].day].push(row.kcal);
    counted.add(i);
  }
  const byDay = weightByDay(weights, now);
  ds.forEach((dose, i) => {
    const base = byDay.get(dose.day);
    if (base === undefined) return;
    kg[0].push(0);
    for (let off = 1; off <= 6; off++) {
      if (i + 1 < ds.length && dose.day + off >= ds[i + 1].day) break;
      const w = byDay.get(dose.day + off);
      if (w !== undefined) kg[off].push(w - base);
    }
  });
  const days: DoseDay[] = kcal.map((xs, offset) => ({
    offset,
    kcal: avgOrNull(xs, Math.round),
    nKcal: xs.length,
    kgChange: avgOrNull(kg[offset], round1),
    nKg: kg[offset].length,
  }));
  const shown = days.filter((d) => d.kcal !== null);
  if (shown.length < MIN_TREND_POINTS) return null;
  const pick = (d: DoseDay) => ({ offset: d.offset, kcal: d.kcal as number, n: d.nKcal });
  const lowDay = shown.reduce((a, b) => ((b.kcal as number) < (a.kcal as number) ? b : a));
  const highest = (xs: DoseDay[]) => xs.reduce((a, b) => ((b.kcal as number) > (a.kcal as number) ? b : a));
  const later = shown.filter((d) => d.offset > lowDay.offset);
  const earlier = shown.filter((d) => d.offset < lowDay.offset);
  const otherDay = later.length ? highest(later) : earlier.length ? highest(earlier) : null;
  return {
    days,
    weeks: counted.size,
    low: pick(lowDay),
    other: otherDay && otherDay.kcal !== lowDay.kcal ? { ...pick(otherDay), after: later.length > 0 } : null,
  };
}

const offsetLabels = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ t: (from + i) * DAY_MS, label: String(from + i) }));

/** Seven kcal bars and the weight line, on a day-since-dose axis. */
export function weekAfterDoseCharts(r: WeekAfterDose): { kcal: ChartSpec | null; weight: ChartSpec | null } {
  const bars = r.days.filter((d) => d.kcal !== null).map((d) => ({ t: d.offset * DAY_MS, v: d.kcal as number }));
  const line = r.days.filter((d) => d.kgChange !== null).map((d) => ({ t: d.offset * DAY_MS, v: d.kgChange as number }));
  return {
    kcal: bars.length >= MIN_TREND_POINTS
      ? {
          key: 'pattern-dose-kcal',
          title: 'Average kcal, by day since the dose',
          unit: 'kcal',
          series: [{ key: 'kcal', label: 'kcal', kind: 'bar', points: bars }],
          refs: [],
          zeroBased: true,
          xLabels: offsetLabels(0, 6),
        }
      : null,
    weight: line.length >= MIN_TREND_POINTS
      ? {
          key: 'pattern-dose-weight',
          title: 'Scale against the dose-day weigh-in',
          unit: 'kg',
          series: [{ key: 'kg', label: 'kg', kind: 'line', points: line }],
          refs: [],
          zeroBased: false,
          xLabels: offsetLabels(r.days.find((d) => d.kgChange !== null)!.offset, [...r.days].reverse().find((d) => d.kgChange !== null)!.offset),
        }
      : null,
  };
}

// ── 2 · What each dose level did ─────────────────────────────

export interface DoseLevel {
  doseMg: number;
  /** Doses logged at this level — the weeks counted. */
  weeks: number;
  /** Average change on the scale per week; null under 3 weeks with one. */
  kgPerWeek: number | null;
  weightWeeks: number;
  /** Average of the logged days at this level; null under 3 days. */
  avgKcal: number | null;
  kcalDays: number;
}

/**
 * One row per dose level, in the order he first took them. A week runs
 * from a dose day to the day before the next dose, 7 days at most; a day
 * belongs to the dose before it, so the eve of a step up is still the old
 * level. Numbers only: nothing here ranks one level against another.
 */
export function doseLevels(doses: DoseIn[], diet: DietIn[], weights: WeighIn[], now: Date = new Date()): DoseLevel[] | null {
  const ds = doseDays(doses, now);
  if (!ds.length) return null;
  const acc = new Map<number, { weeks: number; changes: number[]; kcal: number[] }>();
  const level = (mg: number) => {
    const cur = acc.get(mg) ?? { weeks: 0, changes: [], kcal: [] };
    acc.set(mg, cur);
    return cur;
  };
  const byDay = weightByDay(weights, now);
  ds.forEach((dose, i) => {
    const l = level(dose.doseMg);
    l.weeks += 1;
    const end = i + 1 < ds.length ? Math.min(dose.day + 7, ds[i + 1].day) : dose.day + 7;
    const change = scaleChange(byDay, dose.day, end);
    if (change !== null) l.changes.push(change);
  });
  const last = activityToday(now);
  for (const row of diet) {
    if (row.kcal == null) continue;
    const day = storedDay(row.day);
    if (day > last) continue;
    const i = doseIndexFor(ds, day);
    if (i >= 0) level(ds[i].doseMg).kcal.push(row.kcal);
  }
  const rows = [...acc.entries()].map(([doseMg, l]) => ({
    doseMg,
    weeks: l.weeks,
    kgPerWeek: avgOrNull(l.changes, round1),
    weightWeeks: l.changes.length,
    avgKcal: avgOrNull(l.kcal, Math.round),
    kcalDays: l.kcal.length,
  }));
  return rows.some((r) => r.kgPerWeek !== null || r.avgKcal !== null) ? rows : null;
}

// ── 3 · Food and the scale ───────────────────────────────────

export interface FoodWeek {
  /** His Monday, YYYY-MM-DD. */
  weekStart: string;
  kcal: number;
  proteinG: number | null;
  days: number;
  /** kg per 7 days, first to last weigh-in of the week. */
  kgChange: number;
}
export interface FoodBucket { kcal: number; proteinG: number | null; kgChange: number; n: number }
export interface FoodAndScale {
  weeks: FoodWeek[];
  /** Six weeks or more: the lower and upper half, averaged (n ≥ 3 each).
   *  Four or five: the lightest and the fullest week, each a single week. */
  low: FoodBucket;
  high: FoodBucket;
}

/**
 * Weeks (his Monday to Sunday) with 5+ logged days and a change on the
 * scale: average kcal and protein beside that week's change. A week with
 * fewer logged days, or without two weigh-ins 5+ days apart (Monday to the
 * next Monday), is simply not counted. Null under four such weeks.
 */
export function foodAndScale(diet: DietIn[], weights: WeighIn[], now: Date = new Date()): FoodAndScale | null {
  const last = activityToday(now);
  const byWeek = new Map<number, { kcal: number[]; protein: number[] }>();
  for (const row of diet) {
    if (row.kcal == null) continue;
    const day = storedDay(row.day);
    if (day > last) continue;
    const monday = day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);
    const cur = byWeek.get(monday) ?? { kcal: [], protein: [] };
    cur.kcal.push(row.kcal);
    if (row.proteinG != null) cur.protein.push(row.proteinG);
    byWeek.set(monday, cur);
  }
  const byDay = weightByDay(weights, now);
  const weeks: FoodWeek[] = [];
  for (const [monday, w] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    if (w.kcal.length < MIN_WEEK_DAYS) continue;
    const change = scaleChange(byDay, monday, monday + 7);
    if (change === null) continue;
    weeks.push({
      weekStart: dayKey(monday),
      kcal: Math.round(mean(w.kcal)),
      proteinG: avgOrNull(w.protein, Math.round),
      days: w.kcal.length,
      kgChange: round1(change),
    });
  }
  if (weeks.length < MIN_TREND_POINTS) return null;
  const sorted = [...weeks].sort((a, b) => a.kcal - b.kcal);
  const single = (w: FoodWeek): FoodBucket => ({ kcal: w.kcal, proteinG: w.proteinG, kgChange: w.kgChange, n: 1 });
  const bucket = (ws: FoodWeek[]): FoodBucket => ({
    kcal: Math.round(mean(ws.map((w) => w.kcal)) / 50) * 50,
    proteinG: avgOrNull(ws.filter((w) => w.proteinG !== null).map((w) => w.proteinG as number), Math.round),
    kgChange: round1(mean(ws.map((w) => w.kgChange))),
    n: ws.length,
  });
  const half = Math.floor(sorted.length / 2);
  return half >= MIN_AVG
    ? { weeks, low: bucket(sorted.slice(0, half)), high: bucket(sorted.slice(-half)) }
    : { weeks, low: single(sorted[0]), high: single(sorted[sorted.length - 1]) };
}

/** Weekly kcal bars and the weekly change, over time. */
export function foodAndScaleCharts(r: FoodAndScale): { kcal: ChartSpec | null; weight: ChartSpec | null } {
  if (r.weeks.length < MIN_TREND_POINTS) return { kcal: null, weight: null };
  const t = (w: FoodWeek) => dayNum(w.weekStart) * DAY_MS;
  return {
    kcal: {
      key: 'pattern-week-kcal',
      title: 'Average kcal a day, by week',
      unit: 'kcal',
      series: [{ key: 'kcal', label: 'kcal', kind: 'bar', points: r.weeks.map((w) => ({ t: t(w), v: w.kcal })) }],
      refs: [],
      zeroBased: true,
    },
    weight: {
      key: 'pattern-week-weight',
      title: 'Change on the scale, by week',
      unit: 'kg a week',
      series: [{ key: 'kg', label: 'kg', kind: 'line', points: r.weeks.map((w) => ({ t: t(w), v: w.kgChange })) }],
      refs: [],
      zeroBased: false,
    },
  };
}

// ── 4 · Sleep and the next day ───────────────────────────────

export interface SleepSide {
  nights: number;
  /** Average of the day-after readings; null under 3 days with one. */
  bp: { systolic: number; diastolic: number; n: number } | null;
  /** Share of rated sets at Hard or above in that day's session; null
   *  under 3 sessions or 5 rated sets. */
  hard: { pct: number; sets: number; sessions: number } | null;
}
export interface SleepNextDay { long: SleepSide; short: SleepSide }

/**
 * Nights of 4 h or more on the mask against nights under 4 h: the BP of
 * the day the night ended, and that day's session. A night row is keyed
 * by the morning it ended, so "the next day" is the row's own day. Null
 * until each side has four nights.
 */
export function sleepAndNextDay(nights: NightIn[], bp: BpIn[], sessions: SessionIn[], now: Date = new Date()): SleepNextDay | null {
  const today = instantDay(now);
  const bpByDay = new Map<number, BpIn[]>();
  for (const r of bp) {
    const day = storedDay(ownerActivityDayUtc(new Date(r.at)));
    bpByDay.set(day, [...(bpByDay.get(day) ?? []), r]);
  }
  const ratedByDay = new Map<number, number[]>();
  for (const s of sessions) {
    const rated = s.rpes.filter((v): v is number => v != null && v > 0);
    if (!rated.length) continue;
    const day = storedDay(s.date);
    ratedByDay.set(day, [...(ratedByDay.get(day) ?? []), ...rated]);
  }
  const side = (rows: NightIn[]): SleepSide => {
    const sys: number[] = [];
    const dia: number[] = [];
    let sets = 0;
    let hard = 0;
    let sessionDays = 0;
    for (const n of rows) {
      const day = storedDay(n.night);
      const readings = bpByDay.get(day);
      if (readings) {
        sys.push(mean(readings.map((x) => x.systolic)));
        dia.push(mean(readings.map((x) => x.diastolic)));
      }
      const rated = ratedByDay.get(day);
      if (rated) {
        sessionDays += 1;
        sets += rated.length;
        hard += rated.filter((v) => v >= 3).length;
      }
    }
    return {
      nights: rows.length,
      bp: sys.length >= MIN_AVG ? { systolic: Math.round(mean(sys)), diastolic: Math.round(mean(dia)), n: sys.length } : null,
      hard: sessionDays >= MIN_AVG && sets >= MIN_SHARE_ITEMS ? { pct: Math.round((hard / sets) * 100), sets, sessions: sessionDays } : null,
    };
  };
  const reported = nights.filter((n) => storedDay(n.night) <= today);
  const long = reported.filter((n) => n.usageHours >= CPAP_ADHERENT_HOURS);
  const short = reported.filter((n) => n.usageHours < CPAP_ADHERENT_HOURS);
  if (long.length < MIN_SIDE_NIGHTS || short.length < MIN_SIDE_NIGHTS) return null;
  return { long: side(long), short: side(short) };
}

// ── 5 · Pressure and apnea as the weight falls ───────────────

export interface BpMonth { month: string; systolic: number; diastolic: number; kg: number }
export interface ApneaMonth { month: string; kg: number; ahi: number; press: number | null }
export interface MonthTrends {
  /** Months with 3+ readings and 2+ weigh-ins; null under two months. */
  bp: BpMonth[] | null;
  /** Months with 3+ measured nights and 2+ weigh-ins; null under two. */
  apnea: ApneaMonth[] | null;
}

/**
 * His calendar months, oldest first: BP beside weight, and AHI plus the
 * pressure the machine reached beside weight. Two months make rows; four
 * make a line (monthTrendCharts).
 */
export function monthTrends(bp: BpIn[], nights: NightIn[], weights: WeighIn[], now: Date = new Date()): MonthTrends | null {
  const past = weights.filter((w) => new Date(w.date).getTime() <= now.getTime());
  const bpRows = bpWeightStory(bp.filter((r) => new Date(r.at).getTime() <= now.getTime()), past);

  const kgBy = new Map<string, number[]>();
  for (const w of past) {
    if (w.weight == null) continue;
    const k = ownerMonthKey(new Date(w.date));
    kgBy.set(k, [...(kgBy.get(k) ?? []), w.weight]);
  }
  const ahiBy = new Map<string, number[]>();
  const pressBy = new Map<string, number[]>();
  const today = instantDay(now);
  for (const n of nights) {
    if (storedDay(n.night) > today) continue;
    // A night row is a bare date: its month is the key's own month.
    const k = new Date(n.night).toISOString().slice(0, 7);
    if (n.ahi != null) ahiBy.set(k, [...(ahiBy.get(k) ?? []), n.ahi]);
    if (n.p95Pressure != null) pressBy.set(k, [...(pressBy.get(k) ?? []), n.p95Pressure]);
  }
  const apneaRows: ApneaMonth[] = [...ahiBy.entries()]
    .filter(([k, v]) => v.length >= MIN_AVG && (kgBy.get(k)?.length ?? 0) >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      month: k,
      kg: round1(mean(kgBy.get(k) as number[])),
      ahi: round1(mean(v)),
      press: avgOrNull(pressBy.get(k) ?? [], round1),
    }));
  const apnea = apneaRows.length >= 2 ? apneaRows : null;
  return bpRows || apnea ? { bp: bpRows, apnea } : null;
}

const monthT = (month: string): number => Date.parse(`${month}-01T00:00:00Z`);
const monthEnds = (rows: Array<{ month: string }>) =>
  [rows[0], rows[rows.length - 1]].map((m) => ({ t: monthT(m.month), label: monthLabel(m.month) }));

/** Monthly points as lines — only with four months behind each line. */
export function monthTrendCharts(r: MonthTrends): { weight: ChartSpec | null; bp: ChartSpec | null; apnea: ChartSpec | null } {
  const bp = r.bp && r.bp.length >= MIN_TREND_POINTS ? r.bp : null;
  const apnea = r.apnea && r.apnea.length >= MIN_TREND_POINTS ? r.apnea : null;
  const kgRows: Array<{ month: string; kg: number }> | null =
    bp && apnea ? (apnea.length > bp.length ? apnea : bp) : bp ?? apnea;
  const press = apnea && apnea.every((m) => m.press !== null);
  return {
    weight: kgRows
      ? {
          key: 'pattern-month-weight',
          title: 'Weight, monthly average',
          unit: 'kg',
          series: [{ key: 'weight', label: 'Weight', kind: 'line', points: kgRows.map((m) => ({ t: monthT(m.month), v: m.kg })) }],
          refs: [],
          zeroBased: false,
          xLabels: monthEnds(kgRows),
        }
      : null,
    bp: bp
      ? {
          key: 'pattern-month-bp',
          title: 'Blood pressure, monthly average',
          unit: 'mmHg',
          series: [
            { key: 'systolic', label: 'Systolic', kind: 'line', points: bp.map((m) => ({ t: monthT(m.month), v: m.systolic })) },
            { key: 'diastolic', label: 'Diastolic', kind: 'line', points: bp.map((m) => ({ t: monthT(m.month), v: m.diastolic })) },
          ],
          refs: [],
          zeroBased: false,
          xLabels: monthEnds(bp),
        }
      : null,
    apnea: apnea
      ? {
          key: 'pattern-month-apnea',
          title: press ? 'AHI and machine pressure, monthly average' : 'AHI, monthly average',
          unit: press ? 'events/h · hPa' : 'events/h',
          series: [
            { key: 'ahi', label: 'AHI', kind: 'line' as const, points: apnea.map((m) => ({ t: monthT(m.month), v: m.ahi })) },
            ...(press
              ? [{ key: 'pressure', label: 'Pressure', kind: 'line' as const, points: apnea.map((m) => ({ t: monthT(m.month), v: m.press as number })) }]
              : []),
          ],
          refs: [],
          zeroBased: true,
          xLabels: monthEnds(apnea),
        }
      : null,
  };
}

// ── Words around the numbers (the page prints these as they are) ──

/** 1480 → "1,480". */
export const kcalLabel = (kcal: number): string => kcal.toLocaleString('en-US');

/** A change on the scale, signed: −0.9 → "−0.9 kg", 0.4 → "+0.4 kg". */
export const kgChangeLabel = (change: number): string => `${signedKg(-change)} kg`;

/** "2026-08-31" → "31 Aug" — a week is named by its Monday. */
export const weekLabel = (weekStart: string): string =>
  new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
