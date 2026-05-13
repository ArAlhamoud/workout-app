import Link from 'next/link';
import { getWorkouts } from '../actions';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

function CalendarHeatmap({ workouts }: { workouts: { date: Date }[] }) {
  const workoutDates = new Set(
    workouts.map((w) => new Date(w.date).toISOString().split('T')[0]),
  );

  const today = new Date();
  const dayOfWeek = today.getDay();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - dayOfWeek - 15 * 7);
  startDate.setHours(0, 0, 0, 0);

  const weeks: Date[][] = [];
  let current = new Date(startDate);
  while (current <= today) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
      <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
        Activity · 16 weeks
      </p>
      <div className="flex gap-0.5">
        <div className="flex flex-col gap-0.5 mr-1">
          {dayLabels.map((label, i) => (
            <div
              key={i}
              className="h-3.5 flex items-center text-[9px] text-gray-700 font-medium w-3"
            >
              {i % 2 === 0 ? label : ''}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5 flex-1">
            {week.map((day, di) => {
              const key = day.toISOString().split('T')[0];
              const isFuture = day > today;
              const hasWorkout = workoutDates.has(key);
              return (
                <div
                  key={di}
                  className={`h-3.5 rounded-sm transition-colors ${
                    isFuture
                      ? 'bg-transparent'
                      : hasWorkout
                      ? 'bg-green-500'
                      : 'bg-gray-800'
                  }`}
                  title={key}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-gray-700 text-[10px]">16 weeks ago</span>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-800" />
          <span className="text-gray-700 text-[10px]">Rest</span>
          <div className="w-3 h-3 rounded-sm bg-green-500 ml-1" />
          <span className="text-gray-700 text-[10px]">Workout</span>
        </div>
        <span className="text-gray-700 text-[10px]">Today</span>
      </div>
    </div>
  );
}

export default async function WorkoutsPage() {
  const workouts = await getWorkouts();

  const totalVolume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + set.reps * set.weight, 0),
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">History</h1>
        <Link
          href="/workouts/new"
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          + Log
        </Link>
      </div>

      {workouts.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">{workouts.length}</div>
            <div className="text-gray-600 text-xs mt-0.5">Sessions</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">
              {workouts.reduce((n, w) => n + w.sets.length, 0)}
            </div>
            <div className="text-gray-600 text-xs mt-0.5">Total Sets</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">
              {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)}
            </div>
            <div className="text-gray-600 text-xs mt-0.5">kg Volume</div>
          </div>
        </div>
      )}

      {workouts.length > 0 && <CalendarHeatmap workouts={workouts} />}

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
            const volume = workout.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);
            const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
            return (
              <Link
                key={workout.id}
                href={`/workouts/${workout.id}`}
                className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3.5 border border-gray-800 hover:border-gray-600 hover:bg-gray-800/80 transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {dayLetter && (
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 ${
                        dayLetter === 'A'
                          ? 'bg-blue-600/25 text-blue-400'
                          : 'bg-violet-700/25 text-violet-400'
                      }`}>
                        {dayLetter}
                      </span>
                    )}
                    <div className="font-medium text-white truncate">{workout.name}</div>
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5 truncate">
                    {exerciseNames.slice(0, 4).join(' · ')}
                    {exerciseNames.length > 4 && ` +${exerciseNames.length - 4}`}
                  </div>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <div className="text-xs text-gray-400">{formatDate(workout.date)}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {workout.sets.length} sets
                    {volume > 0 && ` · ${volume.toLocaleString()} kg`}
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
