import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * AF episode corrections and remote logging — the same pipe pattern as
 * /api/health/cpap and /api/health/fuel. Two row shapes:
 *   { startedAtISO, durationMin?, hrBpm? }            → create
 *   { remove: true, fromISO, toISO }                  → delete in window
 * Bounds mirror logAfEpisode. Open like the rest of the app.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const rows = (body as { episodes?: unknown }).episodes;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) {
    return NextResponse.json({ error: 'episodes: 1-50 rows required' }, { status: 400 });
  }

  let saved = 0;
  let removed = 0;
  const skipped: string[] = [];
  for (const raw of rows) {
    const r = raw as {
      startedAtISO?: string;
      durationMin?: number;
      hrBpm?: number;
      remove?: boolean;
      fromISO?: string;
      toISO?: string;
    };
    if (r.remove === true) {
      const from = r.fromISO ? new Date(r.fromISO) : null;
      const to = r.toISO ? new Date(r.toISO) : null;
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        skipped.push('remove: bad window');
        continue;
      }
      removed += (
        await prisma.afEpisode.deleteMany({ where: { startedAt: { gte: from, lte: to } } })
      ).count;
      continue;
    }
    const startedAt = r.startedAtISO ? new Date(r.startedAtISO) : null;
    if (!startedAt || Number.isNaN(startedAt.getTime()) || startedAt.getTime() > Date.now()) {
      skipped.push(String(r.startedAtISO ?? '?'));
      continue;
    }
    const durationMin =
      r.durationMin != null && Number.isFinite(r.durationMin) && r.durationMin > 0 && r.durationMin < 24 * 60
        ? Math.round(r.durationMin)
        : null;
    await prisma.afEpisode.create({
      data: {
        startedAt,
        durationMin,
        endedAt: durationMin ? new Date(startedAt.getTime() + durationMin * 60_000) : null,
        hrBpm: r.hrBpm != null && r.hrBpm > 20 && r.hrBpm < 300 ? Math.round(r.hrBpm) : null,
        ecgRecorded: false,
      },
    });
    saved++;
  }
  return NextResponse.json({ saved, removed, skipped });
}
