'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DEFAULT_GYM_ID } from '@/lib/program';

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
  const name = formData.get('name') as string;
  const category = formData.get('category') as string;
  await prisma.exercise.create({ data: { name, category } });
  revalidatePath('/exercises');
}

export async function deleteExercise(id: string) {
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
}) {
  if (data.clientSaveId) {
    const existing = await prisma.workout.findUnique({
      where: { clientSaveId: data.clientSaveId },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduped: true };
  }
  const workout = await prisma.workout.create({
    data: {
      name: data.name,
      date: new Date(data.date),
      gym: data.gym || null,
      notes: data.notes || null,
      duration: data.duration ?? null,
      healthWorkoutUuid: data.healthWorkoutUuid || null,
      clientSaveId: data.clientSaveId || null,
      sets: {
        create: data.sets.map((s) => ({
          ...s,
          completedAt: s.completedAt ? new Date(s.completedAt) : null,
        })),
      },
    },
  });
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

export async function getLastSessionForExercises(
  exerciseIds: string[],
  gym?: string | null,
): Promise<Record<string, { weight: number; reps: number; rpe: number | null }>> {
  if (!exerciseIds.length) return {};
  // Weight memory is per building. The same exercise sits on a different
  // machine with a different stack — and at Alrajhi Tower a stack labelled in
  // pounds — so a number carried across gyms would silently corrupt both the
  // "Try N kg" suggestion and every plateau/1RM read that follows it.
  // Sessions logged before gym tagging existed are untagged; they are all
  // B_Fit, so the home gym claims them.
  const lastSets = await prisma.workoutSet.findMany({
    where: { exerciseId: { in: exerciseIds }, isWarmup: false, workout: gym ? gymScope(gym) : {} },
    orderBy: [{ workout: { date: 'desc' } }, { setNumber: 'desc' }],
    distinct: ['exerciseId'],
    select: { exerciseId: true, weight: true, reps: true, rpe: true },
  });
  return lastSets.reduce<Record<string, { weight: number; reps: number; rpe: number | null }>>((acc, s) => {
    acc[s.exerciseId] = { weight: s.weight, reps: s.reps, rpe: s.rpe };
    return acc;
  }, {});
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

  return { exercise, history, pr, totalSessions: history.length };
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

// Apple Health bridge
export async function getHealthOverview(): Promise<{
  lastWeightSync: Date | null;
  samplesTotal: number;
  enrichedWorkouts: number;
}> {
  const [lastWeight, samplesTotal, enrichedWorkouts] = await Promise.all([
    prisma.healthSample.findFirst({
      where: { type: 'weight' },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    prisma.healthSample.count(),
    prisma.workout.count({
      where: { OR: [{ avgHr: { not: null } }, { activeKcal: { not: null } }] },
    }),
  ]);
  return {
    lastWeightSync: lastWeight?.date ?? null,
    samplesTotal,
    enrichedWorkouts,
  };
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
  exerciseIds?: string[],
): Promise<Record<string, Record<number, number>>> {
  // groupBy pushes the max() into SQL — the old version pulled EVERY
  // non-warmup set ever logged into JS to fold it by hand, a cost that grew
  // with every session forever. Same result shape, same gymScope semantics.
  const grouped = await prisma.workoutSet.groupBy({
    by: ['exerciseId', 'reps'],
    where: {
      isWarmup: false,
      weight: { gt: 0 },
      ...(exerciseIds?.length ? { exerciseId: { in: exerciseIds } } : {}),
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
    getLastSessionForExercises(exerciseIds, gym),
    getPersonalRecords(gym),
    getRepRecords(gym, exerciseIds),
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
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const existing = await prisma.workout.findFirst({
    where: { name: { startsWith: 'Rescue walk' }, date: { gte: dayStart } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, deduped: true };

  const workout = await prisma.workout.create({
    data: {
      name: `Rescue walk 15m — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
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
