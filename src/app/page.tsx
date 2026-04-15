import Link from 'next/link';
import { getWorkouts } from './actions';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export default async function Home() {
  const workouts = await getWorkouts();
  const recentWorkouts = workouts.slice(0, 5);
  const totalSets = workouts.reduce((sum, w) => sum + w.sets.length, 0);

  return (
    <div className="space-y-8">
      <div className="text-center py-8">
        <h1 className="text-4xl font-bold text-white mb-3">Workout Tracker</h1>
        <p className="text-gray-400 text-lg">Log, track, and analyze your training progress</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-6 text-center border border-gray-800">
          <div className="text-3xl font-bold text-blue-400">{workouts.length}</div>
          <div className="text-gray-400 text-sm mt-1">Total Workouts</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-6 text-center border border-gray-800">
          <div className="text-3xl font-bold text-green-400">{totalSets}</div>
          <div className="text-gray-400 text-sm mt-1">Total Sets</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-6 text-center border border-gray-800">
          <div className="text-3xl font-bold text-purple-400">
            {workouts.length > 0 ? Math.round(totalSets / workouts.length) : 0}
          </div>
          <div className="text-gray-400 text-sm mt-1">Avg Sets / Workout</div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Recent Workouts</h2>
          <Link href="/workouts" className="text-blue-400 hover:text-blue-300 text-sm transition-colors">
            View all &rarr;
          </Link>
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800 border-dashed">
            <div className="text-5xl mb-4">🏋️</div>
            <h3 className="text-lg font-medium text-white mb-2">No workouts yet</h3>
            <p className="text-gray-400 mb-6">Start tracking your fitness journey</p>
            <Link
              href="/workouts/new"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-block"
            >
              Log your first workout
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {recentWorkouts.map((workout) => {
              const exerciseNames = [...new Set(workout.sets.map((s) => s.exercise.name))];
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}`}
                  className="block bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-600 transition-all hover:bg-gray-800"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{workout.name}</h3>
                      <p className="text-gray-400 text-sm mt-1">
                        {exerciseNames.slice(0, 3).join(', ')}
                        {exerciseNames.length > 3 && ` +${exerciseNames.length - 3} more`}
                      </p>
                    </div>
                    <div className="text-right text-sm text-gray-400">
                      <div>{formatDate(workout.date)}</div>
                      <div className="mt-1">{workout.sets.length} sets</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {recentWorkouts.length > 0 && (
        <div className="text-center">
          <Link
            href="/workouts/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold text-lg transition-colors inline-block"
          >
            + Log New Workout
          </Link>
        </div>
      )}
    </div>
  );
}
