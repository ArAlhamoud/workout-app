'use server';

import { pinMapFor } from '@/lib/coach';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  sanitizeLiveUpdate,
  unionForFinish,
  type LiveSetUpdate,
  type LiveSource,
  dropRemovedSets,
  mergeCandidates,
  recordedInHealth,
} from '@/lib/live-session';
import { ownerActivityDayUtc } from '@/lib/health-insights';
import { closeLive, readLive, upsertLive } from '@/lib/live-store';
import {
  DEFAULT_GYM_ID,
  cleanRampSessionDates,
  getTrainingStatus,
  isTrainingSession,
  pickRampMemory,
  rampBaseBefore,
  allowedRampKg,
  lastFullLoad,
} from '@/lib/program';

/**
 * Workout filter restricting a query to one building.
 *
 * Weights are not comparable across gyms — a different machine with a
 * different stack, and at Alrajhi Tower a stack labelled in pounds. Every
 * weight-derived aggregate has to be scoped or it silently mixes units.
 *
 * Sessions logged before gym tagging existed are untagged and are all B_Fit,
 * so the home gym claims them.
 */
function gymScope(gym: string) {
  return gym === DEFAULT_GYM_ID ? { OR: [{ gym: DEFAULT_GYM_ID }, { gym: null }] } : { gym };
}

export async function getExercises() {
  return prisma.exercise.findMany({ orderBy: { name: 'asc' } });
}

export async function createExercise(formData: FormData) {
  // A second "Chest Press" splits history across two ids — the incident
  // merge-duplicate-exercises.js exists to undo (data-steward, 2026-09-18).
  const name = String(formData.get('name') ?? '').trim().slice(0, 80);
  const category = String(formData.get('category') ?? '').trim().slice(0, 40) || 'OTHER';
  if (!name) return;
  const dup = await prisma.exercise.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
  if (dup) return;
  await prisma.exercise.create({ data: { name, category } });
  revalidatePath('/exercises');
}

export async function deleteExercise(id: string) {
  // Refuse, don't 500: an exercise with history is load-bearing.
  const used = await prisma.workoutSet.count({ where: { exerciseId: id } });
  if (used > 0) throw new Error(`This exercise has ${used} logged sets and cannot be deleted.`);
  await prisma.exercise.delete({ where: { id } });
  revalidatePath('/exercises');
}

export async function getWorkouts() {
  return prisma.workout.findMany({
    orderBy: { date: 'desc' },
    include: { sets: { include: { exercise: true } } },
  });
}

export async function getWorkout(id: string) {
  return prisma.workout.findUnique({
    where: { id },
    include: {
      sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } },
    },
  });
}

/**
 * The previous session of the same day letter at the same gym, for comparison
 * on the detail screen.
 *
 * Gym-scoped on purpose: weights are not comparable across buildings — same
 * exercise, different stack — so a Day B at Alrajhi must not be measured
 * against a Day B at B_Fit. Day letter comes from the name because that is
 * where it lives; a custom-named session simply has no comparison.
 */
export async function getPreviousSameDayWorkout(current: {
  id: string;
  date: Date;
  name: string;
  gym: string | null;
}) {
  // Takes the already-loaded row, not an id: the only caller (the detail
  // page) has the workout in hand, and re-fetching it here made the
  // save-confirmation spinner wait on a duplicate query.

  const letter = current.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
  if (!letter) return null;

  const previous = await prisma.workout.findFirst({
    where: {
      id: { not: current.id },
      date: { lt: current.date },
      name: { contains: `Day ${letter}` },
      ...gymScope(current.gym ?? DEFAULT_GYM_ID),
    },
    orderBy: { date: 'desc' },
    include: { sets: { select: { reps: true, weight: true, isWarmup: true } } },
  });
  if (!previous) return null;

  // Warm-ups are excluded from volume everywhere else; keep that consistent.
  const volume = previous.sets.reduce(
    (sum, s) => sum + (s.isWarmup ? 0 : s.reps * s.weight),
    0,
  );
  return { id: previous.id, date: previous.date, volume };
}

export async function createWorkout(data: {
  name: string;
  date: string;
  gym?: string;
  notes?: string;
  duration?: number;
  /**
   * UUID of the Apple Health workout this session was logged FROM, when the
   * logger was opened off the auto-detect list. Storing it is what stops the
   * same HKWorkout being offered again on the next visit — without it the
   * detect route has to fall back on same-day matching.
   */
  healthWorkoutUuid?: string;
  /**
   * Client-generated idempotency key, set by the offline outbox. A save that
   * timed out client-side but actually landed must not become a second
   * workout when the outbox replays it — the replay finds this key and gets
   * the original row back. Plain online saves may omit it.
   */
  clientSaveId?: string;
  sets: Array<{
    exerciseId: string;
    setNumber: number;
    reps: number;
    weight: number;
    notes?: string;
    rpe?: number;
    /** ISO instant the set was ticked done in the logger, when it was. */
    completedAt?: string;
    /** Warm-up sets are logged but excluded from records/volume/plateaus. */
    isWarmup?: boolean;
  }>;
  /** Which device is finishing — its own live sets are never re-added. */
  finishSource?: LiveSource;
}) {
  if (data.clientSaveId) {
    // Any set must belong to a machine that exists, or the insert hits the
    // FK and the session becomes unsaveable under its id (steward).
    const knownIds = async (rows: Array<{ exerciseId: string }>) => {
      const ids = [...new Set(rows.map((s) => s.exerciseId))];
      if (!ids.length) return new Set<string>();
      return new Set((await prisma.exercise.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id));
    };
    // The other half of a handed-off session: the Watch finished first and
    // the phone (or the reverse) posts the same save id. Sets it logged
    // that the saved workout lacks are added; keys already saved keep the
    // first finisher's values. A plain outbox replay adds nothing. Read
    // and insert in ONE transaction so two overlapping replays cannot both
    // add the same set (steward).
    // Everything that queries runs BEFORE the transaction opens: the live
    // row (read regardless of closedAt — the first finisher closed it) and
    // the ramp allowances (up to seven round-trips on the global client,
    // which inside the tx held its connection against Prisma's 5 s
    // timeout; steward). The transaction itself is read-then-insert only.
    const priorRow = await prisma.workout.findUnique({
      where: { clientSaveId: data.clientSaveId },
      select: { gym: true },
    });
    const liveForMerge = priorRow ? await readLive(data.clientSaveId) : null;
    const allowedForMerge = priorRow ? await rampAllowances(data.sets, priorRow.gym, data.name, data.clientSaveId) : {};
    const merged = await prisma.$transaction(async (tx) => {
      const existing = await tx.workout.findUnique({
        where: { clientSaveId: data.clientSaveId },
        select: { id: true, gym: true, sets: { select: { exerciseId: true, setNumber: true, isWarmup: true } } },
      });
      if (!existing) return null;
      const ok = await knownIds(data.sets);
      // Minus anything the other device un-ticked after it was logged: the
      // Watch re-posts everything it ever logged at finish (steward B1).
      const missing = mergeCandidates(existing.sets, data.sets, liveForMerge?.sets).filter((s) => ok.has(s.exerciseId));
      if (missing.length) {
        // With the (workoutId, exerciseId, setNumber, isWarmup) unique index
        // two overlapping finishers cannot both insert the same set.
        const allowed = allowedForMerge;
        await tx.workoutSet.createMany({
          skipDuplicates: true,
          data: missing.map((s) => ({
            workoutId: existing.id,
            exerciseId: s.exerciseId,
            setNumber: s.setNumber,
            reps: s.reps,
            weight: s.weight,
            notes: s.notes || null,
            rpe: s.rpe ?? null,
            completedAt: s.completedAt ? new Date(s.completedAt) : null,
            isWarmup: s.isWarmup === true,
            allowedKg: s.isWarmup ? null : allowed[s.exerciseId] ?? null,
          })),
        });
      }
      // An HKWorkout uuid came with this save — proof the workout is in Apple
      // Health: mark it, so the phone's write-through never adds a copy.
      if (recordedInHealth({ healthWorkoutUuid: data.healthWorkoutUuid })) {
        await tx.workout.updateMany({ where: { id: existing.id, healthSyncedAt: null }, data: { healthSyncedAt: new Date() } });
      }
      return { id: existing.id, merged: missing.length };
    });
    if (merged) {
      if (merged.merged) {
        revalidatePath('/workouts');
        revalidatePath(`/workouts/${merged.id}`);
        revalidatePath('/');
      }
      await closeLive(data.clientSaveId, merged.id);
      return { id: merged.id, deduped: true, merged: merged.merged };
    }
    // Finishing a handed-off session: union in any set the OTHER device
    // logged to the live row that this device never saw. Poster wins ties;
    // the poster's own live sets are never re-added (an un-tick whose
    // remove never reached the server must stay un-ticked).
    const live = await readLive(data.clientSaveId);
    if (live && live.sets.length) {
      // A set the OTHER device un-ticked after this one logged it is gone
      // for good — the Watch re-posts everything it ever logged at finish.
      // Honoured whether or not the row is still open.
      data.sets = dropRemovedSets(data.sets, live.sets) as typeof data.sets;
      if (!live.closedAt) {
        const union = unionForFinish(data.sets, live.sets, data.finishSource);
        const ok = await knownIds(union);
        data.sets = union.filter((s) => ok.has(s.exerciseId)) as typeof data.sets;
      }
    }
  }
  // Same guard for the HKWorkout identity: without it a re-save under a
  // fresh clientSaveId hits the unique index, throws, and the outbox
  // replays a save that can never land (device-tester M1).
  if (data.healthWorkoutUuid) {
    const existing = await prisma.workout.findFirst({
      where: { healthWorkoutUuid: data.healthWorkoutUuid },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduped: true };
  }
  // The ramp's allowance is recorded on each set NOW, from the same memory
  // and pin map the prefill used — never reconstructed later.
  const allowed = await rampAllowances(data.sets, data.gym, data.name);
  const workout = await prisma.workout.create({
    data: {
      name: data.name,
      date: new Date(data.date),
      gym: data.gym || null,
      notes: data.notes || null,
      duration: data.duration ?? null,
      healthWorkoutUuid: data.healthWorkoutUuid || null,
      clientSaveId: data.clientSaveId || null,
      // Provably in Apple Health already (rule 10: record the fact at save
      // time). Anything else waits out the push delay, then is written only
      // if Health holds no strength workout over that window.
      healthSyncedAt: recordedInHealth({ healthWorkoutUuid: data.healthWorkoutUuid }) ? new Date() : null,
      sets: {
        create: data.sets.map((s) => ({
          ...s,
          completedAt: s.completedAt ? new Date(s.completedAt) : null,
          allowedKg: s.isWarmup ? null : allowed[s.exerciseId] ?? null,
        })),
      },
    },
  });
  if (data.clientSaveId) await closeLive(data.clientSaveId, workout.id);
  revalidatePath('/workouts');
  revalidatePath('/');
  return { id: workout.id };
}

export async function deleteWorkout(id: string) {
  await prisma.workout.delete({ where: { id } });
  revalidatePath('/workouts');
  revalidatePath('/');
  redirect('/workouts');
}

export type ExerciseMemory = {
  weight: number;
  reps: number;
  rpe: number | null;
  /** Two straight all-Easy sessions at the same top weight — the prefill
   *  takes one learned pin (Overload by default). Never set during a ramp
   *  (the client guards that; the flag only reports history). */
  overload?: boolean;
  /** Every rated set of the LAST session on this machine was Easy. */
  allEasy?: boolean;
  /** Ramp only: this machine has no pre-break record, so the weight is the
   *  latest in-block one and must NOT be scaled again (pickRampMemory). */
  rampHold?: boolean;
};

/**
 * Weight memory for the logger, /train and the watch plan, ramp-aware.
 * Outside a return ramp (rampBaseBeforeISO undefined) it is the plain last
 * session. In a ramp it reads the last FULL-LOAD session per machine —
 * everything before `rampBaseBefore()`, the pre-break weight the ramp
 * percentage is defined against — and falls back to the latest in-block
 * weight, held, for machines with no pre-break history. null (the latest
 * session was itself full-load) needs no cut-off.
 */
export async function getLoggerMemory(
  exerciseIds: string[],
  gym: string | null | undefined,
  rampBaseBeforeISO: string | null | undefined,
): Promise<Record<string, ExerciseMemory>> {
  if (!rampBaseBeforeISO) return getLastSessionForExercises(exerciseIds, gym);
  const [preBreak, latest] = await Promise.all([
    getLastSessionForExercises(exerciseIds, gym, new Date(rampBaseBeforeISO)),
    getLastSessionForExercises(exerciseIds, gym),
  ]);
  const out: Record<string, ExerciseMemory> = {};
  for (const id of exerciseIds) {
    const m = pickRampMemory(preBreak[id], latest[id]);
    if (m) out[id] = m;
  }
  return out;
}

/** Where the ramp stands right now, from judged rows: status, the pre-break
 *  cut-off, and the ONE pin map (judged home-gym rows + manual overrides). */
async function rampSnapshot(gym: string = DEFAULT_GYM_ID, excludeClientSaveId?: string) {
  const [allRows, exercises] = await Promise.all([
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      take: 120,
      select: { date: true, name: true, gym: true, duration: true, clientSaveId: true, sets: { select: { rpe: true, isWarmup: true, exerciseId: true, weight: true, allowedKg: true } } },
    }),
    prisma.exercise.findMany({ select: { id: true, pinIncrement: true } }),
  ]);
  // The workout being merged into is NOT history for its own allowance:
  // the first half must not step the ramp or become its own machine's
  // memory (adversary pass 4).
  const rows = excludeClientSaveId ? allRows.filter((w) => w.clientSaveId !== excludeClientSaveId) : allRows;
  const training = rows.filter((w) => isTrainingSession(w));
  const clean = cleanRampSessionDates(training);
  const status = getTrainingStatus(training.map((w) => w.date), new Date(), clean);
  // No mode gate: outside a ramp rampBaseBefore is null unless the latest
  // sessions are Rescues, which are 60% by construction and never a base
  // (adversary, 2026-09-18) — memory then reads from before them.
  const cut = rampBaseBefore(training, clean);
  // Pins are a property of ONE building's stacks (rules 2 and 4) — the
  // session's own, exactly as the Watch plan learns them.
  const pinFor = pinMapFor(training.filter((w) => (w.gym ?? DEFAULT_GYM_ID) === gym) as never, exercises);
  return { status, cut, pinFor };
}

/** The ramp cut-off for the client-side gym switch, which has no status
 *  in hand: undefined outside a ramp, else rampBaseBefore (or null). */
async function rampBase(): Promise<string | null | undefined> {
  return (await rampSnapshot()).cut;
}

/**
 * What each set of a session being saved was ALLOWED under the ramp —
 * computed once, here, from the same memory and pin map the prefill used,
 * and stored on the set (program.ts allowedRampKg). Outside a ramp, at
 * 100%, on a rescue session, or on a machine with no memory: null.
 */
async function rampAllowances(
  sets: Array<{ exerciseId: string; isWarmup?: boolean }>,
  gym: string | null | undefined,
  name: string,
  excludeClientSaveId?: string,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (name.startsWith('Rescue')) return out;
  // Never blocks a save: null means "judged on effort alone", which is the
  // fallback the design already accepts for historical rows. A column not
  // yet applied, a cold Neon, a transient error — the workout still lands
  // (steward, 2026-09-18).
  try {
    const { status, cut, pinFor } = await rampSnapshot(gym ?? DEFAULT_GYM_ID, excludeClientSaveId);
    if (status.mode !== 'return' || status.returnWeek.loadPct >= 100) return out;
    const ids = [...new Set(sets.filter((s) => !s.isWarmup).map((s) => s.exerciseId))];
    const memory = await getLoggerMemory(ids, gym ?? DEFAULT_GYM_ID, cut);
    for (const id of ids) {
      const m = memory[id];
      out[id] = m && m.weight > 0 ? allowedRampKg(m, status.returnWeek.loadPct, pinFor(id)) : null;
    }
  } catch (e) {
    console.warn('rampAllowances: skipped —', e instanceof Error ? e.message : e);
    return {};
  }
  return out;
}

export async function getLastSessionForExercises(
  exerciseIds: string[],
  gym?: string | null,
  before?: Date,
): Promise<Record<string, ExerciseMemory>> {
  if (!exerciseIds.length) return {};
  // Weight memory is per building. The same exercise sits on a different
  // machine with a different stack — and at Alrajhi Tower a stack labelled in
  // pounds — so a number carried across gyms would silently corrupt both the
  // "Try N kg" suggestion and every plateau/1RM read that follows it.
  // Sessions logged before gym tagging existed are untagged; they are all
  // B_Fit, so the home gym claims them.
  //
  // Last TWO sessions per exercise now ride the one query: Overload by
  // default needs to see whether the previous two visits to a machine were
  // both all-Easy at the same top weight. The take is generous at today's
  // scale; the fold below only ever reads the first two sessions it meets.
  const rows = await prisma.workoutSet.findMany({
    where: {
      exerciseId: { in: exerciseIds },
      isWarmup: false,
      workout: {
        ...(gym ? gymScope(gym) : {}),
        // Ramp base: strictly before the first scaled session, and never a
        // rescue session — those are 60% by construction.
        ...(before ? { date: { lt: before }, NOT: { name: { startsWith: 'Rescue' } } } : {}),
      },
    },
    orderBy: [{ workout: { date: 'desc' } }, { setNumber: 'desc' }],
    select: {
      exerciseId: true, weight: true, reps: true, rpe: true,
      workout: { select: { id: true, date: true, duration: true } },
    },
    take: Math.min(2000, exerciseIds.length * 40),
  });
  // A mis-tap row (seconds long, a handful of sets) is not memory: with it
  // the ramp base walked onto a junk row's own prefills (adversary). Judged
  // by the SAME evidence rule as the ramp, from the row's real working sets.
  const wids = [...new Set(rows.map((r) => r.workout.id))];
  const evidence = new Map<string, Array<{ rpe: number | null; isWarmup: boolean }>>();
  if (wids.length) {
    const all = await prisma.workoutSet.findMany({ where: { workoutId: { in: wids }, isWarmup: false }, select: { workoutId: true, rpe: true } });
    for (const x of all) (evidence.get(x.workoutId) ?? evidence.set(x.workoutId, []).get(x.workoutId)!).push({ rpe: x.rpe, isWarmup: false });
  }

  const out: Record<string, ExerciseMemory> = {};
  const byExercise = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!isTrainingSession({ name: 'Day', duration: r.workout.duration, sets: evidence.get(r.workout.id) ?? [] })) continue;
    const list = byExercise.get(r.exerciseId);
    if (list) list.push(r);
    else byExercise.set(r.exerciseId, [r]);
  }
  for (const [exId, sets] of byExercise) {
    // First row = last set of the latest session — byte-identical to what
    // the old `distinct` query returned as the prefill memory.
    const first = sets[0];
    // Group by calendar DAY, not workout id: a session saved in two halves
    // (compress-and-save, then finish) must count as ONE day's evidence,
    // not "two straight sessions" earned in an afternoon (adversary).
    const sessions: Array<typeof rows> = [];
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
    const allEasy = (sess: typeof rows) => {
      const rated = sess.filter((x) => x.rpe !== null && x.rpe > 0);
      // ≥2 rated sets, same bar as the ramp's "clean" — one stray Easy tap
      // per session must not add pins to the prefill (trainer).
      return rated.length >= 2 && rated.every((x) => x.rpe === 1);
    };
    const top = (sess: typeof rows) => Math.max(...sess.map((x) => x.weight));
    const overload =
      sessions.length >= 2 &&
      allEasy(sessions[0]) &&
      allEasy(sessions[1]) &&
      top(sessions[0]) === top(sessions[1]) &&
      top(sessions[0]) > 0;
    out[exId] = { weight: first.weight, reps: first.reps, rpe: first.rpe, overload, allEasy: allEasy(sessions[0]) };
  }
  return out;
}

export async function getPersonalRecords(gym?: string | null): Promise<Record<string, number>> {
  // Scoped to one building for the same reason weight memory is: a stack
  // labelled in pounds at Alrajhi reads NUMERICALLY HIGHER than the kilogram
  // equivalent, so pooling gyms would mint a false PR on the first cable
  // session and never let it be beaten again.
  const records = await prisma.workoutSet.groupBy({
    by: ['exerciseId'],
    where: { isWarmup: false, ...(gym ? { workout: gymScope(gym) } : {}) },
    _max: { weight: true },
  });
  return records.reduce<Record<string, number>>((acc, r) => {
    if (r._max.weight !== null) acc[r.exerciseId] = r._max.weight;
    return acc;
  }, {});
}

export async function getExerciseHistory(exerciseId: string, gym: string = DEFAULT_GYM_ID) {
  const exercise = await prisma.exercise.findUnique({
    where: { id: exerciseId },
    select: { name: true, category: true },
  });
  if (!exercise) return null;

  // Gym-scoped (review catch): pooled history let a work-gym entry wear a
  // false PR badge on the progress chart — the exact cross-gym corruption
  // getPersonalRecords already guards against. Warm-ups never chart.
  const sets = await prisma.workoutSet.findMany({
    where: { exerciseId, isWarmup: false, workout: gymScope(gym) },
    orderBy: { workout: { date: 'asc' } },
    select: {
      weight: true,
      reps: true,
      workout: { select: { date: true, name: true } },
    },
  });

  const bySession = new Map<
    string,
    { date: Date; maxWeight: number; reps: number; sessionName: string }
  >();
  for (const s of sets) {
    const key = s.workout.date.toISOString().split('T')[0];
    const existing = bySession.get(key);
    if (!existing || s.weight > existing.maxWeight) {
      bySession.set(key, {
        date: s.workout.date,
        maxWeight: s.weight,
        reps: s.reps,
        sessionName: s.workout.name,
      });
    }
  }

  const history = Array.from(bySession.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const pr = history.reduce((m, h) => Math.max(m, h.maxWeight), 0);

  // "Improvement" compares the last FULL-LOAD session to the first; a ramp
  // session is scaled by design (rule 7). Never blocks the page.
  let latestWeight: number | null = history[history.length - 1]?.maxWeight ?? null;
  try {
    const { cut } = await rampSnapshot(gym);
    if (cut) latestWeight = lastFullLoad(history, cut)?.maxWeight ?? null;
  } catch {
    /* judged on the latest row */
  }

  return { exercise, history, pr, totalSessions: history.length, latestWeight };
}

// Body stats
export async function getBodyStats() {
  return prisma.bodyStat.findMany({ orderBy: { date: 'asc' } });
}

export async function addBodyStat(data: { weight?: number; waist?: number; arms?: number; date: string }) {
  await prisma.bodyStat.create({
    data: {
      date: new Date(data.date),
      weight: data.weight ?? null,
      waist: data.waist ?? null,
      arms: data.arms ?? null,
    },
  });
  revalidatePath('/stats');
}

export async function deleteBodyStat(id: string) {
  await prisma.bodyStat.delete({ where: { id } });
  revalidatePath('/stats');
}

/**
 * Imports a HealthKit cardio session (his Day B swim) as a lightweight workout
 * with NO sets. There is nothing to log set-wise — the session is a duration
 * and a name, and inventing a fake set just to satisfy the shape would poison
 * every volume, PR and effort number in the app.
 *
 * Idempotent on the HealthKit UUID, so a double tap (or a re-offer after a
 * failed refresh) returns the existing row instead of creating a twin.
 */
export async function importHealthWorkout(input: {
  /** HKWorkout UUID — the idempotency key. */
  healthWorkoutUuid: string;
  name: string;
  /** ISO instant the HealthKit session started; kept as the workout date. */
  dateISO: string;
  durationSec: number;
  /** Energy as HealthKit recorded it. Never an app-side estimate. */
  activeKcal?: number | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.workout.findFirst({
    where: { healthWorkoutUuid: input.healthWorkoutUuid },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const date = new Date(input.dateISO);
  const durationSec = Math.round(input.durationSec);
  const workout = await prisma.workout.create({
    data: {
      name: input.name,
      // The real start instant, not a bare day: this is the one workout kind
      // whose exact clock time is known, and it is what lets the detect route
      // recognise the session by overlap afterwards.
      date: Number.isNaN(date.getTime()) ? new Date() : date,
      duration: durationSec > 0 ? durationSec : null,
      activeKcal:
        input.activeKcal != null && input.activeKcal > 0 ? Math.round(input.activeKcal) : null,
      healthWorkoutUuid: input.healthWorkoutUuid,
      // Already in Apple Health — that is where it came from. Marking it synced
      // keeps /api/health/workouts from pushing it straight back and creating a
      // duplicate HKWorkout for the same swim.
      healthSyncedAt: new Date(),
    },
  });

  revalidatePath('/workouts');
  revalidatePath('/');
  revalidatePath('/stats');
  return { id: workout.id, created: true };
}

// ── Wave 2 ───────────────────────────────────────────────────

/**
 * Hevy's headline feature: best weight AT EACH REP COUNT, per gym. On a
 * 12–15-rep pin-stack program, reps climbing at the same pin are the main
 * form of progress — invisible to a heaviest-ever PR. exerciseId → reps →
 * best kg. Warm-ups never count.
 */
export async function getRepRecords(
  gym?: string | null,
): Promise<Record<string, Record<number, number>>> {
  // groupBy pushes the max() into SQL — the old version pulled EVERY
  // non-warmup set ever logged into JS to fold it by hand, a cost that grew
  // with every session forever. Same result shape, same gymScope semantics.
  //
  // Deliberately UNBOUNDED by exercise: records must cover exercises added
  // to the form AFTER a gym switch, or the first done set on one mints a
  // fake "best N-rep set" toast (data-steward, this wave — the same class
  // as the shipped fake-PR bug CLAUDE.md rule 2 records).
  const grouped = await prisma.workoutSet.groupBy({
    by: ['exerciseId', 'reps'],
    where: {
      isWarmup: false,
      weight: { gt: 0 },
      ...(gym ? { workout: gymScope(gym) } : {}),
    },
    _max: { weight: true },
  });
  const records: Record<string, Record<number, number>> = {};
  for (const g of grouped) {
    if (g._max.weight === null) continue;
    (records[g.exerciseId] ??= {})[g.reps] = g._max.weight;
  }
  return records;
}

/**
 * The mid-workout gym switch in ONE round trip. Three separate POSTs used to
 * race from gym LTE to us-east-1 and the prefill waited on the slowest;
 * the parallelism belongs next to the database, not on the radio.
 */
export async function getGymMemory(exerciseIds: string[], gym: string) {
  const [lastSession, personalRecords, repRecords] = await Promise.all([
    rampBase().then((cut) => getLoggerMemory(exerciseIds, gym, cut)),
    getPersonalRecords(gym),
    getRepRecords(gym),
  ]);
  return { lastSession, personalRecords, repRecords };
}

/**
 * Last few sessions of one exercise at one gym — the mid-workout history
 * drawer. Fetched lazily when the ⓘ layer opens; not part of page load.
 */
export async function getRecentExerciseSessions(
  exerciseId: string,
  gym: string,
  limit = 3,
): Promise<Array<{ date: string; topWeight: number; reps: number; rpe: number | null }>> {
  const sets = await prisma.workoutSet.findMany({
    where: { exerciseId, isWarmup: false, weight: { gt: 0 }, workout: gymScope(gym) },
    orderBy: { workout: { date: 'desc' } },
    select: { weight: true, reps: true, rpe: true, workout: { select: { date: true } } },
    take: 60,
  });
  const bySession = new Map<string, { date: string; topWeight: number; reps: number; rpe: number | null }>();
  for (const s of sets) {
    const key = s.workout.date.toISOString().split('T')[0];
    const cur = bySession.get(key);
    if (!cur || s.weight > cur.topWeight) {
      bySession.set(key, { date: key, topWeight: s.weight, reps: s.reps, rpe: s.rpe });
    }
  }
  return [...bySession.values()].slice(0, limit);
}

// ── Holds — "holding, not losing" ────────────────────────────

export async function getActiveHold(): Promise<{ id: string; endsAt: string; reason: string | null } | null> {
  const hold = await prisma.hold.findFirst({
    where: { endsAt: { gt: new Date() } },
    orderBy: { endsAt: 'desc' },
    select: { id: true, endsAt: true, reason: true },
  });
  return hold ? { id: hold.id, endsAt: hold.endsAt.toISOString(), reason: hold.reason } : null;
}

/** Declare a bounded hold. Capped at 3 weeks — longer is a decision to remake. */
export async function startHold(days: number, reason?: string) {
  const bounded = Math.min(21, Math.max(3, Math.round(days)));
  const hold = await prisma.hold.create({
    data: { endsAt: new Date(Date.now() + bounded * 86_400_000), reason: reason || null },
  });
  revalidatePath('/');
  revalidatePath('/stats');
  return { id: hold.id, endsAt: hold.endsAt.toISOString() };
}

export async function endHold(id: string) {
  // Ending early = expiring now; the row stays as history for streak grace.
  await prisma.hold.update({ where: { id }, data: { endsAt: new Date() } });
  revalidatePath('/');
  revalidatePath('/stats');
}

/** A tapped proposal is consumed for the whole day — the Approve button
 *  must never come back on a remount and invite a duplicate tap. */
async function consumeCoachProposal(): Promise<void> {
  const { todayKey } = await import('@/lib/coach-context');
  const { Prisma } = await import('@prisma/client');
  await prisma.coachNote
    .updateMany({ where: { day: todayKey() }, data: { proposal: Prisma.DbNull } })
    .catch(() => { /* pre-schema window — nothing to consume */ });
}

/**
 * Approve a coach-proposed hold. The bounds live HERE, in code, regardless
 * of what the model wrote (adversary rule: guards are enforcement, not
 * prompt discipline): 3–7 days (trainer: a real circumstance can be
 * re-proposed; 14 app-endorsed silent days cannot), AND the hold may never
 * end later than 20 days after the last training session — so no approved
 * hold can silently carry him across the day-21 ramp threshold.
 * Idempotent: an already-active hold is returned, never duplicated.
 */
export async function approveCoachHold(
  days: number,
  reason?: string,
): Promise<{ id: string; endsAt: string; clamped: boolean; already: boolean } | null> {
  await consumeCoachProposal();

  const active = await prisma.hold.findFirst({
    where: { endsAt: { gt: new Date() } },
    orderBy: { endsAt: 'desc' },
    select: { id: true, endsAt: true },
  });
  if (active) {
    return { id: active.id, endsAt: active.endsAt.toISOString(), clamped: false, already: true };
  }

  const bounded = Math.min(7, Math.max(3, Math.round(days)));
  const lastTraining = await prisma.workout.findFirst({
    where: { NOT: { name: { startsWith: 'Rescue walk' } } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  let endsAt = new Date(Date.now() + bounded * 86_400_000);
  let clamped = false;
  if (lastTraining) {
    const rampFence = new Date(lastTraining.date.getTime() + 20 * 86_400_000);
    if (endsAt > rampFence) {
      endsAt = rampFence;
      clamped = true;
    }
  }
  if (endsAt.getTime() <= Date.now()) return null; // fence already passed — no hold to give
  const hold = await prisma.hold.create({
    data: { endsAt, reason: reason ? `coach: ${reason.slice(0, 60)}` : 'coach proposal' },
  });
  revalidatePath('/');
  revalidatePath('/stats');
  return { id: hold.id, endsAt: hold.endsAt.toISOString(), clamped, already: false };
}

/** Approve a coach-proposed early hold end. Ends EVERY active hold — a
 *  duplicate row must not keep the ladder paused after "hold ended". */
export async function approveCoachEndHold(): Promise<boolean> {
  await consumeCoachProposal();
  const now = new Date();
  const ended = await prisma.hold.updateMany({
    where: { endsAt: { gt: now } },
    data: { endsAt: now },
  });
  if (!ended.count) return false;
  revalidatePath('/');
  revalidatePath('/stats');
  return true;
}

/**
 * The one-line answer to "what got in the way?" at the welcome-back moment.
 * Stored on the comeback workout itself; only the coach's context reads it.
 */
export async function saveGapReason(workoutId: string, reason: string): Promise<void> {
  const trimmed = reason.trim().slice(0, 140);
  if (!trimmed) return;
  await prisma.workout.update({ where: { id: workoutId }, data: { gapReason: trimmed } });
  revalidatePath(`/workouts/${workoutId}`);
}

/** Every hold that overlaps history — the streak excuses these weeks. */
export async function getAllHolds(): Promise<Array<{ startsAt: string; endsAt: string }>> {
  const holds = await prisma.hold.findMany({ select: { startsAt: true, endsAt: true } });
  return holds.map((h) => ({ startsAt: h.startsAt.toISOString(), endsAt: h.endsAt.toISOString() }));
}

/**
 * The zero-equipment rescue: a 15-minute brisk walk logged as a real session
 * so the chain (streak, Gap Guard, dynamic plan recovery day) stays intact.
 * No sets — the walk IS the content, like an imported swim.
 */
export async function logRescueWalk() {
  // Idempotent per calendar day (steward's veto): a timed-out-but-landed
  // tap must not create two walks — two phantom sessions on one day would
  // falsely mend a streak and permanently inflate the lifetime count.
  // The owner's activity day (04:00 Riyadh rollover), stored as UTC
  // midnight like every other writer — server-local midnight let two taps
  // at 02:00 and 03:30 Riyadh straddle 00:00 UTC (steward, 2026-09-18).
  const dayStart = ownerActivityDayUtc();
  const existing = await prisma.workout.findFirst({
    where: { name: { startsWith: 'Rescue walk' }, date: { gte: dayStart } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, deduped: true };

  const workout = await prisma.workout.create({
    data: {
      name: `Rescue walk 15m — ${dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
      date: dayStart,
      duration: 15 * 60,
      notes: 'Zero-equipment rescue session — keeping the chain alive.',
    },
  });
  revalidatePath('/');
  revalidatePath('/workouts');
  return { id: workout.id };
}

/** Last N days of a persisted daily recovery metric, oldest first. */
export async function getDailyHealthValues(type: string, days = 14): Promise<Array<number | null>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.healthSample.findMany({
    where: { type, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { value: true },
  });
  return rows.map((r) => r.value);
}

/** The open live session (from either device), for the logger and the
 *  draft pill — or, with an id, that row whatever its state. */
/** RAW row, tombstones included — the phone's overlay honours them (live-session.ts). */
export async function getLiveSession(id?: string) {
  return readLive(id);
}

/** The phone logger's per-set push: fire-and-forget from the client. */
export async function pushLiveSets(
  meta: { clientSaveId: string; day?: 'A' | 'B' | null; durationMin?: number | null; gym?: string | null; startedAt?: string | null },
  updates: LiveSetUpdate[],
) {
  const clean = updates
    .map((u) => sanitizeLiveUpdate(u, 'phone'))
    .filter((u): u is LiveSetUpdate => u !== null);
  return upsertLive({ ...meta, source: 'phone' }, clean);
}

/** Discarded on the phone: tell the Watch to stop offering it. */
export async function closeLiveSession(clientSaveId: string) {
  await closeLive(clientSaveId);
}

/**
 * A swim or a walk as its own workout (owner, 2026-09-02: "typically swim
 * for 15 minutes"). Cardio counts for the streak and nothing else —
 * isTrainingSession keeps it out of the plan, the ramp and the coach's
 * session maths. Idempotent per day and kind (steward: two phantom
 * sessions on one day would falsely mend a streak); a swim HealthKit
 * already imported today dedupes the same way.
 */
export async function logCardio(kind: 'swim' | 'walk', minutes: number) {
  const mins = Math.max(5, Math.min(180, Math.round(minutes)));
  const prefix = kind === 'swim' ? 'Swim ' : 'Walk ';
  // The day the activity BELONGS to, which rolls over at 04:00 Riyadh —
  // he logs from the sofa after training, and a swim at 21:00 tapped in at
  // 00:30 was filing itself under the next date (2026-09-13). Also keeps
  // the row at UTC midnight of that day, like every other workout: letting
  // `date` default to now() stored a real instant (found 2026-09-11).
  const dayStart = ownerActivityDayUtc();
  const existing = await prisma.workout.findFirst({
    where: { name: { startsWith: prefix }, date: { gte: dayStart } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, deduped: true };
  const workout = await prisma.workout.create({
    data: {
      name: `${prefix}${mins}m — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' })}`,
      date: dayStart,
      duration: mins * 60,
      notes: kind === 'swim' ? 'Swim — recovery, keeps the chain alive.' : 'Walk — recovery, keeps the chain alive.',
    },
  });
  revalidatePath('/');
  revalidatePath('/train');
  revalidatePath('/workouts');
  return { id: workout.id };
}
