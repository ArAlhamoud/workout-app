#!/usr/bin/env node
/**
 * One-off history repair (owner, 2026-09-06): on the Sep 6 Day A session
 * the Life Fitness combo machine was used both ways — sets 1-2 pads out
 * (abduction, 27.5 kg), sets 3-4 pads in (adduction, 32.5 kg) — and all
 * four were logged under Hip Abduction. Sets 3-4 move to Hip Adduction
 * and are renumbered 1-2 there; nothing else changes. Idempotent: a
 * second run finds nothing to move.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/split-hip-adduction.js           # preview
 *   node scripts/split-hip-adduction.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const day = new Date('2026-09-06T00:00:00.000Z');
  const workout = await prisma.workout.findFirst({
    where: { date: { gte: day, lt: new Date(day.getTime() + 86400000) }, name: { startsWith: 'Day A' } },
    select: { id: true, name: true },
  });
  if (!workout) { console.log('No Day A workout on 2026-09-06 — nothing to do.'); await prisma.$disconnect(); return; }
  const abd = await prisma.exercise.findFirst({ where: { name: 'Hip Abduction' } });
  const add = await prisma.exercise.findFirst({ where: { name: 'Hip Adduction' } });
  if (!abd || !add) { console.log('Missing exercise row (run Add missing exercises first).'); await prisma.$disconnect(); return; }
  const sets = await prisma.workoutSet.findMany({
    where: { workoutId: workout.id, exerciseId: abd.id, setNumber: { in: [3, 4] } },
    orderBy: { setNumber: 'asc' },
  });
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${workout.name}: ${sets.length} Hip Abduction set(s) numbered 3-4`);
  for (const s of sets) console.log(`  set ${s.setNumber}: ${s.weight} kg x ${s.reps} -> Hip Adduction set ${s.setNumber - 2}`);
  if (!sets.length) { console.log('Nothing to move (already split?).'); await prisma.$disconnect(); return; }
  if (APPLY) {
    await prisma.$transaction(
      sets.map((s) => prisma.workoutSet.update({ where: { id: s.id }, data: { exerciseId: add.id, setNumber: s.setNumber - 2 } })),
    );
    console.log('  moved.');
  } else {
    console.log('Dry run — nothing written. Re-run with --apply.');
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
