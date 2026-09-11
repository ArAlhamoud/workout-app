import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

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
  const b = body as { conditions?: unknown; familyHistory?: unknown };
  const list = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 40);
    return out;
  };
  const conditions = list(b.conditions);
  const familyHistory = list(b.familyHistory);
  if (conditions == null && familyHistory == null) {
    return NextResponse.json({ error: 'conditions and/or familyHistory (arrays) required' }, { status: 400 });
  }
  const profile = await prisma.healthProfile.update({
    where: { id: PROFILE_ID },
    data: {
      ...(conditions ? { conditions } : {}),
      ...(familyHistory ? { familyHistory } : {}),
    },
    select: { conditions: true, familyHistory: true },
  });
  return NextResponse.json(profile);
}

export async function GET() {
  const profile = await prisma.healthProfile.findUnique({
    where: { id: PROFILE_ID },
    select: { conditions: true, familyHistory: true },
  });
  return NextResponse.json(profile ?? { conditions: null, familyHistory: null });
}
