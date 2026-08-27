import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  cleanRampSessionDates,
  getDynamicPlan,
  getExercisesForDuration,
  getTrainingStatus,
  isTrainingSession,
  queuedDay,
  type DayId,
} from '@/lib/program';
import { combineIncrement, learnPinIncrements } from '@/lib/coach';
import { getLastSessionForExercises } from '@/app/actions';
import { DEFAULT_GYM_ID } from '@/lib/program';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Watch's session plan: today's queued day (or ?day=A|B override),
 * the ordered exercises with prefill weights ALREADY scaled for a return
 * ramp, per-machine pin increments, and the RPE cap. Everything the wrist
 * needs to run a session as confirm/adjust — no free entry.
 *
 * Open like the rest of the app (single user, owner's decision). The watch
 * treats this as advisory: if unreachable it logs sets blind and the
 * server-side prefill memory catches up on the next plan fetch.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dayParam = url.searchParams.get('day');
  const durParam = Number(url.searchParams.get('dur'));

  const [exercises, workoutRows] = await Promise.all([
    prisma.exercise.findMany({ select: { id: true, name: true } }),
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      take: 60,
      include: { sets: { select: { exerciseId: true, weight: true, reps: true, rpe: true, isWarmup: true } } },
    }),
  ]);

  const training = workoutRows.filter((w) => isTrainingSession(w));
  const plan = getDynamicPlan(training.map((w) => ({ date: w.date, name: w.name })));
  const day: DayId = dayParam === 'A' || dayParam === 'B' ? dayParam : queuedDay(plan) ?? 'A';

  const status = getTrainingStatus(
    training.map((w) => w.date),
    new Date(),
    cleanRampSessionDates(training),
  );
  const inRamp = status.mode === 'return';
  const loadPct = inRamp ? status.returnWeek.loadPct : 100;
  const rpeCap = inRamp ? status.returnWeek.rpeCap : 4;
  const dur = durParam === 30 || durParam === 45 || durParam === 60 ? durParam : inRamp ? 45 : 60;

  const template = getExercisesForDuration(day, dur as 30 | 45 | 60);
  const byName = new Map(exercises.map((e) => [e.name, e]));
  const ids = template.map((t) => byName.get(t.name)?.id).filter((v): v is string => !!v);
  const [memory, learned] = [
    await getLastSessionForExercises(ids, DEFAULT_GYM_ID),
    learnPinIncrements(workoutRows as never),
  ];

  const payload = {
    day,
    mode: plan.mode,
    focus: `Day ${day}`,
    durationMin: dur,
    loadPct,
    rpeCap,
    exercises: template.flatMap((t, order) => {
      const ex = byName.get(t.name);
      if (!ex) return [];
      const last = memory[ex.id];
      const pin = combineIncrement(learned[ex.id]);
      const raw = last?.weight ?? null;
      const scaled = raw != null ? Math.round(((raw * loadPct) / 100) / pin) * pin : null;
      return [{
        exerciseId: ex.id,
        name: t.name,
        machine: t.machine,
        order,
        sets: t.sets,
        repsMin: t.repsMin,
        repsMax: t.repsMax,
        unit: t.unit,
        prefillKg: scaled,
        prefillReps: last?.reps ?? t.repsMin,
        pinKg: pin,
      }];
    }),
  };

  return NextResponse.json(payload);
}
