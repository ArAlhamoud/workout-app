import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { readChart } from '@/lib/chart';
import {
  cleanRampSessionDates,
  clampTimedReps,
  effortCeiling,
  getDynamicPlan,
  getExercisesForDuration,
  getTrainingStatus,
  hasWarmupSet,
  isTrainingSession,
  queuedDay,
  rampBaseBefore,
  rampPrefillWeight,
  warmupWeight,
  type DayId,
} from '@/lib/program';
import { pinMapFor } from '@/lib/coach';
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

  const [exercises, workoutRows, chart] = await Promise.all([
    prisma.exercise.findMany({ select: { id: true, name: true, pinIncrement: true } }),
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      take: 60,
      include: { sets: { select: { exerciseId: true, weight: true, reps: true, rpe: true, isWarmup: true } } },
    }),
    // The chart's effort ceiling rides with the plan (rule 9: told, not
    // taught) — the wrist greys RPE above it exactly as the phone does.
    readChart(),
  ]);

  const training = workoutRows.filter((w) => isTrainingSession(w));
  const plan = getDynamicPlan(training.map((w) => ({ date: w.date, name: w.name })));
  const day: DayId = dayParam === 'A' || dayParam === 'B' ? dayParam : queuedDay(plan) ?? 'A';

  // Pin spacing learned from THIS gym's judged sessions only — a
  // mixed-building learn infers a step that exists on neither machine
  // (adversary C1); the same map judges over-ramp (rule 4).
  const pinFor = pinMapFor(training.filter((w) => (w.gym ?? DEFAULT_GYM_ID) === gym) as never, exercises);
  const cleanDates = cleanRampSessionDates(training);
  const status = getTrainingStatus(training.map((w) => w.date), new Date(), cleanDates);
  const inRamp = status.mode === 'return';
  const loadPct = inRamp ? status.returnWeek.loadPct : 100;
  const ceiling = effortCeiling(chart.conditions, chart.medications);
  const rpeCap = Math.min(inRamp ? status.returnWeek.rpeCap : 4, ceiling);
  const dur = durParam === 30 || durParam === 45 || durParam === 60 ? durParam : inRamp ? 45 : 60;

  const template = getExercisesForDuration(day, dur as 30 | 45 | 60);
  const byName = new Map(exercises.map((e) => [e.name, e]));
  const ids = template.map((t) => byName.get(t.name)?.id).filter((v): v is string => !!v);
  // Ramp-aware: the percentage scales the last FULL-LOAD weight, never a
  // previous ramp session (already scaled — compounding bug, owner's first
  // wrist session).
  const memory = await getLoggerMemory(ids, gym, inRamp ? rampBaseBefore(training, cleanDates) : undefined);

  const payload = {
    day,
    mode: plan.mode,
    focus: `Day ${day}`,
    durationMin: dur,
    loadPct,
    rpeCap,
    // `order` must index the SAME list the phone's blocks do. The phone
    // filters out template names with no Exercise row FIRST and then
    // numbers what is left; numbering before the filter would make the
    // two devices warm up different movements the moment a newly named
    // movement ships ahead of its seed row — which is exactly the window
    // Hip Adduction and Back Extension went through (adversary,
    // 2026-09-18). Filter, then number.
    exercises: template
      .filter((t) => byName.has(t.name))
      .map((t, order) => {
      const ex = byName.get(t.name)!;
      const last = memory[ex.id];
      // Manual per-machine override outranks the learned spacing, exactly
      // as on the phone.
      const pin = pinFor(ex.id);
      // One scaler for wrist and phone: pre-break × loadPct snapped to
      // THIS machine's nearest pin; held / 100% weights pass through.
      const scaled = last ? rampPrefillWeight(last, loadPct, pin) : null;
      // Timed holds never scale — a plank at bodyweight is the same load in
      // every ramp week — and never open below the program floor (trainer:
      // the 10 s planks on the first wrist session).
      const prefillReps =
        t.unit === 'seconds' ? clampTimedReps(last?.reps ?? t.repsMin, t.repsMin, t.repsMax) : last?.reps ?? t.repsMin;
      return {
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
        // The phone opens the first two movements with a ramp-in set; the
        // Watch built its slots straight from `sets` and never offered one,
        // so wrist sessions skipped the warm-ups entirely (owner,
        // 2026-09-18). Sent as a weight rather than a flag so the rule
        // stays in one place — null means this movement has no warm-up.
        warmupKg: hasWarmupSet(order, t.unit, scaled) ? warmupWeight(scaled!, pin) : null,
      };
    }),
  };

  return NextResponse.json(payload);
}
