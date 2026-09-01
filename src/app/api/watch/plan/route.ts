import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  cleanRampSessionDates,
  getDynamicPlan,
  getExercisesForDuration,
  getTrainingStatus,
  isTrainingSession,
  queuedDay,
  rampBaseBefore,
  rampPrefillWeight,
  type DayId,
} from '@/lib/program';
import { combineIncrement, learnPinIncrements } from '@/lib/coach';
import { getLoggerMemory } from '@/app/actions';
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
  // Weights and pins are per building (rule 2) — default gym unless asked.
  const gym = url.searchParams.get('gym') === 'work' ? 'work' : DEFAULT_GYM_ID;

  const [exercises, workoutRows] = await Promise.all([
    prisma.exercise.findMany({ select: { id: true, name: true, pinIncrement: true } }),
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
  // Pin spacing learned from THIS gym's sessions only — a mixed-building
  // learn infers a step that exists on neither machine (adversary C1, the
  // same lesson the phone logger carries).
  const gymRows = workoutRows.filter((w) => (w.gym ?? DEFAULT_GYM_ID) === gym);
  const [memory, learned] = [
    // Ramp-aware: the percentage scales the last FULL-LOAD weight, never
    // a previous ramp session (already scaled — compounding bug, owner's
    // first wrist session).
    await getLoggerMemory(ids, gym, inRamp ? rampBaseBefore(training, cleanRampSessionDates(training)) : undefined),
    learnPinIncrements(gymRows as never),
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
      // Manual per-machine override outranks the learned spacing, exactly
      // as on the phone.
      const pin = combineIncrement(learned[ex.id], ex.pinIncrement);
      // One scaler for wrist and phone: pre-break × loadPct floored to
      // THIS machine's pin; held / 100% weights pass through unsnapped.
      const scaled = last ? rampPrefillWeight(last, loadPct, pin) : null;
      // Timed holds never scale — a plank at bodyweight is the same load in
      // every ramp week — and never open below the program floor (trainer:
      // the 10 s planks on the first wrist session).
      const prefillReps =
        t.unit === 'seconds' ? Math.max(t.repsMin, last?.reps ?? t.repsMin) : last?.reps ?? t.repsMin;
      return [{
        exerciseId: ex.id,
        name: t.name,
        machine: t.machine,
        order,
        sets: t.sets,
        repsMin: t.repsMin,
        repsMax: t.repsMax,
        unit: t.unit,
        restSec: parseInt(t.rest, 10) || 90,
        prefillKg: scaled,
        prefillReps,
        pinKg: pin,
      }];
    }),
  };

  return NextResponse.json(payload);
}
