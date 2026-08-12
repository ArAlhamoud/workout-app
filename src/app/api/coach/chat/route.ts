// Argue with the coach. Token-gated (same bearer as the health routes):
// chat turns cost real model tokens, and this is a single-user app.

import { NextResponse } from 'next/server';
import { coachChat, type ChatTurn } from '@/lib/coach-ai';
import { assembleCoachContext } from '@/lib/coach-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TURN_CHARS = 2000;

export async function POST(request: Request) {

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ reply: null, reason: 'no-key' });
  }

  let payload: { turns?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const turns: ChatTurn[] = Array.isArray(payload.turns)
    ? payload.turns
        .filter(
          (t): t is ChatTurn =>
            !!t &&
            typeof t === 'object' &&
            ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
            typeof (t as ChatTurn).content === 'string' &&
            (t as ChatTurn).content.trim().length > 0,
        )
        .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) }))
    : [];
  if (!turns.length) return NextResponse.json({ error: 'No turns' }, { status: 400 });

  try {
    const { context, todayLine } = await assembleCoachContext();
    const reply = await coachChat(context, todayLine, turns);
    return NextResponse.json({ reply });
  } catch {
    // Context assembly failed (DB, missing table) — degrade, never 500.
    return NextResponse.json({ reply: null });
  }
}
