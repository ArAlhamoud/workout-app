// One JSON verdict for anything that isn't the web app: the Gap Guard
// scheduler in the native shell today, the Lock Screen widget tomorrow.
//
// The contract is the glance rule in miniature — a lead, a day letter, a
// days-since number. The widget must be able to render this without any
// further computation, and must degrade to a dash if `updatedISO` goes
// stale, so everything here is primitive and self-describing.

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkHealthAuth } from '@/lib/health';
import { homeVerdict } from '@/lib/coach';
import { getDynamicPlan, getTrainingStatus, queuedDay } from '@/lib/program';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = checkHealthAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const workouts = await prisma.workout.findMany({
    orderBy: { date: 'desc' },
    select: { date: true, name: true },
    take: 60,
  });

  const now = new Date();
  const status = getTrainingStatus(workouts.map((w) => w.date), now);
  const plan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })), now);
  const verdict = homeVerdict(status, plan, now);

  const lastSessionISO = workouts.length ? workouts[0].date.toISOString() : null;
  const daysSince = lastSessionISO
    ? Math.floor((now.getTime() - new Date(lastSessionISO).getTime()) / 86_400_000)
    : null;

  return NextResponse.json({
    lead: verdict.lead,
    parts: verdict.parts,
    sub: verdict.sub,
    tone: verdict.tone,
    day: verdict.day,
    queuedDay: queuedDay(plan),
    daysSince,
    lastSessionISO,
    updatedISO: now.toISOString(),
  });
}
