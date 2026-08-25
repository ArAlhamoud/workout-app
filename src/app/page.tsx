import Link from 'next/link';
import type { Metadata } from 'next';
import { getHealthData } from './health-actions';
import { getWorkouts } from './actions';
import { getDynamicPlan, isTrainingSession, queuedDay } from '@/lib/program';
import {
  journeyDay,
  journeyStory,
  ownPattern,
  afStats,
  bpAverage,
  cpapStats,
  severeSymptomFlag,
  siteLabel,
  nextSite,
  treatmentClock,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  DEFAULT_ROTATION,
  SYMPTOM_LABEL,
  type DosePlanStep,
} from '@/lib/health-insights';
import BodyMap, { type BodyData } from '@/components/health/BodyMap';
import CheckIn from '@/components/health/CheckIn';
import HealthReminders from '@/components/health/HealthReminders';

export const metadata: Metadata = { title: 'Aurora Health' };
export const dynamic = 'force-dynamic';

// The landing is an OVERALL health dashboard — but the dashboard is his
// BODY (owner's fourth push): every system shown where it lives, live
// numbers on the anatomy, tap a region to see and log, the next injection
// site glowing on the actual spot. Pages branch off from the rooms below
// and from the body itself.
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
  const bp7 = bpAverage(data.bpReadings, 7);
  const latestBp = data.bpReadings[0] ?? null;
  const lastNight = data.cpapNights[0] ?? null;
  const latestLdl = data.labs.find((l) => l.test === 'ldl') ?? null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySymptoms = data.symptoms.filter((s) => new Date(s.at) >= todayStart);
  const severe = severeSymptomFlag(
    data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity })),
  );
  const story = journeyStory({
    snapshot, af, cpap, dosesTaken: data.injectionCount, daysIn: day.day,
  });
  const pattern = ownPattern(
    data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity })),
    data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site })),
  );

  const trainPlan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })));
  const trainDay = queuedDay(trainPlan);
  const trainedToday = workouts.some(
    (w) => isTrainingSession(w) && new Date(w.date) >= todayStart,
  );
  const injectionDue = !clock || clock.daysSinceLast >= 7 || clock.overdue;
  const cpapLoggedToday = data.cpapNights.some((n) => new Date(n.createdAt) >= todayStart);

  const lastNightIsRecent =
    lastNight && Date.now() - new Date(lastNight.night).getTime() < 3 * 86_400_000;

  const body: BodyData = {
    heart: { daysClear: af.daysSinceLast, thisMonth: af.thisMonth },
    breath: {
      lastHours: lastNightIsRecent ? lastNight.usageHours : null,
      ahi: lastNightIsRecent ? lastNight.ahi : null,
      streak: cpap.streak,
    },
    gut: {
      today: [...new Set(todaySymptoms.map((s) => SYMPTOM_LABEL[s.kind] ?? s.kind))],
    },
    bp: {
      latest: latestBp ? `${latestBp.systolic}/${latestBp.diastolic}` : null,
      avg7: bp7 ? `${bp7.systolic}/${bp7.diastolic}` : null,
    },
    nextSite: site,
    nextSiteLabel: siteLabel(site),
    ldl: latestLdl
      ? {
          value: latestLdl.value,
          when: new Date(latestLdl.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        }
      : null,
  };

  return (
    <div className="space-y-4 pb-8">
      <HealthReminders
        nextDueISO={clock ? clock.nextDue.toISOString() : null}
        lastInjectionISO={clock ? clock.lastInjection.toISOString() : null}
        enabled={(profile.reminders as Record<string, boolean> | null) ?? {}}
      />

      {/* Header: him, in one line */}
      <div className="flex items-end justify-between pt-1">
        <div>
          <p className="section-label text-acc-cyan/80">
            Aurora Health{day.day ? ` · day ${day.day}` : ''}
          </p>
          <h1 className="mt-0.5 font-round text-3xl font-extrabold leading-none tracking-tight text-app-tx1">
            {snapshot ? `${snapshot.currentKg}` : '—'}
            <span className="text-base font-bold text-app-tx3"> kg</span>
          </h1>
          <p className="mt-1 text-xs font-semibold text-app-tx2">
            {snapshot && snapshot.lostKg >= 0.5 && `−${snapshot.lostKg} kg since the start · `}
            {clock ? `${clock.lastDoseMg} mg weekly` : 'first dose ahead'}
            {day.dosesUntilCheckpoint != null && day.dosesUntilCheckpoint > 0 &&
              ` · ${day.dosesUntilCheckpoint} to the doctor`}
          </p>
        </div>
        {/* today's one thing, as a stamp */}
        <Link
          href={injectionDue ? '/health/injection' : trainPlan.mode === 'train' && !trainedToday ? `/workouts/new?day=${trainDay}&dur=45` : '/journey'}
          className={`rounded-card border-2 border-ink px-3.5 py-2.5 text-xs font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] ${
            injectionDue ? 'bg-acc-teal-deep' : trainPlan.mode === 'train' && !trainedToday ? 'bg-acc-violet-deep' : 'bg-ink'
          }`}
        >
          {!clock ? 'First dose →' : injectionDue ? 'Dose today →' : trainPlan.mode === 'train' && !trainedToday ? `Train ${trainDay} →` : 'On track →'}
        </Link>
      </div>

      {severe && (
        <div className="card border-rpe-hard/40 px-4 py-3">
          <p className="text-sm text-app-tx1">
            You&apos;ve logged repeated severe symptoms in the last two days. This app can&apos;t
            judge how serious that is — a clinician can. Consider getting checked.
          </p>
        </div>
      )}

      {/* THE dashboard: his body, live */}
      <BodyMap data={body} />

      {/* The conversation */}
      <CheckIn cpapLoggedToday={cpapLoggedToday} />

      {pattern && (
        <div className="card border-acc-cyan/40 px-4 py-3">
          <p className="text-sm leading-relaxed text-app-tx1">{pattern}</p>
        </div>
      )}

      {story.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">The story so far</p>
          <div className="space-y-2">
            {story.map((s, i) => (
              <p key={i} className="text-sm leading-relaxed text-app-tx1">{s}</p>
            ))}
          </div>
        </div>
      )}

      {/* The pages branch from here */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { href: '/journey', label: 'Journey' },
          { href: '/train', label: 'Training' },
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
