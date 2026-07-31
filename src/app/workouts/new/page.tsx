import Link from 'next/link';
import type { Metadata } from 'next';
import { getExercises, getLastSessionForExercises, getPersonalRecords, getWorkouts } from '../../actions';
import WorkoutForm from '@/components/WorkoutForm';
import { combineIncrement, learnPinIncrements } from '@/lib/coach';
import {
  getDayTemplate,
  getExercisesForDuration,
  getPlankTarget,
  getTrainingStatus,
  type Duration,
} from '@/lib/program';

export const metadata: Metadata = { title: 'Log Workout' };

const DURATIONS: Duration[] = [30, 45, 60];

export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const rawDay = searchParams.day;
  const day = Array.isArray(rawDay) ? rawDay[0] : rawDay;
  const validDay = day === 'A' || day === 'B' ? day : undefined;

  const rawDur = searchParams.dur;
  const durStr = Array.isArray(rawDur) ? rawDur[0] : rawDur;
  const validDur: Duration =
    durStr === '30' ? 30 : durStr === '45' ? 45 : durStr === '60' ? 60 : 60;

  const exercises = await getExercises();

  const initialName = validDay
    ? `Day ${validDay} ${validDur}m — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  const initialExercises = (() => {
    if (!validDay) return [];
    const templateExercises = getExercisesForDuration(validDay, validDur);
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
  const [lastSession, personalRecords, allWorkouts] = await Promise.all([
    getLastSessionForExercises(exerciseIds),
    getPersonalRecords(),
    getWorkouts(),
  ]);

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
  const status = getTrainingStatus(allWorkouts.map((w) => w.date));
  const isReturning = status.mode === 'return';

  // Per-machine pin spacing: learned from weight-jump history, with any
  // manual pinIncrement on the exercise taking precedence.
  const learnedIncrements = learnPinIncrements(allWorkouts);
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

  const plankTarget = getPlankTarget(status.week);
  const finalExercises = initialExercises.map((ex) =>
    ex.name === 'Plank' ? { ...ex, defaultReps: plankTarget.min } : ex
  );

  // Aurora day accents — Day A glows violet, Day B glows teal.
  const eyebrowAccent =
    validDay === 'A' ? 'text-acc-violet/80' : validDay === 'B' ? 'text-acc-teal/80' : '';
  const titleGradient =
    validDay === 'A'
      ? 'bg-gradient-to-r from-white via-[#ddd6fe] to-[#c4b5fd] bg-clip-text text-transparent'
      : validDay === 'B'
        ? 'bg-gradient-to-r from-white via-[#c7d2fe] to-[#99f6e4] bg-clip-text text-transparent'
        : 'text-app-tx1';
  const durActive =
    validDay === 'A'
      ? 'bg-gradient-to-br from-acc-violet/25 to-acc-violet-deep/10 border-acc-violet/60 text-[#e9e4ff] shadow-glow-violet'
      : 'bg-gradient-to-br from-acc-teal/25 to-acc-teal-deep/10 border-acc-teal/60 text-[#ccfbf1] shadow-glow-teal';

  return (
    <div className="space-y-5">
      <div className="pt-1">
        <p className={`section-label ${eyebrowAccent}`}>
          {validDay ? getDayTemplate(validDay).focus : 'Freestyle'}
        </p>
        <h1 className={`text-2xl font-bold font-round tracking-tight mt-0.5 ${titleGradient}`}>
          {validDay ? `Day ${validDay} Workout` : 'Log Workout'}
        </h1>
      </div>

      {/* Duration switcher pills */}
      {validDay && (
        <div>
          <p className="section-label mb-2">
            Minutes · {initialExercises.length} exercises
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
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <WorkoutForm
        exercises={exercises}
        initialName={initialName}
        initialExercises={finalExercises}
        lastSession={lastSession}
        personalRecords={personalRecords}
        progressionHints={progressionHints}
        returnLoadPct={isReturning ? status.returnWeek.loadPct : undefined}
        returnRpeCap={isReturning ? status.returnWeek.rpeCap : undefined}
        pinIncrements={pinIncrements}
        dayAccent={validDay}
      />
    </div>
  );
}
