#!/usr/bin/env node
/**
 * One-off (2026-10-17): the owner reported yesterday's symptoms in chat —
 * "a light reflux and medium gas" on Fri 16 Oct. There is no symptom pipe
 * and the phone form stamps "now", so this writes the two SymptomLog rows at
 * 16 Oct 20:00 Riyadh (17:00Z; time of day not given). Severity scale 1-3:
 * light = 1, medium = 2. Idempotent: skips a kind already logged that day.
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/log-symptoms-2026-10-16.js           # preview
 *   node scripts/log-symptoms-2026-10-16.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');
const AT = new Date('2026-10-16T17:00:00.000Z');
const DAY_FROM = new Date('2026-10-16T01:00:00.000Z'); // 04:00 Riyadh
const DAY_TO = new Date('2026-10-17T01:00:00.000Z');
const ROWS = [
  { kind: 'reflux', severity: 1, notes: 'Light; reported next day (time not given).' },
  { kind: 'gas', severity: 2, notes: 'Medium; reported next day (time not given).' },
];

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — symptoms for Fri 16 Oct`);
  for (const r of ROWS) {
    const existing = await prisma.symptomLog.findFirst({ where: { kind: r.kind, at: { gte: DAY_FROM, lt: DAY_TO } } });
    if (existing) { console.log(`  ${r.kind}: already logged (severity ${existing.severity}) — skip`); continue; }
    console.log(`  ${r.kind}: severity ${r.severity} at ${AT.toISOString()}`);
    if (APPLY) await prisma.symptomLog.create({ data: { ...r, at: AT } });
  }
  console.log(APPLY ? 'Written.' : 'Dry run — nothing written. Re-run with --apply.');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
