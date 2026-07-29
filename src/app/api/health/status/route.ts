import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkHealthAuth } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = checkHealthAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const [byType, workoutsAwaitingSync, lastEnrichedWorkout] = await Promise.all([
    prisma.healthSample.groupBy({
      by: ['type'],
      _max: { date: true },
      _count: { _all: true },
    }),
    prisma.workout.count({ where: { healthSyncedAt: null } }),
    prisma.workout.findFirst({
      where: { OR: [{ avgHr: { not: null } }, { maxHr: { not: null } }, { activeKcal: { not: null } }] },
      orderBy: { date: 'desc' },
      select: { id: true, name: true, date: true, avgHr: true, maxHr: true, activeKcal: true },
    }),
  ]);

  const lastSampleByType: Record<string, string | null> = {};
  const sampleCounts: Record<string, number> = {};
  for (const row of byType) {
    lastSampleByType[row.type] = row._max.date?.toISOString() ?? null;
    sampleCounts[row.type] = row._count._all;
  }

  return NextResponse.json({
    lastSampleByType,
    sampleCounts,
    workoutsAwaitingSync,
    lastEnrichedWorkout,
  });
}
