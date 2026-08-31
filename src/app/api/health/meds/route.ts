import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Medication corrections and remote logging — the same pipe pattern as
 * cpap/fuel/af/bp. Row shapes:
 *   { name, doseLabel, frequency, startedOnISO?, notes? }  → upsert by name
 *   { name, stopISO }                                      → mark stopped
 *   { name, remove: true }                                 → delete outright
 * Upsert-by-name keeps re-POSTs idempotent (one row per drug; a dose
 * change updates the row — history lives in the prescriber's notes).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const rows = (body as { meds?: unknown }).meds;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20) {
    return NextResponse.json({ error: 'meds: 1-20 rows required' }, { status: 400 });
  }

  let saved = 0;
  let stopped = 0;
  let removed = 0;
  const skipped: string[] = [];
  for (const raw of rows) {
    const r = raw as {
      name?: string; doseLabel?: string; frequency?: string;
      startedOnISO?: string; notes?: string; stopISO?: string; remove?: boolean;
    };
    const name = r.name?.trim();
    if (!name || name.length > 80) { skipped.push(String(r.name ?? '?')); continue; }
    const existing = await prisma.medication.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });

    if (r.remove === true) {
      if (existing) { await prisma.medication.delete({ where: { id: existing.id } }); removed++; }
      continue;
    }
    if (r.stopISO) {
      const stop = new Date(r.stopISO);
      if (!existing || Number.isNaN(stop.getTime())) { skipped.push(`${name}: bad stop`); continue; }
      await prisma.medication.update({ where: { id: existing.id }, data: { stoppedOn: stop } });
      stopped++;
      continue;
    }
    if (!r.doseLabel || !r.frequency) { skipped.push(`${name}: doseLabel+frequency required`); continue; }
    const startedOn = r.startedOnISO ? new Date(r.startedOnISO) : undefined;
    if (startedOn && Number.isNaN(startedOn.getTime())) { skipped.push(`${name}: bad start`); continue; }
    const data = {
      name,
      doseLabel: r.doseLabel.slice(0, 60),
      frequency: r.frequency.slice(0, 60),
      startedOn,
      stoppedOn: null,
      notes: r.notes?.slice(0, 300) || undefined,
    };
    if (existing) await prisma.medication.update({ where: { id: existing.id }, data });
    else await prisma.medication.create({ data });
    saved++;
  }
  return NextResponse.json({ saved, stopped, removed, skipped });
}
