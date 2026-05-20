import Link from 'next/link';
import { getWorkouts } from '../actions';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekLabel(monday: Date): string {
  const now = new Date();
  const thisMonday = getMondayOfWeek(now);
  const diffDays = Math.round((thisMonday.getTime() - monday.getTime()) / 86400000);
  if (diffDays === 0) return 'This week';
  if (diffDays === 7) return 'Last week';
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

type Workout = Awaited<ReturnType<typeof getWorkouts>>[number];

function groupByWeek(workouts: Workout[]): Array<{ label: string; monday: Date; items: Workout[] }> {
  const map = new Map<string, { label: string; monday: Date; items: Workout[] }>();
  for (const w of workouts) {
    const monday = getMondayOfWeek(new Date(w.date));
    const key = monday.toISOString().split('T')[0];
    if (!map.has(key)) {
      map.set(key, { label: weekLabel(monday), monday, items: [] });
    }
    map.get(key)!.items.push(w);
  }
  return Array.from(map.values()).sort((a, b) => b.monday.getTime() - a.monday.getTime());
}

export default async function WorkoutsPage() {
  const workouts = await getWorkouts();
  const groups = groupByWeek(workouts);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">History</h1>
        <span className="text-gray-600 text-sm">{workouts.length} sessions</span>
      </div>

      {workouts.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl p-10 text-center border border-gray-800 border-dashed">
          <p className="text-gray-500 font-medium mb-1">No sessions yet</p>
          <Link href="/" className="text-blue-400 text-sm mt-2 inline-block hover:text-blue-300 transition-colors">
            Start from home &#8594;
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const weekVol = group.items.reduce(
              (sum, w) => sum + w.sets.reduce((s, set) => s + set.reps * set.weight, 0),
              0,
            );
            return (
              <div key={group.monday.toISOString()}>
                {/* Week header */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                    {group.label}
                  </p>
                  <p className="text-xs text-gray-700">
                    {group.items.length} session{group.items.length !== 1 ? 's' : ''}
                    {weekVol > 0 && <span> &middot; {weekVol >= 1000 ? `${(weekVol / 1000).toFixed(1)}k` : Math.round(weekVol)} kg</span>}
                  </p>
                </div>

                <div className="space-y-2">
                  {group.items.map((workout) => {
                    const exerciseNames = Array.from(new Set(workout.sets.map((s) => s.exercise.name)));
                    const totalVolume = workout.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);
                    const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
                    return (
                      <Link
                        key={workout.id}
                        href={`/workouts/${workout.id}`}
                        className="flex items-center bg-gray-900 rounded-xl px-4 py-3.5 border border-gray-800 hover:border-gray-700 hover:bg-gray-800/60 active:scale-[0.99] transition-all"
                      >
                        {dayLetter && (
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md mr-3 flex-shrink-0 ${
                            dayLetter === 'A'
                              ? 'bg-blue-600/25 text-blue-400'
                              : 'bg-violet-700/25 text-violet-400'
                          }`}>
                            {dayLetter}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-white text-sm truncate">{workout.name}</div>
                          <div className="text-gray-600 text-xs mt-0.5 truncate">
                            {exerciseNames.slice(0, 4).join(' · ')}
                            {exerciseNames.length > 4 && ` +${exerciseNames.length - 4}`}
                          </div>
                        </div>
                        <div className="text-right ml-4 flex-shrink-0">
                          <div className="text-xs text-gray-500">{formatDate(workout.date)}</div>
                          <div className="text-xs text-gray-700 mt-0.5">
                            {workout.sets.length} sets
                            {totalVolume > 0 && <span> &middot; {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)} kg</span>}
                            {workout.duration ? <span> &middot; {formatDuration(workout.duration)}</span> : null}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
