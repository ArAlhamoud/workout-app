import type { Metadata } from 'next';
import BackLink from '@/components/BackLink';
import prisma from '@/lib/prisma';
import { getHealthData } from '../../health-actions';
import { siteLabel } from '@/lib/health-insights';

export const metadata: Metadata = { title: 'Health Timeline' };
export const dynamic = 'force-dynamic';

interface TimelineEvent {
  at: Date;
  kind: 'injection' | 'weight' | 'symptom' | 'af' | 'bp' | 'cpap' | 'lab' | 'workout';
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
};

const SEVERITY_WORD = ['', 'mild', 'moderate', 'severe'];

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
          Nothing logged yet — the timeline builds itself as you log.
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
