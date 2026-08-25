import type { Metadata } from 'next';
import Link from 'next/link';
import { getHealthData } from '../health-actions';
import {
  journeyDay,
  journeyStations,
  treatmentClock,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  type DosePlanStep,
} from '@/lib/health-insights';

export const metadata: Metadata = { title: 'Journey' };
export const dynamic = 'force-dynamic';

// The treatment as a PATH, not a table: dose stations, the doctor gate,
// weight landmarks. The full chronological log stays at /health/timeline
// for the day he wants rows.
export default async function JourneyPage() {
  const data = await getHealthData();
  const { profile } = data;
  const plan = ((profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN);
  const clock = treatmentClock(
    data.injections, plan, new Date(),
    data.firstInjectionAt ?? undefined, data.injectionCount,
  );
  const day = journeyDay(clock, plan, data.injectionCount);
  const stations = journeyStations(
    plan,
    data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site })),
  );
  const snapshot = weightSnapshot(
    profile,
    (profile.milestonesKg as number[] | null) ?? [120, 110, 103],
    data.bodyStats,
  );

  const dotFor = (state: string, kind: string) =>
    state === 'done'
      ? 'bg-acc-teal-deep'
      : state === 'next'
      ? 'bg-white ring-4 ring-acc-teal-deep/30'
      : kind === 'checkpoint'
      ? 'bg-acc-ember-deep'
      : 'bg-app-surface2';

  return (
    <div className="space-y-5 pb-8">
      <div className="pt-1">
        <p className="section-label text-acc-cyan/80">
          {day.day ? `Day ${day.day} · week ${day.week}` : 'Not started'}
        </p>
        <h1 className="mt-0.5 font-round text-2xl font-extrabold tracking-tight text-app-tx1">
          The Journey
        </h1>
        {snapshot && (
          <p className="mt-1 text-sm text-app-tx2">
            {snapshot.startKg} kg at the start · {snapshot.currentKg} kg today · the road runs
            to {profile.goalWeightKg} kg
          </p>
        )}
      </div>

      {/* The path */}
      <div className="card-lg p-4">
        <div className="relative space-y-0 pl-1">
          {stations.map((s, i) => (
            <div key={i} className="relative flex gap-4 pb-5 last:pb-0">
              {i < stations.length - 1 && (
                <span className="absolute left-[7px] top-5 h-full w-0.5 bg-ink/15" aria-hidden="true" />
              )}
              <span
                className={`relative z-10 mt-1 h-4 w-4 flex-none rounded-full border-2 border-ink ${dotFor(s.state, s.kind)}`}
              />
              <div className={`min-w-0 ${s.state === 'future' || s.state === 'gate' ? 'opacity-55' : ''}`}>
                <p className={`text-sm font-extrabold ${s.kind === 'checkpoint' ? 'text-acc-ember' : 'text-app-tx1'}`}>
                  {s.label}
                  {s.state === 'next' && <span className="ml-2 text-[10px] font-black uppercase tracking-[0.1em] text-acc-teal">next</span>}
                </p>
                {s.detail && <p className="mt-0.5 text-[11px] text-app-tx3">{s.detail}</p>}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-ink/10 pt-3 text-[10px] text-app-tx3">
          The path past the doctor gate is written in Plan &amp; profile — by you two, never by
          the app.
        </p>
      </div>

      {/* Weight landmarks along the road */}
      {snapshot && (
        <div className="card-lg p-4">
          <p className="section-label mb-2.5">Landmarks</p>
          <div className="space-y-2">
            {snapshot.kgMilestones.map((m) => (
              <div key={m.kg} className="flex items-center gap-3">
                <span
                  className={`h-3.5 w-3.5 flex-none rounded-full border-2 border-ink ${m.achieved ? 'bg-acc-teal-deep' : 'bg-app-surface2'}`}
                />
                <p className={`text-sm font-bold ${m.achieved ? 'text-acc-teal' : 'text-app-tx2'}`}>
                  {m.kg} kg{m.achieved ? ' — passed' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Link
        href="/health/timeline"
        className="card block px-4 py-3 text-sm font-bold text-app-tx1 transition-colors hover:border-app-border-hi"
      >
        The full log, entry by entry <span className="text-app-tx3">→</span>
      </Link>
    </div>
  );
}
