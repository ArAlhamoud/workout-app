#!/usr/bin/env node
/**
 * One-off (2026-09-30): the owner injected his 5 mg dose on Tuesday
 * evening, 29 Sep, and logged it at 02:00 Wednesday. The injection form
 * still has no date or time field, so the save moment became the dose
 * time and next-due moved to Wednesday 7 Oct. The owner asked for
 * "10 pm tuesday": 22:00 Riyadh = 19:00Z, Tuesday on the calendar (law 8).
 * Same shape as fix-injection-2026-09-22.js.
 *
 * TARGETED ON PURPOSE: it names the one row by id and refuses unless
 * that row still carries the exact dose and timestamp being corrected.
 * `createdAt` is left alone — it is the honest record of when he logged.
 *
 * Idempotent: if the row already sits at the target time, it reports and
 * exits.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-injection-2026-09-29.js           # preview
 *   node scripts/fix-injection-2026-09-29.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const ID = 'cmuna4pjl0000o6dyv2x16yp9';
const EXPECT_DOSE_MG = 5;
const FROM_AT = '2026-09-29T23:00:18.126Z';
const TO_AT = '2026-09-29T19:00:00.000Z';

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const row = await prisma.injection.findUnique({
    where: { id: ID },
    select: { id: true, at: true, doseMg: true, site: true, createdAt: true },
  });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — injection ${ID}`);
  if (!row) {
    console.error('REFUSING: no injection with that id.');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ${row.doseMg} mg · ${row.site} · at ${row.at.toISOString()} · logged ${row.createdAt.toISOString()}`);

  if (row.at.toISOString() === TO_AT) {
    console.log('Already on Tuesday. Nothing to change.');
    await prisma.$disconnect();
    return;
  }
  if (row.doseMg !== EXPECT_DOSE_MG || row.at.toISOString() !== FROM_AT) {
    console.error(`REFUSING: expected ${EXPECT_DOSE_MG} mg at ${FROM_AT}; the row has changed since this script was written.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`  at ${FROM_AT} -> ${TO_AT}  (Tue 29 Sep, 22:00 Riyadh)`);
  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }
  await prisma.injection.update({ where: { id: ID }, data: { at: new Date(TO_AT) } });
  console.log('  ✓ re-dated to Tuesday');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
