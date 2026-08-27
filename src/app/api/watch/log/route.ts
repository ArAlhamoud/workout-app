import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createWorkout } from '@/app/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Watch posts a finished session in one shot: sets logged on the wrist,
 * flushed when connectivity allows. Idempotent twice over — by the watch's
 * clientSaveId (createWorkout's own dedupe) and by the HKWorkout uuid the
 * watch recorded, so a retry or a later phone-side detect can never mint a
 * duplicate. Bounds mirror the logger's; junk sets are dropped, not fatal.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as {
    name?: string;
    day?: string;
    startISO?: string;
    durationSec?: number;
    gym?: string;
    healthWorkoutUuid?: string;
    clientSaveId?: string;
    sets?: Array<{ exerciseId?: string; setNumber?: number; reps?: number; weight?: number; rpe?: number; isWarmup?: boolean }>;
  };

  const start = b.startISO ? new Date(b.startISO) : new Date();
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'Bad startISO' }, { status: 400 });
  }
  const sets = (Array.isArray(b.sets) ? b.sets : [])
    .filter(
      (s) =>
        typeof s.exerciseId === 'string' &&
        Number.isFinite(s.reps) && (s.reps as number) >= 1 && (s.reps as number) <= 200 &&
        Number.isFinite(s.weight) && (s.weight as number) >= 0 && (s.weight as number) <= 500,
    )
    .map((s, i) => ({
      exerciseId: s.exerciseId as string,
      setNumber: Number.isFinite(s.setNumber) ? (s.setNumber as number) : i + 1,
      reps: Math.round(s.reps as number),
      weight: s.weight as number,
      rpe: Number.isFinite(s.rpe) && (s.rpe as number) >= 1 && (s.rpe as number) <= 4 ? Math.round(s.rpe as number) : undefined,
      isWarmup: s.isWarmup === true,
    }));
  if (!sets.length) {
    return NextResponse.json({ error: 'No valid sets' }, { status: 400 });
  }

  // The HKWorkout the watch recorded is the strongest identity: if any
  // logged workout already carries it, this POST is a replay.
  if (b.healthWorkoutUuid) {
    const existing = await prisma.workout.findFirst({
      where: { healthWorkoutUuid: b.healthWorkoutUuid },
      select: { id: true },
    });
    if (existing) return NextResponse.json({ id: existing.id, deduped: true });
  }

  const day = b.day === 'A' || b.day === 'B' ? b.day : null;
  const name =
    (typeof b.name === 'string' && b.name.trim().slice(0, 80)) ||
    `Day ${day ?? '?'} — Watch · ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const result = await createWorkout({
    name,
    date: start.toISOString(),
    gym: typeof b.gym === 'string' ? b.gym.slice(0, 20) : undefined,
    duration:
      Number.isFinite(b.durationSec) && (b.durationSec as number) > 0 && (b.durationSec as number) < 4 * 3600
        ? Math.round(b.durationSec as number)
        : undefined,
    healthWorkoutUuid: typeof b.healthWorkoutUuid === 'string' ? b.healthWorkoutUuid.slice(0, 64) : undefined,
    clientSaveId: typeof b.clientSaveId === 'string' ? b.clientSaveId.slice(0, 64) : undefined,
    sets,
  });
  return NextResponse.json(result);
}
