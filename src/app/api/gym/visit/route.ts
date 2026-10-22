import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { geofenceEnter, geofenceExit, type VisitLite } from '@/lib/gym-visits';

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
  const at = typeof b.atISO === 'string' ? new Date(b.atISO) : null;
  if ((b.event !== 'enter' && b.event !== 'exit') || typeof b.gym !== 'string' || !at || Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: 'event (enter|exit), gym and atISO required' }, { status: 400 });
  }
  const now = new Date();
  const open = (await prisma.gymVisit.findMany({ where: { checkOutAt: null }, orderBy: { checkInAt: 'desc' }, take: 5 })).map(toLite);

  if (b.event === 'enter') {
    const d = geofenceEnter(open, { gym: b.gym, at, now });
    if (d.action === 'none' || !d.checkInAt) return NextResponse.json({ action: 'none', open: open[0] ?? null });
    const v = await prisma.gymVisit.create({ data: { gym: b.gym, checkInAt: d.checkInAt } });
    revalidatePath('/train');
    revalidatePath('/stats');
    return NextResponse.json({ action: 'created', visit: toLite(v) });
  }

  const d = geofenceExit(open, { gym: b.gym, at, now });
  if (d.action === 'none' || !d.visitId || !d.checkOutAt) return NextResponse.json({ action: 'none' });
  // Only an open row is closed: a check-out tapped on another device wins.
  const r = await prisma.gymVisit.updateMany({ where: { id: d.visitId, checkOutAt: null }, data: { checkOutAt: d.checkOutAt } });
  if (r.count === 0) return NextResponse.json({ action: 'none' });
  revalidatePath('/train');
  revalidatePath('/stats');
  const v = await prisma.gymVisit.findUnique({ where: { id: d.visitId } });
  return NextResponse.json({ action: 'closed', visit: v ? toLite(v) : null });
}
