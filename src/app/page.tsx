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
  weightPace,
  milestoneEta,
  fastLossLowProtein,
  fuelTargets,
  fuelWeek,
  afRecord,
  recentMilestoneCross,
  DEFAULT_DOSE_PLAN,
  DEFAULT_ROTATION,
  SYMPTOM_LABEL,
  type DosePlanStep,
} from '@/lib/health-insights';
import BodyMap, { type BodyData } from '@/components/health/BodyMap';
import { slimProgress } from '@/lib/body-figure';
import CheckIn from '@/components/health/CheckIn';
import DetectedSessionBanner from '@/components/health/DetectedSessionBanner';
import HealthReminders from '@/components/health/HealthReminders';

export const metadata: Metadata = { title: 'AR Health' };
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

  // The pace layer: week-average vs week-average, and what it promises.
  const pace = weightPace(data.bodyStats);
  const milestoneKgs = [
    ...(snapshot?.pctMilestones.map((m) => m.kg) ?? []),
    ...((profile.milestonesKg as number[] | null) ?? [120, 110, 103]),
  ];
  const nextMilestoneKg = snapshot
    ? milestoneKgs.filter((kg) => kg < snapshot.currentKg).sort((a, b) => b - a)[0] ?? null
    : null;
  const eta = snapshot && nextMilestoneKg != null
    ? milestoneEta(snapshot.currentKg, nextMilestoneKg, pace)
    : null;
  const targets = fuelTargets((profile.targets as Record<string, unknown> | null) ?? null);
  const week = fuelWeek(
    data.nutrition.map((n) => ({ day: n.day, kcal: n.kcal, proteinG: n.proteinG })),
    targets,
  );
  const muscleGuard = fastLossLowProtein(pace, week, targets);
  const stamp = recentMilestoneCross(milestoneKgs, data.bodyStats);
  const heartRecord = afRecord(data.afEpisodes.map((e) => ({ startedAt: e.startedAt })));

  const trainPlan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })));
  const trainDay = queuedDay(trainPlan);
  const trainedToday = workouts.some(
    (w) => isTrainingSession(w) && new Date(w.date) >= todayStart,
  );
  const injectionDue = !clock || clock.daysSinceLast >= 7 || clock.overdue;

  // CPAP truth arrives weekly via the prisma report, so "recent" spans the
  // report cadence — a mid-week stale label would nag about data that is
  // simply in transit.
  const lastNightIsRecent =
    lastNight && Date.now() - new Date(lastNight.night).getTime() < 8 * 86_400_000;

  const body: BodyData = {
    heart: { daysClear: af.daysSinceLast, thisMonth: af.thisMonth, longestDays: heartRecord?.longestDays ?? null },
    breath: {
      lastHours: lastNightIsRecent ? lastNight.usageHours : null,
      ahi: lastNightIsRecent ? lastNight.ahi : null,
      streak: cpap.streak,
      everLogged: data.cpapNights.length > 0,
    },
    gut: {
      today: [...new Set(todaySymptoms.map((s) => SYMPTOM_LABEL[s.kind] ?? s.kind))],
    },
    bp: {
      latest: latestBp ? `${latestBp.systolic}/${latestBp.diastolic}` : null,
      avg7: bp7 ? `${bp7.systolic}/${bp7.diastolic}` : null,
    },
    train: {
      value:
        trainedToday
          ? 'trained today'
          : trainPlan.mode === 'train'
            ? `Day ${trainDay} next`
            : trainPlan.mode === 'recover'
              ? 'recover day'
              : 'rest',
      day: trainDay ?? null,
    },
    nextSite: site,
    nextSiteLabel: siteLabel(site),
    ldl: latestLdl
      ? {
          value: latestLdl.value,
          when: new Date(latestLdl.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        }
      : null,
    slimT: slimProgress(profile.startWeightKg, profile.goalWeightKg, snapshot?.currentKg ?? null),
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
            AR Health{day.day ? ` · day ${day.day}` : ''}
          </p>
          <Link href="/stats" className="block">
            <h1 className="mt-0.5 font-round text-3xl font-extrabold leading-none tracking-tight text-app-tx1">
              {snapshot ? `${snapshot.currentKg}` : '—'}
              <span className="text-base font-bold text-app-tx3"> kg</span>
            </h1>
          </Link>
          <p className="mt-1 text-xs font-semibold text-app-tx2">
            {snapshot && snapshot.lostKg >= 0.5 && `−${snapshot.lostKg} kg since the start · `}
            {clock ? `${clock.lastDoseMg} mg weekly` : 'first dose ahead'}
            {day.dosesUntilCheckpoint != null && day.dosesUntilCheckpoint > 0 &&
              ` · ${day.dosesUntilCheckpoint} to the doctor`}
          </p>
          {pace && (
            <p className="mt-0.5 text-xs font-semibold text-app-tx2">
              <span className={pace.kgPerWeek < 0 ? 'text-acc-teal font-bold' : 'text-app-tx1 font-bold'}>
                {pace.kgPerWeek > 0 ? '+' : pace.kgPerWeek < 0 ? '−' : ''}{Math.abs(pace.kgPerWeek)} kg/week
              </span>
              {eta && nextMilestoneKg != null &&
                ` · ${nextMilestoneKg} kg by ~${eta.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
            </p>
          )}
          {clock && clock.daysSinceLast === 6 && trainPlan.mode === 'train' && !trainedToday && (
            <p className="mt-0.5 text-xs font-semibold text-acc-violet">
              Dose tomorrow.
            </p>
          )}
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

      {stamp && (
        <div className="card border-acc-teal/50 px-4 py-3">
          <p className="text-sm font-bold text-app-tx1">
            Milestone: {stamp.kg} kg · passed{' '}
            {stamp.at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
          </p>
        </div>
      )}

      {muscleGuard && (
        <div className="card border-acc-ember-deep/50 px-4 py-3">
          <p className="text-sm leading-relaxed text-app-tx1">
            Fast loss this week — defend the muscle: {targets.proteinG} g protein today.
          </p>
        </div>
      )}

      {/* A Watch session waiting to be confirmed — native only, silent otherwise */}
      <DetectedSessionBanner />

      {/* THE dashboard: his body, live */}
      <BodyMap data={body} />

      {/* The conversation */}
      <CheckIn />

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

      <p className="text-[10px] leading-relaxed text-app-tx3">
        A tracker, not a diagnosis — patterns are observations from your own logs; decisions
        belong to you and your doctor.
      </p>
    </div>
  );
}
