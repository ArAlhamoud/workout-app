import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const exercises = [
  { name: 'Bench Press', category: 'CHEST' },
  { name: 'Incline Bench Press', category: 'CHEST' },
  { name: 'Dumbbell Flyes', category: 'CHEST' },
  { name: 'Push-ups', category: 'CHEST' },
  { name: 'Pull-ups', category: 'BACK' },
  { name: 'Barbell Row', category: 'BACK' },
  { name: 'Lat Pulldown', category: 'BACK' },
  { name: 'Seated Cable Row', category: 'BACK' },
  { name: 'Deadlift', category: 'BACK' },
  { name: 'Squat', category: 'LEGS' },
  { name: 'Romanian Deadlift', category: 'LEGS' },
  { name: 'Leg Press', category: 'LEGS' },
  { name: 'Leg Curl', category: 'LEGS' },
  { name: 'Leg Extension', category: 'LEGS' },
  { name: 'Calf Raise', category: 'LEGS' },
  { name: 'Overhead Press', category: 'SHOULDERS' },
  { name: 'Dumbbell Lateral Raise', category: 'SHOULDERS' },
  { name: 'Front Raise', category: 'SHOULDERS' },
  { name: 'Face Pull', category: 'SHOULDERS' },
  { name: 'Barbell Curl', category: 'ARMS' },
  { name: 'Dumbbell Curl', category: 'ARMS' },
  { name: 'Tricep Pushdown', category: 'ARMS' },
  { name: 'Skull Crushers', category: 'ARMS' },
  { name: 'Hammer Curl', category: 'ARMS' },
  { name: 'Plank', category: 'CORE' },
  { name: 'Crunches', category: 'CORE' },
  { name: 'Leg Raises', category: 'CORE' },
  { name: 'Russian Twists', category: 'CORE' },
  { name: 'Running', category: 'CARDIO' },
  { name: 'Cycling', category: 'CARDIO' },
  { name: 'Jump Rope', category: 'CARDIO' },
];

async function main() {
  console.log('Seeding exercises...');
  for (const exercise of exercises) {
    await prisma.exercise.create({ data: exercise });
  }
  console.log(`Seeded ${exercises.length} exercises`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
