// Writes logged sessions into Apple Health — the ONE place it happens. The
// autopilot and the Stats card each had their own copy of this loop, and
// neither looked at what Health already held (review, 2026-09-24).
//
// Client-side: it talks to HealthKit through the Capacitor bridge.

import { coveredByExisting } from './health';
import { queryWorkouts, queryWorkoutStats, saveWorkout } from './native-health';

export interface HealthPushCandidate {
  id: string;
  name: string;
  start: string;
  durationMin: number;
}

export interface HealthPushSample {
  type: 'heart_rate' | 'active_energy';
  value: number;
  max?: number;
  unit: string;
  date: string;
}

export interface HealthPushOutcome {
  /** Written to Health on this run. */
  savedIds: string[];
  /** Health already held a workout over this window; marked, never written twice. */
  alreadyIds: string[];
  /** HR / energy read back out of Health for each window, to enrich the rows. */
  enrichment: HealthPushSample[];
  errors: string[];
}

/** How far before the earliest window to look for overlapping Health workouts. */
const LOOKBACK_MS = 6 * 3_600_000;

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The three bridge calls the push makes; replaceable so the suite can
 *  run two pushes against one pretend Health store. */
export interface HealthPushBridge {
  queryWorkouts: typeof queryWorkouts;
  queryWorkoutStats: typeof queryWorkoutStats;
  saveWorkout: typeof saveWorkout;
}
const nativeBridge: HealthPushBridge = { queryWorkouts, queryWorkoutStats, saveWorkout };

// ONE push at a time. The autopilot and "Sync now" each ran this
// check-then-write on their own: both could read Health before either
// wrote, and the same session went in twice — a write the app can never
// undo (rule 11; review, 2026-10-02). A later call waits for the one in
// flight and only then reads Health, so it sees what that one wrote.
let pushChain: Promise<unknown> = Promise.resolve();

export function pushWorkoutsToHealth(
  candidates: HealthPushCandidate[],
  bridge: HealthPushBridge = nativeBridge,
): Promise<HealthPushOutcome> {
  const run = pushChain.then(() => pushOnce(candidates, bridge));
  pushChain = run.catch(() => undefined);
  return run;
}

/** Windows written since the page loaded, in case Health's own query has
 *  not caught up with a save that just returned. */
const writtenThisLoad: Array<{ startISO: string; endISO: string; activityType?: string }> = [];

async function pushOnce(candidates: HealthPushCandidate[], bridge: HealthPushBridge): Promise<HealthPushOutcome> {
  const { queryWorkouts, queryWorkoutStats, saveWorkout } = bridge;
  const out: HealthPushOutcome = { savedIds: [], alreadyIds: [], enrichment: [], errors: [] };
  if (!candidates.length) return out;

  const earliest = Math.min(...candidates.map((c) => Date.parse(c.start)));
  let existing: Array<{ startISO: string; endISO: string; activityType?: string }>;
  try {
    existing = [...(await queryWorkouts(new Date(earliest - LOOKBACK_MS).toISOString())), ...writtenThisLoad];
  } catch (e) {
    // Without seeing what Health already holds, write nothing this run: a
    // missed write retries on the next open; a duplicate never goes away.
    out.errors.push(`health check: ${why(e)}`);
    return out;
  }

  for (const c of candidates) {
    const start = Date.parse(c.start);
    const end = start + c.durationMin * 60_000;
    const endISO = new Date(end).toISOString();
    try {
      const stats = await queryWorkoutStats(c.start, endISO);
      if (stats.avgHr !== null) {
        // The window's real max rides along; alone, the average became maxHr.
        out.enrichment.push({ type: 'heart_rate', value: stats.avgHr, max: stats.maxHr ?? undefined, unit: 'count/min', date: c.start });
      }
      if (stats.activeKcal !== null && stats.activeKcal > 0) {
        out.enrichment.push({ type: 'active_energy', value: stats.activeKcal, unit: 'kcal', date: c.start });
      }
    } catch (e) {
      out.errors.push(`stats: ${why(e)}`);
    }
    if (coveredByExisting({ start, end }, existing)) {
      out.alreadyIds.push(c.id);
      continue;
    }
    try {
      // No energy value, on purpose. Energy READ out of Health for this window
      // and written back as a new workout double-counts a session the Watch
      // already logged; no value is more honest than a wrong one.
      await saveWorkout({ startISO: c.start, endISO, name: c.name });
      out.savedIds.push(c.id);
      // Two candidates in one run can never both land on the same window.
      const written = { startISO: c.start, endISO, activityType: 'traditionalStrengthTraining' };
      existing = [...existing, written];
      writtenThisLoad.push(written);
    } catch (e) {
      out.errors.push(`save: ${why(e)}`);
    }
  }
  return out;
}
