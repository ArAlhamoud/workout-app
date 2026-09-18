// What his chart says, read once per request for the effort ceiling and
// the readiness rules (program.ts effortCeiling / afOnChart). Server-only.
// Fails CLOSED: if either table cannot be read, the caller receives
// 'unknown' and effortCeiling answers Hard — a medical cap that costs
// nothing is the right default, an unreadable chart lifting it is not
// (trainer, 2026-09-18).
import prisma from '@/lib/prisma';

export interface Chart {
  conditions: unknown;
  medications: unknown;
}

export async function readChart(): Promise<Chart> {
  const [profile, meds] = await Promise.all([
    prisma.healthProfile.findUnique({ where: { id: 'profile' }, select: { conditions: true } }).catch(() => 'unknown' as const),
    prisma.medication.findMany({ where: { stoppedOn: null }, select: { name: true } }).catch(() => 'unknown' as const),
  ]);
  return {
    conditions: profile === 'unknown' ? 'unknown' : profile?.conditions ?? [],
    medications: meds === 'unknown' ? 'unknown' : meds.map((m) => m.name),
  };
}
