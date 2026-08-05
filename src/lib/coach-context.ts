// Server-side assembly of the coach's context — the only file that joins
// the database to the model. Everything it feeds the coach is already the
// app's own data; nothing new is collected for the AI.

import prisma from '@/lib/prisma';
import { buildCoachContext, type CoachContextInput } from './coach-ai';
import { getDynamicPlan, getTrainingStatus, isTrainingSession } from './program';
import { holdWeekKeys, weekStreak } from './streak';

const START_WEIGHT_FALLBACK = 135;

export async function assembleCoachContext(): Promise<{ context: string; todayLine: string }> {
  const [workouts, bodyStats, holds, recovery] = await Promise.all([
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      take: 40,
      include: { sets: { include: { exercise: { select: { name: true } } }, orderBy: { setNumber: 'asc' } } },
    }),
    prisma.bodyStat.findMany({ orderBy: { date: 'asc' } }),
    prisma.hold.findMany({ select: { startsAt: true, endsAt: true } }),
    prisma.healthSample.findMany({
      where: { type: { in: ['resting_hr', 'hrv_sdnn', 'sleep_asleep_h', 'steps'] } },
      orderBy: { date: 'desc' },
      take: 120,
      select: { type: true, date: true, value: true, unit: true },
    }),
  ]);

  const trainingOnly = workouts.filter(isTrainingSession);
  const now = new Date();
  const status = getTrainingStatus(trainingOnly.map((w) => w.date), now);
  const plan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })), now);
  const streak = weekStreak({
    sessionDates: workouts.map((w) => w.date),
    excusedWeeks: holdWeekKeys(holds),
    now,
  });

  const weights = bodyStats.filter((b) => b.weight != null);
  const latestWeight = weights.length ? weights[weights.length - 1].weight : null;
  const startWeight = weights.length ? weights[0].weight : START_WEIGHT_FALLBACK;

  const input: CoachContextInput = {
    profile: { weightKg: latestWeight, startWeightKg: startWeight, goal: 'fat loss, joint-safe machine training' },
    status: {
      mode: status.mode,
      week: status.week,
      returnWeek: status.mode === 'return' ? status.returnWeek : null,
    },
    plan: { mode: plan.mode, day: plan.day, daysSinceLast: plan.daysSinceLast },
    streak: { weeks: streak.weeks, status: streak.status, label: streak.label },
    workouts: workouts.map((w) => ({
      date: w.date.toISOString(),
      name: w.name,
      gym: w.gym,
      sets: w.sets.map((s) => ({
        exercise: s.exercise.name,
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        isWarmup: s.isWarmup,
      })),
    })),
    bodyStats: bodyStats.map((b) => ({ date: b.date.toISOString(), weight: b.weight, waist: b.waist })),
    recovery: recovery
      .reverse()
      .map((r) => ({ type: r.type, date: r.date.toISOString(), value: r.value, unit: r.unit })),
    holds: holds.map((h) => ({ startsAt: h.startsAt.toISOString(), endsAt: h.endsAt.toISOString() })),
  };

  // The date lives OUTSIDE the cached context block — a timestamp inside it
  // would invalidate the prompt cache on every request.
  const todayLine = `Today is ${now.toISOString().slice(0, 10)}.`;
  return { context: buildCoachContext(input), todayLine };
}

/** Local calendar day key for the one-note-per-day gate. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
