import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import {
  dayKey,
  matchSamplesToWorkout,
  parseHealthPayload,
  type ParsedSample,
} from '@/lib/health';

const HEALTH_SOURCE = 'apple-health';

function dayRange(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

async function upsertBodyStats(weightSamples: ParsedSample[]): Promise<number> {
  // One BodyStat per calendar day; keep the latest sample of each day.
  const latestByDay = new Map<string, ParsedSample>();
  for (const sample of weightSamples) {
    const key = dayKey(sample.date);
    const existing = latestByDay.get(key);
    if (!existing || sample.date > existing.date) latestByDay.set(key, sample);
  }

  let upserted = 0;
  for (const [key, sample] of latestByDay) {
    const { start, end } = dayRange(key);
    const existing = await prisma.bodyStat.findFirst({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    });
    if (existing) {
      // Never overwrite a manually logged entry for that day.
      if (existing.source === 'manual') continue;
      await prisma.bodyStat.update({
        where: { id: existing.id },
        data: { weight: sample.value, date: sample.date },
      });
    } else {
      await prisma.bodyStat.create({
        data: { date: sample.date, weight: sample.value, source: HEALTH_SOURCE },
      });
    }
    upserted++;
  }
  return upserted;
}

async function enrichWorkouts(samples: ParsedSample[]): Promise<number> {
  const workoutSamples = samples.filter((s) => s.type === 'heart_rate' || s.type === 'active_energy');
  if (!workoutSamples.length) return 0;

  const days = new Set(workoutSamples.map((s) => dayKey(s.date)));
  let enriched = 0;

  for (const key of days) {
    const { start, end } = dayRange(key);
    const workouts = await prisma.workout.findMany({
      where: { date: { gte: start, lt: end } },
      select: { id: true, date: true, duration: true, createdAt: true, avgHr: true, maxHr: true, activeKcal: true },
    });
    const daySamples = workoutSamples.filter((s) => dayKey(s.date) === key);

    for (const workout of workouts) {
      const { avgHr, maxHr, activeKcal } = matchSamplesToWorkout(daySamples, workout);
      // Only fill nulls — never clobber existing values.
      const data: { avgHr?: number; maxHr?: number; activeKcal?: number } = {};
      if (workout.avgHr === null && avgHr !== null) data.avgHr = avgHr;
      if (workout.maxHr === null && maxHr !== null) data.maxHr = maxHr;
      if (workout.activeKcal === null && activeKcal !== null) data.activeKcal = activeKcal;
      if (!Object.keys(data).length) continue;
      await prisma.workout.update({ where: { id: workout.id }, data });
      enriched++;
    }
  }
  return enriched;
}

/**
 * Import Apple Health samples. Called by a server action, not over HTTP —
 * there is no token because there is no public endpoint to guard.
 */
export async function importHealthSamples(payload: unknown) {
  const { samples, skipped } = parseHealthPayload(payload);

  let imported = 0;
  for (const sample of samples) {
    await prisma.healthSample.upsert({
      where: {
        type_date_source: { type: sample.type, date: sample.date, source: HEALTH_SOURCE },
      },
      update: { value: sample.value, unit: sample.unit },
      create: {
        type: sample.type,
        date: sample.date,
        value: sample.value,
        unit: sample.unit,
        source: HEALTH_SOURCE,
        meta:
          sample.min !== undefined || sample.max !== undefined
            ? JSON.stringify({ min: sample.min, max: sample.max })
            : null,
      },
    });
    imported++;
  }

  const bodyStatsUpserted = await upsertBodyStats(samples.filter((s) => s.type === 'weight'));
  const workoutsEnriched = await enrichWorkouts(samples);

  if (imported || bodyStatsUpserted || workoutsEnriched) {
    revalidatePath('/');
    revalidatePath('/stats');
  }

  return { imported, skipped, bodyStatsUpserted, workoutsEnriched };
}
