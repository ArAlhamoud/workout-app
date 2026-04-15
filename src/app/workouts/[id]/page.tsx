import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkout } from '../../actions';
import DeleteButton from '@/components/DeleteButton';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export default async function WorkoutDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const workout = await getWorkout(params.id);

  if (!workout) notFound();

  const exerciseMap = new Map<string, typeof workout.sets>();
  for (const set of workout.sets) {
    if (!exerciseMap.has(set.exerciseId)) exerciseMap.set(set.exerciseId, []);
    exerciseMap.get(set.exerciseId)!.push(set);
  }

  const totalVolume = workout.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/workouts" className="text-blue-400 hover:text-blue-300 text-sm mb-2 inline-block">
            &larr; Back to workouts
          </Link>
          <h1 className="text-2xl font-bold text-white">{workout.name}</h1>
          <p className="text-gray-400 mt-1">{formatDate(workout.date)}</p>
        </div>
        <DeleteButton workoutId={workout.id} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 rounded-lg p-4 text-center border border-gray-800">
          <div className="text-2xl font-bold text-blue-400">{exerciseMap.size}</div>
          <div className="text-gray-400 text-xs mt-1">Exercises</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 text-center border border-gray-800">
          <div className="text-2xl font-bold text-green-400">{workout.sets.length}</div>
          <div className="text-gray-400 text-xs mt-1">Total Sets</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 text-center border border-gray-800">
          <div className="text-2xl font-bold text-purple-400">{totalVolume.toLocaleString()}</div>
          <div className="text-gray-400 text-xs mt-1">Volume (kg)</div>
        </div>
      </div>

      {workout.notes && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-medium text-gray-400 mb-1">Notes</h3>
          <p className="text-white">{workout.notes}</p>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Exercises</h2>
        {Array.from(exerciseMap.entries()).map(([, sets]) => {
          const exercise = sets[0].exercise;
          return (
            <div key={exercise.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-white">{exercise.name}</h3>
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
                  {exercise.category}
                </span>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-4 text-xs text-gray-500 font-medium uppercase tracking-wide pb-1 border-b border-gray-800">
                  <span>Set</span><span>Weight</span><span>Reps</span><span>Volume</span>
                </div>
                {sets.map((set) => (
                  <div key={set.id} className="grid grid-cols-4 text-sm">
                    <span className="text-gray-400">{set.setNumber}</span>
                    <span className="text-white">{set.weight} kg</span>
                    <span className="text-white">{set.reps}</span>
                    <span className="text-gray-400">{(set.reps * set.weight).toFixed(0)} kg</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
