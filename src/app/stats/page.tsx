import { getBodyStats, getWorkouts } from '../actions';
import BodyStatForm from '@/components/BodyStatForm';
import DeleteBodyStatButton from '@/components/DeleteBodyStatButton';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(date));
}

function BodyWeightChart({ stats }: { stats: { date: Date; weight: number | null }[] }) {
  const weighted = stats.filter((s): s is { date: Date; weight: number } => s.weight !== null);
  if (weighted.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-600 text-sm">
        Log 2+ weigh-ins to see your chart
      </div>
    );
  }

  const W = 320;
  const H = 100;
  const pad = { top: 8, right: 8, bottom: 20, left: 36 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const weights = weighted.map((d) => d.weight);
  const minW = Math.min(...weights) - 1;
  const maxW = Math.max(...weights) + 1;
  const range = maxW - minW;

  const cx = (i: number) => pad.left + (i / (weighted.length - 1)) * pw;
  const cy = (w: number) => pad.top + ph - ((w - minW) / range) * ph;

  const linePath = weighted
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${cy(d.weight).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${cx(weighted.length - 1).toFixed(1)} ${(pad.top + ph).toFixed(1)} L ${pad.left} ${(pad.top + ph).toFixed(1)} Z`;

  const yTicks = [minW + 1, minW + range / 2, maxW - 1];
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((v) => (
        <line key={v} x1={pad.left} y1={cy(v).toFixed(1)} x2={pad.left + pw} y2={cy(v).toFixed(1)} stroke="#1f2937" strokeWidth="1" />
      ))}
      {yTicks.map((v, i) => (
        <text key={i} x={pad.left - 4} y={cy(v) + 3} textAnchor="end" fill="#4b5563" fontSize="8">
          {Math.round(v)}
        </text>
      ))}
      <path d={areaPath} fill="url(#bodyGrad)" />
      <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {weighted.map((d, i) => (
        <circle key={i} cx={cx(i).toFixed(1)} cy={cy(d.weight).toFixed(1)} r="3" fill="#10b981" />
      ))}
      <text x={pad.left} y={H - 2} textAnchor="start" fill="#4b5563" fontSize="8">
        {fmt(weighted[0].date)}
      </text>
      <text x={pad.left + pw} y={H - 2} textAnchor="end" fill="#4b5563" fontSize="8">
        {fmt(weighted[weighted.length - 1].date)}
      </text>
    </svg>
  );
}

export default async function StatsPage() {
  const [stats, workouts] = await Promise.all([getBodyStats(), getWorkouts()]);

  const latestWeight = [...stats].reverse().find((s) => s.weight !== null)?.weight ?? null;
  const firstWeight = stats.find((s) => s.weight !== null)?.weight ?? null;
  const weightChange =
    latestWeight !== null && firstWeight !== null ? +(latestWeight - firstWeight).toFixed(1) : null;

  const totalVolume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );
  const totalSets = workouts.reduce((n, w) => n + w.sets.length, 0);

  const prByExercise: Record<string, { name: string; weight: number }> = {};
  for (const w of workouts) {
    for (const s of w.sets) {
      if (s.weight > 0) {
        const existing = prByExercise[s.exerciseId];
        if (!existing || s.weight > existing.weight) {
          prByExercise[s.exerciseId] = { name: s.exercise.name, weight: s.weight };
        }
      }
    }
  }
  const topPRs = Object.values(prByExercise)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Progress</h1>
        <p className="text-gray-500 text-sm mt-1">Body stats & personal records</p>
      </div>

      {latestWeight !== null && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">{latestWeight} kg</div>
            <div className="text-gray-600 text-xs mt-0.5">Current</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className={`text-xl font-bold ${weightChange !== null && weightChange < 0 ? 'text-green-400' : weightChange !== null && weightChange > 0 ? 'text-red-400' : 'text-white'}`}>
              {weightChange !== null ? (weightChange > 0 ? `+${weightChange}` : `${weightChange}`) : '—'} kg
            </div>
            <div className="text-gray-600 text-xs mt-0.5">Change</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3.5 text-center border border-gray-800">
            <div className="text-xl font-bold text-white">{stats.length}</div>
            <div className="text-gray-600 text-xs mt-0.5">Weigh-ins</div>
          </div>
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-4">
          Body Weight (kg)
        </p>
        <BodyWeightChart stats={stats} />
      </div>

      <BodyStatForm />

      {stats.length > 0 && (
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
            Weigh-in History
          </p>
          <div className="space-y-2">
            {[...stats].reverse().slice(0, 10).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3 border border-gray-800"
              >
                <div>
                  <span className="text-white text-sm font-medium">
                    {s.weight !== null ? `${s.weight} kg` : '—'}
                  </span>
                  {s.waist !== null && (
                    <span className="text-gray-500 text-xs ml-2">· {s.waist} cm waist</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-xs">{formatDate(s.date)}</span>
                  <DeleteBodyStatButton statId={s.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
          Workout Totals
        </p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xl font-bold text-white">{workouts.length}</div>
            <div className="text-gray-600 text-xs">Sessions</div>
          </div>
          <div>
            <div className="text-xl font-bold text-white">{totalSets}</div>
            <div className="text-gray-600 text-xs">Sets</div>
          </div>
          <div>
            <div className="text-xl font-bold text-white">
              {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)}
            </div>
            <div className="text-gray-600 text-xs">kg Volume</div>
          </div>
        </div>
      </div>

      {topPRs.length > 0 && (
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-3">
            Personal Records
          </p>
          <div className="space-y-2">
            {topPRs.map((pr) => (
              <div
                key={pr.name}
                className="flex items-center justify-between bg-gray-900 rounded-xl px-4 py-3 border border-gray-800"
              >
                <span className="text-white text-sm">{pr.name}</span>
                <span className="text-yellow-400 font-bold text-sm tabular-nums">{pr.weight} kg</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
