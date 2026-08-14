// The full-history export payload, shared by /api/export (URL access, token
// guard) and the iCloud backup action (same-origin, no token). One builder so
// the two copies can never drift — an export that omits a table is not a
// backup, and that mistake has already happened once (healthSamples).

import prisma from '@/lib/prisma';

export async function buildExportPayload() {
  const [workouts, bodyStats, exercises, healthSamples] = await Promise.all([
    prisma.workout.findMany({
      orderBy: { date: 'asc' },
      include: { sets: { include: { exercise: { select: { name: true } } }, orderBy: { setNumber: 'asc' } } },
    }),
    prisma.bodyStat.findMany({ orderBy: { date: 'asc' } }),
    prisma.exercise.findMany({ orderBy: { name: 'asc' } }),
    prisma.healthSample.findMany({ orderBy: { date: 'asc' } }),
  ]);
  // Holds shape the verdict and the streak; a restore without them silently
  // un-declares every pause he ever named. The snapshot/restore pair already
  // carries them — this builder lagged behind (found by the feature panel's
  // constitution judge, of all things).
  const holds = await prisma.hold.findMany({ orderBy: { startsAt: 'asc' } });

  return {
    exportedAt: new Date().toISOString(),
    exercises,
    workouts,
    bodyStats,
    healthSamples,
    holds,
  };
}
