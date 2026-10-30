import { NextResponse } from 'next/server';
import { logCardio } from '@/app/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A swim or a walk from the wrist (owner, 2026-10-31: "so I don't need to
 * open the phone app every time"). The SAME logCardio the Train page's
 * quick log calls — minutes clamped, one per kind per activity day, a
 * repeat answered `deduped` — so the wrist carries no rule of its own.
 * Open like the rest of the app (single user, owner's decision).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = (body ?? {}) as { kind?: unknown; minutes?: unknown };
  if ((b.kind !== 'swim' && b.kind !== 'walk') || typeof b.minutes !== 'number' || !Number.isFinite(b.minutes)) {
    return NextResponse.json({ error: 'kind (swim|walk) and minutes required' }, { status: 400 });
  }
  const r = await logCardio(b.kind, b.minutes);
  return NextResponse.json({ deduped: r.deduped === true });
}
