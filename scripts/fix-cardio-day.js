#!/usr/bin/env node
/**
 * One-off repair (2026-09-11): `logCardio` let Prisma default the workout
 * date to now(), so cardio rows carry a real UTC instant while every other
 * workout sits at UTC midnight of the OWNER'S calendar day. A swim logged
 * at 00:38 Riyadh therefore filed itself under the previous day — its name
 * said "Sep 7", the list said "Sun, Sep 6", and the streak counted it in
 * the wrong week.
 *
 * Re-dates every Swim/Walk row to UTC midnight of the Riyadh day it was
 * actually created on. Rows already at midnight are left alone, so a second
 * run is a no-op.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-cardio-day.js           # preview
 *   node scripts/fix-cardio-day.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const riyadhDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const rows = await prisma.workout.findMany({
    where: { OR: [{ name: { startsWith: 'Swim ' } }, { name: { startsWith: 'Walk ' } }] },
    select: { id: true, name: true, date: true, createdAt: true },
    orderBy: { date: 'asc' },
  });
  const fixes = [];
  for (const w of rows) {
    if (w.date.toISOString().endsWith('T00:00:00.000Z')) continue;
    // The instant it was logged IS the moment he swam — take his day from it.
    const want = new Date(`${riyadhDay(w.date)}T00:00:00.000Z`);
    if (want.getTime() !== w.date.getTime()) fixes.push({ w, want });
  }
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} cardio row(s), ${fixes.length} to re-date`);
  for (const { w, want } of fixes) {
    console.log(`  "${w.name}"  ${w.date.toISOString()} -> ${want.toISOString()}`);
  }
  if (!fixes.length) { console.log('Nothing to change.'); await prisma.$disconnect(); return; }
  if (APPLY) {
    await prisma.$transaction(fixes.map(({ w, want }) => prisma.workout.update({ where: { id: w.id }, data: { date: want } })));
    console.log('  ✓ re-dated');
  } else {
    console.log('Dry run — nothing written. Re-run with --apply.');
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
