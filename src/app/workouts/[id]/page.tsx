import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkout } from '../../actions';
import DeleteButton from '@/components/DeleteButton';
import { CATEGORY_BADGE, formatDateLong, formatDuration, kgCompact, RPE_LABELS } from '@/lib/format';

/* Effort spectrum — Easy teal-green, Med amber, Hard orange, Grind magenta */
const rpeBadge: Record<number, { label: string; cls: string }> = {
  1: { label: RPE_LABELS[1], cls: 'text-rpe-easy bg-rpe-easy/10 border-rpe-easy/30' },
  2: { label: RPE_LABELS[2], cls: 'text-rpe-med bg-rpe-med/10 border-rpe-med/30' },
  3: { label: RPE_LABELS[3], cls: 'text-rpe-hard bg-rpe-hard/10 border-rpe-hard/30' },
  4: { label: RPE_LABELS[4], cls: 'text-rpe-grind bg-rpe-grind/10 border-rpe-grind/30' },
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
  const dayLetter = dayMatch?.[1]?.toUpperCase();
  const durMatch = workout.name.match(/(\d+)m/);
  const logAgainHref = dayLetter
    ? `/workouts/new?day=${dayLetter}${durMatch ? `&dur=${durMatch[1]}` : ''}`
    : '/workouts/new';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          <Link
            href="/workouts"
            className="text-app-tx3 hover:text-app-tx2 text-sm transition-colors inline-flex items-center gap-1 mb-2"
          >
            ← History
          </Link>
          <div className="flex items-center gap-3">
            {dayLetter && (
              <span className={`font-round text-[17px] font-extrabold w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                dayLetter === 'A'
                  ? 'bg-acc-violet-deep/15 border-acc-violet/30 glow-violet shadow-glow-violet'
                  : 'bg-acc-teal-deep/15 border-acc-teal/30 glow-teal shadow-glow-teal'
              }`}>
                {dayLetter}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold font-round tracking-tight leading-tight bg-clip-text text-transparent bg-[linear-gradient(100deg,#ffffff_20%,#c7d2fe_60%,#99f6e4_100%)]">
                {workout.name}
              </h1>
              <p className="text-app-tx3 text-sm mt-0.5">{formatDateLong(workout.date)}</p>
            </div>
          </div>
        </div>
        <DeleteButton workoutId={workout.id} />
      </div>

      {/* Stats row */}
      <div className={`grid gap-2 ${workout.duration ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {[
          { value: exerciseOrder.length.toString(), label: 'Exercises', accent: 'glow-violet' },
          { value: workout.sets.length.toString(), label: 'Sets', accent: 'glow-cyan' },
          {
            value: kgCompact(totalVolume),
            label: 'kg Vol',
            accent: 'glow-teal',
          },
          ...(workout.duration
            ? [{ value: formatDuration(workout.duration), label: 'Duration', accent: 'text-app-tx1' }]
            : []),
        ].map((s) => (
          <div key={s.label} className="card p-3 text-center">
            <div className={`text-xl font-light font-round tabular-nums ${s.accent}`}>{s.value}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-app-tx3 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {workout.notes && (
        <div className="card px-4 py-3">
          <p className="section-label mb-1">Notes</p>
          <p className="text-app-tx2 text-sm">{workout.notes}</p>
        </div>
      )}

      {/* Exercise list */}
      <div className="space-y-3">
        {exerciseOrder.map((exId) => {
          const sets = exerciseMap.get(exId)!;
          const exercise = sets[0].exercise;
          const colorClass = CATEGORY_BADGE[exercise.category] ?? 'text-app-tx2 bg-app-surface2 border-app-border';
          const exVolume = sets.reduce((s, set) => s + set.reps * set.weight, 0);

          return (
            <div key={exId} className="card-lg overflow-hidden">
              {/* Exercise header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-semibold text-app-tx1 text-sm truncate">{exercise.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 font-bold uppercase tracking-[0.08em] ${colorClass}`}>
                    {exercise.category}
                  </span>
                </div>
                <span className="text-app-tx3 text-xs flex-shrink-0 ml-2">
                  {exVolume > 0 ? `${exVolume.toLocaleString()} kg` : `${sets.length} sets`}
                </span>
              </div>

              {/* Set rows */}
              <div className="px-4 py-3 space-y-1.5">
                <div className="grid grid-cols-3 text-[10px] text-app-tx3 font-semibold uppercase tracking-wide mb-2">
                  <span>Set</span>
                  <span>Weight × Reps</span>
                  <span className="text-right">Volume</span>
                </div>
                {sets.map((set) => {
                  const rpe = set.rpe ? rpeBadge[set.rpe] : null;
                  return (
                    <div key={set.id} className="grid grid-cols-3 text-sm items-center py-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-app-tx3 tabular-nums w-4 text-center">{set.setNumber}</span>
                        {rpe && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold leading-none ${rpe.cls}`}>
                            {rpe.label}
                          </span>
                        )}
                      </div>
                      <span className="text-app-tx1 tabular-nums">
                        {set.weight > 0 ? `${set.weight} kg` : '—'}
                        <span className="text-app-tx3 mx-1">×</span>
                        {set.reps}
                      </span>
                      <span className="text-app-tx3 text-xs text-right tabular-nums">
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
          if (maxRpe === 0)      { next = +(maxWeight + 2.5).toFixed(1); note = 'No RPE — try +2.5 kg'; }
          else if (maxRpe === 1) { next = +(maxWeight + 5).toFixed(1);   note = 'Easy — add 5 kg'; }
          else if (maxRpe === 2) { next = +(maxWeight + 2.5).toFixed(1); note = 'Medium — add 2.5 kg'; }
          else if (maxRpe === 3) { next = maxWeight;                      note = 'Hard — hold weight'; }
          else if (maxRpe === 4) { next = +(maxWeight - 2.5).toFixed(1); note = 'Grind — drop 2.5 kg'; }
          targets.push({ name: sets[0].exercise.name, current: maxWeight, next, note });
        }
        if (!targets.length) return null;
        return (
          <div className="card-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-app-border">
              <p className="section-label">Next Session Targets</p>
            </div>
            <div className="divide-y divide-app-border">
              {targets.map((t) => (
                <div key={t.name} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-app-tx1 text-sm font-medium truncate">{t.name}</p>
                    <p className="text-app-tx3 text-xs mt-0.5">{t.note}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {/* raise = teal glow · hold = neutral · drop = magenta */}
                    <span className={`text-sm font-semibold font-round tabular-nums ${
                      t.next > t.current
                        ? 'glow-teal'
                        : t.next < t.current
                          ? 'text-rpe-grind [text-shadow:0_0_14px_rgba(244,63,94,0.4)]'
                          : 'text-app-tx2'
                    }`}>
                      {t.next} kg
                    </span>
                    {t.next !== t.current && (
                      <p className="text-app-tx3 text-xs tabular-nums">was {t.current} kg</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Repeat workout */}
      <Link
        href={logAgainHref}
        className="w-full flex items-center justify-center gap-2 btn-ghost rounded-card-lg py-4 text-sm font-semibold transition-all active:scale-[0.99]"
      >
        Repeat this workout →
      </Link>
    </div>
  );
}
