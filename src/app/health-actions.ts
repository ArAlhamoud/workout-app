'use server';

// Apple Health sync, as server actions rather than REST endpoints.
//
// These used to be /api/health/{import,workouts,detect,hr-series}, guarded by a
// bearer token the owner had to paste into the app after every reinstall. The
// token existed because those were public HTTP endpoints — the guard's own
// comment called it "not auth, a data integrity check so only the owner's
// Shortcuts can write".
//
// He does not use Shortcuts. The only caller was the app itself, which is
// same-origin with this server and needs no token to reach a server action. So
// the endpoints are gone, the token is gone, and the setup step went with them.

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { importHealthSamples } from '@/lib/health-import';
import { detectUnloggedWorkouts } from '@/lib/health-detect';
import { storeHrSeries } from '@/lib/health-hr';

// Strength-training estimate for a ~133 kg trainee.
const KCAL_PER_MIN = 7;
const DEFAULT_DURATION_MIN = 60;

/** Apple Health samples → BodyStats, HealthSamples, and workout enrichment. */
export async function importHealth(payload: unknown) {
  return importHealthSamples(payload);
}

/** HealthKit sessions the log doesn't have yet. */
export async function detectUnlogged(payload: unknown) {
  return detectUnloggedWorkouts(payload);
}

/** A workout's downsampled heart-rate curve. */
export async function saveHrSeries(payload: { workoutId?: string; bins?: unknown }) {
  return storeHrSeries(payload as Parameters<typeof storeHrSeries>[0]);
}

/** Workouts logged here but not yet written to Apple Health. */
export async function getWorkoutsToPush() {
  const workouts = await prisma.workout.findMany({
    where: { healthSyncedAt: null },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true, duration: true },
  });

  return workouts.map((w) => {
    const durationMin = w.duration ? Math.max(1, Math.round(w.duration / 60)) : DEFAULT_DURATION_MIN;
    return {
      id: w.id,
      name: w.name,
      start: w.date.toISOString(),
      durationMin,
      /**
       * App-side estimate. Deliberately NOT written to HealthKit — the Watch
       * already logs energy for the same window, and writing this on top
       * double-counts the session.
       */
      estKcal: Math.round(durationMin * KCAL_PER_MIN),
    };
  });
}

/** Mark workouts as pushed. Only ever moves null → now, never back. */
export async function markWorkoutsPushed(ids: string[]) {
  if (!Array.isArray(ids) || !ids.length) return { marked: 0 };
  const clean = ids.filter((id): id is string => typeof id === 'string');
  if (!clean.length) return { marked: 0 };

  const result = await prisma.workout.updateMany({
    where: { id: { in: clean }, healthSyncedAt: null },
    data: { healthSyncedAt: new Date() },
  });
  if (result.count) {
    revalidatePath('/');
    revalidatePath('/stats');
  }
  return { marked: result.count };
}
