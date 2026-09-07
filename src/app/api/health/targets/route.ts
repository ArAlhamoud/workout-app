import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROFILE_ID = 'profile';

/**
 * Daily fuel targets — the same merge as updateFuelTargets (the Fuel
 * tracker's own editor), reachable as a pipe so a reviewed plan can be
 * written without retyping four numbers on a phone. Body:
 *   { kcal?, proteinG?, carbsG?, fatG?, waterMl?, fiberG?, dropLegacyProtein? }
 * Out-of-range means LEAVE UNCHANGED, never clamp — the same
 * reject-don't-clamp rule as the read side (adversary S2). Open like the
 * rest of the app (single user, owner's decision).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as {
    kcal?: number; proteinG?: number; carbsG?: number; fatG?: number;
    waterMl?: number; fiberG?: number; dropLegacyProtein?: boolean;
  };
  const profile = await prisma.healthProfile.findUnique({
    where: { id: PROFILE_ID },
    select: { targets: true },
  });
  const current = { ...((profile?.targets as Record<string, unknown> | null) ?? {}) };
  // The check-in's old protein key is read by nothing since the Fuel
  // tracker moved to fuelProteinG; two protein targets in one record is
  // how a 100 g number ends up contradicting a 130 g display.
  if (b.dropLegacyProtein === true) delete current.proteinG;

  const valid = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
  const put = (key: string, v: unknown, lo: number, hi: number) => {
    const n = valid(v, lo, hi);
    return n != null ? { [key]: n } : {};
  };
  const merged = {
    ...current,
    ...put('kcal', b.kcal, 800, 6000),
    ...put('fuelProteinG', b.proteinG, 30, 400),
    ...put('carbsG', b.carbsG, 0, 800),
    ...put('fatG', b.fatG, 20, 400),
    ...put('waterMl', b.waterMl, 500, 10_000),
    ...put('fiberG', b.fiberG, 5, 100),
  };
  await prisma.healthProfile.update({ where: { id: PROFILE_ID }, data: { targets: merged as Prisma.InputJsonValue } });
  return NextResponse.json({ targets: merged });
}

export async function GET() {
  const profile = await prisma.healthProfile.findUnique({
    where: { id: PROFILE_ID },
    select: { targets: true },
  });
  return NextResponse.json({ targets: profile?.targets ?? null });
}
