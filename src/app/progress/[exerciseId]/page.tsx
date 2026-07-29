import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getExerciseHistory } from '@/app/actions';
import ProgressChart from '@/components/ProgressChart';
import { CATEGORY_BADGE, formatDateShort } from '@/lib/format';

export default async function ProgressPage({ params }: { params: { exerciseId: string } }) {
  const result = await getExerciseHistory(params.exerciseId);
  if (!result) notFound();

  const { exercise, history, pr, totalSessions } = result;
  const colorClass = CATEGORY_BADGE[exercise.category] ?? 'text-app-tx2 bg-app-surface2 border-app-border';

  const latestWeight = history.at(-1)?.maxWeight ?? 0;
  const firstWeight = history[0]?.maxWeight ?? 0;
  const improvement =
    firstWeight > 0 ? Math.round(((latestWeight - firstWeight) / firstWeight) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="pt-1">
        <Link
          href="/program"
          className="text-app-tx3 hover:text-app-tx2 text-sm transition-colors inline-flex items-center gap-1 mb-2"
        >
          ← Program
        </Link>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl font-bold text-app-tx1">{exercise.name}</h1>
          <span className={`chip border ${colorClass}`}>{exercise.category}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3.5 text-center">
          <div className="text-xl font-bold text-yellow-400 tabular-nums">{pr > 0 ? `${pr} kg` : '—'}</div>
          <div className="metric-label">Best Lift</div>
        </div>
        <div className="card p-3.5 text-center">
          <div className="text-xl font-bold text-app-tx1 tabular-nums">{totalSessions}</div>
          <div className="metric-label">Sessions</div>
        </div>
        <div className="card p-3.5 text-center">
          <div className={`text-xl font-bold tabular-nums ${improvement > 0 ? 'text-teal-400' : 'text-app-tx3'}`}>
            {improvement > 0 ? `+${improvement}%` : '—'}
          </div>
          <div className="metric-label">Improvement</div>
        </div>
      </div>

      {/* Chart */}
      <div className="card-lg p-4">
        <p className="section-label mb-4">Weight Progress (kg)</p>
        <ProgressChart data={history} />
      </div>

      {/* Session history */}
      {history.length > 0 && (
        <div>
          <p className="section-label mb-3">Session History</p>
          <div className="space-y-2">
            {[...history].reverse().map((h, i) => {
              const isPR = h.maxWeight === pr && pr > 0;
              return (
                <div
                  key={i}
                  className="card flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-app-tx1 text-sm font-medium tabular-nums">{h.maxWeight} kg</span>
                      {isPR && (
                        <span className="text-xs bg-yellow-900/30 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-800/40">
                          🏆 PR
                        </span>
                      )}
                    </div>
                    <div className="text-app-tx3 text-xs mt-0.5">{h.sessionName}</div>
                  </div>
                  <div className="text-app-tx3 text-xs">{formatDateShort(h.date)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
