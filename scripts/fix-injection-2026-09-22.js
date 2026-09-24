#!/usr/bin/env node
/**
 * One-off (2026-09-24): the owner injected his first 5 mg dose on
 * Tuesday evening, 22 Sep, and logged it the next morning. The injection
 * form has no date or time field, so `logInjection` stamped the SAVE
 * moment — Wednesday 23 Sep 10:52 Riyadh — and every reader that follows
 * the latest injection (next-due, the reminder, the weekly rhythm) moved
 * to Wednesday. The next reminder landed on 30 Sep, his cardiology day.
 *
 * The owner confirmed "correct it to tuesday". He gave no clock time;
 * his four previous doses were all logged Tuesday between 21:57 and 23:22
 * Riyadh, so this uses 22:00 Riyadh (19:00Z). Doses stay on CALENDAR days
 * (HEALTH.md law 8) and 22:00 on the 22nd is Tuesday in both clocks.
 *
 * TARGETED ON PURPOSE: it names the one row by id and refuses unless
 * that row still carries the exact dose and timestamp being corrected.
 * `createdAt` is left alone — it is the honest record of when he logged.
 *
 * Idempotent: if the row already sits at the target time, it reports and
 * exits.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-injection-2026-09-22.js           # preview
 *   node scripts/fix-injection-2026-09-22.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const ID = 'cmudt1mf0003913we7fhglemw';
const EXPECT_DOSE_MG = 5;
const FROM_AT = '2026-09-23T07:52:05.038Z';
const TO_AT = '2026-09-22T19:00:00.000Z';

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

  console.log(`  at ${FROM_AT} -> ${TO_AT}  (Tue 22 Sep, 22:00 Riyadh)`);
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
