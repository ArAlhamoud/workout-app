import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bulk CPAP nights — the pipe for the prisma SMART max PDF report, which
 * is the only way Löwenstein data leaves their ecosystem. Same bounds and
 * PATCH-upsert semantics as logCpapNight; a night is keyed by the morning
 * it ENDED. Idempotent: re-posting a report updates rather than duplicates.
 * Open like the rest of the app (single user, owner's decision).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const nights = (body as { nights?: unknown }).nights;
  if (!Array.isArray(nights) || nights.length === 0 || nights.length > 100) {
    return NextResponse.json({ error: 'nights: 1-100 rows required' }, { status: 400 });
  }

  let saved = 0;
  let removed = 0;
  const skipped: string[] = [];
  for (const raw of nights) {
    const r = raw as { night?: string; usageHours?: number; ahi?: number; remove?: boolean };
    const night =
      typeof r.night === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.night)
        ? new Date(`${r.night}T00:00:00.000Z`)
        : null;
    // A correction row: {night, remove:true} erases the night entirely —
    // for rows that never should have existed (pre-therapy zeros), not
    // for nights he'd rather forget.
    if (night && !Number.isNaN(night.getTime()) && r.remove === true) {
      removed += (await prisma.cpapNight.deleteMany({ where: { night } })).count;
      continue;
    }
    if (
      !night ||
      Number.isNaN(night.getTime()) ||
      !Number.isFinite(r.usageHours) ||
      (r.usageHours as number) < 0 ||
      (r.usageHours as number) > 16
    ) {
      skipped.push(String(r.night ?? '?'));
      continue;
    }
    const patch: Record<string, number> = {
      usageHours: Math.round((r.usageHours as number) * 10) / 10,
    };
    if (r.ahi != null && Number.isFinite(r.ahi) && r.ahi >= 0 && r.ahi < 150) {
      patch.ahi = Math.round(r.ahi * 10) / 10;
    }
    await prisma.cpapNight.upsert({
      where: { night },
      update: patch,
      create: { night, ...patch } as never,
    });
    saved++;
  }
  return NextResponse.json({ saved, removed, skipped });
}
