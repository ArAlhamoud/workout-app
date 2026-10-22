import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { geofenceEnter, geofenceExit, parseEventTime, type VisitLite } from '@/lib/gym-visits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Geofence check-in / check-out (owner, 2026-10-22). The phone posts
 *   { event: 'enter' | 'exit', gym: 'bfit' | 'work', atISO }
 * where atISO is when the region event happened. Enter is sent when he taps
 * "Check in" on the arrival prompt; exit is sent on its own once he has been
 * outside long enough. No location ever reaches the server — only the gym
 * and the time. The rules live in geofenceEnter / geofenceExit.
 * Open like the rest of the app (single user, owner's decision).
 */
const toLite = (v: { id: string; gym: string; checkInAt: Date; checkOutAt: Date | null }): VisitLite => ({
  id: v.id,
  gym: v.gym,
  checkInAt: v.checkInAt.toISOString(),
  checkOutAt: v.checkOutAt ? v.checkOutAt.toISOString() : null,
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = (body ?? {}) as { event?: unknown; gym?: unknown; atISO?: unknown };
  const at = parseEventTime(b.atISO);
  if ((b.event !== 'enter' && b.event !== 'exit') || typeof b.gym !== 'string' || !at) {
    return NextResponse.json({ error: 'event (enter|exit), gym and atISO with Z or an offset required' }, { status: 400 });
  }
  const gym = b.gym;
  const now = new Date();
  // One lock for the read-decide-write, so a retry or a phone and a Watch
  // tap at the same moment cannot both create a visit (adversary).
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    const recent = (
      await tx.gymVisit.findMany({
        where: { OR: [{ checkOutAt: null }, { checkOutAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } }] },
        orderBy: { checkInAt: 'desc' },
        take: 10,
      })
    ).map(toLite);
    if (b.event === 'enter') {
      const d = geofenceEnter(recent, { gym, at, now });
      if (d.action === 'none' || !d.checkInAt) return { action: 'none' as const };
      const v = await tx.gymVisit.create({ data: { gym, checkInAt: d.checkInAt } });
      return { action: 'created' as const, visit: toLite(v) };
    }
    const d = geofenceExit(recent.filter((v) => !v.checkOutAt), { gym, at, now });
    if (d.action === 'none' || !d.visitId || !d.checkOutAt) return { action: 'none' as const };
    const r = await tx.gymVisit.updateMany({ where: { id: d.visitId, checkOutAt: null }, data: { checkOutAt: d.checkOutAt } });
    if (r.count === 0) return { action: 'none' as const };
    const v = await tx.gymVisit.findUnique({ where: { id: d.visitId } });
    return { action: 'closed' as const, visit: v ? toLite(v) : null };
  });
  if (result.action !== 'none') {
    revalidatePath('/train');
    revalidatePath('/stats');
  }
  return NextResponse.json(result);
}
