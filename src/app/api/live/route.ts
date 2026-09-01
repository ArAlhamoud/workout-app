import { NextResponse } from 'next/server';
import { readLive, upsertLive } from '@/lib/live-store';
import { sanitizeLiveUpdate, type LiveSetUpdate } from '@/lib/live-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The live session pipe (docs/WATCH.md "Live session"). No auth: single
 * user, the owner's standing decision — same as every watch route.
 *
 *   GET  /api/live          → { live: <open fresh session> | null }
 *   GET  /api/live?id=<csid> → { live: <that row, open or closed> | null }
 *   POST /api/live  { clientSaveId, source, day?, durationMin?, gym?,
 *                     startedAt?, sets?: [set | {exerciseId,setNumber,remove}] }
 *                   → { live } — the merged row. A closed id answers with
 *                     closedAt set and writes nothing.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? undefined;
  const live = await readLive(id && id.length <= 64 ? id : undefined);
  return NextResponse.json({ live });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as {
    clientSaveId?: string; source?: string; day?: string; durationMin?: number;
    gym?: string; startedAt?: string; sets?: unknown[];
  };
  if (typeof b.clientSaveId !== 'string' || !b.clientSaveId || b.clientSaveId.length > 64) {
    return NextResponse.json({ error: 'clientSaveId required' }, { status: 400 });
  }
  const source = b.source === 'watch' ? 'watch' : 'phone';
  if (b.startedAt && (Number.isNaN(Date.parse(b.startedAt)) || Date.parse(b.startedAt) > Date.now() + 10 * 60_000)) {
    return NextResponse.json({ error: 'Bad startedAt' }, { status: 400 });
  }
  const now = new Date();
  const updates = (Array.isArray(b.sets) ? b.sets : [])
    .slice(0, 200)
    .map((s) => sanitizeLiveUpdate(s, source, now))
    .filter((u): u is LiveSetUpdate => u !== null);
  const live = await upsertLive(
    {
      clientSaveId: b.clientSaveId,
      source,
      day: b.day === 'A' || b.day === 'B' ? b.day : undefined,
      durationMin: b.durationMin === 30 || b.durationMin === 45 || b.durationMin === 60 ? b.durationMin : undefined,
      gym: b.gym === 'work' || b.gym === 'bfit' ? b.gym : undefined,
      startedAt: b.startedAt,
    },
    updates,
  );
  if (!live) return NextResponse.json({ error: 'live session unavailable' }, { status: 503 });
  return NextResponse.json({ live });
}
