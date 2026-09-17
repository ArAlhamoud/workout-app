#!/usr/bin/env node
/**
 * One-off (2026-09-18): the owner trained Thursday evening, handed the
 * session from the Watch to the phone, and finished after midnight. The
 * phone logger stamped the SAVE moment, so it saved as Friday 18 Sep.
 * The Watch had it right — it dates by startISO — so a handed-off
 * session had two answers depending on which device finished. The logger
 * now uses `activityDayStr` (04:00 rollover); this row predates it.
 *
 * TARGETED ON PURPOSE. The obvious version of this script infers
 * "mis-dated" from `createdAt` between 00:00 and 04:00 Riyadh, the way
 * fix-latenight-cardio.js did. That is NOT safe here: a snapshot restore
 * rewrites `createdAt`, so on a restored database every re-imported row
 * looks like a small-hours save. Dry-running that version against the
 * local restore offered to rename four correctly-dated September
 * sessions. So this names the row it is here to fix and refuses to
 * guess at any other.
 *
 * Idempotent: if nothing sits on FROM_DAY, it reports and exits.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/fix-latenight-training.js           # preview
 *   node scripts/fix-latenight-training.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const FROM_DAY = '2026-09-18';
const TO_DAY = '2026-09-17';
const NAME_PREFIX = 'Day A';

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const from = new Date(`${FROM_DAY}T00:00:00.000Z`);
  const to = new Date(`${TO_DAY}T00:00:00.000Z`);
  const next = new Date(from.getTime() + 86_400_000);

  const rows = await prisma.workout.findMany({
    where: { name: { startsWith: NAME_PREFIX }, date: { gte: from, lt: next } },
    select: { id: true, name: true, date: true, duration: true, _count: { select: { sets: true } } },
  });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} "${NAME_PREFIX}" row(s) on ${FROM_DAY}`);
  if (rows.length === 0) { console.log('Nothing to change.'); await prisma.$disconnect(); return; }
  if (rows.length > 1) {
    console.error(`REFUSING: expected exactly one session, found ${rows.length}. Name them individually instead.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const w = rows[0];
  const label = to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const name = w.name.replace(/ — [A-Z][a-z]{2} \d{1,2}$/, ` — ${label}`);
  console.log(`  "${w.name}"  ${w._count.sets} sets, ${Math.round((w.duration ?? 0) / 60)}m`);
  console.log(`  ${w.date.toISOString().slice(0, 10)} -> ${TO_DAY}   name -> "${name}"`);

  if (!APPLY) { console.log('Dry run — nothing written. Re-run with --apply.'); await prisma.$disconnect(); return; }
  await prisma.workout.update({ where: { id: w.id }, data: { date: to, name } });
  console.log('  ✓ re-dated');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
