import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ongoingSymptoms } from '@/lib/health-insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROFILE_ID = 'profile';

/**
 * The profile's narrative lists — his own conditions, and first-degree
 * family events. Both are plain string arrays shown on the doctor report;
 * a cardiologist reads them, so they are kept apart (his diagnoses are not
 * his parents' illnesses). Sending a key REPLACES that list; omitting it
 * leaves it untouched. Open like the rest of the app (single user).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as { conditions?: unknown; familyHistory?: unknown; investigations?: unknown; ongoingSymptoms?: unknown; clear?: unknown };
  // An empty array REPLACES the list — the family-history line the
  // cardiologist needs exists nowhere else. Only with clear:true.
  const list = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    if (v.length === 0 && b.clear !== true) return null;
    const out = v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 40);
    return out;
  };
  const conditions = list(b.conditions);
  const familyHistory = list(b.familyHistory);
  const investigations = list(b.investigations);
  // Ongoing side effects: [{kind, severity 1-3}], known symptom kinds only.
  // Same replace rule as the lists: [] clears only with clear:true.
  const ongoing = Array.isArray(b.ongoingSymptoms)
    ? b.ongoingSymptoms.length === 0 && b.clear !== true
      ? null
      : ongoingSymptoms(b.ongoingSymptoms)
    : null;
  if (Array.isArray(b.ongoingSymptoms) && b.ongoingSymptoms.length > 0 && ongoing?.length === 0) {
    return NextResponse.json({ error: 'ongoingSymptoms: each entry needs a known symptom kind and severity 1-3' }, { status: 400 });
  }
  if (conditions == null && familyHistory == null && investigations == null && ongoing == null) {
    return NextResponse.json({ error: 'conditions, familyHistory, investigations and/or ongoingSymptoms (arrays) required' }, { status: 400 });
  }
  const profile = await prisma.healthProfile.update({
    where: { id: PROFILE_ID },
    data: {
      ...(conditions ? { conditions } : {}),
      ...(familyHistory ? { familyHistory } : {}),
      ...(investigations ? { investigations } : {}),
      ...(ongoing ? { ongoingSymptoms: ongoing as unknown as Prisma.InputJsonValue } : {}),
    },
    select: { conditions: true, familyHistory: true, investigations: true, ongoingSymptoms: true },
  });
  return NextResponse.json(profile);
}

export async function GET() {
  const profile = await prisma.healthProfile.findUnique({
    where: { id: PROFILE_ID },
    select: { conditions: true, familyHistory: true, investigations: true, ongoingSymptoms: true },
  });
  return NextResponse.json(profile ?? { conditions: null, familyHistory: null, investigations: null, ongoingSymptoms: null });
}
