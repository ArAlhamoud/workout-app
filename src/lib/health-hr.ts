// Stores the downsampled in-workout heart-rate curve the native shell
// captures after a save. This is the highest-value irreplaceable data in the
// system: the join between HealthKit's HR stream and this app's sets exists
// nowhere else, and cannot be reconstructed once the phone is gone.
//
// Contract (steward's rules):
// - fill-null-only: an existing series is never clobbered; re-runs are no-ops
// - bounded: bins are capped server-side regardless of what the client sends
// - avg/max fall out of the same bins, also fill-null-only

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';

/** 15 s bins × 3 h is 720 — anything past this is not a strength session. */
const MAX_BINS = 800;

interface Payload {
  workoutId?: unknown;
  /** [[offsetSec, bpm], ...] ascending. */
  bins?: unknown;
}

export async function storeHrSeries(payload: Payload) {
  const workoutId = typeof payload.workoutId === 'string' ? payload.workoutId : null;
  const rawBins = Array.isArray(payload.bins) ? payload.bins : null;
  if (!workoutId || !rawBins) {
    return { stored: false, reason: 'expected { workoutId, bins }' };
  }

  const bins = rawBins
    .filter(
      (b): b is [number, number] =>
        Array.isArray(b) &&
        b.length === 2 &&
        Number.isFinite(b[0]) &&
        Number.isFinite(b[1]) &&
        b[0] >= 0 &&
        b[1] > 20 &&
        b[1] < 260,
    )
    .slice(0, MAX_BINS)
    .map(([off, bpm]) => [Math.round(off), Math.round(bpm)]);

  if (!bins.length) return { stored: false, reason: 'no valid bins' };

  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    select: { id: true, hrSeries: true, avgHr: true, maxHr: true },
  });
  if (!workout) return { stored: false, reason: 'unknown workout' };

  // Fill-null-only — a re-run (outbox replay, double sync) changes nothing.
  if (workout.hrSeries !== null) return { stored: false, reason: 'already present' };

  const bpms = bins.map(([, bpm]) => bpm);
  const avg = Math.round(bpms.reduce((s, v) => s + v, 0) / bpms.length);
  const max = Math.max(...bpms);

  await prisma.workout.update({
    where: { id: workoutId },
    data: {
      hrSeries: bins,
      ...(workout.avgHr === null ? { avgHr: avg } : {}),
      ...(workout.maxHr === null ? { maxHr: max } : {}),
    },
  });

  revalidatePath('/stats');
  return { stored: true, bins: bins.length, avgHr: avg, maxHr: max };
}
