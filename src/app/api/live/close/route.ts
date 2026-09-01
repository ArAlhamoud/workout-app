import { NextResponse } from 'next/server';
import { closeLive } from '@/lib/live-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Discarded on a device: close the row so the other device stops offering it. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const id = (body as { clientSaveId?: string }).clientSaveId;
  if (typeof id !== 'string' || !id || id.length > 64) {
    return NextResponse.json({ error: 'clientSaveId required' }, { status: 400 });
  }
  await closeLive(id);
  return NextResponse.json({ ok: true });
}
