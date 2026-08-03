'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function getExercises() {
  return prisma.exercise.findMany({ orderBy: { name: 'asc' } });
}

export async function createExercise(formData: FormData) {
  const name = formData.get('name') as string;
  const category = formData.get('category') as string;
  await prisma.exercise.create({ data: { name, category } });
  revalidatePath('/exercises');
}

export async function deleteExercise(id: string) {
  await prisma.exercise.delete({ where: { id } });
  revalidatePath('/exercises');
}

export async function getWorkouts() {
  return prisma.workout.findMany({
    orderBy: { date: 'desc' },
    include: { sets: { include: { exercise: true } } },
  });
}

export async function getWorkout(id: string) {
  return prisma.workout.findUnique({
    where: { id },
    include: {
      sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } },
    },
  });
}

export async function createWorkout(data: {
  name: string;
  date: string;
  gym?: string;
  notes?: string;
  duration?: number;
  /**
   * UUID of the Apple Health workout this session was logged FROM, when the
   * logger was opened off the auto-detect list. Storing it is what stops the
   * same HKWorkout being offered again on the next visit — without it the
   * detect route has to fall back on same-day matching.
   */
  healthWorkoutUuid?: string;
  sets: Array<{
    exerciseId: string;
    setNumber: number;
    reps: number;
    weight: number;
    notes?: string;
    rpe?: number;
    /** ISO instant the set was ticked done in the logger, when it was. */
    completedAt?: string;
  }>;
}) {
  const workout = await prisma.workout.create({
    data: {
      name: data.name,
      date: new Date(data.date),
      gym: data.gym || null,
      notes: data.notes || null,
      duration: data.duration ?? null,
      healthWorkoutUuid: data.healthWorkoutUuid || null,
      sets: {
        create: data.sets.map((s) => ({
          ...s,
          completedAt: s.completedAt ? new Date(s.completedAt) : null,
        })),
      },
    },
  });
  revalidatePath('/workouts');
  revalidatePath('/');
  return { id: workout.id };
}

export async function deleteWorkout(id: string) {
  await prisma.workout.delete({ where: { id } });
  revalidatePath('/workouts');
  revalidatePath('/');
  redirect('/workouts');
}

export async function getLastSessionForExercises(
  exerciseIds: string[],
): Promise<Record<string, { weight: number; reps: number; rpe: number | null }>> {
  if (!exerciseIds.length) return {};
  const lastSets = await prisma.workoutSet.findMany({
    where: { exerciseId: { in: exerciseIds } },
    orderBy: [{ workout: { date: 'desc' } }, { setNumber: 'desc' }],
    distinct: ['exerciseId'],
    select: { exerciseId: true, weight: true, reps: true, rpe: true },
  });
  return lastSets.reduce<Record<string, { weight: number; reps: number; rpe: number | null }>>((acc, s) => {
    acc[s.exerciseId] = { weight: s.weight, reps: s.reps, rpe: s.rpe };
    return acc;
  }, {});
}

export async function getPersonalRecords(): Promise<Record<string, number>> {
  const records = await prisma.workoutSet.groupBy({
    by: ['exerciseId'],
    _max: { weight: true },
  });
  return records.reduce<Record<string, number>>((acc, r) => {
    if (r._max.weight !== null) acc[r.exerciseId] = r._max.weight;
    return acc;
  }, {});
}

export async function getExerciseHistory(exerciseId: string) {
  const exercise = await prisma.exercise.findUnique({
    where: { id: exerciseId },
    select: { name: true, category: true },
  });
  if (!exercise) return null;

  const sets = await prisma.workoutSet.findMany({
    where: { exerciseId },
    orderBy: { workout: { date: 'asc' } },
    select: {
      weight: true,
      reps: true,
      workout: { select: { date: true, name: true } },
    },
  });

  const bySession = new Map<
    string,
    { date: Date; maxWeight: number; reps: number; sessionName: string }
  >();
  for (const s of sets) {
    const key = s.workout.date.toISOString().split('T')[0];
    const existing = bySession.get(key);
    if (!existing || s.weight > existing.maxWeight) {
      bySession.set(key, {
        date: s.workout.date,
        maxWeight: s.weight,
        reps: s.reps,
        sessionName: s.workout.name,
      });
    }
  }

  const history = Array.from(bySession.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const pr = history.reduce((m, h) => Math.max(m, h.maxWeight), 0);

  return { exercise, history, pr, totalSessions: history.length };
}

// Body stats
export async function getBodyStats() {
  return prisma.bodyStat.findMany({ orderBy: { date: 'asc' } });
}

export async function addBodyStat(data: { weight?: number; waist?: number; arms?: number; date: string }) {
  await prisma.bodyStat.create({
    data: {
      date: new Date(data.date),
      weight: data.weight ?? null,
      waist: data.waist ?? null,
      arms: data.arms ?? null,
    },
  });
  revalidatePath('/stats');
}

export async function deleteBodyStat(id: string) {
  await prisma.bodyStat.delete({ where: { id } });
  revalidatePath('/stats');
}

/**
 * Imports a HealthKit cardio session (his Day B swim) as a lightweight workout
 * with NO sets. There is nothing to log set-wise — the session is a duration
 * and a name, and inventing a fake set just to satisfy the shape would poison
 * every volume, PR and effort number in the app.
 *
 * Idempotent on the HealthKit UUID, so a double tap (or a re-offer after a
 * failed refresh) returns the existing row instead of creating a twin.
 */
export async function importHealthWorkout(input: {
  /** HKWorkout UUID — the idempotency key. */
  healthWorkoutUuid: string;
  name: string;
  /** ISO instant the HealthKit session started; kept as the workout date. */
  dateISO: string;
  durationSec: number;
  /** Energy as HealthKit recorded it. Never an app-side estimate. */
  activeKcal?: number | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.workout.findFirst({
    where: { healthWorkoutUuid: input.healthWorkoutUuid },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const date = new Date(input.dateISO);
  const durationSec = Math.round(input.durationSec);
  const workout = await prisma.workout.create({
    data: {
      name: input.name,
      // The real start instant, not a bare day: this is the one workout kind
      // whose exact clock time is known, and it is what lets the detect route
      // recognise the session by overlap afterwards.
      date: Number.isNaN(date.getTime()) ? new Date() : date,
      duration: durationSec > 0 ? durationSec : null,
      activeKcal:
        input.activeKcal != null && input.activeKcal > 0 ? Math.round(input.activeKcal) : null,
      healthWorkoutUuid: input.healthWorkoutUuid,
      // Already in Apple Health — that is where it came from. Marking it synced
      // keeps /api/health/workouts from pushing it straight back and creating a
      // duplicate HKWorkout for the same swim.
      healthSyncedAt: new Date(),
    },
  });

  revalidatePath('/workouts');
  revalidatePath('/');
  revalidatePath('/stats');
  return { id: workout.id, created: true };
}

// Apple Health bridge
export async function getHealthOverview(): Promise<{
  lastWeightSync: Date | null;
  samplesTotal: number;
  enrichedWorkouts: number;
}> {
  const [lastWeight, samplesTotal, enrichedWorkouts] = await Promise.all([
    prisma.healthSample.findFirst({
      where: { type: 'weight' },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    prisma.healthSample.count(),
    prisma.workout.count({
      where: { OR: [{ avgHr: { not: null } }, { activeKcal: { not: null } }] },
    }),
  ]);
  return {
    lastWeightSync: lastWeight?.date ?? null,
    samplesTotal,
    enrichedWorkouts,
  };
}
