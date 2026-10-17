#!/usr/bin/env node
/**
 * READ-ONLY (2026-10-17, re-run for 13-17 Oct). The owner asked to see his heart rate around the
 * flu shot (11 Oct), the chest-pain evening (12 Oct) and today. Prints the
 * heart-related HealthSample rows the phone has synced for 10-13 Oct, the
 * matching BP readings and any AF episodes. It writes nothing; --apply is
 * accepted only so the Run-history-script Action's dry-run guard passes,
 * and it changes nothing either.
 *
 *   node scripts/read-heart-2026-10-13.js
 */
const APPLY = process.argv.includes('--apply');

const FROM = new Date('2026-10-13T00:00:00.000Z');
const TYPES = ['resting_hr', 'heart_rate', 'hrv_sdnn', 'walking_hr', 'respiratory_rate', 'sleep_resp_rate',
  'sleep_spo2_low', 'sleep_spo2_avg', 'sleep_asleep_h', 'wrist_temp_c', 'readiness_hold', 'steps', 'active_energy'];

const riyadh = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  console.log(`READ-ONLY${APPLY ? ' (--apply ignored, nothing is written)' : ''}: heart data from ${FROM.toISOString().slice(0, 10)}`);

  const rows = await prisma.healthSample.findMany({
    where: { date: { gte: FROM }, type: { in: TYPES } },
    orderBy: [{ type: 'asc' }, { date: 'asc' }],
  });
  let type = '';
  for (const r of rows) {
    if (r.type !== type) { type = r.type; console.log(`\n== ${type}`); }
    console.log(`  ${r.date.toISOString().slice(0, 16)}Z (${riyadh(r.date)}) = ${Math.round(r.value * 100) / 100} ${r.unit}${r.meta ? `  meta ${r.meta.slice(0, 120)}` : ''}  [synced ${r.createdAt.toISOString().slice(0, 16)}Z]`);
  }

  const bp = await prisma.bpReading.findMany({ where: { at: { gte: FROM } }, orderBy: { at: 'asc' } });
  console.log('\n== bp readings');
  for (const b of bp) console.log(`  ${riyadh(b.at)}  ${b.systolic}/${b.diastolic} pulse ${b.pulse ?? '-'}  ${b.context ?? ""} ${b.notes ?? ""}`);

  const af = await prisma.afEpisode.findMany({ where: { startedAt: { gte: new Date('2026-08-01T00:00:00Z') } }, orderBy: { startedAt: 'asc' } });
  console.log('\n== af episodes since 1 Aug');
  for (const a of af) console.log(`  ${riyadh(a.startedAt)}  ${a.durationMin ?? '?'} min  hr ${a.hrBpm ?? '-'}  ${a.symptoms ?? ''}`);

  const latest = await prisma.healthSample.findFirst({ where: { source: 'apple-health' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, type: true } });
  console.log(`\nLast phone sync: ${latest ? `${riyadh(latest.createdAt)} (${latest.type})` : 'none'}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
