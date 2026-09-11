import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lab results — the same pipe pattern as cpap/fuel/bp/meds, because they
 * arrive the same way: a screenshot of the lab's own app, typed in once.
 * A result is keyed by TEST + CALENDAR DAY, so re-posting a panel corrects
 * it rather than duplicating; a repeat of the same test on a later day is
 * a new row, which is the whole point of a trend.
 *   { date, test, value, unit, refLow?, refHigh?, lab?, notes? }
 *   { date, test, remove: true }
 * The range is stored PER ROW because it belongs to the draw, not to the
 * test: thresholds move with guideline revisions and with the patient's
 * own risk over the years. Omit refHigh when the historical range is
 * unknown rather than back-stamping today's (owner, 2026-09-11).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const rows = (body as { labs?: unknown }).labs;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) {
    return NextResponse.json({ error: 'labs: 1-100 rows required' }, { status: 400 });
  }

  let saved = 0;
  let removed = 0;
  const skipped: string[] = [];
  for (const raw of rows) {
    const r = raw as {
      date?: string; test?: string; value?: number; unit?: string;
      refLow?: number; refHigh?: number; lab?: string; notes?: string; remove?: boolean;
    };
    const test = r.test?.trim().toLowerCase().slice(0, 40);
    const day = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
      ? new Date(`${r.date}T00:00:00.000Z`)
      : null;
    if (!test || !day || Number.isNaN(day.getTime())) {
      skipped.push(`${r.test ?? '?'} ${r.date ?? '?'}`);
      continue;
    }
    // Same test, same calendar day = the same result, however it was typed.
    const next = new Date(day.getTime() + 86_400_000);
    const existing = await prisma.labResult.findFirst({
      where: { test, date: { gte: day, lt: next } },
      select: { id: true },
    });

    if (r.remove === true) {
      if (existing) { await prisma.labResult.delete({ where: { id: existing.id } }); removed++; }
      continue;
    }
    if (!Number.isFinite(r.value) || !r.unit) {
      skipped.push(`${test}: value+unit required`);
      continue;
    }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const data = {
      date: day,
      test,
      value: r.value as number,
      unit: r.unit.slice(0, 20),
      refLow: num(r.refLow),
      refHigh: num(r.refHigh),
      lab: r.lab?.slice(0, 80) || null,
      notes: r.notes?.slice(0, 300) || null,
    };
    if (existing) await prisma.labResult.update({ where: { id: existing.id }, data });
    else await prisma.labResult.create({ data });
    saved++;
  }
  return NextResponse.json({ saved, removed, skipped });
}
