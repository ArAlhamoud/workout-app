import Link from 'next/link';
import { getWorkouts } from './actions';
import { SCHEDULE } from '@/lib/program';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(date),
  );
}

function formatRelative(date: Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export default async function Home() {
  const workouts = await getWorkouts();
  const recentWorkouts = workouts.slice(0, 4);
  const totalSets = workouts.reduce((sum, w) => sum + w.sets.length, 0);
  const totalVolume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );

  // Today's schedule
  const todayIdx = new Date().getDay(); // 0=Sun
  const today = SCHEDULE[todayIdx];
  const isGymDay = today?.type === 'gym';

  // Find next gym day (for rest days)
  let nextGymDay: (typeof SCHEDULE)[0] | null = null;
  if (!isGymDay) {
    for (let i = 1; i <= 7; i++) {
      const s = SCHEDULE[(todayIdx + i) % 7];
      if (s?.type === 'gym') {
        nextGymDay = s;
        break;
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Today banner */}
      {isGymDay ? (
        <div className="rounded-2xl bg-green-900/20 border border-green-800/40 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-green-400 text-xs font-bold uppercase tracking-widest">Today</p>
            <p className="text-white font-semibold text-sm mt-0.5">Gym day — pick a workout below</p>
          </div>
          <div className="text-green-400 text-xl">↓</div>
        </div>
      ) : (
        <div className="rounded-2xl bg-gray-900 border border-gray-800 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">Today</p>
            <p className="text-gray-300 font-semibold text-sm mt-0.5">Rest day — recover well</p>
          </div>
          {nextGymDay && (
            <p className="text-gray-500 text-xs text-right">
              Next gym:<br />
              <span className="text-gray-300 font-semibold">{nextGymDay.day}</span>
            </p>
          )}
        </div>
      )}

      {/* Start workout cards */}
      <div>
        <p className="text-gray-600 text-xs uppercase tracking-widest font-semibold mb-2.5">
          Start a Workout
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/workouts/new?day=A"
            className="relative overflow-hidden bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-2xl p-4 transition-all active:scale-95 group block"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="text-xl font-black text-white">Day A</div>
            <div className="text-blue-200 text-xs mt-0.5 leading-snug">
              Chest · Quads<br />Shoulders
            </div>
            <div className="mt-3 text-blue-300/70 text-xs">8 exercises</div>
            <div className="absolute bottom-3 right-3 text-white/20 text-2xl font-black group-hover:text-white/40 transition-colors">
              →
            </div>
          </Link>
          <Link
            href="/workouts/new?day=B"
            className="relative overflow-hidden bg-violet-700 hover:bg-violet-600 active:bg-violet-800 rounded-2xl p-4 transition-all active:scale-95 group block"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="text-xl font-black text-white">Day B</div>
            <div className="text-violet-200 text-xs mt-0.5 leading-snug">
              Back · Hamstrings<br />Arms
            </div>
            <div className="mt-3 text-violet-300/70 text-xs">8 exercises</div>
            <div className="absolute bottom-3 right-3 text-white/20 text-2xl font-black group-hover:text-white/40 transition-colors">
              →
            </div>
          </Link>
        </div>
      </div>

      {/* Stats — only when there's data */}
      {workouts.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">{workouts.length}</div>
            <div className="text-gray-600 text-xs mt-0.5">Sessions</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">{totalSets}</div>
            <div className="text-gray-600 text-xs mt-0.5">Total Sets</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">
              {totalVolume >= 1000
                ? `${(totalVolume / 1000).toFixed(1)}k`
                : Math.round(totalVolume)}
            </div>
            <div className="text-gray-600 text-xs mt-0.5">kg Volume</div>
          </div>
        </div>
      )}

      {/* Recent workouts */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-gray-600 text-xs uppercase tracking-widest font-semibold">Recent</p>
          {workouts.length > 4 && (
            <Link href="/workouts" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
              See all →
            </Link>
          )}
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800 border-dashed">
            <p className="text-gray-600 font-medium mb-1">No workouts yet</p>
            <p className="text-gray-700 text-sm mb-4">Tap Day A or Day B above to get started</p>
            <Link href="/program" className="text-blue-400 text-sm hover:text-blue-300">
              Read the program first →
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
                  className="flex items-center bg-gray-900 rounded-xl px-4 py-3 border border-gray-800 hover:border-gray-700 hover:bg-gray-800/60 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-sm truncate">{workout.name}</div>
                    <div className="text-gray-600 text-xs mt-0.5 truncate">
                      {exerciseNames.slice(0, 3).join(' · ')}
                      {exerciseNames.length > 3 && ` +${exerciseNames.length - 3}`}
                    </div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <div className="text-gray-500 text-xs">{formatRelative(workout.date)}</div>
                    <div className="text-gray-700 text-xs mt-0.5">{workout.sets.length} sets</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
