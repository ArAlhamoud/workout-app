// One JSON verdict for anything that isn't the web app: the Gap Guard
// scheduler in the native shell today, the Lock Screen widget tomorrow.
//
// The contract is the glance rule in miniature — a lead, a day letter, a
// days-since number, a streak line. The widget must render this without any
// further computation, and must degrade to a dash if `updatedISO` goes
// stale, so everything here is primitive and self-describing.

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkHealthAuth } from '@/lib/health';
import { homeVerdict } from '@/lib/coach';
import { calendarDaysBetween, getDynamicPlan, getTrainingStatus, queuedDay } from '@/lib/program';
import { holdWeekKeys, weekStreak } from '@/lib/streak';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = checkHealthAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const now = new Date();
  const [workouts, holds, activeHold] = await Promise.all([
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      select: { date: true, name: true },
      take: 400,
    }),
    prisma.hold.findMany({ select: { startsAt: true, endsAt: true } }),
    prisma.hold.findFirst({
      where: { endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    }),
  ]);

  const status = getTrainingStatus(workouts.map((w) => w.date), now);
  const plan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })), now);
  const verdict = homeVerdict(status, plan, now);
  const streak = weekStreak({
    sessionDates: workouts.map((w) => w.date),
    excusedWeeks: holdWeekKeys(holds),
    now,
  });

  const lastSessionISO = workouts.length ? workouts[0].date.toISOString() : null;
  // Calendar days, not elapsed-ms floor: a session logged yesterday evening
  // is "1 day ago" this morning even though fewer than 24 h have passed.
  const daysSince = workouts.length ? Math.max(0, calendarDaysBetween(now, workouts[0].date)) : null;

  return NextResponse.json({
    lead: verdict.lead,
    parts: verdict.parts,
    sub: verdict.sub,
    tone: verdict.tone,
    day: verdict.day,
    queuedDay: queuedDay(plan),
    daysSince,
    lastSessionISO,
    streak: { weeks: streak.weeks, status: streak.status, label: streak.label },
    holdUntilISO: activeHold ? activeHold.endsAt.toISOString() : null,
    updatedISO: now.toISOString(),
  });
}
