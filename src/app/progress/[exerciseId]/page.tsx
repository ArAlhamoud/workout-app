import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getExerciseHistory } from '@/app/actions';
import ProgressChart from '@/components/ProgressChart';
import { CATEGORY_BADGE, formatDateShort } from '@/lib/format';

export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: { exerciseId: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // Per-gym chart with an explicit switch — pooling minted false PRs, but
  // hiding Alrajhi history entirely was the steward's objection to the fix.
  const rawGym = Array.isArray(searchParams?.gym) ? searchParams?.gym[0] : searchParams?.gym;
  const gym = rawGym === 'work' ? 'work' : 'bfit';
  const result = await getExerciseHistory(params.exerciseId, gym);
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
          <div className="mt-2 flex gap-2">
            {[
              { id: 'bfit', label: 'B_Fit' },
              { id: 'work', label: 'Alrajhi' },
            ].map((g) => (
              <Link
                key={g.id}
                href={`?gym=${g.id}`}
                className={`chip border transition-colors ${
                  gym === g.id
                    ? 'border-acc-teal/50 bg-acc-teal/10 text-acc-teal'
                    : 'border-app-border bg-app-surface2 text-app-tx3 hover:text-app-tx2'
                }`}
              >
                {g.label}
              </Link>
            ))}
          </div>
          <span className={`chip border ${colorClass}`}>{exercise.category}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3.5 text-center">
          <div className="text-xl font-light font-round tabular-nums glow-gold">{pr > 0 ? `${pr} kg` : '—'}</div>
          <div className="metric-label">Best Lift</div>
        </div>
        <div className="card p-3.5 text-center">
          <div className="text-xl font-light font-round tabular-nums text-app-tx1">{totalSessions}</div>
          <div className="metric-label">Sessions</div>
        </div>
        <div className="card p-3.5 text-center">
          <div className={`text-xl font-light font-round tabular-nums ${improvement > 0 ? 'glow-teal' : 'text-app-tx3'}`}>
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
                      <span className={`text-sm font-medium tabular-nums ${isPR ? 'glow-gold' : 'text-app-tx1'}`}>
                        {h.maxWeight} kg
                      </span>
                      {isPR && (
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] bg-acc-gold/10 text-acc-gold px-2 py-0.5 rounded-full border border-acc-gold/30 shadow-glow-gold">
                          PR
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
