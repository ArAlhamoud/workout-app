// Today's coach brief: generated once per day, lazily, on first request —
// then served from the CoachNote row. The model is never in the render path
// twice, and abuse of the URL costs at most one generation per day.
//
// Degradation contract: no API key, refusal, timeout, parse failure — all
// return { note: null } and the app's deterministic layer stands alone.

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { generateCoachBrief, type CoachBrief } from '@/lib/coach-ai';
import { assembleCoachContext, todayKey } from '@/lib/coach-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const day = todayKey();

  const existing = await prisma.coachNote.findUnique({ where: { day } });
  if (existing) {
    return NextResponse.json({
      note: { brief: existing.brief, directives: existing.directives ?? [] },
      cached: true,
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ note: null });

  const { context, todayLine } = await assembleCoachContext();
  const brief: CoachBrief | null = await generateCoachBrief(context, todayLine);
  if (!brief) return NextResponse.json({ note: null });

  // Race-safe: two first-requests of the day may both generate; the unique
  // day key makes the second write a no-op instead of a duplicate.
  try {
    await prisma.coachNote.create({
      data: {
        day,
        brief: brief.brief,
        directives: brief.directives as unknown as Prisma.InputJsonValue,
        model: 'claude-opus-5',
      },
    });
  } catch {
    /* unique collision — someone else stored it first; serve ours anyway */
  }

  return NextResponse.json({ note: brief, cached: false });
}
