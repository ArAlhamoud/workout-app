// Raw CSV of the health rows for a range — the "give the doctor the data"
// escape hatch, and the second copy of the truth outside Neon. One file,
// one section per entity, headers repeated per section (spreadsheet apps
// split it cleanly on the blank lines). Every scalar column, every table.

import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;
const RANGES: Record<string, number> = { '4w': 28, '3m': 91, all: 100_000 };

const esc = (v: unknown): string => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rows = (header: string[], data: unknown[][]): string =>
  [header.join(','), ...data.map((r) => r.map(esc).join(','))].join('\n');

export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get('range') ?? 'all';
  // Object.hasOwn: ?range=constructor must not walk the prototype chain
  // into NaN dates and an unbounded query (data-steward).
  const days = Object.hasOwn(RANGES, range) ? RANGES[range] : RANGES.all;
  const since = new Date(Date.now() - days * DAY_MS);

  const [injections, symptoms, af, bp, cpap, labs, nutrition, stats, meds, profile] = await Promise.all([
    prisma.injection.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
    prisma.symptomLog.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
    prisma.afEpisode.findMany({ where: { startedAt: { gte: since } }, orderBy: { startedAt: 'asc' } }),
    prisma.bpReading.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
    prisma.cpapNight.findMany({ where: { night: { gte: since } }, orderBy: { night: 'asc' } }),
    prisma.labResult.findMany({ where: { date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.nutritionLog.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } }),
    prisma.bodyStat.findMany({ where: { date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.medication.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.healthProfile.findMany(),
  ]);

  // Every scalar column of every table, generated from the schema — a copy
  // that omits the four fields the Fuel tracker actually uses (kcal, carbs,
  // fat, notes) is not a copy (data-steward, 2026-09-18). Json columns are
  // serialised as JSON text.
  const COLUMNS: Record<string, string[]> = {
  'Injection': [
    'id',
    'at',
    'doseMg',
    'penMg',
    'clicks',
    'site',
    'onSchedule',
    'needleInfo',
    'penId',
    'notes',
    'createdAt'
  ],
  'SymptomLog': [
    'id',
    'at',
    'kind',
    'severity',
    'context',
    'notes',
    'createdAt'
  ],
  'AfEpisode': [
    'id',
    'startedAt',
    'endedAt',
    'durationMin',
    'hrBpm',
    'symptoms',
    'ecgRecorded',
    'bloating',
    'gas',
    'afterMeal',
    'sleepRelated',
    'exerciseRelated',
    'caffeine',
    'dehydration',
    'stress',
    'notes',
    'createdAt'
  ],
  'BpReading': [
    'id',
    'at',
    'systolic',
    'diastolic',
    'pulse',
    'context',
    'seated',
    'notes',
    'createdAt'
  ],
  'CpapNight': [
    'id',
    'night',
    'usageHours',
    'ahi',
    'leak',
    'avgPressure',
    'p95Pressure',
    'maskComfort',
    'sleepQuality',
    'deepSleepMin',
    'notes',
    'createdAt'
  ],
  'LabResult': [
    'id',
    'date',
    'test',
    'value',
    'unit',
    'refLow',
    'refHigh',
    'lab',
    'notes',
    'createdAt'
  ],
  'NutritionLog': [
    'id',
    'day',
    'proteinG',
    'waterMl',
    'fiberG',
    'meals',
    'kcal',
    'carbsG',
    'fatG',
    'flags',
    'notes',
    'createdAt'
  ],
  'BodyStat': [
    'id',
    'date',
    'weight',
    'waist',
    'arms',
    'neckCm',
    'bodyFatPct',
    'muscleKg',
    'visceralFat',
    'source',
    'createdAt'
  ],
  'Medication': [
    'id',
    'name',
    'doseLabel',
    'frequency',
    'startedOn',
    'stoppedOn',
    'prescriber',
    'notes',
    'createdAt'
  ],
  'HealthProfile': [
    'id',
    'heightCm',
    'startWeightKg',
    'goalWeightKg',
    'milestonesKg',
    'conditions',
    'familyHistory',
    'investigations',
    'dosePlan',
    'targets',
    'reminders',
    'createdAt',
    'updatedAt'
  ]
};
  const cell = (v: unknown): unknown => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
  const table = (name: string, list: object[]) =>
    rows(COLUMNS[name], list.map((r) => COLUMNS[name].map((c) => cell((r as Record<string, unknown>)[c]))));

  const sections = [
    '# injections', table('Injection', injections), '',
    '# symptoms', table('SymptomLog', symptoms), '',
    '# af_episodes', table('AfEpisode', af), '',
    '# blood_pressure', table('BpReading', bp), '',
    '# cpap_nights', table('CpapNight', cpap), '',
    '# labs', table('LabResult', labs), '',
    '# nutrition', table('NutritionLog', nutrition), '',
    '# body_stats', table('BodyStat', stats), '',
    '# medications', table('Medication', meds), '',
    '# profile', table('HealthProfile', profile),
  ].join('\n');

  return new Response(sections, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="health-${range}.csv"`,
    },
  });
}
