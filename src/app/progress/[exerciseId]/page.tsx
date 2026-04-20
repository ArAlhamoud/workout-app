import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getExerciseHistory } from '@/app/actions';
import ProgressChart from '@/components/ProgressChart';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(date),
  );
}

const categoryColor: Record<string, string> = {
  CHEST: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
  BACK: 'bg-violet-900/40 text-violet-300 border-violet-800/40',
  LEGS: 'bg-green-900/40 text-green-300 border-green-800/40',
  SHOULDERS: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/40',
  ARMS: 'bg-orange-900/40 text-orange-300 border-orange-800/40',
  CORE: 'bg-pink-900/40 text-pink-300 border-pink-800/40',
};

export default async function ProgressPage({ params }: { params: { exerciseId: string } }) {
  const result = await getExerciseHistory(params.exerciseId);
  if (!result) notFound();

  const { exercise, history, pr, totalSessions } = result;
  const colorClass = categoryColor[exercise.category] ?? 'bg-gray-800 text-gray-300 border-gray-700';

  const latestWeight = history.at(-1)?.maxWeight ?? 0;
  const firstWeight = history[0]?.maxWeight ?? 0;
  const improvement =
    firstWeight > 0 ? Math.round(((latestWeight - firstWeight) / firstWeight) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/program"
          className="text-gray-500 hover:text-gray-300 text-sm inline-flex items-center gap-1 mb-2 transition-colors"
        >
          ← Program
        </Link>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl font-bold text-white">{exercise.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${colorClass}`}>
            {exercise.category}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
          <div className="text-xl font-bold text-yellow-400">{pr > 0 ? `${pr} kg` : '—'}</div>
          <div className="text-gray-600 text-xs mt-0.5">Best Lift</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
          <div className="text-xl font-bold text-white">{totalSessions}</div>
          <div className="text-gray-600 text-xs mt-0.5">Sessions</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
          <div className={`text-xl font-bold ${improvement > 0 ? 'text-green-400' : 'text-gray-500'}`}>
            {improvement > 0 ? `+${improvement}%` : '—'}
          </div>
          <div className="text-gray-600 text-xs mt-0.5">Improvement</div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-4">
          Weight Progress (kg)
        </p>
        <ProgressChart data={history} />
      </div>

      {/* Session history */}
      {history.length > 0 && (
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
            Session History
          </p>
          <div className="space-y-2">
            {[...history].reverse().map((h, i) => {
              const isPR = h.maxWeight === pr && pr > 0;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3 border border-gray-800"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">{h.maxWeight} kg</span>
                      {isPR && i === 0 && (
                        <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-800/40">
                          🏆 PR
                        </span>
                      )}
                    </div>
                    <div className="text-gray-600 text-xs mt-0.5">{h.sessionName}</div>
                  </div>
                  <div className="text-gray-500 text-xs">{formatDate(h.date)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
