// The forgiving weekly streak — the streak primitive that fits a 2×/week
// A/B program and a man whose enemy is the gap, not the workout.
//
// Design rules, each one load-bearing (sources: Hevy's week streak, Fitbod's
// streak minus its fatal flaw, Gentler Streak's compassion, and Duolingo's
// own research that guilt-streaks drive abandonment):
//
//   - The unit is the WEEK (Monday-start). One session keeps a week alive.
//     A daily streak on a 2×/week program is designed to be lost.
//   - Forgiveness is banked: every 4 completed weeks earn 1 protected week,
//     spent automatically on an empty week. Sickness happens; the streak
//     should absorb it the way a body does.
//   - Hold weeks (declared maintenance) are excused entirely — a bounded
//     break he ASKED for must not cost the thing he is protecting.
//   - A broken week is MENDABLE: two sessions in the current week repair
//     last week's break. The "record's dead anyway" spiral — which turned
//     6 days into 43 — dies here.
//   - The display is never zero. After a true break the streak reads
//     "rebuilding · week 1", because zero is an argument for staying gone.
//
// Pure functions over (dates, excused weeks, now) — everything testable.

const WEEK_MS = 7 * 86_400_000;

/** Monday 00:00 local of the week containing d. */
export function weekStart(d: Date): Date {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (day.getDay() + 6) % 7; // Mon=0 … Sun=6
  day.setDate(day.getDate() - dow);
  return day;
}

/** "2026-08-03" — local Monday key for the week containing d. */
export function weekKeyOf(d: Date): string {
  const m = weekStart(d);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}

export interface StreakInput {
  /** Session dates (any order). Bare-UTC-day dates are treated as local days. */
  sessionDates: Array<Date | string>;
  /** Week keys excused outright (holds; sickness when known server-side). */
  excusedWeeks?: Set<string>;
  now?: Date;
}

export interface StreakState {
  /** Consecutive live weeks, counting protected + excused ones. */
  weeks: number;
  /** Protected weeks currently banked (1 earned per 4 trained weeks). */
  bank: number;
  /** Sessions logged in the current (incomplete) week. */
  thisWeekSessions: number;
  /**
   * 'alive'      — current or last week trained/protected/excused
   * 'mendable'   — last week broke; 2 sessions THIS week repair it
   * 'rebuilding' — truly broken; weeks counts up from the fresh start
   */
  status: 'alive' | 'mendable' | 'rebuilding';
  /** Sessions still needed this week to mend (0 unless mendable). */
  mendNeeds: number;
  /** One-line display honouring the never-zero rule. */
  label: string;
}

function toLocalDay(d: Date | string): Date {
  const parsed = typeof d === 'string' ? new Date(d) : d;
  // Bare UTC days ("2026-08-01T00:00:00Z") mean that calendar day, locally.
  if (
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0
  ) {
    return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }
  return parsed;
}

export function weekStreak({ sessionDates, excusedWeeks, now = new Date() }: StreakInput): StreakState {
  const excused = excusedWeeks ?? new Set<string>();
  const trained = new Set<string>();
  let earliest: number | null = null;
  for (const d of sessionDates) {
    const local = toLocalDay(d);
    if (Number.isNaN(local.getTime())) continue;
    trained.add(weekKeyOf(local));
    const monday = weekStart(local).getTime();
    if (earliest === null || monday < earliest) earliest = monday;
  }

  const currentKey = weekKeyOf(now);
  const currentMonday = weekStart(now).getTime();
  const thisWeekSessions = sessionDates.filter((d) => {
    const local = toLocalDay(d);
    return !Number.isNaN(local.getTime()) && weekKeyOf(local) === currentKey;
  }).length;

  // Nothing ever trained: rebuilding from the very start, never a zero.
  if (earliest === null) {
    return {
      weeks: 0,
      bank: 0,
      thisWeekSessions: 0,
      status: 'rebuilding',
      mendNeeds: 0,
      label: 'rebuilding · week 1',
    };
  }

  // FORWARD pass from the first trained week to last week. Forward, not
  // backward: bank protection is earned by weeks OLDER than the gap it
  // covers, which a reverse walk cannot know yet when it meets the gap.
  // The current week never breaks anything — it is not over.
  let run = 0; // current unbroken run, in weeks
  let trainedInRun = 0;
  let bank = 0;
  let lastBreak: number | null = null; // Monday ms of the newest break
  for (let t = earliest; t < currentMonday; t += WEEK_MS) {
    const key = weekKeyOf(new Date(t));
    if (trained.has(key)) {
      run++;
      trainedInRun++;
      if (trainedInRun % 4 === 0) bank++;
    } else if (excused.has(key)) {
      run++; // excused weeks extend the run but earn nothing
    } else if (bank > 0) {
      bank--;
      run++;
    } else {
      // Record only the TRANSITION into a break: mendable means the break is
      // exactly one week old, so a months-old break must not keep re-dating
      // itself to "last week" on every empty week that follows.
      if (run > 0) lastBreak = t;
      run = 0;
      trainedInRun = 0;
      bank = 0;
    }
  }
  const weeksBeforeCurrent = run;
  const weeks = weeksBeforeCurrent + (trained.has(currentKey) ? 1 : 0);

  const lastWeekMonday = currentMonday - WEEK_MS;
  if (lastBreak === lastWeekMonday) {
    // The dangerous moment: the break is exactly one week old. Two sessions
    // this week stitch it closed — recount with last week excused.
    if (thisWeekSessions >= 2) {
      const mended = weekStreak({
        sessionDates,
        excusedWeeks: new Set([...excused, weekKeyOf(new Date(lastWeekMonday))]),
        now,
      });
      return { ...mended, label: `${mended.weeks} wk streak · mended` };
    }
    const needs = 2 - thisWeekSessions;
    // Show the streak that is WAITING to be repaired, not a zero. It is the
    // stake on the table, and the stake is the motivator.
    const atStake = (() => {
      const counterfactual = weekStreak({
        sessionDates,
        excusedWeeks: new Set([...excused, weekKeyOf(new Date(lastWeekMonday))]),
        now,
      });
      return counterfactual.weeks;
    })();
    return {
      weeks: atStake,
      bank: 0,
      thisWeekSessions,
      status: 'mendable',
      mendNeeds: needs,
      label: `${atStake} wk streak on the line · ${needs} session${needs === 1 ? '' : 's'} this week saves it`,
    };
  }

  if (weeks === 0) {
    // Break older than a week: honest fresh start, never a zero.
    return {
      weeks: 1,
      bank: 0,
      thisWeekSessions,
      status: 'rebuilding',
      mendNeeds: 0,
      label: thisWeekSessions > 0 ? 'rebuilding · week 1 ✓' : 'rebuilding · week 1',
    };
  }

  return {
    weeks,
    bank,
    thisWeekSessions,
    status: 'alive',
    mendNeeds: 0,
    label: `${weeks} wk streak${bank > 0 ? ` · ${bank} protected` : ''}`,
  };
}

/** Every Monday key a hold window touches — those weeks are excused. */
export function holdWeekKeys(
  holds: Array<{ startsAt: Date | string; endsAt: Date | string }>,
): Set<string> {
  const keys = new Set<string>();
  for (const h of holds) {
    const start = new Date(h.startsAt).getTime();
    const end = new Date(h.endsAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    for (let t = start; t <= end; t += 86_400_000) keys.add(weekKeyOf(new Date(t)));
  }
  return keys;
}

// ── Lifetime milestones — numbers a gap can never take away ──

export interface LifetimeStats {
  sessions: number;
  /** Total kg moved: Σ weight × reps over working sets. */
  tonnageKg: number;
  label: string;
}

export function lifetimeStats(
  workouts: Array<{ sets: Array<{ weight: number; reps: number; isWarmup?: boolean }> }>,
): LifetimeStats {
  let tonnage = 0;
  for (const w of workouts) {
    for (const s of w.sets) {
      if (s.isWarmup) continue;
      if (s.weight > 0 && s.reps > 0) tonnage += s.weight * s.reps;
    }
  }
  const tonnageKg = Math.round(tonnage);
  const label =
    tonnageKg >= 1_000_000
      ? `${(tonnageKg / 1_000_000).toFixed(2)}M kg lifted`
      : `${Math.round(tonnageKg / 1000)} t lifted`;
  return { sessions: workouts.length, tonnageKg, label };
}
