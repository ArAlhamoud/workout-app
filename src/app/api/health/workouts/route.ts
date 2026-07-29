import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkHealthAuth } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Strength-training estimate for a ~133 kg trainee.
const KCAL_PER_MIN = 7;
const DEFAULT_DURATION_MIN = 60;

// Feeds the "Log Workout to Apple Health" Shortcut: workouts not yet pushed to Health.
export async function GET(request: Request) {
  const auth = checkHealthAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const workouts = await prisma.workout.findMany({
    where: { healthSyncedAt: null },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true, duration: true },
  });

  return NextResponse.json(
    workouts.map((w) => {
      const durationMin = w.duration ? Math.max(1, Math.round(w.duration / 60)) : DEFAULT_DURATION_MIN;
      return {
        id: w.id,
        name: w.name,
        start: w.date.toISOString(),
        durationMin,
        estKcal: Math.round(durationMin * KCAL_PER_MIN),
      };
    }),
  );
}

// Marks workouts as synced once the Shortcut has logged them to Apple Health.
export async function POST(request: Request) {
  const auth = checkHealthAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ids = (payload as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
    return NextResponse.json({ error: 'Expected { ids: string[] }' }, { status: 400 });
  }

  const result = await prisma.workout.updateMany({
    where: { id: { in: ids }, healthSyncedAt: null },
    data: { healthSyncedAt: new Date() },
  });

  return NextResponse.json({ marked: result.count });
}
