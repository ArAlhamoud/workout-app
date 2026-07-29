import { getBodyStats, getWorkouts } from '../actions';
import BodyStatForm from '@/components/BodyStatForm';
import DeleteBodyStatButton from '@/components/DeleteBodyStatButton';

function CalendarHeatmap({ workouts }: { workouts: { date: Date }[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const startDay = new Date(today);
  startDay.setDate(today.getDate() - today.getDay() - 77);

  const workoutDays = new Set(workouts.map((w) => new Date(w.date).toISOString().split('T')[0]));

  const weeks: Date[][] = [];
  for (let w = 0; w < 12; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(startDay);
      day.setDate(startDay.getDate() + w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div>
      <div className="flex gap-0.5">
        <div className="flex flex-col gap-0.5 mr-1">
          {dayLabels.map((l, i) => (
            <div key={i} className="h-4 w-3 flex items-center justify-end">
              <span className="text-[8px] text-app-tx3 leading-none">{i % 2 === 1 ? l : ''}</span>
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5 flex-1">
            {week.map((day, di) => {
              const key = day.toISOString().split('T')[0];
              const isFuture = day > today;
              const hasWorkout = workoutDays.has(key);
              const isToday = key === todayStr;
              return (
                <div
                  key={di}
                  title={key}
                  className={`h-4 rounded-sm ${
                    isFuture ? 'bg-app-surface' :
                    hasWorkout ? 'bg-teal-500' :
                    'bg-app-surface2'
                  } ${isToday ? 'ring-1 ring-white/30' : ''}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 mt-2">
        <span className="text-[10px] text-app-tx3">None</span>
        <div className="w-3 h-3 rounded-sm bg-app-surface2" />
        <div className="w-3 h-3 rounded-sm bg-teal-500" />
        <span className="text-[10px] text-app-tx3">Workout</span>
      </div>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(date));
}

function BodyWeightChart({ stats }: { stats: { date: Date; weight: number | null }[] }) {
  const weighted = stats.filter((s): s is { date: Date; weight: number } => s.weight !== null);
  if (weighted.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-app-tx3 text-sm">
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
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((v) => (
        <line key={v} x1={pad.left} y1={cy(v).toFixed(1)} x2={pad.left + pw} y2={cy(v).toFixed(1)} stroke="#1A2138" strokeWidth="1" />
      ))}
      {yTicks.map((v, i) => (
        <text key={i} x={pad.left - 4} y={cy(v) + 3} textAnchor="end" fill="#3D4E6E" fontSize="8">
          {Math.round(v)}
        </text>
      ))}
      <path d={areaPath} fill="url(#bodyGrad)" />
      <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {weighted.map((d, i) => (
        <circle key={i} cx={cx(i).toFixed(1)} cy={cy(d.weight).toFixed(1)} r="3" fill="#2dd4bf" />
      ))}
      <text x={pad.left} y={H - 2} textAnchor="start" fill="#3D4E6E" fontSize="8">
        {fmt(weighted[0].date)}
      </text>
      <text x={pad.left + pw} y={H - 2} textAnchor="end" fill="#3D4E6E" fontSize="8">
        {fmt(weighted[weighted.length - 1].date)}
      </text>
    </svg>
  );
}

function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function MuscleVolumeChart({ workouts }: { workouts: { sets: { weight: number; reps: number; exercise: { category: string } }[] }[] }) {
  const vol: Record<string, number> = {};
  for (const w of workouts) {
    for (const s of w.sets) {
      const cat = s.exercise.category;
      vol[cat] = (vol[cat] ?? 0) + s.weight * s.reps;
    }
  }
  const order = ['CHEST', 'BACK', 'SHOULDERS', 'LEGS', 'ARMS', 'CORE'];
  const entries = order.filter((c) => vol[c] > 0).map((c) => ({ cat: c, v: vol[c] }));
  if (!entries.length) return null;
  const max = Math.max(...entries.map((e) => e.v));
  const label: Record<string, string> = { CHEST: 'Chest', BACK: 'Back', SHOULDERS: 'Shoulders', LEGS: 'Legs', ARMS: 'Arms', CORE: 'Core' };
  const color: Record<string, string> = {
    CHEST: 'bg-blue-500', BACK: 'bg-violet-500', SHOULDERS: 'bg-cyan-500',
    LEGS: 'bg-teal-500', ARMS: 'bg-orange-500', CORE: 'bg-rose-500',
  };
  return (
    <div className="space-y-2.5">
      {entries.map(({ cat, v }) => (
        <div key={cat} className="flex items-center gap-3">
          <span className="text-app-tx2 text-xs w-20 flex-shrink-0">{label[cat]}</span>
          <div className="flex-1 bg-app-surface2 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${color[cat]}`}
              style={{ width: `${(v / max) * 100}%` }}
            />
          </div>
          <span className="text-app-tx3 text-xs tabular-nums w-14 text-right flex-shrink-0">
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)} kg
          </span>
        </div>
      ))}
    </div>
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

  const prByExercise: Record<string, { name: string; weight: number; reps: number }> = {};
  for (const w of workouts) {
    for (const s of w.sets) {
      if (s.weight > 0) {
        const existing = prByExercise[s.exerciseId];
        if (!existing || s.weight > existing.weight) {
          prByExercise[s.exerciseId] = { name: s.exercise.name, weight: s.weight, reps: s.reps };
        }
      }
    }
  }
  const topPRs = Object.values(prByExercise)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - now.getDay());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  const thisWeekVol = workouts
    .filter((w) => new Date(w.date) >= thisWeekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0), 0);
  const lastWeekVol = workouts
    .filter((w) => new Date(w.date) >= lastWeekStart && new Date(w.date) < thisWeekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0), 0);
  const volChange = lastWeekVol > 0 ? Math.round(((thisWeekVol - lastWeekVol) / lastWeekVol) * 100) : null;

  const sorted = [...workouts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const exerciseProgressions: Record<string, number[]> = {};
  for (const w of sorted) {
    const sessionMax: Record<string, number> = {};
    for (const s of w.sets) {
      if (s.weight > 0) sessionMax[s.exerciseId] = Math.max(sessionMax[s.exerciseId] ?? 0, s.weight);
    }
    for (const [id, weight] of Object.entries(sessionMax)) {
      if (!exerciseProgressions[id]) exerciseProgressions[id] = [];
      exerciseProgressions[id].push(weight);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="pt-1">
        <h1 className="text-xl font-bold text-app-tx1">Progress</h1>
        <p className="text-app-tx3 text-sm mt-0.5">Body stats & personal records</p>
      </div>

      {/* Body weight metrics */}
      {latestWeight !== null && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card p-3.5 text-center">
            <div className="text-xl font-bold text-app-tx1 tabular-nums">{latestWeight} kg</div>
            <div className="metric-label">Current</div>
          </div>
          <div className="card p-3.5 text-center">
            <div className={`text-xl font-bold tabular-nums ${
              weightChange !== null && weightChange < 0 ? 'text-teal-400' :
              weightChange !== null && weightChange > 0 ? 'text-red-400' : 'text-app-tx1'
            }`}>
              {weightChange !== null ? (weightChange > 0 ? `+${weightChange}` : `${weightChange}`) : '—'} kg
            </div>
            <div className="metric-label">Change</div>
          </div>
          <div className="card p-3.5 text-center">
            <div className="text-xl font-bold text-app-tx1 tabular-nums">{stats.length}</div>
            <div className="metric-label">Weigh-ins</div>
          </div>
        </div>
      )}

      {/* Body weight chart */}
      <div className="card-lg p-4">
        <p className="section-label mb-4">Body Weight (kg)</p>
        <BodyWeightChart stats={stats} />
      </div>

      {/* Heatmap */}
      <div className="card-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="section-label">Consistency · 12 weeks</p>
          <span className="text-[11px] text-app-tx3">{workouts.length} sessions total</span>
        </div>
        <CalendarHeatmap workouts={workouts} />
      </div>

      {/* Week volume comparison */}
      {(thisWeekVol > 0 || lastWeekVol > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="card p-4">
            <div className="metric-value">
              {thisWeekVol >= 1000 ? `${(thisWeekVol / 1000).toFixed(1)}k` : Math.round(thisWeekVol)}
              <span className="text-app-tx3 text-sm font-semibold ml-0.5">kg</span>
            </div>
            <div className="metric-label">This week</div>
          </div>
          <div className="card p-4">
            <div className={`metric-value ${
              volChange === null ? 'text-app-tx3' :
              volChange > 0 ? 'text-teal-400' :
              volChange < 0 ? 'text-red-400' : 'text-app-tx1'
            }`}>
              {lastWeekVol >= 1000 ? `${(lastWeekVol / 1000).toFixed(1)}k` : Math.round(lastWeekVol)}
              <span className="text-app-tx3 text-sm font-semibold ml-0.5">kg</span>
              {volChange !== null && (
                <span className="text-sm font-bold ml-1">
                  {volChange > 0 ? `+${volChange}%` : volChange < 0 ? `${volChange}%` : '='}
                </span>
              )}
            </div>
            <div className="metric-label">Last week</div>
          </div>
        </div>
      )}

      {/* Volume by muscle group */}
      <div className="card-lg p-4">
        <p className="section-label mb-4">Volume by Muscle Group</p>
        <MuscleVolumeChart workouts={workouts} />
      </div>

      {/* Workout totals */}
      <div className="card-lg p-4">
        <p className="section-label mb-4">Workout Totals</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { value: workouts.length.toString(), label: 'Sessions' },
            { value: totalSets.toString(), label: 'Sets' },
            { value: totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume).toString(), label: 'kg Vol' },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-xl font-bold text-app-tx1 tabular-nums">{s.value}</div>
              <div className="text-[11px] text-app-tx3 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Personal records */}
      {topPRs.length > 0 && (
        <div>
          <p className="section-label mb-3">Personal Records</p>
          <div className="space-y-2">
            {topPRs.map((pr) => {
              const progression = exerciseProgressions[
                Object.keys(prByExercise).find((id) => prByExercise[id].name === pr.name) ?? ''
              ] ?? [];
              const uniqueWeights = [...new Set(progression)];
              const progressStr = uniqueWeights.length > 1
                ? uniqueWeights.length <= 3
                  ? uniqueWeights.join(' → ')
                  : `${uniqueWeights[0]} → … → ${uniqueWeights[uniqueWeights.length - 1]}`
                : null;
              return (
                <div
                  key={pr.name}
                  className="card flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <span className="text-app-tx1 text-sm font-medium">{pr.name}</span>
                    {progressStr && (
                      <p className="text-app-tx3 text-xs mt-0.5 tabular-nums">{progressStr} kg</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-yellow-400 font-bold text-sm tabular-nums">{pr.weight} kg</div>
                    {pr.reps > 1 && epley1RM(pr.weight, pr.reps) > pr.weight && (
                      <div className="text-app-tx3 text-xs tabular-nums">~{epley1RM(pr.weight, pr.reps)} kg 1RM</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Log body stat */}
      <BodyStatForm />

      {/* Weigh-in history */}
      {stats.length > 0 && (
        <div>
          <p className="section-label mb-3">Weigh-in History</p>
          <div className="space-y-2">
            {[...stats].reverse().slice(0, 10).map((s) => (
              <div key={s.id} className="card flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-app-tx1 text-sm font-medium">
                    {s.weight !== null ? `${s.weight} kg` : '—'}
                  </span>
                  {s.waist !== null && (
                    <span className="text-app-tx3 text-xs ml-2">· {s.waist} cm waist</span>
                  )}
                  {s.arms !== null && (
                    <span className="text-app-tx3 text-xs ml-2">· {s.arms} cm arms</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-app-tx3 text-xs">{formatDate(s.date)}</span>
                  <DeleteBodyStatButton statId={s.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
