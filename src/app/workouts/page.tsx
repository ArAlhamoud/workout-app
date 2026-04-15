import Link from 'next/link';
import { getWorkouts } from '../actions';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export default async function WorkoutsPage() {
  const workouts = await getWorkouts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Workout History</h1>
        <Link
          href="/workouts/new"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Log Workout
        </Link>
      </div>

      {workouts.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800 border-dashed">
          <div className="text-5xl mb-4">🏋️</div>
          <h3 className="text-lg font-medium text-white mb-2">No workouts yet</h3>
          <p className="text-gray-400 mb-6">Start logging your training sessions</p>
          <Link
            href="/workouts/new"
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-block"
          >
            Log first workout
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {workouts.map((workout) => {
            const exerciseNames = [...new Set(workout.sets.map((s) => s.exercise.name))];
            const totalVolume = workout.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);
            return (
              <Link
                key={workout.id}
                href={`/workouts/${workout.id}`}
                className="block bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-600 transition-all hover:bg-gray-800"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-white text-lg">{workout.name}</h3>
                    <p className="text-gray-400 text-sm mt-1">
                      {exerciseNames.slice(0, 4).join(' · ')}
                      {exerciseNames.length > 4 && ` · +${exerciseNames.length - 4} more`}
                    </p>
                  </div>
                  <div className="text-right text-sm ml-4">
                    <div className="text-gray-300">{formatDate(workout.date)}</div>
                    <div className="text-gray-400 mt-1">
                      {workout.sets.length} sets &middot; {totalVolume.toLocaleString()} kg vol
                    </div>
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
