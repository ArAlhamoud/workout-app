import Link from 'next/link';
import { getWorkouts } from './actions';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export default async function Home() {
  const workouts = await getWorkouts();
  const recentWorkouts = workouts.slice(0, 4);
  const totalSets = workouts.reduce((sum, w) => sum + w.sets.length, 0);
  const totalVolume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Hero: Start Today's Workout */}
      <div>
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          Start Today
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/workouts/new?day=A"
            className="relative overflow-hidden bg-blue-600 hover:bg-blue-500 rounded-2xl p-5 transition-all active:scale-95 group"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="text-2xl font-black text-white mb-1">Day A</div>
            <div className="text-blue-200 text-xs font-medium leading-tight">
              Chest · Quads · Shoulders
            </div>
            <div className="mt-4 text-blue-300 text-xs">8 exercises · ~45 min</div>
            <div className="absolute bottom-3 right-4 text-white/20 text-3xl font-black group-hover:text-white/40 transition-colors">
              →
            </div>
          </Link>
          <Link
            href="/workouts/new?day=B"
            className="relative overflow-hidden bg-violet-700 hover:bg-violet-600 rounded-2xl p-5 transition-all active:scale-95 group"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="text-2xl font-black text-white mb-1">Day B</div>
            <div className="text-violet-200 text-xs font-medium leading-tight">
              Back · Hamstrings · Arms
            </div>
            <div className="mt-4 text-violet-300 text-xs">8 exercises · ~45 min</div>
            <div className="absolute bottom-3 right-4 text-white/20 text-3xl font-black group-hover:text-white/40 transition-colors">
              →
            </div>
          </Link>
        </div>
      </div>

      {/* Stats */}
      {workouts.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-800">
            <div className="text-2xl font-bold text-white">{workouts.length}</div>
            <div className="text-gray-500 text-xs mt-1">Sessions</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-800">
            <div className="text-2xl font-bold text-white">{totalSets}</div>
            <div className="text-gray-500 text-xs mt-1">Total Sets</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-800">
            <div className="text-2xl font-bold text-white">
              {totalVolume >= 1000
                ? `${(totalVolume / 1000).toFixed(1)}k`
                : Math.round(totalVolume)}
            </div>
            <div className="text-gray-500 text-xs mt-1">kg Volume</div>
          </div>
        </div>
      )}

      {/* Recent Workouts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold">Recent</p>
          {workouts.length > 0 && (
            <Link href="/workouts" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
              See all →
            </Link>
          )}
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-10 text-center border border-gray-800 border-dashed">
            <div className="text-gray-700 text-4xl mb-3 select-none">▲</div>
            <h3 className="font-semibold text-white mb-1">No workouts yet</h3>
            <p className="text-gray-500 text-sm mb-5">Pick Day A or Day B above to get started</p>
            <Link href="/program" className="text-blue-400 text-sm hover:text-blue-300 transition-colors">
              View your program →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentWorkouts.map((workout) => {
              const exerciseNames = Array.from(new Set(workout.sets.map((s) => s.exercise.name)));
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}`}
                  className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3.5 border border-gray-800 hover:border-gray-700 transition-all hover:bg-gray-800/80"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-white text-sm truncate">{workout.name}</div>
                    <div className="text-gray-500 text-xs mt-0.5 truncate">
                      {exerciseNames.slice(0, 3).join(' · ')}
                      {exerciseNames.length > 3 && ` +${exerciseNames.length - 3}`}
                    </div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <div className="text-gray-400 text-xs">{formatDate(workout.date)}</div>
                    <div className="text-gray-600 text-xs mt-0.5">{workout.sets.length} sets</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* View Full Program */}
      <div className="text-center pb-2">
        <Link href="/program" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
          View full 12-week program →
        </Link>
      </div>
    </div>
  );
}
