// Raw CSV of the health rows for a range — the "give the doctor the data"
// escape hatch, and the second copy of the truth outside Neon. One file,
// one section per entity, headers repeated per section (spreadsheet apps
// split it cleanly on the blank lines).

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
  const since = new Date(Date.now() - (RANGES[range] ?? RANGES.all) * DAY_MS);

  const [injections, symptoms, af, bp, cpap, labs, nutrition, stats] = await Promise.all([
    prisma.injection.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
    prisma.symptomLog.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
    prisma.afEpisode.findMany({ where: { startedAt: { gte: since } }, orderBy: { startedAt: 'asc' } }),
    prisma.bpReading.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } }),
    prisma.cpapNight.findMany({ where: { night: { gte: since } }, orderBy: { night: 'asc' } }),
    prisma.labResult.findMany({ where: { date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.nutritionLog.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } }),
    prisma.bodyStat.findMany({ where: { date: { gte: since } }, orderBy: { date: 'asc' } }),
  ]);

  const sections = [
    '# injections',
    rows(
      ['at', 'doseMg', 'site', 'onSchedule', 'clicks', 'notes'],
      injections.map((i) => [i.at, i.doseMg, i.site, i.onSchedule, i.clicks, i.notes]),
    ),
    '',
    '# symptoms',
    rows(
      ['at', 'kind', 'severity', 'notes'],
      symptoms.map((s) => [s.at, s.kind, s.severity, s.notes]),
    ),
    '',
    '# af_episodes',
    rows(
      ['startedAt', 'durationMin', 'hrBpm', 'bloating', 'gas', 'afterMeal', 'sleepRelated', 'caffeine', 'stress', 'ecgRecorded', 'notes'],
      af.map((e) => [e.startedAt, e.durationMin, e.hrBpm, e.bloating, e.gas, e.afterMeal, e.sleepRelated, e.caffeine, e.stress, e.ecgRecorded, e.notes]),
    ),
    '',
    '# blood_pressure',
    rows(
      ['at', 'systolic', 'diastolic', 'pulse', 'context'],
      bp.map((r) => [r.at, r.systolic, r.diastolic, r.pulse, r.context]),
    ),
    '',
    '# cpap_nights',
    rows(
      ['night', 'usageHours', 'ahi', 'leak', 'avgPressure', 'p95Pressure'],
      cpap.map((n) => [n.night, n.usageHours, n.ahi, n.leak, n.avgPressure, n.p95Pressure]),
    ),
    '',
    '# labs',
    rows(
      ['date', 'test', 'value', 'unit', 'refLow', 'refHigh', 'lab'],
      labs.map((l) => [l.date, l.test, l.value, l.unit, l.refLow, l.refHigh, l.lab]),
    ),
    '',
    '# nutrition',
    rows(
      ['day', 'proteinG', 'waterMl', 'fiberG', 'meals'],
      nutrition.map((n) => [n.day, n.proteinG, n.waterMl, n.fiberG, n.meals]),
    ),
    '',
    '# body_stats',
    rows(
      ['date', 'weight', 'waist', 'neckCm', 'bodyFatPct', 'muscleKg', 'visceralFat'],
      stats.map((b) => [b.date, b.weight, b.waist, b.neckCm, b.bodyFatPct, b.muscleKg, b.visceralFat]),
    ),
  ].join('\n');

  return new Response(sections, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="health-${range}.csv"`,
    },
  });
}
