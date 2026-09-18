// Server half of the navigation: reads the treatment state and today's
// priorities, hands the client bar its ONE action. Mirrors the Home
// page's priority order exactly — the bar and the page must never
// disagree about what today asks. (The journey road itself now lives on
// Home, under the figure's feet.)

import prisma from '@/lib/prisma';
import { getDynamicPlan, queuedDay, isTrainingSession } from '@/lib/program';
import {
  treatmentClock,
  DEFAULT_DOSE_PLAN,
  type DosePlanStep,
} from '@/lib/health-insights';
import JourneyNavClient, { type NavAction } from './JourneyNavClient';

export default async function JourneyNav() {
  // Neutral when the nav is built with no database (static routes): the
  // old fallback baked "First dose" into /offline for a man on dose 4.
  let action: NavAction = { href: '/', label: 'Home', kind: 'talk' };

  try {
    const [injections, profile, workouts, firstInjection, injectionCount] = await Promise.all([
      prisma.injection.findMany({
        orderBy: { at: 'asc' },
        take: 120,
        select: { at: true, doseMg: true, site: true },
      }),
      prisma.healthProfile.findUnique({ where: { id: 'profile' }, select: { dosePlan: true } }),
      prisma.workout.findMany({ orderBy: { date: 'desc' }, take: 30, select: { date: true, name: true, duration: true, sets: { select: { rpe: true, isWarmup: true } } } }),
      prisma.injection.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
      prisma.injection.count(),
    ]);
    const plan = ((profile?.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN);

    const clock = treatmentClock(
      injections, plan, new Date(),
      firstInjection?.at ?? undefined, injectionCount,
    );
    // Judged rows only: a mis-tap must not flip the nav's day (adversary).
    const trainPlan = getDynamicPlan(workouts.filter(isTrainingSession).map((w) => ({ date: w.date, name: w.name })));
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const trainedToday = workouts.some(
      (w) => !w.name.startsWith('Rescue walk') && new Date(w.date) >= todayStart,
    );

    if (!clock) {
      action = { href: '/health/injection', label: 'First dose', kind: 'dose' };
    } else if (clock.daysSinceLast >= 7 || clock.overdue) {
      action = { href: '/health/injection', label: 'Dose day', kind: 'dose' };
    } else if (trainPlan.mode === 'train' && !trainedToday) {
      const day = queuedDay(trainPlan);
      action = { href: `/workouts/new?day=${day}&dur=45`, label: `Train ${day}`, kind: 'train', day };
    } else {
      action = { href: '/', label: 'Check in', kind: 'talk' };
    }
  } catch {
    /* pre-schema or db-down: the neutral Home bar stands */
  }

  return <JourneyNavClient action={action} />;
}
