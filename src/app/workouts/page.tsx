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
      {/* Header */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-xl font-bold text-app-tx1">History</h1>
          <p className="text-app-tx3 text-sm mt-0.5">{workouts.length} sessions logged</p>
        </div>
      </div>

      {workouts.length === 0 ? (
        <div className="card-lg p-10 text-center border-dashed">
          <p className="text-app-tx2 font-medium mb-1">No sessions yet</p>
          <Link href="/" className="text-teal-400 text-sm mt-2 inline-block hover:text-teal-300 transition-colors">
            Start from home →
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const weekVol = group.items.reduce(
              (sum, w) => sum + w.sets.reduce((s, set) => s + set.reps * set.weight, 0),
              0,
            );
            return (
              <div key={group.monday.toISOString()}>
                {/* Week header */}
                <div className="flex items-center justify-between mb-2.5">
                  <p className="section-label">{group.label}</p>
                  <p className="text-[11px] text-app-tx3">
                    {group.items.length} session{group.items.length !== 1 ? 's' : ''}
                    {weekVol > 0 && (
                      <span> · {weekVol >= 1000 ? `${(weekVol / 1000).toFixed(1)}k` : Math.round(weekVol)} kg</span>
                    )}
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
                        className="flex items-center card px-4 py-3.5 hover:border-white/15 hover:bg-app-surface2/50 active:scale-[0.99] transition-all pressable"
                      >
                        {/* Day badge */}
                        {dayLetter ? (
                          <span className={`text-[10px] font-black w-7 h-7 rounded-lg flex items-center justify-center mr-3 flex-shrink-0 ${
                            dayLetter === 'A'
                              ? 'bg-blue-600/25 text-blue-400'
                              : 'bg-violet-700/25 text-violet-400'
                          }`}>
                            {dayLetter}
                          </span>
                        ) : (
                          <span className="w-7 h-7 rounded-lg bg-app-surface2 mr-3 flex-shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-app-tx1 text-sm truncate">{workout.name}</div>
                          <div className="text-app-tx3 text-[11px] mt-0.5 truncate">
                            {exerciseNames.slice(0, 4).join(' · ')}
                            {exerciseNames.length > 4 && ` +${exerciseNames.length - 4}`}
                          </div>
                        </div>

                        <div className="text-right ml-4 flex-shrink-0">
                          <div className="text-[11px] text-app-tx2">{formatDate(workout.date)}</div>
                          <div className="text-[11px] text-app-tx3 mt-0.5">
                            {workout.sets.length} sets
                            {totalVolume > 0 && (
                              <span> · {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)} kg</span>
                            )}
                            {workout.duration ? <span> · {formatDuration(workout.duration)}</span> : null}
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
