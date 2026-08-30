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
    /** The watch's local calendar day (YYYY-MM-DD) — the server cannot
     *  know the wrist's timezone, and every other workout sits at UTC
     *  midnight of the local day. */
    localDay?: string;
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
  // A future-dated session wedges the dynamic plan in done-today until
  // that date (adversary S1). 10 minutes of clock skew is the allowance.
  if (start.getTime() > Date.now() + 10 * 60_000) {
    return NextResponse.json({ error: 'startISO is in the future' }, { status: 400 });
  }
  if (typeof b.healthWorkoutUuid === 'string' && b.healthWorkoutUuid.length > 64) {
    // Checked in full but stored sliced would 500 on replay — refuse instead.
    return NextResponse.json({ error: 'healthWorkoutUuid too long' }, { status: 400 });
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

  const workoutDate =
    typeof b.localDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.localDay)
      ? `${b.localDay}T00:00:00.000Z`
      : start.toISOString();
  const result = await createWorkout({
    name,
    date: workoutDate,
    gym: b.gym === 'work' || b.gym === 'bfit' ? b.gym : undefined,
    duration:
      Number.isFinite(b.durationSec) && (b.durationSec as number) > 0 && (b.durationSec as number) < 4 * 3600
        ? Math.round(b.durationSec as number)
        : undefined,
    healthWorkoutUuid: typeof b.healthWorkoutUuid === 'string' ? b.healthWorkoutUuid : undefined,
    clientSaveId: typeof b.clientSaveId === 'string' ? b.clientSaveId.slice(0, 64) : undefined,
    sets,
  });
  return NextResponse.json(result);
}
