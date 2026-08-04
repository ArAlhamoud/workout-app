// Captures the in-workout heart-rate curve right after a save.
//
// The Watch has been recording HR the whole session; HealthKit holds the raw
// stream and the read permission was granted on day one. This joins that
// stream to the workout that was just logged — a join that exists nowhere
// else and cannot be rebuilt once the phone is gone (steward's rank-2 data).
//
// Fire-and-forget by contract: it runs after createWorkout succeeds, must
// never delay navigation, and every failure is silent — the next manual sync
// can fill avgHr/maxHr through the existing enrichment path anyway.

import { isNativeApp, queryQuantity } from './native-health';

const TOKEN_KEY = 'health-sync-token';
/** One bin per 15 s — plenty for a strength session's between-sets shape. */
const BIN_SECONDS = 15;
/** Raw-sample ceiling; Watch cadence over 3 h stays well under this. */
const SAMPLE_LIMIT = 20_000;

/** Average raw samples into [offsetSec, bpm] bins. Exported for tests. */
export function binHeartRate(
  samples: Array<{ value: number; dateISO: string }>,
  startISO: string,
  binSeconds: number = BIN_SECONDS,
): Array<[number, number]> {
  const start = new Date(startISO).getTime();
  if (Number.isNaN(start)) return [];
  const sums = new Map<number, { total: number; n: number }>();
  for (const s of samples) {
    const t = new Date(s.dateISO).getTime();
    if (Number.isNaN(t) || t < start) continue;
    if (!Number.isFinite(s.value) || s.value <= 20 || s.value >= 260) continue;
    const bin = Math.floor((t - start) / 1000 / binSeconds) * binSeconds;
    const cur = sums.get(bin) ?? { total: 0, n: 0 };
    cur.total += s.value;
    cur.n += 1;
    sums.set(bin, cur);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, { total, n }]) => [offset, Math.round(total / n)]);
}

export function captureWorkoutHr(workoutId: string, startISO: string, endISO: string): void {
  if (!isNativeApp()) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  void (async () => {
    try {
      const { samples } = await queryQuantity('heartRate', {
        startISO,
        endISO,
        limit: SAMPLE_LIMIT,
      });
      const bins = binHeartRate(samples, startISO);
      if (!bins.length) return; // No Watch on the wrist — nothing to store.
      await fetch('/api/health/hr-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workoutId, bins }),
      });
    } catch {
      /* silent by contract */
    }
  })();
}
