// Month in Iron — Strava's recap energy, generated locally, for one man.
// A December mode aggregates the year through the same renderer's data
// shape, which is what makes the Year in Iron cost an afternoon.

import { weightTrend, type CoachBodyStat, type CoachWorkout } from './coach';
import { lifetimeStats } from './streak';

export interface RecapPeriod {
  /** "August 2026" or "2026". */
  title: string;
  sessions: number;
  tonnageKg: number;
  /** Exercises whose best working weight rose inside the period. */
  liftsProgressed: Array<{ name: string; fromKg: number; toKg: number }>;
  /** Trend-weight change across the period (negative = lost). */
  weightDeltaKg: number | null;
  /** The single line the card leads with. */
  headline: string;
}

interface RecapWorkout extends CoachWorkout {
  gym?: string | null;
}

function inRange(d: Date | string, start: Date, end: Date): boolean {
  const t = new Date(d).getTime();
  return t >= start.getTime() && t < end.getTime();
}

function bestPerExercise(
  workouts: CoachWorkout[],
): Map<string, { name: string; best: number }> {
  const best = new Map<string, { name: string; best: number }>();
  for (const w of workouts) {
    for (const s of w.sets) {
      if (s.isWarmup || s.weight <= 0) continue;
      const cur = best.get(s.exerciseId);
      if (!cur || s.weight > cur.best) best.set(s.exerciseId, { name: s.exercise.name, best: s.weight });
    }
  }
  return best;
}

export function buildRecap(
  workouts: RecapWorkout[],
  bodyStats: CoachBodyStat[],
  start: Date,
  end: Date,
  title: string,
): RecapPeriod | null {
  const period = workouts.filter((w) => inRange(w.date, start, end));
  if (!period.length) return null;

  const { tonnageKg } = lifetimeStats(period);

  // Progress = the period's best beat everything before the period.
  const before = bestPerExercise(workouts.filter((w) => new Date(w.date).getTime() < start.getTime()));
  const during = bestPerExercise(period);
  const liftsProgressed: RecapPeriod['liftsProgressed'] = [];
  for (const [id, entry] of during) {
    const prior = before.get(id);
    if (prior && entry.best > prior.best) {
      liftsProgressed.push({ name: entry.name, fromKg: prior.best, toKg: entry.best });
    }
  }
  liftsProgressed.sort((a, b) => b.toKg - b.fromKg - (a.toKg - a.fromKg));

  const statsBefore = bodyStats.filter((s) => new Date(s.date).getTime() < start.getTime());
  const statsThrough = bodyStats.filter((s) => new Date(s.date).getTime() < end.getTime());
  const emaBefore = weightTrend(statsBefore).ema;
  const emaAfter = weightTrend(statsThrough).ema;
  const weightDeltaKg =
    emaBefore !== null && emaAfter !== null ? Math.round((emaAfter - emaBefore) * 10) / 10 : null;

  const parts: string[] = [`${period.length} session${period.length === 1 ? '' : 's'}`];
  if (tonnageKg > 0) parts.push(`${Math.round(tonnageKg / 1000)} t moved`);
  if (weightDeltaKg !== null && weightDeltaKg < 0) parts.push(`${Math.abs(weightDeltaKg)} kg down`);
  if (liftsProgressed.length) parts.push(`${liftsProgressed.length} lifts up`);

  return {
    title,
    sessions: period.length,
    tonnageKg,
    liftsProgressed: liftsProgressed.slice(0, 5),
    weightDeltaKg,
    headline: parts.join(' · '),
  };
}

/** The most recent COMPLETE calendar month. */
export function lastMonthRecap(
  workouts: RecapWorkout[],
  bodyStats: CoachBodyStat[],
  now: Date = new Date(),
): RecapPeriod | null {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const title = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return buildRecap(workouts, bodyStats, start, end, title);
}

/** Year in Iron — surfaced in December and January. */
export function yearRecap(
  workouts: RecapWorkout[],
  bodyStats: CoachBodyStat[],
  now: Date = new Date(),
): RecapPeriod | null {
  const month = now.getMonth();
  if (month !== 11 && month !== 0) return null;
  const year = month === 11 ? now.getFullYear() : now.getFullYear() - 1;
  return buildRecap(
    workouts,
    bodyStats,
    new Date(year, 0, 1),
    new Date(year + 1, 0, 1),
    `${year} in Iron`,
  );
}
