import Link from 'next/link';
import type { Metadata } from 'next';
import { getHealthData } from './health-actions';
import { getWorkouts } from './actions';
import { getDynamicPlan, isTrainingSession, queuedDay } from '@/lib/program';
import {
  journeyDay,
  journeyStations,
  journeyStory,
  ownPattern,
  afStats,
  cpapStats,
  severeSymptomFlag,
  siteLabel,
  nextSite,
  treatmentClock,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  DEFAULT_ROTATION,
  type DosePlanStep,
} from '@/lib/health-insights';
import CheckIn from '@/components/health/CheckIn';
import HealthReminders from '@/components/health/HealthReminders';

export const metadata: Metadata = { title: 'Aurora Health' };
export const dynamic = 'force-dynamic';

// The journey Home (the owner's re-orientation, round 2): not a dashboard
// of metric cards — a companion walking a treatment. One day, ONE action,
// one conversation, the story so far in sentences, and the path ahead.
// Tables live behind Timeline/Patterns for the day he wants them.
export default async function HomePage() {
  const [data, workouts] = await Promise.all([getHealthData(), getWorkouts()]);
  const { profile } = data;
  const plan = ((profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN);
  const rotation =
    ((profile.targets as { rotation?: string[] } | null)?.rotation ?? DEFAULT_ROTATION);

  const clock = treatmentClock(
    data.injections, plan, new Date(),
    data.firstInjectionAt ?? undefined, data.injectionCount,
  );
  const day = journeyDay(clock, plan, data.injectionCount);
  const site = nextSite(rotation, data.injections);
  const snapshot = weightSnapshot(
    profile,
    (profile.milestonesKg as number[] | null) ?? [120, 110, 103],
    data.bodyStats,
  );
  const af = afStats(data.afEpisodes);
  const cpap = cpapStats(data.cpapNights);
  const story = journeyStory({
    snapshot,
    af,
    cpap,
    dosesTaken: data.injectionCount,
    daysIn: day.day,
  });
  const pattern = ownPattern(
    data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity })),
    data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site })),
  );
  const severe = severeSymptomFlag(
    data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity })),
  );
  const stations = journeyStations(
    plan,
    data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site })),
  );
  const nextStations = stations.filter((s) => s.state !== 'done').slice(0, 2);

  const trainPlan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })));
  const trainDay = queuedDay(trainPlan);
  const isTrainDayNow = trainPlan.mode === 'train';

  // Local calendar "today" for the check-in skip logic.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cpapLoggedToday = data.cpapNights.some((n) => {
    const created = new Date(n.createdAt);
    return created >= todayStart;
  });

  // THE day's one action, in priority order: first dose > due dose >
  // training day > nothing-due. Never a menu of equals.
  const injectionDue = !!clock && (clock.daysSinceLast >= 7 || clock.overdue);
  const workoutsToday = workouts.filter(
    (w) => isTrainingSession(w) && new Date(w.date) >= todayStart,
  ).length;

  return (
    <div className="space-y-5 pb-8">
      <HealthReminders
        nextDueISO={clock ? clock.nextDue.toISOString() : null}
        lastInjectionISO={clock ? clock.lastInjection.toISOString() : null}
        enabled={(profile.reminders as Record<string, boolean> | null) ?? {}}
      />

      {/* The day, named */}
      <div className="pt-1">
        <p className="section-label text-acc-cyan/80">
          Aurora Health{day.week ? ` · week ${day.week}` : ''}
        </p>
        <h1 className="mt-0.5 font-round text-[26px] font-extrabold leading-tight tracking-tight text-app-tx1">
          {day.day
            ? `Day ${day.day} of your journey.`
            : 'It starts with the first dose.'}
        </h1>
        <p className="mt-1 text-sm text-app-tx2">
          {snapshot ? `${snapshot.currentKg} kg` : '—'}
          {clock && ` · ${clock.lastDoseMg} mg weekly`}
          {day.dosesUntilCheckpoint != null &&
            day.dosesUntilCheckpoint > 0 &&
            ` · ${day.dosesUntilCheckpoint} dose${day.dosesUntilCheckpoint === 1 ? '' : 's'} to the doctor`}
          {day.dosesUntilCheckpoint === 0 && ' · doctor review is next'}
        </p>
      </div>

      {severe && (
        <div className="card border-rpe-hard/40 px-4 py-3">
          <p className="text-sm text-app-tx1">
            You&apos;ve logged repeated severe symptoms in the last two days. This app can&apos;t
            judge how serious that is — a clinician can. Consider getting checked.
          </p>
        </div>
      )}

      {/* THE one thing today asks of him */}
      {!clock ? (
        <Link href="/health/injection" className="card-lg block p-5">
          <p className="section-label text-acc-cyan/80">Today&apos;s one thing</p>
          <p className="mt-1.5 text-lg font-extrabold leading-snug text-app-tx1">
            Take the first 2.5 mg dose — {siteLabel(site)} is up.
          </p>
          <div className="mt-3 rounded-card border-2 border-ink bg-acc-teal-deep py-3.5 text-center text-sm font-extrabold text-white shadow-[4px_4px_0_#0b0b0f]">
            Begin the journey →
          </div>
        </Link>
      ) : injectionDue ? (
        <Link href="/health/injection" className="card-lg block p-5">
          <p className="section-label text-acc-cyan/80">Today&apos;s one thing</p>
          <p className="mt-1.5 text-lg font-extrabold leading-snug text-app-tx1">
            Injection day — {clock.nextPlanned?.mg != null
              ? `${clock.nextPlanned.mg} mg, ${siteLabel(site)}.`
              : 'the plan says: talk to your doctor first.'}
          </p>
          <div className="mt-3 rounded-card border-2 border-ink bg-acc-teal-deep py-3.5 text-center text-sm font-extrabold text-white shadow-[4px_4px_0_#0b0b0f]">
            Open injection day →
          </div>
        </Link>
      ) : isTrainDayNow && workoutsToday === 0 ? (
        <Link href={`/workouts/new?day=${trainDay}&dur=45`} className="card-lg block p-5">
          <p className="section-label text-acc-cyan/80">Today&apos;s one thing</p>
          <p className="mt-1.5 text-lg font-extrabold leading-snug text-app-tx1">
            Move — Day {trainDay} is queued. Muscle protects the weight you&apos;re losing.
          </p>
          <div
            className={`mt-3 rounded-card border-2 border-ink py-3.5 text-center text-sm font-extrabold text-white shadow-[4px_4px_0_#0b0b0f] ${
              trainDay === 'A' ? 'bg-acc-violet-deep' : 'bg-acc-teal-deep'
            }`}
          >
            Start Day {trainDay} · 45 min →
          </div>
        </Link>
      ) : (
        <div className="card-lg p-5">
          <p className="section-label text-acc-cyan/80">Today&apos;s one thing</p>
          <p className="mt-1.5 text-lg font-extrabold leading-snug text-app-tx1">
            {workoutsToday > 0
              ? 'Trained and dosed as planned — today asks nothing more of you.'
              : 'Nothing is due today. The check-in below is the whole job.'}
          </p>
          <p className="mt-1 text-xs text-app-tx3">
            Next dose {clock.nextDue.toLocaleDateString('en-US', { weekday: 'long' })} · {siteLabel(site)}
          </p>
        </div>
      )}

      {/* The conversation */}
      <CheckIn cpapLoggedToday={cpapLoggedToday} />

      {/* What his own logs know about today */}
      {pattern && (
        <div className="card border-acc-cyan/40 px-4 py-3">
          <p className="text-sm leading-relaxed text-app-tx1">{pattern}</p>
        </div>
      )}

      {/* The story so far */}
      {story.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">The story so far</p>
          <div className="space-y-2">
            {story.map((s, i) => (
              <p key={i} className="text-sm leading-relaxed text-app-tx1">
                {s}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* The path ahead — two stations, then the full journey */}
      {nextStations.length > 0 && (
        <Link href="/journey" className="card-lg block p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="section-label">The path ahead</p>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-tx3">
              full journey →
            </span>
          </div>
          <div className="space-y-2">
            {nextStations.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 flex-none rounded-full border-2 border-ink ${
                    s.state === 'next' ? 'bg-acc-teal-deep' : s.kind === 'checkpoint' ? 'bg-acc-ember-deep' : 'bg-app-surface2'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-app-tx1">{s.label}</p>
                  {s.detail && <p className="text-[11px] text-app-tx3">{s.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </Link>
      )}

      {/* Everything else is a room, not a widget */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { href: '/health/report', label: 'Doctor report' },
          { href: '/health/plan', label: 'Plan & profile' },
          { href: '/health/analytics', label: 'Patterns' },
          { href: '/health/timeline', label: 'The full log' },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="card px-4 py-3 text-sm font-bold text-app-tx1 transition-colors hover:border-app-border-hi"
          >
            {l.label} <span className="text-app-tx3">→</span>
          </Link>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-app-tx3">
        A tracker, not a diagnosis — patterns are observations from your own logs; decisions
        belong to you and your doctor.
      </p>
    </div>
  );
}
