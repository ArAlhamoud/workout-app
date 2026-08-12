// Full-history export — the data-ownership feature every serious logger
// charges for. JSON by default; ?format=csv flattens sets for spreadsheets.
// Guarded by HEALTH_SYNC_TOKEN — the one place that token still lives, because
// this route is reached by URL rather than by the app (see checkExportAuth).

import { NextResponse } from 'next/server';
import { buildExportPayload } from '@/lib/export-data';
import { checkExportAuth } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const auth = checkExportAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  // Shared with the iCloud backup action — see src/lib/export-data.ts.
  const payload = await buildExportPayload();
  const { workouts } = payload;

  const format = new URL(request.url).searchParams.get('format');
  if (format === 'csv') {
    const header = 'date,workout,gym,exercise,set,reps,weight_kg,rpe,warmup,completed_at';
    const rows = workouts.flatMap((w) =>
      w.sets.map((s) =>
        [
          w.date.toISOString().split('T')[0],
          csvEscape(w.name),
          w.gym ?? 'bfit',
          csvEscape(s.exercise.name),
          s.setNumber,
          s.reps,
          s.weight,
          s.rpe ?? '',
          s.isWarmup ? 1 : 0,
          s.completedAt?.toISOString() ?? '',
        ].join(','),
      ),
    );
    return new NextResponse([header, ...rows].join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="workout-history-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  }

  return NextResponse.json(payload);
}
