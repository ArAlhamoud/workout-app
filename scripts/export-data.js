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

  const data = {
    exportedAt: new Date().toISOString(),
    totalWorkouts: workouts.length,
    totalBodyStats: stats.length,
    totalExercises: exercises.length,
    exercises,
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
