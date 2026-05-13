import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkout } from '../../actions';
import DeleteButton from '@/components/DeleteButton';
import WorkoutComplete from '@/components/WorkoutComplete';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const categoryColor: Record<string, string> = {
  CHEST: 'text-blue-400 bg-blue-900/30 border-blue-800/40',
  BACK: 'text-violet-400 bg-violet-900/30 border-violet-800/40',
  LEGS: 'text-green-400 bg-green-900/30 border-green-800/40',
  SHOULDERS: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/40',
  ARMS: 'text-orange-400 bg-orange-900/30 border-orange-800/40',
  CORE: 'text-pink-400 bg-pink-900/30 border-pink-800/40',
};

export default async function WorkoutDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const workout = await getWorkout(params.id);
  if (!workout) notFound();

  const isNew = searchParams.new === '1';

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
  const logAgainHref = dayMatch
    ? `/workouts/new?day=${dayMatch[1].toUpperCase()}`
    : '/workouts/new';

  return (
    <div className="space-y-5">
      {isNew && (
        <WorkoutComplete
          exerciseCount={exerciseOrder.length}
          setCount={workout.sets.length}
          volume={totalVolume}
          duration={workout.duration}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/workouts"
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors inline-flex items-center gap-1 mb-2"
          >
            ← History
          </Link>
          <h1 className="text-xl font-bold text-white leading-tight">{workout.name}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{formatDate(workout.date)}</p>
        </div>
        <DeleteButton workoutId={workout.id} />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
          <div className="text-lg font-bold text-white">{exerciseOrder.length}</div>
          <div className="text-gray-600 text-xs mt-0.5">Exercises</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
          <div className="text-lg font-bold text-white">{workout.sets.length}</div>
          <div className="text-gray-600 text-xs mt-0.5">Sets</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
          <div className="text-lg font-bold text-white">
            {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume.toLocaleString()}
          </div>
          <div className="text-gray-600 text-xs mt-0.5">kg Vol.</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3 text-center border border-gray-800">
          <div className="text-lg font-bold text-white">
            {workout.duration ? formatDuration(workout.duration) : '—'}
          </div>
          <div className="text-gray-600 text-xs mt-0.5">Duration</div>
        </div>
      </div>

      {workout.notes && (
        <div className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Notes</p>
          <p className="text-gray-300 text-sm">{workout.notes}</p>
        </div>
      )}

      <div className="space-y-3">
        {exerciseOrder.map((exId) => {
          const sets = exerciseMap.get(exId)!;
          const exercise = sets[0].exercise;
          const colorClass = categoryColor[exercise.category] ?? 'text-gray-400 bg-gray-800 border-gray-700';
          const exVolume = sets.reduce((s, set) => s + set.reps * set.weight, 0);
          const isCore = exercise.category === 'CORE';
          const best1RM = isCore
            ? 0
            : sets.reduce((best, s) => Math.max(best, epley1RM(s.weight, s.reps)), 0);

          return (
            <div key={exId} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Link
                    href={`/progress/${exId}`}
                    className="font-semibold text-white text-sm truncate hover:text-blue-400 transition-colors"
                  >
                    {exercise.name}
                  </Link>
                  <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${colorClass}`}>
                    {exercise.category}
                  </span>
                </div>
                <div className="text-right ml-2 flex-shrink-0">
                  {exVolume > 0 ? (
                    <span className="text-gray-600 text-xs">{exVolume.toLocaleString()} kg</span>
                  ) : (
                    <span className="text-gray-600 text-xs">{sets.length} sets</span>
                  )}
                  {best1RM > 0 && (
                    <div className="text-gray-700 text-xs mt-0.5">~{best1RM} kg 1RM</div>
                  )}
                </div>
              </div>

              <div className="px-4 py-3 space-y-2">
                <div className="grid grid-cols-4 text-xs text-gray-600 font-semibold uppercase tracking-wide">
                  <span>Set</span>
                  <span>{isCore ? 'Duration' : 'Weight'}</span>
                  <span>{isCore ? '' : 'Reps'}</span>
                  <span className="text-right">{isCore ? '' : 'Vol.'}</span>
                </div>
                {sets.map((set) => (
                  <div key={set.id}>
                    <div className="grid grid-cols-4 text-sm items-center">
                      <span className="text-gray-600 tabular-nums">{set.setNumber}</span>
                      {isCore ? (
                        <span className="text-white tabular-nums col-span-3">
                          {set.reps < 60 ? `${set.reps}s` : `${Math.floor(set.reps / 60)}:${String(set.reps % 60).padStart(2, '0')}`}
                        </span>
                      ) : (
                        <>
                          <span className="text-white tabular-nums">{set.weight} kg</span>
                          <span className="text-white tabular-nums">{set.reps}</span>
                          <span className="text-gray-600 text-xs text-right tabular-nums">
                            {set.reps * set.weight > 0
                              ? `${(set.reps * set.weight).toFixed(0)} kg`
                              : '—'}
                          </span>
                        </>
                      )}
                    </div>
                    {set.notes && (
                      <p className="text-gray-600 text-xs mt-0.5 italic">{set.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href={logAgainHref}
        className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-2xl py-3.5 text-gray-300 hover:text-white text-sm font-medium transition-colors"
      >
        Repeat this workout →
      </Link>
    </div>
  );
}
