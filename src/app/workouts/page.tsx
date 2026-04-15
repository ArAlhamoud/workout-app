import Link from 'next/link';
import { getWorkouts } from '../actions';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export default async function WorkoutsPage() {
  const workouts = await getWorkouts();

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">History</h1>
        <Link
          href="/workouts/new"
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          + Log
        </Link>
      </div>

      {workouts.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-10 text-center border border-gray-800 border-dashed">
          <p className="text-gray-400">No sessions yet.</p>
          <Link href="/" className="text-blue-400 text-sm mt-2 inline-block hover:text-blue-300">
            Start from the dashboard
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {workouts.map((workout) => {
            const exerciseNames = Array.from(new Set(workout.sets.map((s) => s.exercise.name)));
            const totalVolume = workout.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);
            return (
              <Link
                key={workout.id}
                href={`/workouts/${workout.id}`}
                className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3.5 border border-gray-800 hover:border-gray-600 hover:bg-gray-800/80 transition-all"
              >
                <div className="min-w-0">
                  <div className="font-medium text-white truncate">{workout.name}</div>
                  <div className="text-gray-500 text-xs mt-0.5 truncate">
                    {exerciseNames.slice(0, 4).join(' \u00b7 ')}
                    {exerciseNames.length > 4 && ` +${exerciseNames.length - 4}`}
                  </div>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <div className="text-xs text-gray-400">{formatDate(workout.date)}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {workout.sets.length} sets \u00b7 {totalVolume.toLocaleString()} kg
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
