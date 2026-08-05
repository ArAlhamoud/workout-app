// Server-side assembly of the coach's context — the only file that joins
// the database to the model. Everything it feeds the coach is already the
// app's own data; nothing new is collected for the AI.

import prisma from '@/lib/prisma';
import { buildCoachContext, type CoachContextInput } from './coach-ai';
import { phaseForWeek } from './coach';
import { getDynamicPlan, getTrainingStatus } from './program';
import { holdWeekKeys, weekStreak } from './streak';

const START_WEIGHT_FALLBACK = 135;

export async function assembleCoachContext(): Promise<{ context: string; todayLine: string }> {
  const walkFilter = { name: { startsWith: 'Rescue walk' } };
  const [workouts, sessionRows, walks30d, bodyStats, holds, recovery] = await Promise.all([
    // TRAINING sessions only. Filtering AFTER a take-40 let a month of daily
    // rescue walks evict every real session from the coach's view — the
    // comeback-day brief then read him as a brand-new trainee with no ramp
    // (adversary probe). Walks are excluded at the query, counted separately.
    prisma.workout.findMany({
      where: { NOT: walkFilter },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 40,
      include: { sets: { include: { exercise: { select: { name: true } } }, orderBy: { setNumber: 'asc' } } },
    }),
    // Light rows for streak/plan/status — same window as /api/verdict, so
    // the coach's streak number MATCHES the card beside it (adversary: a
    // 40-row truncation said "15 wk streak" under a card saying 20).
    prisma.workout.findMany({
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 400,
      select: { date: true, name: true },
    }),
    prisma.workout.count({
      where: { ...walkFilter, date: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.bodyStat.findMany({ orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    prisma.hold.findMany({ select: { startsAt: true, endsAt: true, reason: true } }),
    prisma.healthSample.findMany({
      where: { type: { in: ['resting_hr', 'hrv_sdnn', 'sleep_asleep_h', 'steps'] } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 120,
      select: { type: true, date: true, value: true, unit: true },
    }),
  ]);

  const now = new Date();
  const trainingDates = sessionRows
    .filter((w) => !w.name.startsWith('Rescue walk'))
    .map((w) => w.date);
  const status = getTrainingStatus(trainingDates, now);
  const plan = getDynamicPlan(sessionRows.map((w) => ({ date: w.date, name: w.name })), now);
  const streak = weekStreak({
    sessionDates: sessionRows.map((w) => w.date),
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
      // The phase label (BUILD / DELOAD / PEAK...) — without it the coach
      // cheerfully suggests taking a pin during deload week (trainer).
      phase: phaseForWeek(status.week).phase ?? null,
      returnWeek: status.mode === 'return' ? status.returnWeek : null,
    },
    plan: { mode: plan.mode, day: plan.day, daysSinceLast: plan.daysSinceLast },
    streak: { weeks: streak.weeks, status: streak.status, label: streak.label },
    workouts: workouts.map((w) => ({
      date: w.date.toISOString(),
      name: w.name,
      gym: w.gym,
      gapReason: w.gapReason,
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
    holds: holds.map((h) => ({
      startsAt: h.startsAt.toISOString(),
      endsAt: h.endsAt.toISOString(),
      reason: h.reason,
    })),
    rescueWalks30d: walks30d,
  };

  // The date lives OUTSIDE the cached context block — a timestamp inside it
  // would invalidate the prompt cache on every request.
  const todayLine = `Today is ${now.toISOString().slice(0, 10)}.`;
  return { context: buildCoachContext(input), todayLine };
}

/**
 * HIS calendar day, not the server's. Vercel runs on UTC, so a server-local
 * key would flip the "day" at 03:00 in Riyadh and a midnight open would
 * serve yesterday's brief. KSA is UTC+3 with no DST — a fixed offset is
 * correct, not lazy.
 */
const RIYADH_OFFSET_MS = 3 * 3_600_000;
export function todayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}
