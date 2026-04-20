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
  notes?: string;
  duration?: number;
  sets: Array<{ exerciseId: string; setNumber: number; reps: number; weight: number }>;
}) {
  const workout = await prisma.workout.create({
    data: {
      name: data.name,
      date: new Date(data.date),
      notes: data.notes || null,
      duration: data.duration ?? null,
      sets: { create: data.sets },
    },
  });
  revalidatePath('/workouts');
  revalidatePath('/');
  redirect(`/workouts/${workout.id}`);
}

export async function deleteWorkout(id: string) {
  await prisma.workout.delete({ where: { id } });
  revalidatePath('/workouts');
  revalidatePath('/');
  redirect('/workouts');
}

export async function getLastSessionForExercises(
  exerciseIds: string[],
): Promise<Record<string, { weight: number; reps: number }>> {
  if (!exerciseIds.length) return {};
  const lastSets = await prisma.workoutSet.findMany({
    where: { exerciseId: { in: exerciseIds } },
    orderBy: [{ workout: { date: 'desc' } }, { setNumber: 'desc' }],
    distinct: ['exerciseId'],
    select: { exerciseId: true, weight: true, reps: true },
  });
  return lastSets.reduce<Record<string, { weight: number; reps: number }>>((acc, s) => {
    acc[s.exerciseId] = { weight: s.weight, reps: s.reps };
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

  // One data point per session = max weight that session
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
