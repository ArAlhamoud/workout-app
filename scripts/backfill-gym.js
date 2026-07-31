const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// One-shot: every session logged before gym tagging existed was at B_Fit.
// Idempotent — only fills rows where gym is still null, so re-running is safe.
const GYM_ID = 'bfit';

async function main() {
  const untagged = await prisma.workout.count({ where: { gym: null } });
  if (untagged === 0) {
    console.log('Nothing to backfill — every workout already has a gym.');
    return;
  }

  const { count } = await prisma.workout.updateMany({
    where: { gym: null },
    data: { gym: GYM_ID },
  });
  console.log(`Backfilled ${count} workout(s) to gym="${GYM_ID}".`);

  const remaining = await prisma.workout.count({ where: { gym: null } });
  console.log(`Remaining untagged: ${remaining}`);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
