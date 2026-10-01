'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { DEFAULT_GYM_ID, GYMS } from '@/lib/program';
import { ADJUST_STEP_MIN, adjustedTime, isStale, type VisitLite } from '@/lib/gym-visits';

/**
 * Gym check-in / check-out (owner, 2026-10-01). Every read is tolerant of
 * the table not existing yet: the schema ships through the Apply-schema
 * Action ahead of the code, but a deploy must never 500 /train if that
 * order slips (same stance as live-store.ts).
 */

const GYM_IDS = new Set(GYMS.map((g) => g.id));

function refresh() {
  revalidatePath('/train');
  revalidatePath('/stats');
}

export interface GymVisitState {
  /** The visit in progress (opened within the last 6 hours), if any. */
  open: VisitLite | null;
  /** An open visit older than 6 hours: he forgot to check out. */
  forgotten: VisitLite | null;
  /** The most recent closed visit, for the "last visit" line and fixes. */
  last: VisitLite | null;
}

const toLite = (v: { id: string; gym: string; checkInAt: Date; checkOutAt: Date | null }): VisitLite => ({
  id: v.id,
  gym: v.gym,
  checkInAt: v.checkInAt.toISOString(),
  checkOutAt: v.checkOutAt ? v.checkOutAt.toISOString() : null,
});

export async function getGymVisitState(): Promise<GymVisitState> {
  try {
    const [openRows, last] = await Promise.all([
      prisma.gymVisit.findMany({ where: { checkOutAt: null }, orderBy: { checkInAt: 'desc' }, take: 3 }),
      prisma.gymVisit.findFirst({ where: { checkOutAt: { not: null } }, orderBy: { checkInAt: 'desc' } }),
    ]);
    const now = new Date();
    const open = openRows.find((v) => !isStale(toLite(v), now)) ?? null;
    const forgotten = openRows.find((v) => isStale(toLite(v), now)) ?? null;
    return { open: open && toLite(open), forgotten: forgotten && toLite(forgotten), last: last && toLite(last) };
  } catch {
    return { open: null, forgotten: null, last: null };
  }
}

/** Every closed visit, for the averages on /stats. */
export async function getGymVisits(): Promise<VisitLite[]> {
  try {
    const rows = await prisma.gymVisit.findMany({ orderBy: { checkInAt: 'desc' }, take: 500 });
    return rows.map(toLite);
  } catch {
    return [];
  }
}

/** Check in. A second tap while a fresh visit is open returns that visit
 *  instead of opening another (double taps, two devices). */
export async function checkIn(gym: string): Promise<VisitLite> {
  const g = GYM_IDS.has(gym) ? gym : DEFAULT_GYM_ID;
  const openRows = await prisma.gymVisit.findMany({ where: { checkOutAt: null }, orderBy: { checkInAt: 'desc' }, take: 3 });
  const fresh = openRows.find((v) => !isStale(toLite(v)));
  if (fresh) return toLite(fresh);
  const v = await prisma.gymVisit.create({ data: { gym: g, checkInAt: new Date() } });
  refresh();
  return toLite(v);
}

/** Check out now. A visit already closed is left as it is. */
export async function checkOut(id: string): Promise<VisitLite | null> {
  const v = await prisma.gymVisit.findUnique({ where: { id } });
  if (!v) return null;
  if (v.checkOutAt) return toLite(v);
  const now = new Date();
  const out = new Date(Math.max(now.getTime(), v.checkInAt.getTime() + 60_000));
  const done = await prisma.gymVisit.update({ where: { id }, data: { checkOutAt: out } });
  refresh();
  return toLite(done);
}

/**
 * Close a forgotten visit at a stated time: check-in + `minutes`. The
 * owner says how long he stayed; the app never guesses a check-out.
 */
export async function closeForgotten(id: string, minutes: number): Promise<VisitLite | null> {
  const v = await prisma.gymVisit.findUnique({ where: { id } });
  if (!v || v.checkOutAt) return v ? toLite(v) : null;
  const m = Math.round(minutes);
  if (!Number.isFinite(m) || m < 5 || m > 300) return toLite(v);
  const done = await prisma.gymVisit.update({
    where: { id },
    data: { checkOutAt: new Date(v.checkInAt.getTime() + m * 60_000) },
  });
  refresh();
  return toLite(done);
}

/** Move a check-in or check-out by one step (±5 minutes), within the rules
 *  in adjustedTime. Returns the visit unchanged when the move is refused. */
export async function nudgeVisit(
  id: string,
  field: 'checkInAt' | 'checkOutAt',
  direction: 1 | -1,
): Promise<VisitLite | null> {
  // Server actions are callable with anything: only the two time fields,
  // only one step either way, can ever be written here.
  if (field !== 'checkInAt' && field !== 'checkOutAt') return null;
  if (direction !== 1 && direction !== -1) return null;
  const v = await prisma.gymVisit.findUnique({ where: { id } });
  if (!v) return null;
  const next = adjustedTime(toLite(v), field, direction * ADJUST_STEP_MIN);
  if (!next) return toLite(v);
  const done = await prisma.gymVisit.update({ where: { id }, data: { [field]: next } });
  refresh();
  return toLite(done);
}

export async function deleteVisit(id: string): Promise<void> {
  await prisma.gymVisit.deleteMany({ where: { id } });
  refresh();
}
