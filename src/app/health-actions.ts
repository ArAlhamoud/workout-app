'use server';

// Health wave server actions. Same posture as the rest of the app: single
// user, open access by owner decision, writes validated and bounded here.
// The app is a tracker, not a diagnostic tool — nothing in this file
// interprets; it stores, seeds, and reads.

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { DEFAULT_DOSE_PLAN, DEFAULT_ROTATION, SITES } from '@/lib/health-insights';

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
  // every one is editable in the UI.
  const profile = await prisma.healthProfile.create({
    data: {
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
  // profile, so a deliberate delete stays deleted.
  await prisma.medication.createMany({
    data: [
      { name: 'Mounjaro (tirzepatide)', doseLabel: 'per dose plan', frequency: 'weekly' },
      { name: 'Nebilet (nebivolol)', doseLabel: '10 mg', frequency: 'daily' },
    ],
  });
  await prisma.labResult.create({
    data: { date: new Date(), test: 'ldl', value: 4.54, unit: 'mmol/L', refHigh: 3.4, notes: 'baseline (pre-app)' },
  });
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
  const fields = {
    usageHours: Math.round(data.usageHours * 10) / 10,
    ahi: data.ahi != null && data.ahi >= 0 && data.ahi < 150 ? data.ahi : null,
    leak: data.leak != null && data.leak >= 0 ? data.leak : null,
    avgPressure: data.avgPressure != null && data.avgPressure > 0 && data.avgPressure < 30 ? data.avgPressure : null,
    p95Pressure: data.p95Pressure != null && data.p95Pressure > 0 && data.p95Pressure < 30 ? data.p95Pressure : null,
    maskComfort: data.maskComfort != null && data.maskComfort >= 0 && data.maskComfort <= 3 ? Math.round(data.maskComfort) : null,
    notes: data.notes?.slice(0, 300) || null,
  };
  // Re-entering a night corrects it — the prisma APP numbers sometimes
  // update after sync, and one row per night must stay one row.
  await prisma.cpapNight.upsert({
    where: { night },
    update: fields,
    create: { night, ...fields },
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
  flags?: { largeMeal?: boolean; highFat?: boolean; lateNight?: boolean };
}) {
  const day = new Date(`${data.day}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) throw new Error('Bad day');
  const bounded = (v: number | undefined, max: number) =>
    v != null && v >= 0 && v <= max ? Math.round(v) : null;
  const fields = {
    proteinG: bounded(data.proteinG, 400),
    waterMl: bounded(data.waterMl, 10_000),
    fiberG: bounded(data.fiberG, 150),
    meals: bounded(data.meals, 12),
    flags: data.flags ? (data.flags as object) : undefined,
  };
  await prisma.nutritionLog.upsert({ where: { day }, update: fields, create: { day, ...fields } });
  revalidateHealth();
}

// ── Reads for the pages ──────────────────────────────────────

export async function getHealthData() {
  const profile = await ensureHealthProfile();
  const [injections, symptoms, afEpisodes, bpReadings, cpapNights, labs, meds, bodyStats, nutrition] =
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
    ]);
  return { profile, injections, symptoms, afEpisodes, bpReadings, cpapNights, labs, meds, bodyStats, nutrition };
}
