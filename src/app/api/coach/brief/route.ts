// Today's coach brief: AT MOST ONE generation attempt per calendar day.
//
// The cost bound must be real, not advertised (adversary: the old
// check-then-act dedupe let N concurrent requests buy N paid generations,
// and failure days retried on every request all day). The fix is
// row-as-lock: the CoachNote row is created EMPTY before generating, so
// the unique day key is the mutex. Whoever wins the create generates;
// everyone else reads. A failed generation leaves the empty row standing —
// that day's brief is simply absent, and tomorrow tries again. One
// attempt, one day, no matter who hits the URL how often.
//
// Degradation contract: EVERY failure — missing table (pre-schema deploy
// window), no key, refusal, timeout, parse — returns { note: null }.

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { generateCoachBrief } from '@/lib/coach-ai';
import { assembleCoachContext, todayKey } from '@/lib/coach-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Non-streaming Opus call needs more than Vercel's default window. */
export const maxDuration = 60;

const MODEL = 'claude-opus-5';

export async function GET() {
  try {
    const day = todayKey();

    // Try to claim today. An empty brief marks "attempted" — it is the lock
    // AND the failure marker.
    let claimed = false;
    try {
      await prisma.coachNote.create({ data: { day, brief: '', model: MODEL } });
      claimed = true;
    } catch {
      /* row exists — someone claimed today already (or the table is missing,
         which the outer catch handles when the read below also fails) */
    }

    if (!claimed) {
      const existing = await prisma.coachNote.findUnique({ where: { day } });
      if (existing && existing.brief) {
        return NextResponse.json({
          note: { brief: existing.brief, directives: existing.directives ?? [] },
          cached: true,
        });
      }
      // Claimed by another request that is still generating, or that failed.
      // Either way: not our turn, and no retry storm.
      return NextResponse.json({ note: null });
    }

    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ note: null });

    const { context, todayLine } = await assembleCoachContext();
    const brief = await generateCoachBrief(context, todayLine);
    if (!brief) return NextResponse.json({ note: null }); // empty row stands — done for today

    await prisma.coachNote.update({
      where: { day },
      data: { brief: brief.brief, directives: brief.directives as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({ note: brief, cached: false });
  } catch {
    // Missing table, DB down — the deterministic layer stands alone.
    return NextResponse.json({ note: null });
  }
}
