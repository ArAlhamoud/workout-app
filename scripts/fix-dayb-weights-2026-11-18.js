#!/usr/bin/env node
/**
 * One-off (2026-11-18): two mis-tapped Watch weights in Day B of 18 Nov.
 * Owner confirmed both were mistakes: Triceps Extension set 2 logged 35.5
 * (all sets were 35) and Cable Face Pull set 3 logged 8 (all sets were 9).
 * Mixed weights block the next rep (earnsProgress), so they are corrected.
 *
 * TARGETED ON PURPOSE: only the Day B workout dated 2026-11-18, only a working
 * set whose current weight matches the mistake. Idempotent.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-dayb-weights-2026-11-18.js           # preview
 *   node scripts/fix-dayb-weights-2026-11-18.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const FIXES = [
  { exercise: 'Triceps Extension', setNumber: 2, from: 35.5, to: 35 },
  { exercise: 'Cable Face Pull', setNumber: 3, from: 8, to: 9 },
];

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const workouts = await prisma.workout.findMany({
    where: { date: new Date('2026-11-18T00:00:00.000Z'), name: { startsWith: 'Day B' } },
    include: { sets: { include: { exercise: { select: { name: true } } } } },
  });
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — Day B 18 Nov weight fixes`);
  if (workouts.length !== 1) {
    console.error(`REFUSING: expected exactly one Day B workout on 2026-11-18, found ${workouts.length}.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const w = workouts[0];
  for (const f of FIXES) {
    const s = w.sets.find((x) => !x.isWarmup && x.exercise.name === f.exercise && x.setNumber === f.setNumber);
    if (!s) { console.log(`  ${f.exercise} #${f.setNumber}: not found, skipped`); continue; }
    if (s.weight === f.to) { console.log(`  ${f.exercise} #${f.setNumber}: already ${f.to}`); continue; }
    if (s.weight !== f.from) { console.log(`  ${f.exercise} #${f.setNumber}: weight is ${s.weight}, not ${f.from} — skipped`); continue; }
    console.log(`  ${f.exercise} #${f.setNumber}: ${f.from} -> ${f.to}`);
    if (APPLY) await prisma.workoutSet.update({ where: { id: s.id }, data: { weight: f.to } });
  }
  console.log(APPLY ? 'Written.' : 'Dry run — nothing written. Re-run with --apply.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
