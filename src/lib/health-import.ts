import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import {
  dayKey,
  matchSamplesToWorkout,
  pairBpSamples,
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
 * Pairs bp_systolic/bp_diastolic samples (the two halves HealthKit stores
 * per monitor reading) into BpReading rows. Idempotent across the rolling
 * sync window: any existing reading within a minute of a pair's timestamp —
 * imported earlier, or logged by hand for the same measurement — wins, and
 * the pair is skipped (though a heart-rate sample can still fill its missing
 * pulse). The monitor writes its pulse as a separate heartRate sample at the
 * same instant; the nearest one within two minutes rides along as `pulse`.
 * Imports are marked by `notes` so provenance stays visible without a schema
 * change.
 */
async function importBpReadings(samples: ParsedSample[]): Promise<number> {
  const pairs = pairBpSamples(
    samples.filter((s) => s.type === 'bp_systolic').map((s) => ({ dateISO: s.date.toISOString(), value: s.value })),
    samples.filter((s) => s.type === 'bp_diastolic').map((s) => ({ dateISO: s.date.toISOString(), value: s.value })),
  );
  if (!pairs.length) return 0;

  const PULSE_MS = 2 * 60_000;
  const hr = samples.filter((s) => s.type === 'heart_rate');
  const pulseNear = (t: number): number | null => {
    let best: ParsedSample | null = null;
    for (const s of hr) {
      const d = Math.abs(s.date.getTime() - t);
      if (d <= PULSE_MS && (!best || d < Math.abs(best.date.getTime() - t))) best = s;
    }
    return best && best.value > 20 && best.value < 250 ? Math.round(best.value) : null;
  };

  const DEDUPE_MS = 60_000;
  const times = pairs.map((p) => p.at.getTime());
  const existing = await prisma.bpReading.findMany({
    where: {
      at: {
        gte: new Date(Math.min(...times) - DEDUPE_MS),
        lte: new Date(Math.max(...times) + DEDUPE_MS),
      },
    },
    select: { id: true, at: true, pulse: true },
  });
  const taken = existing.map((r) => r.at.getTime());

  let created = 0;
  for (const pair of pairs) {
    const t = pair.at.getTime();
    const twin = existing.find((e) => Math.abs(e.at.getTime() - t) <= DEDUPE_MS);
    if (twin) {
      // Only fill nulls — never clobber a pulse someone logged.
      const pulse = twin.pulse === null ? pulseNear(t) : null;
      if (pulse !== null) {
        await prisma.bpReading.update({ where: { id: twin.id }, data: { pulse } });
      }
      continue;
    }
    if (taken.some((e) => Math.abs(e - t) <= DEDUPE_MS)) continue;
    await prisma.bpReading.create({
      data: {
        at: pair.at,
        systolic: pair.systolic,
        diastolic: pair.diastolic,
        pulse: pulseNear(t),
        notes: 'Apple Health',
      },
    });
    taken.push(t); // two pairs in one batch can't both land on the same minute
    created++;
  }
  return created;
}

/**
 * Import Apple Health samples. Called by a server action, not over HTTP —
 * there is no token because there is no public endpoint to guard (Wave 5).
 * The revamp's BP pairing (importBpReadings above) rides the same entry.
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
  const bpImported = await importBpReadings(samples);

  if (imported || bodyStatsUpserted || workoutsEnriched || bpImported) {
    revalidatePath('/');
    revalidatePath('/stats');
  }

  return { imported, skipped, bodyStatsUpserted, workoutsEnriched, bpImported };
}
