const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Idempotent: only creates what the database is missing. Hip Thrust Machine
// stays listed but is no longer in the program — B_Fit has no such machine, so
// Day A uses Hip Abduction instead.
const exercises = [
  { name: 'Hip Thrust Machine', category: 'LEGS' },
  { name: 'Back Extension', category: 'BACK' },
  { name: 'Hip Abduction', category: 'LEGS' },
];

async function main() {
  for (const ex of exercises) {
    const existing = await prisma.exercise.findFirst({ where: { name: ex.name } });
    if (existing) {
      console.log(`Already exists: ${ex.name}`);
    } else {
      await prisma.exercise.create({ data: ex });
      console.log(`Created: ${ex.name} (${ex.category})`);
    }
  }
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
