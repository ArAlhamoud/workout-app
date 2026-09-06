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

  // Holds — the streak's excuse ledger (data-steward): a restore that loses
  // these turns every excused week into a broken streak, and the coach loses
  // his stated reasons. Tolerate the table not existing yet.
  let holds = [];
  try {
    holds = await prisma.hold.findMany({ orderBy: { startsAt: 'asc' } });
  } catch (e) {
    console.warn('Hold table unavailable, skipping holds export:', e.message);
  }

  // Health wave tables — the treatment record is the least replaceable
  // data in the app (you cannot re-derive an injection date). Tolerant of
  // the tables not existing yet.
  const health = {};
  const healthTables = [
    ['healthProfile', 'findMany', {}],
    ['injection', 'findMany', { orderBy: { at: 'asc' } }],
    ['symptomLog', 'findMany', { orderBy: { at: 'asc' } }],
    ['afEpisode', 'findMany', { orderBy: { startedAt: 'asc' } }],
    ['bpReading', 'findMany', { orderBy: { at: 'asc' } }],
    ['cpapNight', 'findMany', { orderBy: { night: 'asc' } }],
    ['labResult', 'findMany', { orderBy: { date: 'asc' } }],
    ['medication', 'findMany', {}],
    ['nutritionLog', 'findMany', { orderBy: { day: 'asc' } }],
  ];
  // A failed read used to become `[]`, and totalInjections was then derived
  // from that same empty array — so header and array agreed and the restore
  // dry run printed "integrity no issues found" over a snapshot with the
  // treatment record silently removed. This script runs daily in
  // sync-data.yml and COMMITS over data/workout-history.json, so one bad read
  // on Neon would replace the git-tracked copy with an empty one. Record the
  // failures and refuse to write; a missing snapshot is loud, a hollow one is
  // not (data-steward).
  const degraded = [];
  for (const [table, method, args] of healthTables) {
    try {
      health[table] = await prisma[table][method](args);
    } catch (e) {
      console.warn(`${table} unavailable:`, e.message);
      health[table] = [];
      degraded.push(`${table}: ${e.message}`);
    }
  }

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
    totalHolds: holds.length,
    totalInjections: (health.injection ?? []).length,
    latestWeightSample,
    exercises,
    healthSamples,
    holds,
    workouts,
    bodyStats: stats,
    health,
  };

  if (degraded.length) {
    console.error('\n✗ refusing to write a degraded snapshot — these tables did not read:');
    for (const d of degraded) console.error(`    ${d}`);
    console.error('  The existing data/workout-history.json is left untouched.');
    process.exit(1);
  }

  const outPath = path.join(__dirname, '../data/workout-history.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Exported ${exercises.length} exercises, ${workouts.length} workouts, ${stats.length} body stats → data/workout-history.json`);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
