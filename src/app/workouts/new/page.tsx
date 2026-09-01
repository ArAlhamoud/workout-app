import Link from 'next/link';
import type { Metadata } from 'next';
import { getExercises, getLoggerMemory, getPersonalRecords, getRepRecords, getWorkouts } from '../../actions';
import RescueWalkButton from '@/components/RescueWalkButton';
import WorkoutForm from '@/components/WorkoutForm';
import { combineIncrement, deloadTarget, detectPlateau, learnPinIncrements } from '@/lib/coach';
import {
  DEFAULT_GYM_ID,
  getDayTemplate,
  isTrainingSession,
  getDynamicPlan,
  getExercisesForDuration,
  getPlankTarget,
  getTrainingStatus,
  queuedDay,
  type Duration,
  cleanRampSessionDates,
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
  const [exercises, allWorkouts, personalRecords, repRecords] = await Promise.all([
    getExercises(),
    getWorkouts(),
    getPersonalRecords(DEFAULT_GYM_ID),
    getRepRecords(DEFAULT_GYM_ID),
  ]);

  // No ?dur= (the tab bar's +, a bare deep link): during a return ramp the
  // default is 45, not 60 — Home's CTA already says 45 then, and entering
  // through a different door must not silently double the prescribed day
  // (device-tester, Aug 5). An explicit ?dur= always wins.
  const trainingOnly = allWorkouts.filter(isTrainingSession);
  // Earned Ramp: clean rated sessions can lift the calendar clamp, and the
  // logger MUST agree with the unlock — this page's returnLoadPct is what
  // pre-scales every prefit weight, so a stale calendar week here would
  // keep the loads at 60% after the sessions earned 70.
  const cleanDates = cleanRampSessionDates(trainingOnly);
  const status = getTrainingStatus(trainingOnly.map((w) => w.date), new Date(), cleanDates);
  const inRamp = status.mode === 'return';
  const validDur: Duration =
    durStr === '30' ? 30 : durStr === '45' ? 45 : durStr === '60' ? 60 : inRamp ? 45 : 60;

  // No ?day= — e.g. the tab bar or a deep link — so fall back to the day the
  // dynamic plan has queued rather than dropping him into a blank freestyle log.
  const rawDay = searchParams.day;
  const day = Array.isArray(rawDay) ? rawDay[0] : rawDay;
  const validDay =
    day === 'A' || day === 'B'
      ? day
      : queuedDay(getDynamicPlan(allWorkouts.map((w) => ({ date: w.date, name: w.name }))));

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

  const initialName = isRescue
    ? `Rescue 15m — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' })}`
    : `Day ${validDay} ${validDur}m — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' })}`;

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
          name: te.name,
          machine: te.machine,
          cues: te.cues,
          youtubeUrl: te.youtubeUrl,
          rest: te.rest,
          targetReps: te.repsDisplay,
          unit: te.unit,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  })();

  const exerciseIds = initialExercises.map((e) => e.exerciseId);
  // Seeded for the default gym; the form refetches if he tags Alrajhi Tower.
  // Ramp-aware: mid-ramp the memory is the PRE-BREAK weight (the base the
  // percentage scales), not the previous ramp session.
  const lastSession = await getLoggerMemory(
    exerciseIds,
    DEFAULT_GYM_ID,
    status.mode === 'return' ? status.blockStartISO : undefined,
  );

  // Compute progression hints: exerciseId → true if same weight 2+ sessions with Easy/Med RPE
  const last2ByExercise: Record<string, { weight: number; rpe: number | null }[]> = {};
  for (const workout of allWorkouts) {
    const seen = new Set<string>();
    for (const set of workout.sets) {
      if (set.weight <= 0 || seen.has(set.exerciseId)) continue;
      seen.add(set.exerciseId);
      if (!last2ByExercise[set.exerciseId]) last2ByExercise[set.exerciseId] = [];
      if (last2ByExercise[set.exerciseId].length < 2) {
        const maxW = Math.max(...workout.sets.filter((s) => s.exerciseId === set.exerciseId && s.weight > 0).map((s) => s.weight));
        const rpEs = workout.sets.filter((s) => s.exerciseId === set.exerciseId && s.rpe != null && s.rpe > 0).map((s) => s.rpe!);
        last2ByExercise[set.exerciseId].push({ weight: maxW, rpe: rpEs.length ? Math.max(...rpEs) : null });
      }
    }
  }
  const isReturning = inRamp;

  // Per-machine pin spacing: learned from weight-jump history, with any
  // manual pinIncrement on the exercise taking precedence.
  // Home gym only. Pin spacing is a property of one physical stack, so
  // learning it from a mix of buildings would infer a step size that exists
  // on neither machine.
  const learnedIncrements = learnPinIncrements(
    allWorkouts.filter((w) => !w.gym || w.gym === DEFAULT_GYM_ID),
  );
  const pinIncrements: Record<string, number> = {};
  for (const ex of exercises) {
    pinIncrements[ex.id] = combineIncrement(learnedIncrements[ex.id], ex.pinIncrement);
  }

  // "Ready to progress" is derived from pre-break sessions, so it is
  // actively wrong while ramping back — the return target replaces it.
  const progressionHints: Record<string, boolean> = {};
  if (!isReturning) {
    for (const [exId, sessions] of Object.entries(last2ByExercise)) {
      if (sessions.length === 2) {
        const [recent, prev] = sessions;
        if (recent.weight === prev.weight && recent.rpe != null && recent.rpe <= 2) {
          progressionHints[exId] = true;
        }
      }
    }
  }

  // The plateau's ACTION: when detection fires for a machine, its next
  // session opens with a concrete deload prescription instead of a shrug.
  // Suppressed during the return ramp — everything is deloaded there already.
  const deloadHints: Record<string, { weight: number; note: string }> = {};
  if (!isReturning && !isRescue) {
    // Home-gym history only — the same scoping pin-increment learning uses,
    // and for the same reason: an interleaved work-gym session both masks
    // real plateaus and prescribes deloads from the wrong stack (adversary).
    const homeWorkouts = allWorkouts.filter((w) => !w.gym || w.gym === DEFAULT_GYM_ID);
    for (const ex of exercises) {
      const result = detectPlateau(homeWorkouts, ex.id);
      if (result.plateaued && result.weight != null && result.suggestion?.includes('pin')) {
        deloadHints[ex.id] = deloadTarget(result.weight, pinIncrements[ex.id]);
      }
    }
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
          <p className="text-acc-ember text-sm font-semibold">Rescue session — 15 minutes counts</p>
          <p className="text-app-tx2 text-xs mt-1">
            Four machines, two light sets each. Two easy minutes on the bike first — then straight in.
            This keeps the streak, the plan and the habit alive.
          </p>
          <RescueWalkButton />
        </div>
      )}
      <WorkoutForm
        exercises={exercises}
        initialName={initialName}
        initialExercises={finalExercises}
        lastSession={lastSession}
        healthWorkoutUuid={hkUuid}
        initialDate={initialDate}
        detectedDurationMin={detectedMins}
        detectedStartISO={detectedStartISO}
        personalRecords={personalRecords}
        progressionHints={progressionHints}
        repRecords={repRecords}
        deloadHints={deloadHints}
        rescueMode={isRescue}
        returnLoadPct={
          // Mid-ramp, last-logged weights are ALREADY scaled — 60% of 60% is
          // a 36% session wearing a 60% label (trainer). Ramp prefill as-is
          // is the right rescue load then.
          isRescue ? (isReturning ? undefined : RESCUE_LOAD_PCT) : isReturning ? status.returnWeek.loadPct : undefined
        }
        returnRpeCap={isRescue ? 2 : isReturning ? status.returnWeek.rpeCap : undefined}
        pinIncrements={pinIncrements}
        dayAccent={validDay}
      />
    </div>
  );
}
