#!/usr/bin/env node
/**
 * Read-only (2026-11-10): the newest two workouts with every set, for a
 * session review. Writes nothing; --apply is accepted and ignored.
 */
const APPLY = process.argv.includes('--apply');

const riyadh = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : '-');

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const ws = await prisma.workout.findMany({
    orderBy: { date: 'desc' },
    take: 2,
    include: { sets: { include: { exercise: { select: { name: true } } }, orderBy: [{ completedAt: 'asc' }, { setNumber: 'asc' }] } },
  });
  console.log(`READ ONLY${APPLY ? ' (--apply ignored)' : ''}`);
  for (const w of ws) {
    console.log(`== ${w.date.toISOString().slice(0, 10)} ${w.name} gym=${w.gym} dur=${w.duration}s`);
    for (const s of w.sets) console.log(`  ${riyadh(s.completedAt)} ${s.exercise.name} #${s.setNumber}${s.isWarmup ? ' warm' : ''} ${s.weight}x${s.reps} rpe=${s.rpe ?? '-'}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
