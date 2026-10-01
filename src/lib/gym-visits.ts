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

export type VisitCategory = '30' | '45' | '60' | 'rescue' | 'cardio' | 'none';

export const CATEGORY_LABEL: Record<VisitCategory, string> = {
  '30': '30 min workout',
  '45': '45 min workout',
  '60': '60 min workout',
  rescue: 'Rescue session',
  cardio: 'Swim or walk only',
  none: 'Nothing logged',
};

/** Display order: the three workout lengths first, as he asked. */
export const CATEGORY_ORDER: VisitCategory[] = ['30', '45', '60', 'rescue', 'cardio', 'none'];

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

/** Same activity day and the same building. Untagged history is B_Fit (rule 2). */
function sameVisit(v: VisitLite, w: WorkoutLite): boolean {
  const day = ownerActivityDayUtc(new Date(v.checkInAt)).getTime();
  return t(w.date) === day && (w.gym ?? DEFAULT_GYM_ID) === v.gym;
}

const LENGTH = /\b(30|45|60)m\b/;

/**
 * What the visit was for. A lifting session decides it by its template
 * length ("Day A 45m"); a rescue is its own row; swims and walks alone are
 * "cardio"; a visit with nothing logged is "none". The lifting minutes come
 * from the session's own timer.
 */
export function classifyVisit(
  v: VisitLite,
  workouts: WorkoutLite[],
): { category: VisitCategory; liftMin: number | null } {
  const same = workouts.filter((w) => sameVisit(v, w));
  const training = same.filter((w) => isTrainingSession(w));
  const lift = training.find((w) => LENGTH.test(w.name)) ?? training[0];
  const liftMin = lift?.duration ? Math.round(lift.duration / 60) : null;
  if (lift) {
    if (lift.name.startsWith('Rescue')) return { category: 'rescue', liftMin };
    const m = lift.name.match(LENGTH);
    if (m) return { category: m[1] as VisitCategory, liftMin };
  }
  if (same.length) return { category: 'cardio', liftMin: null };
  return { category: 'none', liftMin: null };
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
  const rows = new Map<VisitCategory, { visit: number[]; lift: number[]; other: number[] }>();
  for (const v of visits) {
    const mins = visitMinutes(v);
    if (mins == null || mins < VISIT_MIN_MIN || mins > VISIT_MAX_MIN) continue;
    const { category, liftMin } = classifyVisit(v, workouts);
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
    return {
      category: c,
      label: CATEGORY_LABEL[c],
      visits: r.visit.length,
      avgVisitMin: enough ? avg(r.visit) : null,
      avgLiftMin: enough ? avg(r.lift) : null,
      avgOtherMin: enough ? avg(r.other) : null,
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
  if (field === 'checkInAt') {
    const end = outMs ?? now.getTime();
    if (next >= end) return null;
    if (end - next > VISIT_MAX_MIN * MIN) return null;
  } else {
    if (next < inMs + MIN) return null;
    if (next - inMs > VISIT_MAX_MIN * MIN) return null;
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
