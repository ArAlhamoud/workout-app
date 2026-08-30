import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BP corrections and remote logging — the same pipe pattern as
 * /api/health/cpap, /api/health/fuel and /api/health/af. Two row shapes:
 *   { atISO, systolic, diastolic, pulse?, context? }   → create
 *   { remove: true, fromISO, toISO }                   → delete in window
 * Bounds mirror logBp. A row matching an existing reading within two
 * minutes is skipped, so a re-POST is idempotent. Open like the rest.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const rows = (body as { readings?: unknown }).readings;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) {
    return NextResponse.json({ error: 'readings: 1-100 rows required' }, { status: 400 });
  }

  let saved = 0;
  let removed = 0;
  const skipped: string[] = [];
  for (const raw of rows) {
    const r = raw as {
      atISO?: string;
      systolic?: number;
      diastolic?: number;
      pulse?: number;
      context?: string;
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
        await prisma.bpReading.deleteMany({ where: { at: { gte: from, lte: to } } })
      ).count;
      continue;
    }
    const at = r.atISO ? new Date(r.atISO) : null;
    if (!at || Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 10 * 60_000) {
      skipped.push(String(r.atISO ?? '?'));
      continue;
    }
    if (
      r.systolic == null || r.diastolic == null ||
      r.systolic < 60 || r.systolic > 260 || r.diastolic < 30 || r.diastolic > 160
    ) {
      skipped.push(`${r.atISO}: out of range`);
      continue;
    }
    const systolic = Math.round(r.systolic);
    const diastolic = Math.round(r.diastolic);
    const twin = await prisma.bpReading.findFirst({
      where: {
        systolic,
        diastolic,
        at: { gte: new Date(at.getTime() - 2 * 60_000), lte: new Date(at.getTime() + 2 * 60_000) },
      },
      select: { id: true },
    });
    if (twin) {
      skipped.push(`${r.atISO}: duplicate`);
      continue;
    }
    await prisma.bpReading.create({
      data: {
        at,
        systolic,
        diastolic,
        pulse: r.pulse != null && r.pulse > 20 && r.pulse < 250 ? Math.round(r.pulse) : null,
        context: r.context?.slice(0, 30) || null,
      },
    });
    saved++;
  }
  return NextResponse.json({ saved, removed, skipped });
}
