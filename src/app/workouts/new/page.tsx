import { readChart } from '@/lib/chart';
import { ownerActivityDayUtc } from '@/lib/health-insights';
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getExercises, getLiveSession, getLoggerMemory, getPersonalRecords, getRepRecords, getWorkouts } from '../../actions';
import RescueWalkButton from '@/components/RescueWalkButton';
import WorkoutForm from '@/components/WorkoutForm';
import { prescriptionInputs } from '@/lib/prescription';
import {
  DEFAULT_GYM_ID,
  getDayTemplate,
  getDynamicPlan,
  getExercisesForDuration,
  getPlankTarget,
  queuedDay,
  type Duration,
  effortCeiling,
  afOnChart,
  DEFAULT_SESSION_MIN,
} from '@/lib/program';

export const metadata: Metadata = { title: 'Log Workout' };

// This page was always request-rendered, but only IMPLICITLY — the first
// `searchParams` touch bailed prerendering out before the DB queries ran.
// Reordering the reads once put Prisma first and broke the build against
// CI's unreachable DATABASE_URL. Say it explicitly so statement order can
// never decide it again.
export const dynamic = 'force-dynamic';

const DURATIONS: Duration[] = [30, 45, 60];

export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // searchParams is read BEFORE any database call on purpose — see the
  // force-dynamic note above.
  const rawDur = searchParams.dur;
  const durStr = Array.isArray(rawDur) ? rawDur[0] : rawDur;

  // One wave, not three: personalRecords and repRecords depend only on the
  // constant default gym, so making them wait behind the template math was
  // pure serial latency — worst exactly on the Neon-cold-resume open at the
  // gym. Only lastSession genuinely needs exerciseIds (below).
  const [exercises, allWorkouts, personalRecords, repRecords, liveRow, chart] = await Promise.all([
    getExercises(),
    getWorkouts(),
    getPersonalRecords(DEFAULT_GYM_ID),
    getRepRecords(DEFAULT_GYM_ID),
    getLiveSession(),
    readChart(),
  ]);
  // The chart's effort ceiling (AF / antiarrhythmic / hypertension → Hard)
  // holds after the ramp exits — the logger greys RPE above it either way.
  const effortCap = effortCeiling(chart.conditions, chart.medications);
  const afFlag = afOnChart(chart.conditions);
  // A session in progress on the Watch opens HERE under its own day and
  // length — same rule as a draft from the other day (device-tester, Aug
  // 30): header and content must agree. Only a Watch-born session redirects;
  // a phone-born one is already where it started. Never when confirming a
  // detected session (it has its own identity).
  // Only a BARE open (no ?day) follows the row: an explicit day — the
  // user's tap, or the client hopping to a draft's own day — must win, or
  // a kept Day B draft plus a Watch Day A row ping-pongs forever
  // (adversary). Never on a rescue or a detected-session confirmation.
  const rawDayForLive = Array.isArray(searchParams.day) ? searchParams.day[0] : searchParams.day;
  const hkForLive = Array.isArray(searchParams.hk) ? searchParams.hk[0] : searchParams.hk;
  const rescueForLive = Array.isArray(searchParams.rescue) ? searchParams.rescue[0] : searchParams.rescue;
  if (liveRow && liveRow.source === 'watch' && liveRow.day && !hkForLive && rescueForLive !== '1' && !rawDayForLive) {
    redirect(`/workouts/new?day=${liveRow.day}&dur=${liveRow.durationMin ?? 45}`);
  }

  // No ?dur= (the tab bar's +, a bare deep link): during a return ramp the
  // default is 45, not 60 — Home's CTA already says 45 then, and entering
  // through a different door must not silently double the prescribed day
  // (device-tester, Aug 5). An explicit ?dur= always wins.
  // ONE set of prescription inputs — status (Earned Ramp included), the
  // memory cut, the home gym's pin map and its plateaus — built by the same
  // code, over the same newest rows, as the Watch plan and the save-time
  // ramp judge (prescription.ts; rules 2, 4, 9). This page's returnLoadPct
  // pre-scales every prefilled weight, so a stale week here would keep the
  // loads at 60% after the sessions earned 70.
  const inputs = prescriptionInputs(allWorkouts, exercises, DEFAULT_GYM_ID);
  const trainingOnly = inputs.training;
  const pinFor = inputs.pinFor;
  const status = inputs.status;
  const inRamp = status.mode === 'return';
  const validDur: Duration =
    durStr === '30' ? 30 : durStr === '45' ? 45 : durStr === '60' ? 60 : DEFAULT_SESSION_MIN;

  // No ?day= — e.g. the tab bar or a deep link — so fall back to the day the
  // dynamic plan has queued rather than dropping him into a blank freestyle log.
  const rawDay = searchParams.day;
  const day = Array.isArray(rawDay) ? rawDay[0] : rawDay;
  const validDay =
    day === 'A' || day === 'B'
      ? day
      : queuedDay(getDynamicPlan(trainingOnly.map((w) => ({ date: w.date, name: w.name }))));

  // The rescue session: 15 minutes, four priority-1 machines, 60% loads.
  // Reached from Gap Guard notifications and the readiness-hold banner. Its
  // only job is keeping the chain alive on a day a full session won't happen.
  const isRescue = (Array.isArray(searchParams.rescue) ? searchParams.rescue[0] : searchParams.rescue) === '1';

  // A detect/Watch confirmation arrives with the session's HealthKit
  // identity: ?hk=<uuid>&mins=<real minutes>&date=<local day>. Storing the
  // uuid is what stops the same session being offered again (the Stats
  // card sent these for weeks to a page that ignored them).
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const hkUuid = one(searchParams.hk) || undefined;
  const rawMins = Number(one(searchParams.mins));
  const detectedMins = Number.isFinite(rawMins) && rawMins > 0 && rawMins < 300 ? Math.round(rawMins) : undefined;
  const rawDate = one(searchParams.date);
  const initialDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
  const rawStart = one(searchParams.start);
  const detectedStartISO =
    rawStart && !Number.isNaN(new Date(rawStart).getTime()) ? new Date(rawStart).toISOString() : undefined;
  const RESCUE_EXERCISES = ['Leg Press', 'Chest Press', 'Lat Pulldown', 'Mid Row'];
  const RESCUE_LOAD_PCT = 60;

  // Same clock as the date field (activityDayStr): a session finished at
  // 00:30 was named "Sep 18" and dated Sep 17 (device-tester, 2026-09-18).
  const dayLabel = ownerActivityDayUtc().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const initialName = isRescue ? `Rescue 15m — ${dayLabel}` : `Day ${validDay} ${validDur}m — ${dayLabel}`;

  const initialExercises = (() => {
    const templateExercises = isRescue
      ? ([...getDayTemplate('A').exercises, ...getDayTemplate('B').exercises]
          .filter((te) => RESCUE_EXERCISES.includes(te.name))
          .map((te) => ({ ...te, sets: 2 })))
      : getExercisesForDuration(validDay, validDur);
    const exerciseMap = new Map(exercises.map((e) => [e.name, e]));
    return templateExercises
      .map((te) => {
        const ex = exerciseMap.get(te.name);
        if (!ex) return null;
        return {
          exerciseId: ex.id,
          sets: te.sets,
          defaultReps: te.repsMin,
          maxReps: te.repsMax,
          name: te.name,
          machine: te.machine,
          cues: te.cues,
          youtubeUrl: te.youtubeUrl,
          rest: te.rest,
          targetReps: te.repsDisplay,
          unit: te.unit,
          alwaysWarm: te.alwaysWarm === true,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  })();

  const exerciseIds = initialExercises.map((e) => e.exerciseId);
  // Seeded for the default gym; the form refetches if he tags Alrajhi Tower.
  // Ramp-aware: mid-ramp the memory is the last FULL-LOAD weight (the base
  // the percentage scales), never a previous ramp session.
  const lastSession = await getLoggerMemory(exerciseIds, DEFAULT_GYM_ID, inputs.cut);

  const isReturning = inRamp;

  // Per-machine pin spacing: learned from weight-jump history, with any
  // manual pinIncrement on the exercise taking precedence.
  // Home gym only. Pin spacing is a property of one physical stack, so
  // learning it from a mix of buildings would infer a step size that exists
  // on neither machine.
  const pinIncrements: Record<string, number> = {};
  for (const ex of exercises) pinIncrements[ex.id] = pinFor(ex.id);
  // Machines whose step is HIS: their ramp and warm-up weights sit on the
  // ladder through what he lifted, not on a grid counted from zero.
  const hisSteps = exercises.filter((ex) => inputs.stepIsHis(ex.id)).map((ex) => ex.id);

  // The plateau's ACTION: a plateaued machine opens AT its deload weight
  // with half the sets — prescribeWorking decides, from this weight, on the
  // phone and the Watch alike. Never inside a ramp (plateauKgFor).
  const plateauKgs: Record<string, number> = {};
  for (const id of exerciseIds) {
    const kg = inputs.plateauKgFor(id);
    if (kg != null) plateauKgs[id] = kg;
  }

  const plankTarget = getPlankTarget(status.week);
  const finalExercises = initialExercises.map((ex) =>
    ex.name === 'Plank' ? { ...ex, defaultReps: plankTarget.min } : ex
  );

  // Aurora day accents — Day A glows violet, Day B glows teal.
  const titleGradient =
    validDay === 'A'
      ? 'text-acc-violet'
      : 'text-acc-teal';
  const durActive =
    validDay === 'A'
      ? 'bg-gradient-to-br from-acc-violet/25 to-acc-violet-deep/10 border-acc-violet/60 text-[#e9e4ff] shadow-glow-violet'
      : 'bg-gradient-to-br from-acc-teal/25 to-acc-teal-deep/10 border-acc-teal/60 text-[#ccfbf1] shadow-glow-teal';

  return (
    <div className="space-y-5">
      {/* Volt masthead */}
      <header className="pt-1">
        <div className="volt-topline">
          <span>Day {validDay} · {validDur} min</span>
          <span className="volt-live">{getDayTemplate(validDay).focus}</span>
        </div>
        <h1 className="volt-h1" style={{ fontSize: 36 }}>
          Day <span className={titleGradient}>{validDay}</span> <span className="volt-hollow">workout</span>
        </h1>
        <div className="volt-tape" aria-hidden="true" />
      </header>

      {/* Duration switcher pills */}
      <div>
        {/* "Minutes · 9 exercises" over bare 30/45/60 pills read as a value that
            had gone missing. Name the choice, and let the pills carry the unit
            the way the Home card already does. */}
        <p className="section-label mb-2">
          Session length · {initialExercises.length} exercises
        </p>
        <div className="grid grid-cols-3 gap-2">
          {DURATIONS.map((d) => {
            const active = d === validDur;
            return (
              <Link
                key={d}
                href={`/workouts/new?day=${validDay}&dur=${d}`}
                className={`card text-center px-3 py-2.5 rounded-card text-sm font-semibold tabular-nums transition-all pressable ${
                  active
                    ? durActive
                    : 'text-app-tx2 hover:border-app-border-hi hover:text-app-tx1'
                }`}
              >
                {d}
                <span className="ml-1 text-[10px] font-medium opacity-60">min</span>
              </Link>
            );
          })}
        </div>
      </div>

      {isRescue && (
        <div className="card-lg px-4 py-3">
          <p className="text-acc-ember text-sm font-semibold">Rescue · 15 min · 2 min bike first</p>
          <RescueWalkButton />
        </div>
      )}
      <WorkoutForm
        // Keyed by day+dur: the draft-day hop (router.replace to the draft's
        // own ?day=) must REMOUNT the form, or the old day's template blocks
        // survive under the new masthead and the draft never restores (Mac
        // session's two-sim E2E, 2026-09-02: "DAY B" over Leg Press).
        key={`${validDay}-${validDur}-${isRescue ? 'r' : 'n'}`}
        exercises={exercises}
        initialName={initialName}
        initialExercises={finalExercises}
        lastSession={lastSession}
        healthWorkoutUuid={hkUuid}
        initialDate={initialDate}
        detectedDurationMin={detectedMins}
        detectedStartISO={detectedStartISO}
        liveSession={liveRow && (!liveRow.day || liveRow.day === validDay) ? liveRow : null}
        liveOpenElsewhere={Boolean(liveRow)}
        durationMin={validDur}
        personalRecords={personalRecords}
        repRecords={repRecords}
        plateauKgs={plateauKgs}
        rescueMode={isRescue}
        returnLoadPct={
          // Memory is the UNSCALED full-load weight now, so a rescue day
          // mid-ramp scales by the ramp's own week — not 60% on top of it
          // (36% wearing a 60% label), and never full pre-break weight on
          // the day readiness said "shrink" (adversary).
          isRescue ? (isReturning ? status.returnWeek.loadPct : RESCUE_LOAD_PCT) : isReturning ? status.returnWeek.loadPct : undefined
        }
        returnRpeCap={(() => {
          // The ramp strip is gated on returnLoadPct, so a cap on its own
          // only greys the RPE buttons — which is the point after the ramp.
          const cap = isRescue ? 2 : Math.min(isReturning ? status.returnWeek.rpeCap : 4, effortCap);
          return cap < 4 ? cap : undefined;
        })()}
        pinIncrements={pinIncrements}
        hisSteps={hisSteps}
        afOnChart={afFlag}
        coachEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
        dayAccent={validDay}
      />
    </div>
  );
}
