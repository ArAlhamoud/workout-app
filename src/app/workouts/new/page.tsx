import { getExercises } from '../../actions';
import WorkoutForm from '@/components/WorkoutForm';
import { getDayTemplate } from '@/lib/program';

export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const rawDay = searchParams.day;
  const day = Array.isArray(rawDay) ? rawDay[0] : rawDay;
  const validDay = day === 'A' || day === 'B' ? day : undefined;

  const exercises = await getExercises();

  const initialName = validDay
    ? `Day ${validDay} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  const initialExercises = (() => {
    if (!validDay) return [];
    const template = getDayTemplate(validDay);
    const exerciseMap = new Map(exercises.map((e) => [e.name, e]));
    return template.exercises
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
      <WorkoutForm
        exercises={exercises}
        initialName={initialName}
        initialExercises={initialExercises}
      />
    </div>
  );
}
