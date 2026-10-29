#!/usr/bin/env node
/**
 * Read-only (2026-10-29): why did the Watch plan prescribe no +1 rep?
 * Prints the phone's readiness flags (HOLD blocks every climb) for the last
 * 14 activity days. Writes nothing; --apply is accepted and ignored.
 */
const APPLY = process.argv.includes('--apply');

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const since = new Date(Date.now() - 14 * 86400000);
  const rows = await prisma.healthSample.findMany({
    where: { type: 'readiness_hold', date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, value: true, meta: true, createdAt: true },
  });
  console.log(`READ ONLY${APPLY ? ' (--apply ignored)' : ''} — readiness_hold, last 14 days`);
  for (const r of rows) console.log(`  ${r.date.toISOString().slice(0, 10)} hold=${r.value} at=${r.createdAt.toISOString()} ${JSON.stringify(r.meta)}`);
  if (!rows.length) console.log('  (none)');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
