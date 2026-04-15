import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Names here must exactly match src/lib/program.ts
const exercises = [
  // Day A — Chest / Quads / Shoulders
  { name: 'Leg Press', category: 'LEGS' },
  { name: 'Chest Press', category: 'CHEST' },
  { name: 'Shoulder Press', category: 'SHOULDERS' },
  { name: 'Leg Extension', category: 'LEGS' },
  { name: 'Lateral Raise', category: 'SHOULDERS' },
  { name: 'Pec Fly', category: 'CHEST' },
  { name: 'Standing Calf Raise', category: 'LEGS' },
  { name: 'Plank', category: 'CORE' },
  // Day B — Back / Hamstrings / Arms
  { name: 'Lat Pulldown', category: 'BACK' },
  { name: 'Mid Row', category: 'BACK' },
  { name: 'Leg Curl', category: 'LEGS' },
  { name: 'Rear Delt Fly', category: 'SHOULDERS' },
  { name: 'Bicep Curl', category: 'ARMS' },
  { name: 'Triceps Extension', category: 'ARMS' },
  { name: 'Cable Face Pull', category: 'SHOULDERS' },
  { name: 'Ab Crunch', category: 'CORE' },
];

async function main() {
  console.log('Seeding program exercises...');
  let seeded = 0;
  for (const exercise of exercises) {
    const exists = await prisma.exercise.findFirst({ where: { name: exercise.name } });
    if (!exists) {
      await prisma.exercise.create({ data: exercise });
      seeded++;
    }
  }
  console.log(`Done — ${seeded} new exercises added (${exercises.length - seeded} already existed).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
