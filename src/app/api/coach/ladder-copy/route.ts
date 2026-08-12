// Coach-written gap-ladder copy: AT MOST one generation per day, plus at
// most one regeneration if a new session moves the anchor mid-day. Same
// row-as-lock cost bound as /api/coach/brief — whoever wins the create
// generates, everyone else reads, a failed attempt stands until tomorrow.
//
// Token-gated (data-steward): the response embeds his last session, top set
// and gap facts, and a request can be the day's one paid generation. The
// only caller (refreshLadderCopy via HealthAutoPilot) already holds the
// health-sync bearer, so the gate costs one header.
//
// The client arms the STATIC ladder first, then calls this and overwrites
// rungs 7/19 only when copy comes back — and only when the anchor here
// matches the anchor it armed from. Every failure path returns
// { rungs: null } and the static ladder stands.

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  buildLadderFacts,
  generateLadderCopy,
  type LadderRungCopy,
} from '@/lib/coach-ladder';
import { todayKey } from '@/lib/coach-context';
import { getDynamicPlan, gymLabel, queuedDay } from '@/lib/program';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Non-streaming Opus call needs more than Vercel's default window. */
export const maxDuration = 60;

const MODEL = 'claude-opus-5';

export async function GET(request: Request) {

  try {
    const day = todayKey();

    // Server-authoritative anchor: the last TRAINING session in the DB.
    const last = await prisma.workout.findFirst({
      where: { NOT: { name: { startsWith: 'Rescue walk' } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        sets: {
          where: { isWarmup: false },
          include: { exercise: { select: { name: true } } },
          orderBy: { weight: 'desc' },
          take: 1,
        },
      },
    });
    if (!last) return NextResponse.json({ rungs: null });
    const anchor = last.date.toISOString().slice(0, 10);

    // Claim today (or discover someone already did).
    let claimed = false;
    try {
      await prisma.coachLadderCopy.create({ data: { day, anchor, model: MODEL } });
      claimed = true;
    } catch {
      /* row exists — fall through to read it */
    }

    if (!claimed) {
      const existing = await prisma.coachLadderCopy.findUnique({ where: { day } });
      if (!existing) return NextResponse.json({ rungs: null });
      if (existing.anchor === anchor) {
        // Same anchor: serve what the day's one attempt produced (or nothing).
        return NextResponse.json({
          rungs: (existing.copy as unknown as LadderRungCopy[] | null) ?? null,
          anchor,
        });
      }
      // A new session moved the anchor. One regeneration is allowed: the
      // conditional update is the lock — exactly one request wins it.
      const won = await prisma.coachLadderCopy.updateMany({
        where: { day, anchor: existing.anchor },
        data: { anchor, copy: Prisma.DbNull },
      });
      if (won.count !== 1) return NextResponse.json({ rungs: null });
      claimed = true;
    }

    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ rungs: null });

    // Top set carries its gym tag (rule 2): a pin at Alrajhi is not a pin
    // at B_Fit, and copy that fires weeks later must say which it means.
    const topSet = last.sets[0]
      ? `${last.sets[0].exercise.name} ${last.sets[0].weight} kg × ${last.sets[0].reps} at ${gymLabel(last.gym) ?? 'B_Fit'}`
      : null;
    const sessions = await prisma.workout.findMany({
      where: { NOT: { name: { startsWith: 'Rescue walk' } } },
      orderBy: { date: 'asc' },
      select: { date: true, name: true },
    });
    let longestGapDays: number | null = null;
    for (let i = 1; i < sessions.length; i++) {
      const gap = Math.round(
        (sessions[i].date.getTime() - sessions[i - 1].date.getTime()) / 86_400_000,
      );
      if (longestGapDays === null || gap > longestGapDays) longestGapDays = gap;
    }

    const facts = buildLadderFacts({
      lastSessionDate: anchor,
      lastSessionName: last.name,
      topSet,
      queuedDay: queuedDay(getDynamicPlan(sessions)),
      longestGapDays,
    });

    const rungs = await generateLadderCopy(facts);
    if (!rungs) return NextResponse.json({ rungs: null }); // row stands — done for today

    // Anchor-conditional write-back (adversary): a slow first generation
    // finishing AFTER a mid-day regeneration must not overwrite fresher
    // copy — that would pair the NEW anchor with STALE copy and defeat the
    // client-side anchor guard. Lose the race → serve nothing.
    const stored = await prisma.coachLadderCopy.updateMany({
      where: { day, anchor },
      data: { copy: rungs as unknown as Prisma.InputJsonValue },
    });
    if (stored.count !== 1) return NextResponse.json({ rungs: null });
    return NextResponse.json({ rungs, anchor });
  } catch {
    // Missing table (pre-schema window), DB down — the static ladder stands.
    return NextResponse.json({ rungs: null });
  }
}
