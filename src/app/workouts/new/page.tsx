import Link from 'next/link';
import { getExercises, getLastSessionForExercises, getPersonalRecords } from '../../actions';
import WorkoutForm from '@/components/WorkoutForm';
import {
  getDayTemplate,
  getExercisesForDuration,
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
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  })();

  const exerciseIds = initialExercises.map((e) => e.exerciseId);
  const [lastSession, personalRecords] = await Promise.all([
    getLastSessionForExercises(exerciseIds),
    getPersonalRecords(),
  ]);

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

      {/* Day picker — shown when arriving from the nav LOG button without a day */}
      {!validDay && (
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-widest font-bold mb-3">
            Quick Start
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((d) => {
              const template = getDayTemplate(d);
              return (
                <Link
                  key={d}
                  href={`/workouts/new?day=${d}&dur=60`}
                  className={`rounded-2xl px-4 py-5 text-center transition-colors ${
                    d === 'A'
                      ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700'
                      : 'bg-violet-700 hover:bg-violet-600 active:bg-violet-800'
                  }`}
                >
                  <div className="text-white font-black text-xl">Day {d}</div>
                  <div className={`text-xs mt-1.5 ${d === 'A' ? 'text-blue-200' : 'text-violet-200'}`}>
                    {template.focus}
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-gray-600 text-xs text-center mt-3">
            or add exercises manually below
          </p>
        </div>
      )}

      {/* Duration switcher pills */}
      {validDay && (
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-2">
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
                      : 'bg-gray-900 border border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
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
        initialExercises={initialExercises}
        lastSession={lastSession}
        personalRecords={personalRecords}
      />
    </div>
  );
}
