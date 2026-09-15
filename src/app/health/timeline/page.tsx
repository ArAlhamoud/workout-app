import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import prisma from '@/lib/prisma';
import { getHealthData } from '../../health-actions';
import { ownerTodayUtc, siteLabel } from '@/lib/health-insights';

export const metadata: Metadata = { title: 'Health Timeline' };
export const dynamic = 'force-dynamic';

interface TimelineEvent {
  at: Date;
  kind: 'injection' | 'weight' | 'symptom' | 'af' | 'bp' | 'cpap' | 'lab' | 'workout' | 'fuel';
  text: string;
  accent: string;
}

const ACCENTS: Record<TimelineEvent['kind'], string> = {
  injection: 'bg-acc-cyan',
  weight: 'bg-acc-teal',
  symptom: 'bg-rpe-med',
  af: 'bg-rpe-hard',
  bp: 'bg-acc-violet',
  cpap: 'bg-app-tx3',
  lab: 'bg-acc-ember',
  workout: 'bg-acc-violet',
  // Measured, not eyeballed — two guesses missed (device-tester,
  // 2026-09-15). At 6px the dot is the only non-textual cue and this
  // screen has no legend, so the number that matters is the distance to
  // the NEAREST kind in use: indigo 14.8 from violet, gold 16.3 from the
  // symptom/lab amber (rpe-med and acc-ember are the same hex), green
  // 35.3 from the weight teal. Pink is 49.7, and its nearest neighbour is
  // the AF dot, which shows on one day in forty-five.
  fuel: 'bg-rpe-grind',
};

const SEVERITY_WORD = ['', 'mild', 'moderate', 'severe'];

/**
 * The day's macros as one glanceable line — "1763 kcal · 128P / 155C / 68F",
 * the same shorthand /health/diet already uses, so the two screens read as
 * one app (owner asked for it on the timeline, 2026-09-15). A day that only
 * ever got a protein number still renders; missing columns are dropped
 * rather than shown as zeroes, because a blank is not a fast. But a row
 * needs an anchor: calories or protein. A lone "164C" is a number with
 * nothing to hold on to (editor, 2026-09-15).
 */
function fuelLine(n: {
  kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null;
}): string | null {
  if (n.kcal == null && n.proteinG == null) return null;
  const macros = [
    n.proteinG != null ? `${n.proteinG}P` : null,
    n.carbsG != null ? `${n.carbsG}C` : null,
    n.fatG != null ? `${n.fatG}F` : null,
  ].filter(Boolean);
  const parts = [
    n.kcal != null ? `${n.kcal} kcal` : null,
    macros.length ? macros.join(' / ') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' \u00b7 ') : null;
}

export default async function HealthTimelinePage() {
  const [data, workouts] = await Promise.all([
    getHealthData(),
    prisma.workout.findMany({
      orderBy: { date: 'desc' },
      take: 60,
      select: { date: true, name: true },
    }),
  ]);

  const events: TimelineEvent[] = [
    ...data.injections.map((i) => ({
      at: new Date(i.at),
      kind: 'injection' as const,
      text: `Mounjaro ${i.doseMg} mg · ${siteLabel(i.site)}${i.onSchedule ? '' : ' · off-plan'}`,
      accent: ACCENTS.injection,
    })),
    ...data.bodyStats
      .filter((b) => b.weight != null)
      .slice(-90)
      .map((b) => ({
        at: new Date(b.date),
        kind: 'weight' as const,
        text: `${b.weight} kg${b.waist ? ` · waist ${b.waist} cm` : ''}`,
        accent: ACCENTS.weight,
      })),
    ...data.symptoms.slice(0, 200).map((s) => ({
      at: new Date(s.at),
      kind: 'symptom' as const,
      text: `${s.kind.replace('-', ' ')} ${SEVERITY_WORD[s.severity] ?? ''}`,
      accent: ACCENTS.symptom,
    })),
    ...data.afEpisodes.map((e) => ({
      at: new Date(e.startedAt),
      kind: 'af' as const,
      text: `AF episode${e.durationMin ? ` · ${e.durationMin} min` : ''}${e.hrBpm ? ` · ${e.hrBpm} bpm` : ''}`,
      accent: ACCENTS.af,
    })),
    ...data.bpReadings.slice(0, 120).map((r) => ({
      at: new Date(r.at),
      kind: 'bp' as const,
      text: `BP ${r.systolic}/${r.diastolic}${r.pulse ? ` · ${r.pulse} bpm` : ''}`,
      accent: ACCENTS.bp,
    })),
    ...data.cpapNights.slice(0, 90).map((n) => ({
      at: new Date(n.night),
      kind: 'cpap' as const,
      text: `CPAP ${n.usageHours} h${n.ahi != null ? ` · AHI ${n.ahi}` : ''}`,
      accent: ACCENTS.cpap,
    })),
    ...data.labs.map((l) => ({
      at: new Date(l.date),
      kind: 'lab' as const,
      text: `${l.test.toUpperCase()} ${l.value} ${l.unit}`,
      accent: ACCENTS.lab,
    })),
    // Planned delivery days are logged AHEAD of time (the subscription
    // prints its macros for the week), so unfiltered they would open day
    // cards for dates that have not happened yet. The timeline is a record,
    // not a schedule — cut it at today.
    ...data.nutrition
      .filter((n) => new Date(n.day) <= ownerTodayUtc())
      .flatMap((n) => {
        const text = fuelLine(n);
        return text ? [{ at: new Date(n.day), kind: 'fuel' as const, text, accent: ACCENTS.fuel }] : [];
      }),
    ...workouts.map((w) => ({
      at: new Date(w.date),
      kind: 'workout' as const,
      text: w.name,
      accent: ACCENTS.workout,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // Group by calendar day, newest first.
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const key = e.at.toLocaleDateString('en-US', {
      timeZone: 'Asia/Riyadh',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: e.at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    });
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(e);
  }
  const days = [...byDay.entries()].slice(0, 45);

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Health" />
      <div>
        <p className="section-label text-acc-cyan/80">Everything on one axis</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Timeline
        </h1>
      </div>

      {days.length === 0 && (
        <div className="card px-4 py-6 text-center text-sm text-app-tx3">
          Nothing logged yet.
        </div>
      )}

      <div className="space-y-3">
        {days.map(([day, dayEvents]) => (
          <div key={day} className="card-lg px-4 py-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-app-tx3">
              {day}
            </p>
            <div className="space-y-1.5">
              {dayEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-2.5 text-sm">
                  <span className={`h-1.5 w-1.5 flex-none rounded-full ${e.accent}`} />
                  <span className="text-app-tx1">{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
