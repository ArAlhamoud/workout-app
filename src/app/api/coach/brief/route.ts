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
import { Prisma } from '@prisma/client';
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

    // Dormant coach = no work AND no writes. This check used to sit below the
    // row claim, so a keyless deploy still INSERTed one junk CoachNote per
    // day just to mark "attempted nothing".
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ note: null });

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
          note: {
            brief: existing.brief,
            directives: existing.directives ?? [],
            proposal: existing.proposal ?? null,
          },
          cached: true,
        });
      }
      // Claimed by another request that is still generating, or that failed.
      // Either way: not our turn, and no retry storm.
      return NextResponse.json({ note: null });
    }

    const { context, todayLine } = await assembleCoachContext();
    const brief = await generateCoachBrief(context, todayLine);
    if (!brief) return NextResponse.json({ note: null }); // empty row stands — done for today

    // "Holds are for circumstances, not moods" needs a fence in CODE
    // (trainer): a declare-hold proposal survives only when a logged
    // circumstance exists — a recent gapReason in his own words, or a
    // recent hold he declared himself. No evidence → the words stay, the
    // lever is dropped. (end-hold needs no evidence; it only ever shrinks
    // a pause.)
    if (brief.proposal?.action === 'declare-hold') {
      const since = new Date(Date.now() - 21 * 86_400_000);
      const [recentReason, recentHold] = await Promise.all([
        prisma.workout.findFirst({
          where: { gapReason: { not: null }, date: { gte: since } },
          select: { id: true },
        }),
        prisma.hold.findFirst({ where: { endsAt: { gte: since } }, select: { id: true } }),
      ]);
      if (!recentReason && !recentHold) brief.proposal = null;
    }

    await prisma.coachNote.update({
      where: { day },
      data: {
        brief: brief.brief,
        directives: brief.directives as unknown as Prisma.InputJsonValue,
        proposal: brief.proposal
          ? (brief.proposal as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });

    return NextResponse.json({ note: brief, cached: false });
  } catch {
    // Missing table, DB down — the deterministic layer stands alone.
    return NextResponse.json({ note: null });
  }
}
