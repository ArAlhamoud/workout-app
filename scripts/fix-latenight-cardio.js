#!/usr/bin/env node
/**
 * One-off (2026-09-13): the owner logged a swim and a walk from the sofa
 * after 00:00 Riyadh, so `logCardio` stamped them with the NEW date while
 * the activity belonged to the evening just past. logCardio now rolls the
 * activity day over at 04:00; these two rows predate the fix.
 *
 * Moves Swim/Walk rows created between 00:00 and 04:00 Riyadh back to the
 * previous day. Idempotent: a row already on its created-day minus one is
 * left alone, so a second run finds nothing.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-latenight-cardio.js           # preview
 *   node scripts/fix-latenight-cardio.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');
const riyadhHour = (d) => Number(d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }));
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
    const hour = riyadhHour(w.createdAt);
    if (hour >= 4) continue; // logged in daylight — the date it carries is right
    const want = new Date(`${riyadhDay(w.createdAt)}T00:00:00.000Z`);
    want.setUTCDate(want.getUTCDate() - 1);
    if (want.getTime() !== w.date.getTime()) fixes.push({ w, want, hour });
  }
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} cardio row(s), ${fixes.length} logged before 04:00 and mis-dated`);
  for (const { w, want, hour } of fixes) {
    console.log(`  "${w.name}"  created ${String(hour).padStart(2, '0')}:xx Riyadh  ${w.date.toISOString().slice(0, 10)} -> ${want.toISOString().slice(0, 10)}`);
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
