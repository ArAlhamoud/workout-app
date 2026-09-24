import { NextResponse } from 'next/server';
import { crownStepFor } from '@/lib/pins';
import prisma from '@/lib/prisma';
import { readChart } from '@/lib/chart';
import {
  effortCeiling,
  getDynamicPlan,
  getExercisesForDuration,
  queuedDay,
  WARMUP_BLOCKS,
  type DayId,
  DEFAULT_SESSION_MIN,
  DEFAULT_GYM_ID,
} from '@/lib/program';
import { extraSetAllowed, planExercises, prescriptionInputs, PRESCRIPTION_WINDOW, startableUntilFor } from '@/lib/prescription';
import { getLoggerMemory, readinessHoldToday } from '@/app/actions';

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

  const [exercises, workoutRows, chart, readinessHold] = await Promise.all([
    prisma.exercise.findMany({ select: { id: true, name: true, pinIncrement: true } }),
    // The same newest rows the phone page and the save-time allowance read,
    // so the learned pins cannot differ by window (A3).
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      take: PRESCRIPTION_WINDOW,
      include: { sets: { select: { exerciseId: true, weight: true, reps: true, rpe: true, isWarmup: true, allowedKg: true } } },
    }),
    // The chart's effort ceiling rides with the plan (rule 9: told, not
    // taught) — the wrist greys RPE above it exactly as the phone does.
    readChart(),
    // The phone's readiness verdict for today (reportReadiness): on a HOLD
    // morning the wrist opens at the proven weight, as the phone does.
    readinessHoldToday(),
  ]);

  // Status, ramp percentage, memory cut, THIS gym's pins and plateaus — the
  // same inputs the phone logger builds its blocks from (prescription.ts).
  const inputs = prescriptionInputs(workoutRows, exercises, gym);
  const plan = getDynamicPlan(inputs.training.map((w) => ({ date: w.date, name: w.name })));
  const day: DayId = dayParam === 'A' || dayParam === 'B' ? dayParam : queuedDay(plan) ?? 'A';
  const ceiling = effortCeiling(chart.conditions, chart.medications);
  const rpeCap = Math.min(inputs.rampRpeCap ?? 4, ceiling);
  const dur = durParam === 30 || durParam === 45 || durParam === 60 ? durParam : DEFAULT_SESSION_MIN;

  const template = getExercisesForDuration(day, dur as 30 | 45 | 60);
  const byName = new Map(exercises.map((e) => [e.name, e]));
  const ids = template.map((t) => byName.get(t.name)?.id).filter((v): v is string => !!v);
  // Ramp-aware: the percentage scales the last FULL-LOAD weight, never a
  // previous ramp session (already scaled — compounding bug, owner's first
  // wrist session).
  const memory = await getLoggerMemory(ids, gym, inputs.cut);
  const extraSet = extraSetAllowed(inputs.rampRpeCap);

  const payload = {
    day,
    mode: plan.mode,
    focus: `Day ${day}`,
    durationMin: dur,
    loadPct: inputs.rampPct ?? 100,
    rpeCap,
    // Trainer ruling 5: the first N weighted machines he STARTS warm up,
    // whatever they are. Every weighted machine carries its warm-up weight;
    // the device counts starts and inserts the set (alwaysWarm: always).
    warmupFirstN: WARMUP_BLOCKS,
    // The latest moment a CACHED copy of this plan may start a session
    // offline: the day a layoff would trigger the return ramp. Past it the
    // weights here could be a comeback at 100% (trainer, phase 4 review).
    startableUntil: startableUntilFor(inputs.training[0] ? new Date(inputs.training[0].date) : null, new Date()),
    // planExercises filters unseeded names out FIRST, then numbers — the
    // same `order` the phone's blocks carry.
    exercises: planExercises(template, byName, memory, inputs, { readinessHold }).map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      machine: e.template.machine,
      order: e.order,
      sets: e.prescription.sets,
      repsMin: e.template.repsMin,
      repsMax: e.template.repsMax,
      unit: e.template.unit,
      restSec: parseInt(e.template.rest, 10) || 90,
      // THE prescription, byte-identical to the phone's: ramp-scaled, held,
      // +1 pin, deloaded or stepped down (reason says which).
      prefillKg: e.prescription.workingKg,
      prefillReps: e.prefillReps,
      pinKg: e.pinKg,
      // What ONE crown detent moves on the Watch: his own step for this
      // machine once he has set it, else 0.5 kg so any weight he really
      // lifted is reachable (trainer ruling 4). The prescription above keeps
      // pinKg. Build 13 ignores this key; the next Watch build reads it.
      crownStepKg: crownStepFor(gym === DEFAULT_GYM_ID ? byName.get(e.name)?.pinIncrement ?? null : null),
      warmupKg: e.warmupKg,
      alwaysWarm: e.alwaysWarm,
      reason: e.prescription.reason,
      fromKg: e.prescription.fromKg,
      note: e.prescription.note,
      extraSetAllowed: extraSet && e.template.unit !== 'seconds',
    })),
  };

  return NextResponse.json(payload);
}
