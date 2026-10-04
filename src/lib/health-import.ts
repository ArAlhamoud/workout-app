import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import {
  dayKey,
  matchSamplesToWorkout,
  pairBpSamples,
  dropSleepSamples,
  parseHealthPayload,
  type ParsedSample,
} from '@/lib/health';
import { BP_IMPORT_NOTE, BP_SAME_READING_MS, bpImportTwin, ownerDayWindow, weightImportPlan } from '@/lib/health-entry';
import { ownerDayKey, ownerTodayUtc } from '@/lib/health-insights';
import { SLEEP_BACKFILL_TYPE, SLEEP_ROW_TYPES, SLEEP_SOURCE, SLEEP_TYPES, nightsFromRows, sleepNavGlance, writeSleepNights } from '@/lib/sleep';

const HEALTH_SOURCE = 'apple-health';

function dayRange(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

async function upsertBodyStats(weightSamples: ParsedSample[]): Promise<number> {
  // One BodyStat per calendar day — HIS day (Riyadh), the same key the
  // manual entry uses, not the UTC day: a 01:00 weigh-in belongs to the
  // date he sees (2026-10-02). Keep the latest sample of each day.
  const latestByDay = new Map<string, ParsedSample>();
  for (const sample of weightSamples) {
    const key = ownerDayKey(sample.date);
    const existing = latestByDay.get(key);
    if (!existing || sample.date > existing.date) latestByDay.set(key, sample);
  }

  let upserted = 0;
  for (const [key, sample] of latestByDay) {
    const { start, end } = ownerDayWindow(key);
    // The WHOLE day, not its first row: a waist-only manual entry sorted
    // first and shut the scale out of that day for good (2026-10-02). Only a
    // manual WEIGHT blocks the import — weightImportPlan decides.
    const dayRows = await prisma.bodyStat.findMany({
      // Exactly this day. A wider lookup once matched YESTERDAY's row and
      // overwrote its weigh-in with today's (third review, 2026-09-24).
      where: { date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, source: true, weight: true },
    });
    const plan = weightImportPlan(dayRows);
    // Never overwrite a manually logged weight for that day.
    if (plan.kind === 'skip') continue;
    if (plan.kind === 'update') {
      await prisma.bodyStat.update({
        where: { id: plan.id },
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
      // One day back as well: a sample between 00:00 and 01:00Z (03:00–04:00
      // Riyadh) belongs to the PREVIOUS activity day's row. The window match
      // keeps it off any other row.
      where: { date: { gte: new Date(start.getTime() - 86_400_000), lt: end } },
      select: { id: true, date: true, duration: true, createdAt: true, avgHr: true, maxHr: true, activeKcal: true, sets: { select: { completedAt: true } } },
    });
    const daySamples = workoutSamples.filter((s) => dayKey(s.date) === key);

    for (const workout of workouts) {
      // The same window the Apple Health push read: timed by the stamped sets.
      const { avgHr, maxHr, activeKcal } = matchSamplesToWorkout(daySamples, {
        ...workout,
        setTimes: workout.sets.map((st) => st.completedAt).filter((d): d is Date => d != null),
      });
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
 * so does a reading he typed with the same numbers within five minutes; the
 * pair is skipped (though a heart-rate sample can still fill its missing
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

  // Five minutes either side, with the values: a reading he typed two
  // minutes after measuring is the same measurement as the cuff's copy
  // (bpImportTwin; 2026-10-02 — time alone, ±60 s, made a twin of it).
  const times = pairs.map((p) => p.at.getTime());
  const existing = (
    await prisma.bpReading.findMany({
      where: {
        at: {
          gte: new Date(Math.min(...times) - BP_SAME_READING_MS),
          lte: new Date(Math.max(...times) + BP_SAME_READING_MS),
        },
      },
      select: { id: true, at: true, systolic: true, diastolic: true, pulse: true, notes: true },
    })
  ).map((r) => ({ ...r, at: r.at.getTime() }));
  const claimed = new Set<string>();

  let created = 0;
  for (const pair of pairs) {
    const t = pair.at.getTime();
    const twinId = bpImportTwin({ at: t, systolic: pair.systolic, diastolic: pair.diastolic }, existing, claimed);
    if (twinId) {
      claimed.add(twinId);
      const twin = existing.find((e) => e.id === twinId)!;
      // The row keeps its own time and numbers — a typed row's moment is at
      // most five minutes off and is his; rewriting it buys nothing. Only
      // fill nulls — never clobber a pulse someone logged.
      const pulse = twin.pulse === null ? pulseNear(t) : null;
      if (pulse !== null) {
        await prisma.bpReading.update({ where: { id: twin.id }, data: { pulse } });
        twin.pulse = pulse;
      }
      continue;
    }
    const pulse = pulseNear(t);
    const row = await prisma.bpReading.create({
      data: {
        at: pair.at,
        systolic: pair.systolic,
        diastolic: pair.diastolic,
        pulse,
        notes: BP_IMPORT_NOTE,
      },
      select: { id: true },
    });
    // Two pairs in one batch can't both land on the same minute.
    existing.push({ id: row.id, at: t, systolic: pair.systolic, diastolic: pair.diastolic, pulse, notes: BP_IMPORT_NOTE });
    claimed.add(row.id);
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
  const parsed = parseHealthPayload(payload);
  // Sleep is written by the night sync alone (importSleepNightRows): any
  // sleep-named sample here is refused and counted in `skipped`.
  const { kept: samples, dropped } = dropSleepSamples(parsed.samples);
  const skipped = parsed.skipped + dropped;

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

const DAY_MS = 86_400_000;

/**
 * Store a batch of sleep nights (src/lib/sleep.ts: grouped on the phone,
 * keyed by wake day). Each night is ONE transaction: its upserts on the
 * existing unique (type, date, source) — the update writing `meta` too — and
 * the stage rows the read showed absent, so a failure half-way leaves the
 * night as it was. Oxygen and breathing are never deleted here (a failed
 * read is not an absence). At most SLEEP_IMPORT_MAX_NIGHTS nights per call;
 * a bigger batch is refused whole. Keys are checked against HIS today.
 */
export async function importSleepNightRows(nights: unknown) {
  const out = await writeSleepNights(
    nights,
    {
      async writeNight(date, rows, removes, source) {
        await prisma.$transaction([
          ...rows.map((r) =>
            prisma.healthSample.upsert({
              where: { type_date_source: { type: r.type, date: r.date, source } },
              update: { value: r.value, unit: r.unit, meta: r.meta },
              create: { type: r.type, date: r.date, value: r.value, unit: r.unit, source, meta: r.meta },
            }),
          ),
          ...(removes.length ? [prisma.healthSample.deleteMany({ where: { type: { in: removes }, date, source } })] : []),
        ]);
      },
    },
    ownerDayKey(new Date()),
  );
  if (!('error' in out) && out.nights > 0) {
    revalidatePath('/health/sleep');
    revalidatePath('/stats');
  }
  return out;
}

/**
 * Where the phone's sync stands. `newestWakeDay`: the newest night the night
 * sync wrote (rows from the old one-number push carry no `meta` and do not
 * count), never one dated after tomorrow — a bad future row must not become
 * the cursor and stop every later write. `backfillFromMs`: how far back the
 * backfill walk has reached (null before its first chunk).
 */
export async function sleepSyncState(now: Date = new Date()): Promise<{ newestWakeDay: string | null; backfillFromMs: number | null }> {
  const [newest, cursor] = await Promise.all([
    prisma.healthSample.findFirst({
      where: { type: SLEEP_TYPES.asleep, source: SLEEP_SOURCE, meta: { not: null }, date: { lte: new Date(ownerTodayUtc(now).getTime() + DAY_MS) } },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    prisma.healthSample.findUnique({
      where: { type_date_source: { type: SLEEP_BACKFILL_TYPE, date: new Date(0), source: SLEEP_SOURCE } },
      select: { value: true },
    }),
  ]);
  return {
    newestWakeDay: newest ? newest.date.toISOString().slice(0, 10) : null,
    backfillFromMs: cursor && Number.isFinite(cursor.value) ? cursor.value : null,
  };
}

/** Store how far back the backfill walk has reached: one row of its own
 *  type, keyed at the epoch, value = the instant in ms. A cursor in the
 *  future or more than six years back is refused. */
export async function setSleepBackfillCursor(ms: unknown, now: Date = new Date()): Promise<{ ok: boolean }> {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms > now.getTime() + DAY_MS || ms < now.getTime() - 6 * 366 * DAY_MS) {
    return { ok: false };
  }
  const key = { type: SLEEP_BACKFILL_TYPE, date: new Date(0), source: SLEEP_SOURCE };
  await prisma.healthSample.upsert({
    where: { type_date_source: key },
    update: { value: ms, meta: new Date(ms).toISOString() },
    create: { ...key, value: ms, unit: 'ms', meta: new Date(ms).toISOString() },
  });
  return { ok: true };
}

/** Every stored night, oldest first. */
export async function readSleepNights() {
  const rows = await prisma.healthSample.findMany({
    where: { type: { in: SLEEP_ROW_TYPES }, source: SLEEP_SOURCE },
    orderBy: { date: 'asc' },
    select: { type: true, date: true, value: true, meta: true },
  });
  return nightsFromRows(rows);
}

/**
 * The Rooms glance for Sleep: the newest night up to HIS today. A night is
 * keyed by the calendar morning he woke, so this is his calendar day — not
 * the 04:00 activity day the diet glance in nav-actions uses.
 */
export async function sleepRoomGlance(now: Date = new Date()): Promise<string> {
  const latest = await prisma.healthSample.findFirst({
    where: { type: SLEEP_TYPES.asleep, source: SLEEP_SOURCE, date: { lte: ownerTodayUtc(now) } },
    orderBy: { date: 'desc' },
    select: { date: true, value: true },
  });
  return sleepNavGlance(latest ? { day: latest.date.toISOString().slice(0, 10), hours: latest.value } : null, ownerDayKey(now));
}
