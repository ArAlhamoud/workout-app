// Shared shell for every /health/* page: arms the reminder notifications
// on EVERY health screen visit, not just the hub — logging a dose from the
// Home card's deep link into /health/injection must reschedule them too
// (device-tester: the hub-only mount missed exactly that path).

import prisma from '@/lib/prisma';
import HealthReminders from '@/components/health/HealthReminders';
import { penStatus } from '@/lib/pen';

export const dynamic = 'force-dynamic';

export default async function HealthLayout({ children }: { children: React.ReactNode }) {
  let nextDueISO: string | null = null;
  let lastISO: string | null = null;
  let buyByISO: string | null = null;
  let reminders: Record<string, boolean> = {};
  try {
    const [last, profile, doses] = await Promise.all([
      prisma.injection.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
      prisma.healthProfile.findUnique({ where: { id: 'profile' }, select: { reminders: true } }),
      // The whole log: the pen is counted from the first dose (src/lib/pen.ts).
      prisma.injection.findMany({ select: { at: true, doseMg: true } }),
    ]);
    if (last) {
      lastISO = last.at.toISOString();
      nextDueISO = new Date(last.at.getTime() + 7 * 86_400_000).toISOString();
    }
    buyByISO = penStatus(doses, { nextDueISO })?.buyByISO ?? null;
    reminders = (profile?.reminders as Record<string, boolean> | null) ?? {};
  } catch {
    /* pre-schema or db-down: pages degrade on their own */
  }
  return (
    <>
      <HealthReminders nextDueISO={nextDueISO} lastInjectionISO={lastISO} buyByISO={buyByISO} enabled={reminders} />
      {children}
    </>
  );
}
