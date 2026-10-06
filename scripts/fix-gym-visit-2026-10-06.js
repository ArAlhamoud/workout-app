#!/usr/bin/env node
/**
 * One-off (2026-10-07): the owner's gym visit on the evening of Tue 6 Oct
 * was tapped wrong. He checked in at 22:03 Riyadh and out at 00:20, but
 * spent 25 minutes of it watching a game — "i would take 25 minutes out of
 * the total". GymVisit has no "minutes excluded" field, so the visit keeps
 * its real check-in and the check-out moves 25 minutes earlier:
 *   in  22:03 Riyadh = 19:03Z (6 Oct)
 *   out 23:55 Riyadh = 20:55Z (6 Oct)  → 1 h 52 door to door
 *
 * TARGETED ON PURPOSE: it takes the most recent visit and refuses unless
 * that visit was checked in within 3 hours of 22:03 on 6 Oct. Idempotent.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-gym-visit-2026-10-06.js           # preview
 *   node scripts/fix-gym-visit-2026-10-06.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const TO_IN = '2026-10-06T19:03:00.000Z';
const TO_OUT = '2026-10-06T20:55:00.000Z';
const WINDOW_MS = 3 * 3_600_000;

const riyadh = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }) : 'open';

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const recent = await prisma.gymVisit.findMany({ orderBy: { checkInAt: 'desc' }, take: 5 });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — gym visit of Tue 6 Oct`);
  console.log('Most recent visits:');
  for (const v of recent) console.log(`  ${v.id} · ${v.gym} · in ${riyadh(v.checkInAt)} · out ${riyadh(v.checkOutAt)}`);

  const v = recent[0];
  if (!v) {
    console.error('REFUSING: no gym visits on record.');
    await prisma.$disconnect();
    process.exit(1);
  }
  if (v.checkInAt.toISOString() === TO_IN && v.checkOutAt && v.checkOutAt.toISOString() === TO_OUT) {
    console.log('Already corrected. Nothing to change.');
    await prisma.$disconnect();
    return;
  }
  if (Math.abs(v.checkInAt.getTime() - Date.parse(TO_IN)) > WINDOW_MS) {
    console.error('REFUSING: the most recent visit was not checked in near 22:03 on 6 Oct.');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ${v.id}: in ${riyadh(v.checkInAt)} -> ${riyadh(TO_IN)}; out ${riyadh(v.checkOutAt)} -> ${riyadh(TO_OUT)} (1 h 52)`);
  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }
  await prisma.gymVisit.update({ where: { id: v.id }, data: { checkInAt: new Date(TO_IN), checkOutAt: new Date(TO_OUT) } });
  console.log('Written.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
