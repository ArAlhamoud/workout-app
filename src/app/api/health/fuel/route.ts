import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bulk daily macros — the pipe for meal-app screenshots parsed elsewhere
 * (and any future automation). Same bounds and PATCH-upsert semantics as
 * logNutrition: only provided fields reach an existing day, re-posting
 * corrects, a day is its own key. {day, remove:true} erases a day that
 * never should have existed. Open like the rest of the app.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const days = (body as { days?: unknown }).days;
  if (!Array.isArray(days) || days.length === 0 || days.length > 100) {
    return NextResponse.json({ error: 'days: 1-100 rows required' }, { status: 400 });
  }

  const bounded = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : undefined;

  let saved = 0;
  let removed = 0;
  const skipped: string[] = [];
  for (const raw of days) {
    const r = raw as {
      day?: string; kcal?: number; proteinG?: number; carbsG?: number; fatG?: number;
      waterMl?: number; remove?: boolean;
      /** Add on top of the day instead of setting it — dinner stacking
       *  onto the subscription baseline. */
      add?: boolean;
    };
    const day =
      typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day)
        ? new Date(`${r.day}T00:00:00.000Z`)
        : null;
    if (!day || Number.isNaN(day.getTime())) {
      skipped.push(String(r.day ?? '?'));
      continue;
    }
    if (r.remove === true) {
      removed += (await prisma.nutritionLog.deleteMany({ where: { day } })).count;
      continue;
    }
    const patch: Record<string, number> = {};
    const kc = bounded(r.kcal, 8000);
    const p = bounded(r.proteinG, 400);
    const c = bounded(r.carbsG, 900);
    const f = bounded(r.fatG, 400);
    const w = bounded(r.waterMl, 10_000);
    if (kc !== undefined) patch.kcal = kc;
    if (p !== undefined) patch.proteinG = p;
    if (c !== undefined) patch.carbsG = c;
    if (f !== undefined) patch.fatG = f;
    if (w !== undefined) patch.waterMl = w;
    if (!Object.keys(patch).length) {
      skipped.push(r.day as string);
      continue;
    }
    if (r.add === true) {
      const existing = await prisma.nutritionLog.findUnique({ where: { day } });
      const caps: Record<string, number> = { kcal: 8000, proteinG: 400, carbsG: 900, fatG: 400, waterMl: 10_000 };
      for (const k of Object.keys(patch)) {
        patch[k] = Math.min(((existing as Record<string, number | null> | null)?.[k] ?? 0) + patch[k], caps[k]);
      }
    }
    await prisma.nutritionLog.upsert({ where: { day }, update: patch, create: { day, ...patch } as never });
    saved++;
  }
  return NextResponse.json({ saved, removed, skipped });
}
