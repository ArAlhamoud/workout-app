#!/usr/bin/env node
/**
 * One-time guarded repair for three anomalies the Wave-4 review panel found
 * in the real history (verified against data/workout-history.json):
 *
 *  1. May 10 "Day B 30m": duration = 156 SECONDS for 12 sets — a timer
 *     artifact. 12 sets cannot take 2.6 minutes. Fix: duration -> null
 *     (honest unknown), so per-session pace stats stop lying.
 *
 *  2. May 13 Plank rows: weight=10, reps=1 — encoded upside down. Every
 *     later Plank uses seconds-in-reps (16-21s, weight 0); these are ~10s
 *     holds. Fix: weight -> 0, reps -> 10. Corrupts per-rep records
 *     otherwise (a "10 kg x 1 Plank" outranks every real hold).
 *
 *  3. Jul 29 Hip Thrust Machine: 0 kg x 12 across all sets. The true weight
 *     is UNKNOWABLE from here — FLAGGED ONLY, never guessed. Edit the
 *     workout by hand if you remember the pin.
 *
 * DRY RUN IS THE DEFAULT. Rows are matched by exact current values, so the
 * script is idempotent and cannot touch anything it did not name.
 *
 *   node scripts/fix-history-anomalies.js           # dry run
 *   node scripts/fix-history-anomalies.js --apply   # write the two fixes
 *
 * Point DATABASE_URL at the target (same contract as restore-from-snapshot).
 */

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL is not set');
    process.exit(1);
  }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const day = (iso) => ({
    gte: new Date(`${iso}T00:00:00.000Z`),
    lt: new Date(`${iso}T24:00:00.000Z`),
  });

  // 1. The 156-second "session".
  const may10 = await prisma.workout.findFirst({
    where: { date: day('2026-05-10'), duration: 156 },
    select: { id: true, name: true, duration: true, _count: { select: { sets: true } } },
  });
  console.log(
    may10
      ? `1. ${may10.name}: duration 156s over ${may10._count.sets} sets -> null`
      : '1. May 10 duration row: already fixed or absent — nothing to do',
  );

  // 2. The upside-down Planks.
  const planks = await prisma.workoutSet.findMany({
    where: {
      weight: 10,
      reps: 1,
      exercise: { name: 'Plank' },
      workout: { date: day('2026-05-13') },
    },
    select: { id: true, setNumber: true },
  });
  console.log(
    planks.length
      ? `2. May 13 Plank: ${planks.length} rows at 10 kg x 1 -> 0 kg x 10 (seconds-in-reps)`
      : '2. May 13 Plank rows: already fixed or absent — nothing to do',
  );

  // 3. Flag only.
  const hipThrust = await prisma.workoutSet.count({
    where: {
      weight: 0,
      exercise: { name: 'Hip Thrust Machine' },
      workout: { date: day('2026-07-29') },
    },
  });
  if (hipThrust) {
    console.log(
      `3. FLAG (no write): Jul 29 Hip Thrust Machine has ${hipThrust} sets at 0 kg — edit by hand if you remember the pin.`,
    );
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply to fix 1 and 2.');
    await prisma.$disconnect();
    return;
  }

  if (may10) await prisma.workout.update({ where: { id: may10.id }, data: { duration: null } });
  if (planks.length) {
    await prisma.workoutSet.updateMany({
      where: { id: { in: planks.map((p) => p.id) } },
      data: { weight: 0, reps: 10 },
    });
  }
  console.log(`\napplied — ${(may10 ? 1 : 0) + planks.length} rows changed.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
