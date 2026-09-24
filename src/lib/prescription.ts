// ONE prescription for every device (rule 9). The phone logger, /train and
// the Watch plan each used to derive "the weight for today" themselves, and
// the copies drifted: the phone seeded +1 pin after two Easy sessions and
// deloaded plateaus, the Watch plan did neither, so the same machine opened
// at 22.5 on the phone and 20 on the wrist (A3, 2026-09-24). Everything that
// turns history into today's working weight, set count and warm-up lives
// here, pure — no Prisma — so scripts/coach-tests.ts runs it against the
// real export exactly as the server does.

import { deloadTarget, detectPlateau, pinMapFor, stepIsHisFor, type CoachWorkout } from './coach';
import {
  DEFAULT_GYM_ID,
  cleanRampSessionDates,
  earnsOverload,
  getTrainingStatus,
  isTrainingSession,
  prefillReps,
  programSpec,
  rampBaseBefore,
  rampPrefillWeight,
  shortSetVerdict,
  warmupWeight,
  type EvidenceSet,
  type ProgramExercise,
} from './program';

export type ExerciseMemory = {
  weight: number;
  reps: number;
  rpe: number | null;
  /** Two straight sessions that proved this weight light (earnsOverload) at
   *  the same top weight — the prescription takes one pin. Reports history
   *  only; prescribeWorking decides whether the ramp allows it. */
  overload?: boolean;
  /** The LAST session on this machine proved its weight light. */
  allEasy?: boolean;
  /** Ramp only: no pre-break record, so the weight is the latest in-block one
   *  and must NOT be scaled again (pickRampMemory). */
  rampHold?: boolean;
  /** With overload: the fewest reps on any working set of those two sessions
   *  — a coarse step waits until every set reached repsMax. */
  repsFloor?: number;
  /** The last two sessions each had a short set rated Hard or Grind at the
   *  same top weight (trainer ruling 6): one pin lighter next time. */
  shortHard?: boolean;
  /** The LATEST session had a short set rated Hard or Grind. */
  lastShortHard?: boolean;
  /** Ramp only: the in-block weight a short Hard set was lifted at — the
   *  ramp holds there instead of climbing to the week's percentage (ruling
   *  6: "during the ramp, hold only"). Set by getLoggerMemory. */
  holdAtKg?: number;
  /** ISO date of the latest session on this machine. */
  lastDate?: string;
};

/** One working-set row, as getLastSessionForExercises selects it. */
export interface MemorySetRow extends EvidenceSet {
  exerciseId: string;
  exerciseName?: string | null;
  workout: { id: string; date: Date; duration: number | null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * History → memory per machine. Rows must come newest session first and,
 * within one, highest setNumber first (the query's order): the first row is
 * the last set of the latest session, the prefill memory. Sessions group by
 * calendar DAY, not workout id — a session saved in two halves is one day's
 * evidence, never "two straight sessions" earned in an afternoon. A mis-tap
 * row (seconds long, nothing rated) is not memory at all.
 */
export function foldExerciseMemory(
  rows: MemorySetRow[],
  evidence: Map<string, Array<{ rpe: number | null; isWarmup: boolean }>>,
): Record<string, ExerciseMemory> {
  const out: Record<string, ExerciseMemory> = {};
  const byExercise = new Map<string, MemorySetRow[]>();
  for (const r of rows) {
    if (!isTrainingSession({ name: 'Day', duration: r.workout.duration, sets: evidence.get(r.workout.id) ?? [] })) continue;
    const list = byExercise.get(r.exerciseId);
    if (list) list.push(r);
    else byExercise.set(r.exerciseId, [r]);
  }
  for (const [exId, sets] of byExercise) {
    const first = sets[0];
    const sessions: MemorySetRow[][] = [];
    const order = new Map<string, number>();
    for (const x of sets) {
      const dayKey = x.workout.date.toISOString().slice(0, 10);
      let i = order.get(dayKey);
      if (i === undefined) {
        i = sessions.length;
        order.set(dayKey, i);
        sessions.push([]);
      }
      sessions[i].push(x);
    }
    const spec = programSpec(first.exerciseName);
    const earned = (sess: MemorySetRow[]) => earnsOverload(sess, spec);
    const top = (sess: MemorySetRow[]) => Math.max(...sess.map((x) => x.weight));
    const sameTop = sessions.length >= 2 && top(sessions[0]) === top(sessions[1]) && top(sessions[0]) > 0;
    const overload = sameTop && earned(sessions[0]) && earned(sessions[1]);
    const shortHard =
      sameTop && shortSetVerdict(sessions[0], spec) === 'short-hard' && shortSetVerdict(sessions[1], spec) === 'short-hard';
    out[exId] = {
      weight: first.weight,
      reps: first.reps,
      rpe: first.rpe,
      overload,
      allEasy: earned(sessions[0]),
      ...(overload ? { repsFloor: Math.min(...sessions[0].concat(sessions[1]).map((x) => x.reps)) } : {}),
      ...(shortHard ? { shortHard: true } : {}),
      ...(shortSetVerdict(sessions[0], spec) === 'short-hard' ? { lastShortHard: true } : {}),
      lastDate: first.workout.date.toISOString(),
    };
  }
  return out;
}

/** "Ready to progress": the seed's own evidence (earnsOverload twice at one
 *  weight, home gym), never a max-RPE scan that read short sets as ready. */
export function earnedPin(memory: ExerciseMemory | undefined): boolean {
  return memory?.overload === true;
}

export type PrescriptionReason =
  /** a coarse step: one more rep before the pin */
  | 'reps'
  /** no history on this machine at this gym */
  | 'none'
  /** a timed hold: no weight */
  | 'timed'
  /** outside a ramp: the last working weight */
  | 'last'
  /** in a return ramp: the pre-break weight scaled to the week */
  | 'ramp'
  /** in a ramp, a machine first met inside it: its weight as-is */
  | 'held'
  /** two sessions proved it light: one pin up */
  | 'overload'
  /** a plateau: ~90% for half the sets */
  | 'deload'
  /** short sets rated Hard twice: one pin down */
  | 'short';

export interface Prescription {
  /** The working weight to open at; null when there is nothing to prescribe. */
  workingKg: number | null;
  /** Working sets — halved on a deload. */
  sets: number;
  reason: PrescriptionReason;
  /** The memory weight the prescription came from. */
  fromKg: number | null;
  /** One line for a deload or a short-set step down; else null. */
  note: string | null;
  /** Reps to open at when the prescription asks for more reps (reason 'reps'). */
  reps?: number;
}

/** A step bigger than this share of the working weight is coarse: reps first. */
export const COARSE_PIN_SHARE = 0.15;

/**
 * Today's working weight for one machine. The checks run in this order:
 *   timed → none → deload (a plateau beats everything outside a ramp) →
 *   short (Hard short sets twice) → overload → the ramp scaler / last weight.
 *
 * `rampPct` null means OUTSIDE a return block. It is NOT the same as 100:
 * RESTORE (week 4) is rampPct 100 and still keeps the seed off a scaled
 * machine — only a held machine (no pre-break record) seeds under the ramp,
 * or it would sit frozen for four weeks. A rescue passes its own percentage
 * with rescue true and never seeds or deloads.
 *
 * Rule 10: the result never exceeds allowedRampKg for the same memory and pin
 * (the suite sweeps every real machine), and every number rounds to 0.01, the
 * allowance's own rounding — a 1.25 pin once rounded 27.25 up to 27.3 on the
 * phone, over its own allowance.
 */
export function prescribeWorking(
  ex: Pick<ProgramExercise, 'unit' | 'sets' | 'repsMin' | 'repsMax'>,
  memory: ExerciseMemory | undefined,
  pin: number,
  plateauKg: number | null,
  ctx: { rampPct: number | null; rescue: boolean; anchored?: boolean; readinessHold?: boolean },
): Prescription {
  // ctx.readinessHold: the phone's readiness said HOLD today (a resting-HR
  // spike or a short night — on his chart it can be an AF episode). No seed
  // on any device: the phone takes it back, the Watch is told (T1).
  // ctx.anchored: the step is his (stepIsHis), so scaled weights land on the
  // ladder through the weight he lifted. Overload, deload and the short-set
  // step are already relative to a lifted weight (w ± step).
  const base = { sets: ex.sets, fromKg: null, note: null };
  if (ex.unit === 'seconds') return { ...base, workingKg: null, reason: 'timed' };
  if (!memory || memory.weight <= 0) return { ...base, workingKg: null, reason: 'none' };
  const p = pin > 0 ? pin : 2.5;
  const w = memory.weight;
  const inRamp = ctx.rampPct != null;
  // The prefill IS the instruction: a plateaued machine opens AT the deload
  // weight with half the sets, and building back is the explicit act.
  if (!inRamp && !ctx.rescue && plateauKg != null) {
    const d = deloadTarget(plateauKg, p);
    return { workingKg: d.weight, sets: Math.max(1, Math.ceil(ex.sets / 2)), reason: 'deload', fromKg: plateauKg, note: d.note };
  }
  if (!inRamp && !ctx.rescue && memory.shortHard) {
    return { ...base, workingKg: round2(Math.max(p, w - p)), reason: 'short', fromKg: w, note: `Short sets at ${w} kg felt Hard twice · one pin lighter` };
  }
  // Reps before the pin on a coarse stack (trainer ruling 4): a 5 kg step
  // on 27.5 is +18%, so it waits until every set reached the top of the range.
  const coarse = p > w * COARSE_PIN_SHARE;
  const repsReady = coarse ? (memory.repsFloor ?? memory.reps) >= ex.repsMax : memory.reps >= ex.repsMin;
  const seedable = (!inRamp || memory.rampHold) && !ctx.rescue && memory.overload && !ctx.readinessHold;
  if (seedable && repsReady) {
    return { ...base, workingKg: round2(w + p), reason: 'overload', fromKg: w };
  }
  if (seedable && coarse && Number.isFinite(ex.repsMax)) {
    // The pin is earned but the step is coarse: ASK for the reps, one more
    // than last time, or the machine silently never moves (he logs what
    // the prefill says — 169 of 215 working sets sit at repsMin).
    return { ...base, workingKg: w, reason: 'reps', fromKg: w, reps: Math.min(ex.repsMax, memory.reps + 1) };
  }
  const scaled = rampPrefillWeight(memory, ctx.rampPct ?? 100, p, ctx.anchored === true);
  // In the ramp a short Hard set HOLDS its weight: a scaled machine reads
  // only pre-break memory, so without this a set he could not finish at 35
  // opened at 40 the next week (T2).
  const held = inRamp && memory.holdAtKg != null ? Math.min(scaled, memory.holdAtKg) : scaled;
  return {
    ...base,
    workingKg: held,
    reason: !inRamp ? 'last' : memory.rampHold ? 'held' : 'ramp',
    fromKg: w,
  };
}

/**
 * The warm-up weight for a prescription — from the weight actually
 * prescribed, so a deload day warms up lighter too. null on a rescue (a short
 * session warms up on its first work set), for a hold, with nothing to scale,
 * or when a coarse stack has nothing lighter. WHETHER a machine gets its
 * warm-up is warmupDue's call, counted on the device (trainer ruling 5).
 */
export function prescribeWarmup(p: Prescription, unit: 'reps' | 'seconds', pin: number, rescue: boolean, anchored = false): number | null {
  if (rescue || unit === 'seconds' || !p.workingKg) return null;
  return warmupWeight(p.workingKg, pin, anchored);
}

/** The plateau weight to deload from — never inside a ramp, and only once
 *  the stall has outlasted the add-a-rep response (the 'pin' suggestion). */
export function plateauKgFor(rows: CoachWorkout[], exerciseId: string, inRamp: boolean): number | null {
  if (inRamp) return null;
  const r = detectPlateau(rows, exerciseId);
  return r.plateaued && r.weight != null && r.suggestion?.includes('pin') ? r.weight : null;
}

/** '+1 set' on the Watch: never in REBOOT or REBUILD (cap Med) — trainer ruling 2. */
export function extraSetAllowed(rampRpeCap: number | null): boolean {
  return rampRpeCap == null || rampRpeCap > 2;
}

/**
 * How many workout rows every prescription reads: the phone page, the Watch
 * plan and the save-time ramp allowance all see the SAME newest rows, so the
 * learned pins — and so the numbers — cannot differ by window.
 */
export const PRESCRIPTION_WINDOW = 120;

type InputRow = {
  date: Date | string;
  name: string;
  gym?: string | null;
  duration?: number | null;
  sets?: Array<{ exerciseId: string; weight: number; rpe: number | null; isWarmup?: boolean | null; allowedKg?: number | null }> | null;
};

/**
 * Everything a prescription needs besides memory, from rows already loaded
 * (any order, any kind): status, the ramp percentage, the memory cut, the
 * gym's pin map and its plateaus. Pins and plateaus read THIS gym's judged
 * sessions only (rules 2 and 4).
 *
 * The cut is gated on the ramp. Outside one, rampBaseBefore still walks back
 * over a just-finished RESTORE week to the scaled sessions, so an ungated cut
 * would open the first post-ramp session at May's weights. The one exception
 * is a trailing Rescue: 60% by construction and never a base.
 */
export function prescriptionInputs<R extends InputRow>(
  rows: R[],
  exercises: Array<{ id: string; pinIncrement?: number | null }>,
  gym: string,
  now: Date = new Date(),
) {
  const window = [...rows]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, PRESCRIPTION_WINDOW);
  const training = window.filter((w) => isTrainingSession(w));
  const gymRows = training.filter((w) => (w.gym ?? DEFAULT_GYM_ID) === gym);
  const cleanDates = cleanRampSessionDates(training);
  const status = getTrainingStatus(training.map((w) => new Date(w.date)), now, cleanDates);
  const inRamp = status.mode === 'return';
  const rampPct = inRamp ? status.returnWeek.loadPct : null;
  const rampRpeCap = inRamp ? status.returnWeek.rpeCap : null;
  const afterRescue = !inRamp && (training[0]?.name ?? '').startsWith('Rescue');
  const cut = inRamp || afterRescue ? rampBaseBefore(training, cleanDates, now) : null;
  const pinFor = pinMapFor(gymRows as never, exercises, gym);
  const stepIsHis = stepIsHisFor(exercises, gym);
  return {
    training,
    status,
    inRamp,
    rampPct,
    rampRpeCap,
    cut,
    pinFor,
    stepIsHis,
    plateauKgFor: (id: string) => plateauKgFor(gymRows as never, id, inRamp),
  };
}

export type PrescriptionInputs = ReturnType<typeof prescriptionInputs>;

export interface PlanEntry {
  exerciseId: string;
  name: string;
  /** Index in the FILTERED list — the same list the phone numbers its blocks by. */
  order: number;
  template: ProgramExercise;
  pinKg: number;
  prescription: Prescription;
  /** This machine's warm-up weight if it is one of the first two started (or alwaysWarm). */
  warmupKg: number | null;
  alwaysWarm: boolean;
  prefillReps: number;
}

/**
 * The day's machines with their prescriptions. Template names with no
 * Exercise row are filtered out FIRST and what is left is numbered — the
 * phone numbers its blocks the same way, and numbering before the filter
 * once made the two devices disagree the moment a movement shipped ahead of
 * its seed row (adversary, 2026-09-18).
 */
export function planExercises(
  template: ProgramExercise[],
  byName: Map<string, { id: string }>,
  memory: Record<string, ExerciseMemory>,
  inputs: Pick<PrescriptionInputs, 'pinFor' | 'plateauKgFor' | 'rampPct' | 'stepIsHis'>,
  opts: { rescue?: boolean; readinessHold?: boolean } = {},
): PlanEntry[] {
  const rescue = opts.rescue === true;
  const readinessHold = opts.readinessHold === true;
  return template
    .filter((t) => byName.has(t.name))
    .map((t, order) => {
      const ex = byName.get(t.name)!;
      const pin = inputs.pinFor(ex.id);
      const last = memory[ex.id];
      const anchored = inputs.stepIsHis(ex.id);
      const p = prescribeWorking(t, last, pin, inputs.plateauKgFor(ex.id), { rampPct: inputs.rampPct, rescue, anchored, readinessHold });
      return {
        exerciseId: ex.id,
        name: t.name,
        order,
        template: t,
        pinKg: pin,
        prescription: p,
        warmupKg: prescribeWarmup(p, t.unit, pin, rescue, anchored),
        alwaysWarm: t.alwaysWarm === true,
        prefillReps: p.reps ?? prefillReps(last?.reps, t.repsMin, t.repsMax),
      };
    });
}

/**
 * Warm-up rows on the phone (trainer ruling 5): every weighted machine opens
 * with one until two machines are STARTED; then the untouched ones on
 * machines not yet started go — except an alwaysWarm machine (Back
 * Extension). A started block keeps its rows whatever happens: the rest
 * capsule rates a set by its index in that block. Returns the uids to strip.
 */
export function warmupRowsToDrop(blocks: Array<{ uid: string; started: boolean; weighted: boolean; alwaysWarm: boolean; hasUntouchedWarmup: boolean }>): string[] {
  const startedWeighted = blocks.filter((b) => b.started && b.weighted).length;
  if (startedWeighted < 2) return [];
  return blocks.filter((b) => !b.started && b.hasUntouchedWarmup && !b.alwaysWarm).map((b) => b.uid);
}
