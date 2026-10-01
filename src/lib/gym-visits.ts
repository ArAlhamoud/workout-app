/**
 * Gym visits, door to door (owner, 2026-10-01: "a check in and out for the
 * gym — the average duration of the gym, including shower and swimming,
 * categorised for 30, 45 and 60 min workouts").
 *
 * Pure logic, no database. A visit is two manual taps, both editable in
 * 5-minute steps. The workout a visit belongs to is matched at READ time by
 * the owner's activity day (04:00 Riyadh rollover, the clock sessions use)
 * and the gym, so correcting either row never leaves a stale link.
 */
import { ownerActivityDayUtc } from './health-insights';
import { DEFAULT_GYM_ID, isTrainingSession } from './program';

const MIN = 60_000;

/** A visit still open after this long is "forgot to check out": it is
 *  shown for fixing and kept out of every average until it is closed. */
export const VISIT_STALE_MS = 6 * 60 * MIN;

/** Shortest and longest visit an average will believe. */
export const VISIT_MIN_MIN = 5;
export const VISIT_MAX_MIN = 300;

/** The step the time buttons move a check-in or check-out by. */
export const ADJUST_STEP_MIN = 5;

export type VisitCategory = '30' | '45' | '60' | 'lift' | 'rescue' | 'cardio' | 'none';

export const CATEGORY_LABEL: Record<VisitCategory, string> = {
  '30': '30 min workout',
  '45': '45 min workout',
  '60': '60 min workout',
  lift: 'Workout, length unknown',
  rescue: 'Rescue session',
  cardio: 'Swim or walk only',
  none: 'Nothing logged',
};

/** Display order: the three workout lengths first, as he asked. */
export const CATEGORY_ORDER: VisitCategory[] = ['30', '45', '60', 'lift', 'rescue', 'cardio', 'none'];

export interface VisitLite {
  id: string;
  gym: string;
  checkInAt: Date | string;
  checkOutAt: Date | string | null;
}

export interface WorkoutLite {
  name: string;
  date: Date | string;
  gym: string | null;
  /** Seconds. */
  duration: number | null;
  sets?: Array<{ rpe?: number | null; isWarmup?: boolean | null }> | null;
}

const t = (d: Date | string) => new Date(d).getTime();

/** Minutes between the taps, or null while the visit is open. */
export function visitMinutes(v: VisitLite): number | null {
  if (!v.checkOutAt) return null;
  return Math.round((t(v.checkOutAt) - t(v.checkInAt)) / MIN);
}

export function isStale(v: VisitLite, now: Date = new Date()): boolean {
  return !v.checkOutAt && now.getTime() - t(v.checkInAt) > VISIT_STALE_MS;
}

/** Day + building key. Untagged history is B_Fit (rule 2). */
const dayGymKey = (dayMs: number, gym: string | null) => `${dayMs}|${gym ?? DEFAULT_GYM_ID}`;
const visitKey = (v: VisitLite) => dayGymKey(ownerActivityDayUtc(new Date(v.checkInAt)).getTime(), v.gym);

const LENGTH = /\b(30|45|60)m\b/;

/** Swims and walks are never the lifting session, whatever rows they carry
 *  (the same names isTrainingSession treats as cardio). */
const CARDIO = /^(Rescue walk|Walk |Swim )/;
const isLift = (w: WorkoutLite) => !CARDIO.test(w.name) && isTrainingSession(w);

/** A session's length: its template name ("Day A 45m"), else its own timer
 *  to the nearest of 30/45/60 (Watch and renamed sessions carry no length
 *  in the name — adversary, 2026-10-01), else unknown. */
function lengthOf(w: WorkoutLite): VisitCategory {
  const m = w.name.match(LENGTH);
  if (m) return m[1] as VisitCategory;
  if (w.duration && w.duration > 0) {
    const min = w.duration / 60;
    return min < 37.5 ? '30' : min < 52.5 ? '45' : '60';
  }
  return 'lift';
}

export interface VisitClass {
  category: VisitCategory;
  liftMin: number | null;
}

/**
 * What each visit was for. A lifting session decides it by its length; a
 * rescue is its own row; swims and walks alone are "cardio"; a visit with
 * nothing logged is "none". On a day with two visits to one building, the
 * lifting session belongs to ONE of them — the longest — so a morning swim
 * never claims the evening's workout. Workouts are grouped by day once
 * (not visits × workouts: that took 16 s on /stats at 250 × 400).
 */
export function classifyVisits(visits: VisitLite[], workouts: WorkoutLite[]): Map<string, VisitClass> {
  const byKey = new Map<string, WorkoutLite[]>();
  for (const w of workouts) {
    const k = dayGymKey(t(w.date), w.gym);
    const list = byKey.get(k);
    if (list) list.push(w);
    else byKey.set(k, [w]);
  }
  const visitsByKey = new Map<string, VisitLite[]>();
  for (const v of visits) {
    const k = visitKey(v);
    const list = visitsByKey.get(k);
    if (list) list.push(v);
    else visitsByKey.set(k, [v]);
  }
  const out = new Map<string, VisitClass>();
  for (const [k, vs] of visitsByKey) {
    const same = byKey.get(k) ?? [];
    const training = same.filter(isLift);
    const lift = training.find((w) => !w.name.startsWith('Rescue')) ?? training[0];
    const owner = lift
      ? vs.reduce((best, v) => ((visitMinutes(v) ?? 0) > (visitMinutes(best) ?? 0) ? v : best), vs[0])
      : null;
    const others = same.some((w) => !isLift(w));
    for (const v of vs) {
      if (lift && v === owner) {
        const liftMin = lift.duration ? Math.round(lift.duration / 60) : null;
        out.set(v.id, { category: lift.name.startsWith('Rescue') ? 'rescue' : lengthOf(lift), liftMin });
      } else {
        out.set(v.id, { category: others ? 'cardio' : 'none', liftMin: null });
      }
    }
  }
  return out;
}

/** One visit on its own (no other visit that day to share the session with). */
export function classifyVisit(v: VisitLite, workouts: WorkoutLite[]): VisitClass {
  return classifyVisits([v], workouts).get(v.id)!;
}

export interface CategoryStats {
  category: VisitCategory;
  label: string;
  visits: number;
  /** Door to door. Null below two visits — a single visit is not an average. */
  avgVisitMin: number | null;
  /** The session timer. Null when no visit in the row carried one. */
  avgLiftMin: number | null;
  /** Everything else: changing, shower, swim, the walk to the car. */
  avgOtherMin: number | null;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Averages per category over closed, believable visits. */
export function gymTimeStats(visits: VisitLite[], workouts: WorkoutLite[]): CategoryStats[] {
  const believable = visits.filter((v) => {
    const mins = visitMinutes(v);
    return mins != null && mins >= VISIT_MIN_MIN && mins <= VISIT_MAX_MIN;
  });
  const classes = classifyVisits(believable, workouts);
  const rows = new Map<VisitCategory, { visit: number[]; lift: number[]; other: number[] }>();
  for (const v of believable) {
    const mins = visitMinutes(v)!;
    const { category, liftMin } = classes.get(v.id)!;
    const r = rows.get(category) ?? { visit: [], lift: [], other: [] };
    r.visit.push(mins);
    if (liftMin != null && liftMin <= mins) {
      r.lift.push(liftMin);
      r.other.push(mins - liftMin);
    }
    rows.set(category, r);
  }
  return CATEGORY_ORDER.filter((c) => rows.has(c)).map((c) => {
    const r = rows.get(c)!;
    const enough = r.visit.length >= 2;
    // The split only when EVERY visit in the row carries it: otherwise
    // "lift + other" would average different visits than the headline
    // and not add up to it (adversary, 2026-10-01).
    const split = enough && r.lift.length === r.visit.length;
    return {
      category: c,
      label: CATEGORY_LABEL[c],
      visits: r.visit.length,
      avgVisitMin: enough ? avg(r.visit) : null,
      avgLiftMin: split ? avg(r.lift) : null,
      avgOtherMin: split ? avg(r.other) : null,
    };
  });
}

/**
 * A time button press, kept honest: check-in never after check-out (or
 * after now while open), check-out never before check-in + 1 minute or
 * after now, and the visit never longer than VISIT_MAX_MIN. Returns the
 * new time, or null when the move is not allowed.
 */
export function adjustedTime(
  v: VisitLite,
  field: 'checkInAt' | 'checkOutAt',
  deltaMin: number,
  now: Date = new Date(),
): Date | null {
  const inMs = t(v.checkInAt);
  const outMs = v.checkOutAt ? t(v.checkOutAt) : null;
  if (field === 'checkOutAt' && outMs == null) return null;
  const next = (field === 'checkInAt' ? inMs : outMs!) + deltaMin * MIN;
  if (next > now.getTime()) return null;
  // A move may not create an over-long visit, but one that SHORTENS an
  // already over-long visit is always allowed, or a visit closed hours
  // late could never be fixed (data-steward, 2026-10-01).
  if (field === 'checkInAt') {
    const end = outMs ?? now.getTime();
    if (next >= end) return null;
    const before = end - inMs;
    if (end - next > VISIT_MAX_MIN * MIN && end - next >= before) return null;
  } else {
    if (next < inMs + MIN) return null;
    const before = outMs! - inMs;
    if (next - inMs > VISIT_MAX_MIN * MIN && next - inMs >= before) return null;
  }
  return new Date(next);
}

/** "1 h 12" / "48 min" */
export function fmtVisit(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
