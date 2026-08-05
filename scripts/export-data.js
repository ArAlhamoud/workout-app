const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const [workouts, stats, exercises] = await Promise.all([
    prisma.workout.findMany({
      orderBy: { date: 'asc' },
      include: { sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } } },
    }),
    prisma.bodyStat.findMany({ orderBy: { date: 'asc' } }),
    prisma.exercise.findMany({ orderBy: { name: 'asc' } }),
  ]);

  // Apple Health samples — tolerate the table not existing yet (schema not applied).
  let healthSamplesTotal = 0;
  let latestWeightSample = null;
  // The rows themselves, not just a count. This snapshot is the only off-Neon
  // copy of the app's data, and it excluded this table entirely — the count
  // made it look covered.
  let healthSamples = [];
  try {
    healthSamplesTotal = await prisma.healthSample.count();
    healthSamples = await prisma.healthSample.findMany({ orderBy: { date: 'asc' } });
    latestWeightSample = await prisma.healthSample.findFirst({
      where: { type: 'weight' },
      orderBy: { date: 'desc' },
    });
  } catch (e) {
    console.warn('HealthSample table unavailable, skipping health export:', e.message);
  }

  const data = {
    exportedAt: new Date().toISOString(),
    totalWorkouts: workouts.length,
    totalBodyStats: stats.length,
    totalExercises: exercises.length,
    totalHealthSamples: healthSamplesTotal,
    latestWeightSample,
    exercises,
    healthSamples,
    workouts,
    bodyStats: stats,
  };

  const outPath = path.join(__dirname, '../data/workout-history.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Exported ${exercises.length} exercises, ${workouts.length} workouts, ${stats.length} body stats → data/workout-history.json`);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
