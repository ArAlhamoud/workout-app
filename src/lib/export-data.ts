// The full-history export payload, shared by /api/export (URL access, token
// guard) and the iCloud backup action (same-origin, no token). One builder so
// the two copies can never drift — an export that omits a table is not a
// backup, and that mistake has already happened once (healthSamples).
//
// It happened a SECOND time: this builder covered five tables while
// scripts/export-data.js covered fourteen, so the iCloud backup — the one
// backup taken from the phone, without a laptop — carried no injections, no
// labs, no BP, no CPAP, no nutrition, no AF episodes. An injection date
// cannot be re-derived from anything; it exists in Neon and in whatever
// snapshot holds it. The shape below is the one scripts/restore-from-snapshot.js
// already reads (`snap.health[table]`), and its dry run verifies it.
//
// NOT yet verified: a real `--apply` carrying the treatment record. The write
// path needed a Prisma.DbNull mapping for nullable Json columns before it
// could run at all (restore-from-snapshot.js), which means no restore has
// ever actually written these tables. Prove it on a Neon branch before
// trusting this as a backup — a backup nobody has restored is a hypothesis.
//
// Nothing here is wrapped in a try/catch on purpose. A backup that quietly
// returns without a table is the bug; a backup that fails loudly is a
// nuisance. Prefer the nuisance.

import prisma from '@/lib/prisma';

export async function buildExportPayload() {
  // Holds ride the same wave: they shape the verdict and the streak, and a
  // restore without them silently un-declares every pause he ever named.
  const [
    workouts,
    bodyStats,
    exercises,
    healthSamples,
    holds,
    healthProfile,
    injection,
    symptomLog,
    afEpisode,
    bpReading,
    cpapNight,
    labResult,
    medication,
    nutritionLog,
  ] = await Promise.all([
    prisma.workout.findMany({
      orderBy: { date: 'asc' },
      include: { sets: { include: { exercise: { select: { name: true } } }, orderBy: { setNumber: 'asc' } } },
    }),
    prisma.bodyStat.findMany({ orderBy: { date: 'asc' } }),
    prisma.exercise.findMany({ orderBy: { name: 'asc' } }),
    prisma.healthSample.findMany({ orderBy: { date: 'asc' } }),
    prisma.hold.findMany({ orderBy: { startsAt: 'asc' } }),
    prisma.healthProfile.findMany(),
    prisma.injection.findMany({ orderBy: { at: 'asc' } }),
    prisma.symptomLog.findMany({ orderBy: { at: 'asc' } }),
    prisma.afEpisode.findMany({ orderBy: { startedAt: 'asc' } }),
    prisma.bpReading.findMany({ orderBy: { at: 'asc' } }),
    prisma.cpapNight.findMany({ orderBy: { night: 'asc' } }),
    prisma.labResult.findMany({ orderBy: { date: 'asc' } }),
    prisma.medication.findMany(),
    prisma.nutritionLog.findMany({ orderBy: { day: 'asc' } }),
  ]);

  const health = {
    healthProfile,
    injection,
    symptomLog,
    afEpisode,
    bpReading,
    cpapNight,
    labResult,
    medication,
    nutritionLog,
  };

  return {
    exportedAt: new Date().toISOString(),
    // The counts are the integrity check: restore-from-snapshot compares each
    // header against the array it actually got, so a truncated or pre-fix file
    // announces itself instead of passing the dry run as clean.
    totalWorkouts: workouts.length,
    totalBodyStats: bodyStats.length,
    totalExercises: exercises.length,
    totalHealthSamples: healthSamples.length,
    totalHolds: holds.length,
    totalInjections: injection.length,
    exercises,
    workouts,
    bodyStats,
    healthSamples,
    holds,
    health,
  };
}
