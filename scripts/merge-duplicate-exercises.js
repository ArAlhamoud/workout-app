#!/usr/bin/env node
/**
 * Merge duplicate Exercise rows that share a name.
 *
 * WHY: the library holds twins ("Chest Press" x2, "Pec Fly" x2, ...),
 * created by an early seed running twice. Sets are split across the
 * twins, so /exercises lists doubles and /progress charts each show
 * half a history.
 *
 * WHAT IT DOES, per case-insensitive name group with >1 row:
 *   - keeper = the row with the most WorkoutSets (tie: oldest createdAt)
 *   - repoint every WorkoutSet from the twins to the keeper
 *   - keeper inherits a non-null pinIncrement from a twin only if the
 *     keeper's own is null (a manual override is never overwritten)
 *   - delete the twins
 *
 * NEVER guessed: names must match exactly (after trim+casefold). Rows
 * with distinct names ("Mid Row" vs "Seated Row") are never touched.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/merge-duplicate-exercises.js           # preview only
 *   node scripts/merge-duplicate-exercises.js --apply   # write
 *
 * Point DATABASE_URL at the target (same contract as restore-from-snapshot).
 */

const APPLY = process.argv.includes('--apply');

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const exercises = await prisma.exercise.findMany({
    include: { _count: { select: { sets: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const groups = new Map();
  for (const ex of exercises) {
    const key = ex.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ex);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  if (dupGroups.length === 0) {
    console.log('No duplicate exercise names — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${dupGroups.length} duplicated name(s):\n`);

  for (const group of dupGroups) {
    // keeper: most sets, then oldest (stable across runs)
    const sorted = [...group].sort(
      (a, b) => b._count.sets - a._count.sets || a.createdAt - b.createdAt,
    );
    const keeper = sorted[0];
    const twins = sorted.slice(1);

    console.log(`"${keeper.name}"`);
    console.log(`  keep   ${keeper.id}  (${keeper._count.sets} sets, category ${keeper.category}, pinIncrement ${keeper.pinIncrement ?? '—'})`);
    for (const t of twins) {
      console.log(`  merge  ${t.id}  (${t._count.sets} sets, category ${t.category}, pinIncrement ${t.pinIncrement ?? '—'}) -> sets repointed, row deleted`);
      if (t.category !== keeper.category) {
        console.log(`         NOTE: categories differ (${t.category} vs ${keeper.category}) — keeper's wins`);
      }
    }

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        for (const t of twins) {
          await tx.workoutSet.updateMany({
            where: { exerciseId: t.id },
            data: { exerciseId: keeper.id },
          });
          if (keeper.pinIncrement == null && t.pinIncrement != null) {
            await tx.exercise.update({
              where: { id: keeper.id },
              data: { pinIncrement: t.pinIncrement },
            });
            keeper.pinIncrement = t.pinIncrement;
          }
          await tx.exercise.delete({ where: { id: t.id } });
        }
      });
      console.log('  ✓ merged');
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply to merge.');
  } else {
    const remaining = await prisma.exercise.count();
    console.log(`Done. ${remaining} exercises remain.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
