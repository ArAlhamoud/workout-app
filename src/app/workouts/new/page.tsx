import Link from 'next/link';
import { getExercises, getLastSessionForExercises, getPersonalRecords, getWorkouts } from '../../actions';
import WorkoutForm from '@/components/WorkoutForm';
import {
  getDayTemplate,
  getExercisesForDuration,
  getPlankTarget,
  type Duration,
} from '@/lib/program';

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

  let programWeek = 1;
  if (allWorkouts.length > 0) {
    const firstWorkout = allWorkouts[allWorkouts.length - 1];
    const daysSinceStart = Math.floor((Date.now() - new Date(firstWorkout.date).getTime()) / 86400000);
    programWeek = Math.min(12, Math.floor(daysSinceStart / 7) + 1);
  }
  const plankTarget = getPlankTarget(programWeek);
  const finalExercises = initialExercises.map((ex) =>
    ex.name === 'Plank' ? { ...ex, defaultReps: plankTarget.min } : ex
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {validDay ? `Day ${validDay} Workout` : 'Log Workout'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          {validDay ? getDayTemplate(validDay).focus : 'Record your training session'}
        </p>
      </div>

      {/* Duration switcher pills */}
      {validDay && (
        <div>
          <p className="text-gray-600 text-xs uppercase tracking-widest font-semibold mb-2">
            Duration · {initialExercises.length} exercises
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => {
              const active = d === validDur;
              return (
                <Link
                  key={d}
                  href={`/workouts/new?day=${validDay}&dur=${d}`}
                  className={`text-center px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    active
                      ? validDay === 'A'
                        ? 'bg-blue-600 text-white'
                        : 'bg-violet-700 text-white'
                      : 'bg-gray-900 border border-gray-800 text-gray-400 hover:border-gray-700 hover:text-white'
                  }`}
                >
                  {d} min
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
      />
    </div>
  );
}
