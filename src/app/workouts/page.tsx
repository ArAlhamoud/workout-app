import Link from 'next/link';
import type { Metadata } from 'next';
import { getWorkouts } from '../actions';
import { formatDuration, getMondayOfWeek, kgCompact } from '@/lib/format';
import { DEFAULT_GYM_ID, gymLabel } from '@/lib/program';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'History' };

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
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
          <h1 className="text-xl font-bold font-round tracking-tight bg-clip-text text-transparent bg-[linear-gradient(100deg,#ffffff_20%,#c7d2fe_60%,#99f6e4_100%)]">
            History
          </h1>
          <p className="text-app-tx3 text-sm mt-0.5 tabular-nums">{workouts.length} sessions</p>
        </div>
      </div>

      {workouts.length === 0 ? (
        <div className="card-lg p-10 text-center border-dashed">
          <p className="text-app-tx2 font-medium mb-1">No sessions yet</p>
          <Link href="/" className="text-acc-teal text-sm mt-2 inline-block hover:text-teal-200 transition-colors">
            Start from home →
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const weekVol = group.items.reduce(
              (sum, w) => sum + w.sets.reduce((s, set) => s + (set.isWarmup ? 0 : set.reps * set.weight), 0),
              0,
            );
            return (
              <div key={group.monday.toISOString()}>
                {/* Week header */}
                <div className="flex items-center justify-between mb-2.5">
                  <p className="section-label">{group.label}</p>
                  <p className="text-[11px] text-app-tx3 tabular-nums">
                    {group.items.length} session{group.items.length !== 1 ? 's' : ''}
                    {weekVol > 0 && (
                      <span> · {kgCompact(weekVol)} kg</span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  {group.items.map((workout) => {
                    const totalVolume = workout.sets.reduce((sum, s) => sum + (s.isWarmup ? 0 : s.reps * s.weight), 0);
                    const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
                    return (
                      <Link
                        key={workout.id}
                        href={`/workouts/${workout.id}`}
                        className="flex items-center card px-4 py-3.5 hover:border-app-border-hi hover:bg-app-surface2/50 active:scale-[0.99] transition-all pressable"
                      >
                        {/* Day monogram — Day A glows violet, Day B glows teal */}
                        {dayLetter ? (
                          <span className={`font-round text-[15px] font-extrabold w-9 h-9 rounded-xl border flex items-center justify-center mr-3 flex-shrink-0 ${
                            dayLetter === 'A'
                              ? 'bg-acc-violet-deep/15 border-acc-violet/30 glow-violet shadow-glow-violet'
                              : 'bg-acc-teal-deep/15 border-acc-teal/30 glow-teal shadow-glow-teal'
                          }`}>
                            {dayLetter}
                          </span>
                        ) : (
                          <span className="w-9 h-9 rounded-xl bg-app-surface2 border border-app-border mr-3 flex-shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          {/* The row already shows the date on the right, so the
                              generated "— Aug 2" suffix is redundant — and it was
                              what pushed longer names into an ellipsis. Only the
                              generated pattern is stripped; custom names survive. */}
                          <div className="font-semibold text-app-tx1 text-sm truncate">
                            {workout.name.replace(/\s+—\s+[A-Za-z]{3}\s+\d{1,2}$/, '')}
                          </div>
                          {/* Only surfaced when away from the default gym — the
                              exception is the information, not the routine. */}
                          {workout.gym && workout.gym !== DEFAULT_GYM_ID && gymLabel(workout.gym) && (
                            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-acc-teal/80">
                              {gymLabel(workout.gym)}
                            </div>
                          )}
                        </div>

                        <div className="text-right ml-4 flex-shrink-0">
                          <div className="text-[11px] text-app-tx2">{formatDate(workout.date)}</div>
                          <div className="text-[11px] text-app-tx3 mt-0.5 tabular-nums">
                            {workout.sets.length} sets
                            {totalVolume > 0 && (
                              <span> · {kgCompact(totalVolume)} kg</span>
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
