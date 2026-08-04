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

/** Days between two sessions; the list is already newest-first. */
function daysBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000);
}

/** "5 weeks off" / "17 days off" — a layoff, phrased at the scale it happened. */
function gapLabel(days: number): string {
  if (days >= 14) {
    const weeks = Math.round(days / 7);
    return `${weeks} weeks off`;
  }
  return `${days} days off`;
}

/**
 * A break only shows up in this list as an absence — zero-session weeks never
 * had a row, so a 43-day layoff read as two adjacent sessions. That gap is the
 * single most important fact in the record: it is what the Return Protocol
 * exists to answer. Anything at or over this many days gets a marker.
 */
const GAP_DAYS = 10;

export default async function WorkoutsPage() {
  const workouts = await getWorkouts();

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
        <div className="space-y-2">
          {workouts.map((workout, i) => {
            const totalVolume = workout.sets.reduce((sum, s) => sum + (s.isWarmup ? 0 : s.reps * s.weight), 0);
            const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
            const prev = workouts[i + 1];
            const gap = prev ? daysBetween(new Date(workout.date), new Date(prev.date)) : 0;
            return (
              <div key={workout.id} className="space-y-2">
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
                {gap >= GAP_DAYS && (
                  <div className="flex items-center gap-2.5 py-1" aria-label={gapLabel(gap)}>
                    <span className="h-px flex-1 bg-acc-ember/25" />
                    <span className="chip flex-none border border-acc-ember/35 bg-acc-ember/[0.07] text-[10px] uppercase tracking-[0.12em] text-acc-ember/90">
                      {gapLabel(gap)}
                    </span>
                    <span className="h-px flex-1 bg-acc-ember/25" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
