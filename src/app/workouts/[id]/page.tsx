import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkout } from '../../actions';
import DeleteButton from '@/components/DeleteButton';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

const rpeBadge: Record<number, { label: string; cls: string }> = {
  1: { label: 'Easy',  cls: 'text-green-400 bg-green-900/30 border-green-800/40' },
  2: { label: 'Med',   cls: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/40' },
  3: { label: 'Hard',  cls: 'text-orange-400 bg-orange-900/30 border-orange-800/40' },
  4: { label: 'Grind', cls: 'text-red-400 bg-red-900/30 border-red-800/40' },
};

const categoryColor: Record<string, string> = {
  CHEST:     'text-blue-400 bg-blue-900/30 border-blue-800/40',
  BACK:      'text-violet-400 bg-violet-900/30 border-violet-800/40',
  LEGS:      'text-green-400 bg-green-900/30 border-green-800/40',
  SHOULDERS: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/40',
  ARMS:      'text-orange-400 bg-orange-900/30 border-orange-800/40',
  CORE:      'text-pink-400 bg-pink-900/30 border-pink-800/40',
};

export default async function WorkoutDetailPage({ params }: { params: { id: string } }) {
  const workout = await getWorkout(params.id);
  if (!workout) notFound();

  const exerciseOrder: string[] = [];
  const exerciseMap = new Map<string, typeof workout.sets>();
  for (const set of workout.sets) {
    if (!exerciseMap.has(set.exerciseId)) {
      exerciseMap.set(set.exerciseId, []);
      exerciseOrder.push(set.exerciseId);
    }
    exerciseMap.get(set.exerciseId)!.push(set);
  }

  const totalVolume = workout.sets.reduce((sum, s) => sum + s.reps * s.weight, 0);

  const dayMatch = workout.name.match(/Day ([AB])/i);
  const durMatch = workout.name.match(/(\d+)m/);
  const logAgainHref = dayMatch
    ? `/workouts/new?day=${dayMatch[1].toUpperCase()}${durMatch ? `&dur=${durMatch[1]}` : ''}`
    : '/workouts/new';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/workouts"
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors inline-flex items-center gap-1 mb-2"
          >
            &#8592; History
          </Link>
          <h1 className="text-xl font-bold text-white leading-tight">{workout.name}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{formatDate(workout.date)}</p>
        </div>
        <DeleteButton workoutId={workout.id} />
      </div>

      {/* Stats row */}
      <div className={`grid gap-2 ${workout.duration ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
          <div className="text-xl font-bold text-white">{exerciseOrder.length}</div>
          <div className="text-gray-600 text-xs mt-0.5">Exercises</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
          <div className="text-xl font-bold text-white">{workout.sets.length}</div>
          <div className="text-gray-600 text-xs mt-0.5">Sets</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
          <div className="text-xl font-bold text-white">
            {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume.toLocaleString()}
          </div>
          <div className="text-gray-600 text-xs mt-0.5">kg Vol</div>
        </div>
        {workout.duration && (
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">{formatDuration(workout.duration)}</div>
            <div className="text-gray-600 text-xs mt-0.5">Duration</div>
          </div>
        )}
      </div>

      {workout.notes && (
        <div className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Notes</p>
          <p className="text-gray-300 text-sm">{workout.notes}</p>
        </div>
      )}

      {/* Exercise list */}
      <div className="space-y-3">
        {exerciseOrder.map((exId) => {
          const sets = exerciseMap.get(exId)!;
          const exercise = sets[0].exercise;
          const colorClass = categoryColor[exercise.category] ?? 'text-gray-400 bg-gray-800 border-gray-700';
          const exVolume = sets.reduce((s, set) => s + set.reps * set.weight, 0);

          return (
            <div key={exId} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              {/* Exercise header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-semibold text-white text-sm truncate">{exercise.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${colorClass}`}>
                    {exercise.category}
                  </span>
                </div>
                <span className="text-gray-600 text-xs flex-shrink-0 ml-2">
                  {exVolume > 0 ? `${exVolume.toLocaleString()} kg` : `${sets.length} sets`}
                </span>
              </div>

              {/* Set rows — 3 columns: [Set + RPE] [Weight × Reps] [Volume] */}
              <div className="px-4 py-3 space-y-1.5">
                <div className="grid grid-cols-3 text-xs text-gray-600 font-semibold uppercase tracking-wide mb-2">
                  <span>Set</span>
                  <span>Weight &times; Reps</span>
                  <span className="text-right">Volume</span>
                </div>
                {sets.map((set) => {
                  const rpe = set.rpe ? rpeBadge[set.rpe] : null;
                  return (
                    <div key={set.id} className="grid grid-cols-3 text-sm items-center py-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500 tabular-nums w-4 text-center">{set.setNumber}</span>
                        {rpe && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold leading-none ${rpe.cls}`}>
                            {rpe.label}
                          </span>
                        )}
                      </div>
                      <span className="text-white tabular-nums">
                        {set.weight > 0 ? `${set.weight} kg` : '—'}
                        <span className="text-gray-600 mx-1">&times;</span>
                        {set.reps}
                      </span>
                      <span className="text-gray-600 text-xs text-right tabular-nums">
                        {set.reps * set.weight > 0 ? `${(set.reps * set.weight).toFixed(0)} kg` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Next session targets */}
      {(() => {
        const targets: { name: string; current: number; next: number; note: string }[] = [];
        for (const exId of exerciseOrder) {
          const sets = exerciseMap.get(exId)!;
          const maxWeight = Math.max(...sets.map((s) => s.weight));
          if (maxWeight <= 0) continue;
          const maxRpe = sets.reduce((m, s) => (s.rpe && s.rpe > m ? s.rpe : m), 0);
          let next = maxWeight;
          let note = '';
          if (maxRpe === 0) { next = +(maxWeight + 2.5).toFixed(1); note = 'no RPE — try +2.5'; }
          else if (maxRpe === 1) { next = +(maxWeight + 5).toFixed(1); note = 'felt Easy — add 5 kg'; }
          else if (maxRpe === 2) { next = +(maxWeight + 2.5).toFixed(1); note = 'felt Medium — add 2.5 kg'; }
          else if (maxRpe === 3) { next = maxWeight; note = 'felt Hard — hold weight'; }
          else if (maxRpe === 4) { next = +(maxWeight - 2.5).toFixed(1); note = 'felt like a Grind — drop 2.5 kg'; }
          targets.push({ name: sets[0].exercise.name, current: maxWeight, next, note });
        }
        if (!targets.length) return null;
        return (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold">Next Session Targets</p>
            </div>
            <div className="divide-y divide-gray-800">
              {targets.map((t) => (
                <div key={t.name} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{t.name}</p>
                    <p className="text-gray-600 text-xs mt-0.5">{t.note}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={`text-sm font-bold tabular-nums ${t.next > t.current ? 'text-green-400' : t.next < t.current ? 'text-red-400' : 'text-gray-400'}`}>
                      {t.next} kg
                    </span>
                    {t.next !== t.current && (
                      <p className="text-gray-700 text-xs tabular-nums">was {t.current} kg</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Log again */}
      <Link
        href={logAgainHref}
        className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 active:bg-gray-800/80 border border-gray-700 hover:border-gray-600 rounded-2xl py-4 text-gray-300 hover:text-white text-sm font-semibold transition-all active:scale-[0.99]"
      >
        Repeat this workout &#8594;
      </Link>
    </div>
  );
}
