'use server';

// Health wave server actions. Same posture as the rest of the app: single
// user, open access by owner decision, writes validated and bounded here.
// The app is a tracker, not a diagnostic tool — nothing in this file
// interprets; it stores, seeds, and reads.

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { DEFAULT_DOSE_PLAN, DEFAULT_ROTATION, SITES, bpAverage, fuelTargets, fuelWeek, weightPace } from '@/lib/health-insights';
import { importHealthSamples } from '@/lib/health-import';
import { detectUnloggedWorkouts } from '@/lib/health-detect';
import { storeHrSeries } from '@/lib/health-hr';

const PROFILE_ID = 'profile';

const SYMPTOM_KINDS = new Set([
  'nausea', 'bloating', 'gas', 'reflux', 'burping', 'constipation',
  'diarrhea', 'vomiting', 'abdominal-pain', 'fatigue', 'headache',
  'dizziness', 'appetite-suppression', 'fullness',
]);

function revalidateHealth() {
  revalidatePath('/health');
  revalidatePath('/health/injection');
  revalidatePath('/health/timeline');
  revalidatePath('/');
}

// ── Profile (seeded once, everything editable) ───────────────

export async function ensureHealthProfile() {
  const existing = await prisma.healthProfile.findUnique({ where: { id: PROFILE_ID } });
  if (existing) return existing;

  // First visit: seed his baseline. Values are starting points, not truth —
  // every one is editable on /health/plan. Upsert, not create: two racing
  // first visits must not throw on the unique id (data-steward).
  const profile = await prisma.healthProfile.upsert({
    where: { id: PROFILE_ID },
    update: {},
    create: {
      id: PROFILE_ID,
      heightCm: 169,
      startWeightKg: 133,
      goalWeightKg: 103,
      milestonesKg: [120, 110, 103],
      conditions: [
        'Obesity', 'Hypertension', 'Atrial fibrillation',
        'Obstructive sleep apnea', 'High LDL cholesterol',
        'Recurrent bloating / gas',
      ],
      dosePlan: DEFAULT_DOSE_PLAN as unknown as object[],
      targets: { proteinG: 100, waterMl: 2500, rotation: DEFAULT_ROTATION },
      reminders: { injection: true, missed: true, daySymptoms: true, cpapBedtime: false },
    },
  });

  // Seed medications + the known baseline lab only alongside a fresh
  // profile, so a deliberate delete stays deleted. Best-effort: a failed
  // seed row must not take the whole health hub down.
  try {
    await prisma.medication.createMany({
      data: [
        { name: 'Mounjaro (tirzepatide)', doseLabel: 'per dose plan', frequency: 'weekly' },
        { name: 'Nebilet (nebivolol)', doseLabel: '10 mg', frequency: 'daily' },
      ],
    });
    await prisma.labResult.create({
      data: { date: new Date(), test: 'ldl', value: 4.54, unit: 'mmol/L', refHigh: 3.4, notes: 'baseline (pre-app)' },
    });
  } catch {
    /* seeds are conveniences; the profile is the contract */
  }
  return profile;
}

export async function updateHealthProfile(data: {
  heightCm?: number;
  startWeightKg?: number;
  goalWeightKg?: number;
  milestonesKg?: number[];
  dosePlan?: Array<{ week: number; mg: number | null; label?: string }>;
  targets?: Record<string, unknown>;
  reminders?: Record<string, boolean>;
}) {
  const clean: Record<string, unknown> = {};
  if (data.heightCm && data.heightCm > 100 && data.heightCm < 250) clean.heightCm = data.heightCm;
  if (data.startWeightKg && data.startWeightKg > 30) clean.startWeightKg = data.startWeightKg;
  if (data.goalWeightKg && data.goalWeightKg > 30) clean.goalWeightKg = data.goalWeightKg;
  if (data.milestonesKg) clean.milestonesKg = data.milestonesKg.filter((k) => k > 30 && k < 300);
  if (data.dosePlan) {
    // Dose bounds are wide on purpose (doctor-directed custom doses exist),
    // but never negative and never absurd.
    clean.dosePlan = data.dosePlan
      .filter((s) => Number.isFinite(s.week) && s.week >= 1 && s.week <= 104)
      .map((s) => ({
        week: Math.round(s.week),
        mg: s.mg == null ? null : Math.min(20, Math.max(0.5, s.mg)),
        ...(s.label ? { label: String(s.label).slice(0, 80) } : {}),
      }));
  }
  if (data.targets) clean.targets = data.targets;
  if (data.reminders) clean.reminders = data.reminders;
  await prisma.healthProfile.update({ where: { id: PROFILE_ID }, data: clean });
  revalidateHealth();
}

// ── Injections ───────────────────────────────────────────────

export async function logInjection(data: {
  doseMg: number;
  site: string;
  at?: string;
  penMg?: number;
  clicks?: number;
  onSchedule?: boolean;
  notes?: string;
}) {
  if (!Number.isFinite(data.doseMg) || data.doseMg < 0.5 || data.doseMg > 20) {
    throw new Error('Dose out of range');
  }
  if (!(SITES as readonly string[]).includes(data.site)) throw new Error('Unknown site');
  const injection = await prisma.injection.create({
    data: {
      doseMg: data.doseMg,
      site: data.site,
      at: data.at ? new Date(data.at) : new Date(),
      penMg: data.penMg ?? null,
      clicks: data.clicks ?? null,
      onSchedule: data.onSchedule ?? true,
      notes: data.notes?.slice(0, 500) || null,
    },
  });
  revalidateHealth();
  return { id: injection.id };
}

export async function deleteInjection(id: string) {
  await prisma.injection.delete({ where: { id } });
  revalidateHealth();
}

// ── Symptoms (side effects + GI, one stream) ─────────────────

export async function logSymptoms(
  entries: Array<{ kind: string; severity: number; notes?: string; context?: Record<string, unknown> }>,
  at?: string,
) {
  const rows = entries
    .filter((e) => SYMPTOM_KINDS.has(e.kind) && e.severity >= 0 && e.severity <= 3)
    // Severity 0 entries are dropped, not stored: "none" is the absence of
    // a log, and storing zeros would flood day-relative averages with
    // meaningless rows.
    .filter((e) => e.severity > 0)
    .map((e) => ({
      kind: e.kind,
      severity: Math.round(e.severity),
      at: at ? new Date(at) : new Date(),
      notes: e.notes?.slice(0, 300) || null,
      context: e.context ? (e.context as object) : undefined,
    }));
  if (rows.length) await prisma.symptomLog.createMany({ data: rows });
  revalidateHealth();
  return { logged: rows.length };
}

// ── AF episodes ──────────────────────────────────────────────

export async function logAfEpisode(data: {
  startedAt: string;
  durationMin?: number;
  hrBpm?: number;
  ecgRecorded?: boolean;
  bloating?: boolean;
  gas?: boolean;
  afterMeal?: boolean;
  sleepRelated?: boolean;
  exerciseRelated?: boolean;
  caffeine?: boolean;
  dehydration?: boolean;
  stress?: boolean;
  notes?: string;
}) {
  const startedAt = new Date(data.startedAt);
  if (Number.isNaN(startedAt.getTime())) throw new Error('Bad start time');
  const durationMin =
    data.durationMin != null && data.durationMin > 0 && data.durationMin < 24 * 60
      ? Math.round(data.durationMin)
      : null;
  await prisma.afEpisode.create({
    data: {
      startedAt,
      durationMin,
      endedAt: durationMin ? new Date(startedAt.getTime() + durationMin * 60_000) : null,
      hrBpm: data.hrBpm && data.hrBpm > 20 && data.hrBpm < 300 ? Math.round(data.hrBpm) : null,
      ecgRecorded: data.ecgRecorded ?? false,
      bloating: data.bloating ?? null,
      gas: data.gas ?? null,
      afterMeal: data.afterMeal ?? null,
      sleepRelated: data.sleepRelated ?? null,
      exerciseRelated: data.exerciseRelated ?? null,
      caffeine: data.caffeine ?? null,
      dehydration: data.dehydration ?? null,
      stress: data.stress ?? null,
      notes: data.notes?.slice(0, 500) || null,
    },
  });
  revalidateHealth();
}

export async function deleteAfEpisode(id: string) {
  await prisma.afEpisode.delete({ where: { id } });
  revalidateHealth();
}

// ── Blood pressure ───────────────────────────────────────────

export async function logBp(data: {
  systolic: number;
  diastolic: number;
  pulse?: number;
  context?: string;
  at?: string;
}) {
  if (data.systolic < 60 || data.systolic > 260 || data.diastolic < 30 || data.diastolic > 160) {
    throw new Error('Reading out of range');
  }
  await prisma.bpReading.create({
    data: {
      systolic: Math.round(data.systolic),
      diastolic: Math.round(data.diastolic),
      pulse: data.pulse && data.pulse > 20 && data.pulse < 250 ? Math.round(data.pulse) : null,
      context: data.context?.slice(0, 30) || null,
      at: data.at ? new Date(data.at) : new Date(),
    },
  });
  revalidateHealth();
}

export async function deleteBpReading(id: string) {
  await prisma.bpReading.delete({ where: { id } });
  revalidateHealth();
}

// ── CPAP nights ──────────────────────────────────────────────

export async function logCpapNight(data: {
  night: string; // bare date "2026-08-25" — the night that ENDED that morning
  usageHours: number;
  ahi?: number;
  leak?: number;
  avgPressure?: number;
  p95Pressure?: number;
  maskComfort?: number;
  notes?: string;
}) {
  if (!Number.isFinite(data.usageHours) || data.usageHours < 0 || data.usageHours > 16) {
    throw new Error('Usage hours out of range');
  }
  const night = new Date(`${data.night}T00:00:00.000Z`);
  if (Number.isNaN(night.getTime())) throw new Error('Bad night date');
  // PATCH semantics (adversary blocker class): only fields actually
  // provided reach the update — re-entering corrected hours must never
  // null out the AHI/leak/pressure that were saved earlier.
  const patch: Record<string, number | string> = {
    usageHours: Math.round(data.usageHours * 10) / 10,
  };
  if (data.ahi != null && data.ahi >= 0 && data.ahi < 150) patch.ahi = data.ahi;
  if (data.leak != null && data.leak >= 0) patch.leak = data.leak;
  if (data.avgPressure != null && data.avgPressure > 0 && data.avgPressure < 30) patch.avgPressure = data.avgPressure;
  if (data.p95Pressure != null && data.p95Pressure > 0 && data.p95Pressure < 30) patch.p95Pressure = data.p95Pressure;
  if (data.maskComfort != null && data.maskComfort >= 0 && data.maskComfort <= 3) patch.maskComfort = Math.round(data.maskComfort);
  if (data.notes) patch.notes = data.notes.slice(0, 300);
  await prisma.cpapNight.upsert({
    where: { night },
    update: patch,
    create: { night, ...patch } as never,
  });
  revalidateHealth();
}

// ── Labs ─────────────────────────────────────────────────────

export async function addLabResult(data: {
  date: string;
  test: string;
  value: number;
  unit: string;
  refLow?: number;
  refHigh?: number;
  lab?: string;
  notes?: string;
}) {
  if (!data.test.trim() || !Number.isFinite(data.value)) throw new Error('Bad lab entry');
  await prisma.labResult.create({
    data: {
      date: new Date(data.date),
      test: data.test.trim().toLowerCase().slice(0, 40),
      value: data.value,
      unit: data.unit.slice(0, 20),
      refLow: data.refLow ?? null,
      refHigh: data.refHigh ?? null,
      lab: data.lab?.slice(0, 80) || null,
      notes: data.notes?.slice(0, 300) || null,
    },
  });
  revalidateHealth();
}

export async function deleteLabResult(id: string) {
  await prisma.labResult.delete({ where: { id } });
  revalidateHealth();
}

// ── Nutrition (lightweight by decision) ──────────────────────

export async function logNutrition(data: {
  day: string;
  proteinG?: number;
  waterMl?: number;
  fiberG?: number;
  meals?: number;
  kcal?: number;
  carbsG?: number;
  fatG?: number;
  flags?: { largeMeal?: boolean; highFat?: boolean; lateNight?: boolean };
}) {
  const day = new Date(`${data.day}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) throw new Error('Bad day');
  // PATCH semantics (adversary BLOCKER): protein in the morning, water in
  // the evening is the NORMAL flow — the evening upsert must never null
  // the morning's protein. Only provided fields reach the update.
  const patch: Record<string, number | object> = {};
  const bounded = (v: number | undefined, max: number) =>
    v != null && v >= 0 && v <= max ? Math.round(v) : undefined;
  const p = bounded(data.proteinG, 400);
  const w = bounded(data.waterMl, 10_000);
  const f = bounded(data.fiberG, 150);
  const m = bounded(data.meals, 12);
  const kc = bounded(data.kcal, 8000);
  const cb = bounded(data.carbsG, 900);
  const ft = bounded(data.fatG, 400);
  if (p !== undefined) patch.proteinG = p;
  if (w !== undefined) patch.waterMl = w;
  if (f !== undefined) patch.fiberG = f;
  if (m !== undefined) patch.meals = m;
  if (kc !== undefined) patch.kcal = kc;
  if (cb !== undefined) patch.carbsG = cb;
  if (ft !== undefined) patch.fatG = ft;
  if (data.flags) patch.flags = data.flags as object;
  if (!Object.keys(patch).length) return;
  await prisma.nutritionLog.upsert({ where: { day }, update: patch, create: { day, ...patch } as never });
  revalidateHealth();
}

/** Merge fuel targets into profile.targets without clobbering the other
 *  keys that live there (rotation, waterMl, proteinG for the check-in). */
export async function updateFuelTargets(next: {
  kcal: number;
  fuelProteinG: number;
  carbsG: number;
  fatG: number;
}) {
  const profile = await prisma.healthProfile.findUnique({
    where: { id: PROFILE_ID },
    select: { targets: true },
  });
  const current = (profile?.targets as Record<string, unknown> | null) ?? {};
  // Out-of-range means LEAVE UNCHANGED, never clamp: a cleared input
  // arrives as 0 and used to save as the range floor while the UI said
  // "Targets saved" (adversary S2). Same reject-don't-clamp rule as the
  // read side (fuelTargets).
  const valid = (v: number, lo: number, hi: number) =>
    Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
  const merged = {
    ...current,
    ...(valid(next.kcal, 800, 6000) != null ? { kcal: valid(next.kcal, 800, 6000) } : {}),
    ...(valid(next.fuelProteinG, 30, 400) != null ? { fuelProteinG: valid(next.fuelProteinG, 30, 400) } : {}),
    ...(valid(next.carbsG, 0, 800) != null ? { carbsG: valid(next.carbsG, 0, 800) } : {}),
    ...(valid(next.fatG, 20, 400) != null ? { fatG: valid(next.fatG, 20, 400) } : {}),
  };
  await prisma.healthProfile.update({ where: { id: PROFILE_ID }, data: { targets: merged } });
  revalidateHealth();
}


// ── The Sunday recap ─────────────────────────────────────────

/**
 * One sentence for the week, composed from whatever cleared its guard —
 * a missing piece is simply omitted, never zero-filled. Null when nothing
 * qualified (a silent week gets silence, not an empty notification).
 */
export async function getWeeklyDigest(): Promise<string | null> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [bodyStats, sessions, nutrition, bp, cpap, profile] = await Promise.all([
    prisma.bodyStat.findMany({ orderBy: { date: 'desc' }, take: 30, select: { date: true, weight: true } }),
    prisma.workout.count({ where: { date: { gte: weekAgo }, NOT: { name: { startsWith: 'Rescue walk' } } } }),
    prisma.nutritionLog.findMany({ orderBy: { day: 'desc' }, take: 10, select: { day: true, kcal: true, proteinG: true } }),
    prisma.bpReading.findMany({ where: { at: { gte: weekAgo } }, select: { at: true, systolic: true, diastolic: true } }),
    prisma.cpapNight.findMany({ where: { night: { gte: weekAgo } }, select: { usageHours: true } }),
    prisma.healthProfile.findUnique({ where: { id: PROFILE_ID }, select: { targets: true } }),
  ]);

  const parts: string[] = [];
  const pace = weightPace(bodyStats);
  if (pace) parts.push(`${pace.kgPerWeek > 0 ? '+' : pace.kgPerWeek < 0 ? '\u2212' : ''}${Math.abs(pace.kgPerWeek)} kg`);
  if (sessions > 0) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
  const targets = fuelTargets((profile?.targets as Record<string, unknown> | null) ?? null);
  const week = fuelWeek(nutrition, targets);
  if (week.proteinLoggedDays > 0) parts.push(`protein ${week.proteinHitDays}/${week.proteinLoggedDays}`);
  const bp7 = bpAverage(bp, 7);
  if (bp7) parts.push(`BP ${bp7.systolic}/${bp7.diastolic}`);
  const maskNights = cpap.filter((n) => (n.usageHours ?? 0) >= 4).length;
  if (maskNights > 0) parts.push(`${maskNights} night${maskNights === 1 ? '' : 's'} on the mask`);

  return parts.length >= 2 ? `${parts.join(' \u00b7 ')}.` : null;
}

// ── Reads for the pages ──────────────────────────────────────

export async function getHealthData() {
  const profile = await ensureHealthProfile();
  const [injections, symptoms, afEpisodes, bpReadings, cpapNights, labs, meds, bodyStats, nutrition, firstInjection, injectionCount] =
    await Promise.all([
      prisma.injection.findMany({ orderBy: { at: 'desc' }, take: 200 }),
      prisma.symptomLog.findMany({ orderBy: { at: 'desc' }, take: 1000 }),
      prisma.afEpisode.findMany({ orderBy: { startedAt: 'desc' }, take: 300 }),
      prisma.bpReading.findMany({ orderBy: { at: 'desc' }, take: 500 }),
      prisma.cpapNight.findMany({ orderBy: { night: 'desc' }, take: 400 }),
      prisma.labResult.findMany({ orderBy: { date: 'desc' }, take: 500 }),
      prisma.medication.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.bodyStat.findMany({ orderBy: { date: 'asc' } }),
      prisma.nutritionLog.findMany({ orderBy: { day: 'desc' }, take: 120 }),
      // The TRUE anchor and dose count, independent of any take-window:
      // the treatment clock must never re-anchor because history outgrew
      // a query limit (adversary).
      prisma.injection.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
      prisma.injection.count(),
    ]);
  return {
    profile, injections, symptoms, afEpisodes, bpReadings, cpapNights, labs,
    meds, bodyStats, nutrition,
    firstInjectionAt: firstInjection?.at ?? null,
    injectionCount,
  };
}

// ── Apple Health sync (Wave 5: routes → same-origin server actions) ──────────
// Apple Health sync, as server actions rather than REST endpoints.
//
// These used to be /api/health/{import,workouts,detect,hr-series}, guarded by a
// bearer token the owner had to paste into the app after every reinstall. The
// token existed because those were public HTTP endpoints — the guard's own
// comment called it "not auth, a data integrity check so only the owner's
// Shortcuts can write".
//
// He does not use Shortcuts. The only caller was the app itself, which is
// same-origin with this server and needs no token to reach a server action. So
// the endpoints are gone, the token is gone, and the setup step went with them.


// Strength-training estimate for a ~133 kg trainee.
const KCAL_PER_MIN = 7;
const DEFAULT_DURATION_MIN = 60;

/** Apple Health samples → BodyStats, HealthSamples, and workout enrichment. */
export async function importHealth(payload: unknown) {
  return importHealthSamples(payload);
}

/** HealthKit sessions the log doesn't have yet. */
export async function detectUnlogged(payload: unknown) {
  return detectUnloggedWorkouts(payload);
}

/** A workout's downsampled heart-rate curve. */
export async function saveHrSeries(payload: { workoutId?: string; bins?: unknown }) {
  return storeHrSeries(payload as Parameters<typeof storeHrSeries>[0]);
}

/** Workouts logged here but not yet written to Apple Health. */
export async function getWorkoutsToPush() {
  const workouts = await prisma.workout.findMany({
    where: { healthSyncedAt: null },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true, duration: true },
  });

  return workouts.map((w) => {
    const durationMin = w.duration ? Math.max(1, Math.round(w.duration / 60)) : DEFAULT_DURATION_MIN;
    return {
      id: w.id,
      name: w.name,
      start: w.date.toISOString(),
      durationMin,
      /**
       * App-side estimate. Deliberately NOT written to HealthKit — the Watch
       * already logs energy for the same window, and writing this on top
       * double-counts the session.
       */
      estKcal: Math.round(durationMin * KCAL_PER_MIN),
    };
  });
}

/** Mark workouts as pushed. Only ever moves null → now, never back. */
export async function markWorkoutsPushed(ids: string[]) {
  if (!Array.isArray(ids) || !ids.length) return { marked: 0 };
  const clean = ids.filter((id): id is string => typeof id === 'string');
  if (!clean.length) return { marked: 0 };

  const result = await prisma.workout.updateMany({
    where: { id: { in: clean }, healthSyncedAt: null },
    data: { healthSyncedAt: new Date() },
  });
  if (result.count) {
    revalidatePath('/');
    revalidatePath('/stats');
  }
  return { marked: result.count };
}
