#!/usr/bin/env node
/**
 * One-off (2026-10-04): the owner's endocrinologist (visit 30 Sep) keeps
 * him on 5 mg until the next endo visit, the full check-up about three
 * months after 20 Aug — around 20 Nov. Owner: "until my next endo visit the
 * plan is keep dose 5 mg".
 *
 * The stored plan ended at the week-7 doctor-review checkpoint, so from
 * Tuesday 6 Oct every screen would say "Doctor review" and offer no dose.
 * The review has happened; its answer is written here as plan data:
 *   weeks 1–4  2.5 mg   (as before)
 *   weeks 5–13 5 mg     (dose 13 = Tue 17 Nov, the last before the visit)
 *   week 14    checkpoint "Endo review (~20 Nov)" — nothing scheduled,
 *              the doctor decides (docs/HEALTH.md: checkpoints prescribe
 *              nothing). He can move it on /health/plan if the date moves.
 *
 * Refuses unless the stored plan is still the one this was written
 * against (weeks 1–6 = 2.5×4, 5×2, then a checkpoint at 7). Idempotent.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/set-dose-plan-2026-10-04.js           # preview
 *   node scripts/set-dose-plan-2026-10-04.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const TARGET = [
  ...[1, 2, 3, 4].map((week) => ({ week, mg: 2.5 })),
  ...[5, 6, 7, 8, 9, 10, 11, 12, 13].map((week) => ({ week, mg: 5 })),
  { week: 14, mg: null, label: 'Endo review (~20 Nov)' },
];
const EXPECTED_PREFIX = [2.5, 2.5, 2.5, 2.5, 5, 5];

const show = (plan) =>
  plan.map((s) => `w${s.week}:${s.mg == null ? `checkpoint${s.label ? ` (${s.label})` : ''}` : `${s.mg}`}`).join(' ');

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const profile = await prisma.healthProfile.findUnique({ where: { id: 'profile' }, select: { dosePlan: true } });
  const injections = await prisma.injection.findMany({ orderBy: { at: 'asc' }, select: { at: true, doseMg: true } });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — dose plan`);
  console.log(`Injections on record (${injections.length}):`);
  injections.forEach((i, n) => console.log(`  dose ${n + 1}: ${i.doseMg} mg at ${i.at.toISOString()}`));

  if (!profile) {
    console.error('REFUSING: no health profile row.');
    await prisma.$disconnect();
    process.exit(1);
  }
  const current = Array.isArray(profile.dosePlan) ? [...profile.dosePlan].sort((a, b) => a.week - b.week) : null;
  console.log(`Stored plan: ${current ? show(current) : '(none — the app uses its default)'}`);
  console.log(`Target plan: ${show(TARGET)}`);

  if (current && JSON.stringify(current) === JSON.stringify(TARGET)) {
    console.log('Already set. Nothing to change.');
    await prisma.$disconnect();
    return;
  }
  // The default (null) and the stored copy of it are both the plan this was written against.
  if (current) {
    const prefixOk = EXPECTED_PREFIX.every((mg, i) => current[i] && current[i].week === i + 1 && current[i].mg === mg);
    const checkpoint7 = current.find((s) => s.week === 7);
    if (!prefixOk || !checkpoint7 || checkpoint7.mg != null) {
      console.error('REFUSING: the stored plan is not the 2.5×4 → 5×2 → week-7 checkpoint this was written against.');
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }
  await prisma.healthProfile.update({ where: { id: 'profile' }, data: { dosePlan: TARGET } });
  console.log('Written.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
