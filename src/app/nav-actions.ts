'use server';

// One glance line per room, for the Rooms map. The sheet answers before he
// enters: "8 sessions", "no reading this week", "2.5 mg weekly". Everything
// here is a take-1 or a count — the whole payload rides one Promise.all and
// any failure returns {} so the map still opens instantly with names alone.

import prisma from '@/lib/prisma';
import { calendarDaysBetween, getDynamicPlan, isTrainingSession, queuedDay } from '@/lib/program';

export async function getRoomGlances(): Promise<Record<string, string>> {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const [lastWorkouts, sessionCount, exerciseCount, latestLab, latestDose, bpWeek, latestBp, latestInjection] =
      await Promise.all([
        prisma.workout.findMany({ orderBy: { date: 'desc' }, take: 12, select: { date: true, name: true } }),
        prisma.workout.count(),
        prisma.exercise.count(),
        prisma.labResult.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
        prisma.injection.findFirst({ orderBy: { at: 'desc' }, select: { doseMg: true } }),
        prisma.bpReading.count({ where: { at: { gte: weekAgo } } }),
        prisma.bpReading.findFirst({ orderBy: { at: 'desc' }, select: { systolic: true, diastolic: true } }),
        prisma.injection.findFirst({ orderBy: { at: 'desc' }, select: { at: true, site: true } }),
      ]);

    const lastTraining = lastWorkouts.filter(isTrainingSession)[0];
    const trainDays = lastTraining ? calendarDaysBetween(now, lastTraining.date) : null;
    // Forward-facing, never a scoreboard: an elapsed-absence counter under
    // the Train door grades him precisely when he comes back from a gap
    // (editor, zero-shame). The glance answers "what do I do" — the day's
    // name — not "how long have you been gone".
    const nextDay = queuedDay(getDynamicPlan(lastWorkouts.map((w) => ({ date: w.date, name: w.name })), now));

    const glances: Record<string, string> = {
      '/train': trainDays === 0 ? 'trained today' : `Day ${nextDay ?? 'A'} next`,
      '/workouts': `${sessionCount} sessions`,
      '/exercises': `${exerciseCount} machines`,
      '/health/plan': latestDose ? `${latestDose.doseMg} mg weekly` : 'set the plan',
      '/health/report': latestLab
        ? `labs ${latestLab.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : 'no labs yet',
      ...(bpWeek < 3 ? { '/health/analytics': 'needs more days' } : {}),
      '/health/bp': latestBp ? `last ${latestBp.systolic}/${latestBp.diastolic}` : 'no reading yet',
      '/health/injection': latestInjection
        ? `last ${latestInjection.at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : 'first dose ahead',
    };
    return glances;
  } catch {
    return {};
  }
}
