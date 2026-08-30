'use server';

// One glance line per room, for the Rooms map. The sheet answers before he
// enters: "8 sessions", "no reading this week", "2.5 mg weekly". Everything
// here is a take-1 or a count — the whole payload rides one Promise.all and
// any failure returns {} so the map still opens instantly with names alone.

import prisma from '@/lib/prisma';
import { calendarDaysBetween, getDynamicPlan, isTrainingSession, queuedDay } from '@/lib/program';
import { DEFAULT_DOSE_PLAN, ownerDayKey, treatmentClock } from '@/lib/health-insights';

export async function getRoomGlances(): Promise<Record<string, string>> {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const [lastWorkouts, sessionCount, exerciseCount, latestLab, latestDose, bpWeek, latestBp, latestInjection, latestFuel] =
      await Promise.all([
        prisma.workout.findMany({ orderBy: { date: 'desc' }, take: 12, select: { date: true, name: true } }),
        prisma.workout.count(),
        prisma.exercise.count(),
        prisma.labResult.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
        prisma.injection.findFirst({ orderBy: { at: 'desc' }, select: { doseMg: true } }),
        prisma.bpReading.count({ where: { at: { gte: weekAgo } } }),
        prisma.bpReading.findFirst({ orderBy: { at: 'desc' }, select: { systolic: true, diastolic: true } }),
        prisma.injection.findFirst({ orderBy: { at: 'desc' }, select: { at: true, site: true } }),
        prisma.nutritionLog.findFirst({ orderBy: { day: 'desc' }, select: { day: true, kcal: true, proteinG: true } }),
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
      '/health/diet': (() => {
        // Nutrition days sit at UTC midnight of the owner's calendar day.
        const key = ownerDayKey(now);
        if (latestFuel && latestFuel.day.toISOString().slice(0, 10) === key) {
          return latestFuel.kcal != null ? `${latestFuel.kcal} kcal today` : `${latestFuel.proteinG ?? 0}g protein today`;
        }
        return 'not logged today';
      })(),
    };
    return glances;
  } catch {
    return {};
  }
}


/** The 2-3 doors today actually needs, computed from state — the rooms
 *  map's first group. Empty when the day is fully handled (the map then
 *  opens on the plain groups, no filler). */
export async function getNowDoors(): Promise<Array<{ href: string; label: string; icon: string }>> {
  try {
    const now = new Date();
    const todayKey = ownerDayKey(now);
    const dayStart = new Date(now.getTime() - 24 * 3_600_000);
    const [latestInjection, injectionCount, latestFuel, bpToday, bpEver, profile, injectionsRecent] =
      await Promise.all([
        prisma.injection.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
        prisma.injection.count(),
        prisma.nutritionLog.findFirst({ orderBy: { day: 'desc' }, select: { day: true } }),
        prisma.bpReading.count({ where: { at: { gte: dayStart } } }),
        prisma.bpReading.count(),
        prisma.healthProfile.findUnique({ where: { id: 'profile' }, select: { dosePlan: true } }),
        prisma.injection.findMany({ orderBy: { at: 'asc' }, take: 120, select: { at: true, doseMg: true, site: true } }),
      ]);

    const doors: Array<{ href: string; label: string; icon: string }> = [];

    const plan = ((profile?.dosePlan as Array<{ week: number; mg: number | null }> | null) ?? DEFAULT_DOSE_PLAN);
    const clock = treatmentClock(injectionsRecent, plan, now, latestInjection ? undefined : undefined, injectionCount);
    if (!clock || clock.daysSinceLast >= 7 || clock.overdue) {
      doors.push({ href: '/health/injection', label: 'Injection day', icon: 'dose' });
    }
    if (!latestFuel || latestFuel.day.toISOString().slice(0, 10) !== todayKey) {
      doors.push({ href: '/health/diet', label: 'Diet', icon: 'bowl' });
    }
    if (bpEver > 0 && bpToday === 0) {
      doors.push({ href: '/health/bp', label: 'Pressure', icon: 'cuff' });
    }
    if (clock && clock.nextPlanned?.mg === null) {
      doors.push({ href: '/health/report', label: 'Doctor report', icon: 'doc' });
    }
    return doors.slice(0, 3);
  } catch {
    return [];
  }
}
