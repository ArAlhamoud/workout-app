import type { Metadata } from 'next';
import { getBodyStats, getWorkouts } from '../actions';
import BodyStatForm from '@/components/BodyStatForm';
import DeleteBodyStatButton from '@/components/DeleteBodyStatButton';
import { effortDistribution, weeklyReport, type EffortDistribution, type Rpe } from '@/lib/coach';
import { getTrainingStatus } from '@/lib/program';
import { epley1RM, formatDateShort, getMondayOfWeek, kgCompact, RPE_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Progress' };

/* Effort spectrum — Easy=teal, Med=amber, Hard=orange, Grind=magenta */
const RPE_BAR_COLORS: Record<Rpe, string> = {
  1: 'bg-rpe-easy',
  2: 'bg-rpe-med',
  3: 'bg-rpe-hard',
  4: 'bg-rpe-grind',
};
/* Lit rungs of the effort-ceiling ladder */
const RPE_RUNG_LIT: Record<Rpe, string> = {
  1: 'border-rpe-easy/40 bg-rpe-easy/10 text-rpe-easy',
  2: 'border-rpe-med/40 bg-rpe-med/10 text-rpe-med',
  3: 'border-rpe-hard/40 bg-rpe-hard/10 text-rpe-hard',
  4: 'border-rpe-grind/40 bg-rpe-grind/10 text-rpe-grind',
};
const RPE_VALUES: Rpe[] = [1, 2, 3, 4];

/* Quiet aurora disclosure — the glance stays clean, detail lives one tap away */
function Details({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={`group ${className}`}>
      <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3 transition-colors hover:text-app-tx2 [&::-webkit-details-marker]:hidden">
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="transition-transform duration-200 group-open:rotate-180"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

function EffortBalanceRow({ effort, rpeCap }: { effort: EffortDistribution; rpeCap: number | null }) {
  if (!effort.total) {
    return <p className="text-app-tx3 text-xs">Tag your sets with RPE to see effort balance.</p>;
  }
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-app-surface2">
        {RPE_VALUES.map((r) =>
          effort.share[r] > 0 ? (
            <div
              key={r}
              className={RPE_BAR_COLORS[r]}
              style={{ width: `${effort.share[r] * 100}%` }}
            />
          ) : null,
        )}
      </div>
      {/* Effort-ceiling lockout ladder — doubles as the legend. While the return
          protocol is active, rungs above the cap sit unlit like locked switches. */}
      <div className="grid grid-cols-4 gap-1.5 mt-3">
        {RPE_VALUES.map((r) => {
          const locked = rpeCap !== null && r > rpeCap;
          const isCap = rpeCap === r;
          return (
            <div
              key={r}
              className={`relative rounded-lg border px-1 py-1.5 text-center ${
                locked ? 'border-app-border/70' : RPE_RUNG_LIT[r]
              }`}
            >
              {isCap && (
                <span className="absolute -top-2 right-1 text-[7.5px] font-extrabold tracking-[0.1em] px-1 py-px rounded-sm text-[#1a1206] bg-acc-ember shadow-glow-ember">
                  CAP
                </span>
              )}
              <div
                className={`text-[9px] font-bold uppercase tracking-[0.14em] ${
                  locked ? 'text-app-tx3/60 line-through' : ''
                }`}
              >
                {RPE_LABELS[r]}
              </div>
              <div
                className={`text-[10px] tabular-nums mt-0.5 ${
                  locked ? 'text-app-tx3/60' : 'text-app-tx2'
                }`}
              >
                {Math.round(effort.share[r] * 100)}%
              </div>
            </div>
          );
        })}
      </div>
      {rpeCap !== null && (
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-acc-ember/90">
            We rebuild. We don&rsquo;t test.
          </span>
          <span className="text-[10px] text-app-tx3">
            Ceiling · <b className="text-acc-ember font-semibold">{RPE_LABELS[rpeCap as Rpe]}</b>
          </span>
        </div>
      )}
    </div>
  );
}

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
                    hasWorkout ? 'bg-acc-teal-deep shadow-[0_0_7px_rgba(45,212,191,0.55)]' :
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
        <div className="w-3 h-3 rounded-sm bg-acc-teal-deep shadow-[0_0_7px_rgba(45,212,191,0.55)]" />
        <span className="text-[10px] text-app-tx3">Workout</span>
      </div>
    </div>
  );
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
      {yTicks.map((v, i) => (
        <line key={i} x1={pad.left} y1={cy(v).toFixed(1)} x2={pad.left + pw} y2={cy(v).toFixed(1)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      ))}
      {yTicks.map((v, i) => (
        <text key={i} x={pad.left - 4} y={cy(v) + 3} textAnchor="end" fill="rgba(206,213,248,0.45)" fontSize="8">
          {Math.round(v)}
        </text>
      ))}
      <path d={areaPath} fill="url(#bodyGrad)" />
      <path d={linePath} fill="none" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {weighted.slice(0, -1).map((d, i) => (
        <circle key={i} cx={cx(i).toFixed(1)} cy={cy(d.weight).toFixed(1)} r="2.4" fill="#5eead4" opacity="0.85" />
      ))}
      {/* glow dot endpoint — the latest weigh-in is the brightest object */}
      <circle
        cx={cx(weighted.length - 1).toFixed(1)}
        cy={cy(weighted[weighted.length - 1].weight).toFixed(1)}
        r="7"
        fill="#5eead4"
        opacity="0.25"
      />
      <circle
        cx={cx(weighted.length - 1).toFixed(1)}
        cy={cy(weighted[weighted.length - 1].weight).toFixed(1)}
        r="3.4"
        fill="#99f6e4"
      />
      <text x={pad.left} y={H - 2} textAnchor="start" fill="rgba(206,213,248,0.45)" fontSize="8">
        {fmt(weighted[0].date)}
      </text>
      <text x={pad.left + pw} y={H - 2} textAnchor="end" fill="rgba(206,213,248,0.45)" fontSize="8">
        {fmt(weighted[weighted.length - 1].date)}
      </text>
    </svg>
  );
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
  // Per-muscle hues tuned to the aurora palette (indigo→violet→cyan→teal + warm accents)
  const color: Record<string, string> = {
    CHEST: '#818cf8', BACK: '#a78bfa', SHOULDERS: '#67e8f9',
    LEGS: '#5eead4', ARMS: '#fb923c', CORE: '#fb7185',
  };
  return (
    <div className="space-y-2.5">
      {entries.map(({ cat, v }) => (
        <div key={cat} className="flex items-center gap-3">
          <span className="text-app-tx2 text-xs w-20 flex-shrink-0">{label[cat]}</span>
          <div className="flex-1 bg-app-surface2 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(v / max) * 100}%`,
                background: `linear-gradient(90deg, ${color[cat]}b3, ${color[cat]})`,
                boxShadow: `0 0 10px -2px ${color[cat]}`,
              }}
            />
          </div>
          <span className="text-app-tx3 text-xs tabular-nums w-14 text-right flex-shrink-0">
            {kgCompact(v)} kg
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
  const topPRs = Object.entries(prByExercise)
    .map(([exerciseId, pr]) => ({ exerciseId, ...pr }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  // Monday-start weeks
  const thisWeekStart = getMondayOfWeek(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  const thisWeekVol = workouts
    .filter((w) => new Date(w.date) >= thisWeekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0), 0);
  const lastWeekVol = workouts
    .filter((w) => new Date(w.date) >= lastWeekStart && new Date(w.date) < thisWeekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0), 0);
  const volChange = lastWeekVol > 0 ? Math.round(((thisWeekVol - lastWeekVol) / lastWeekVol) * 100) : null;

  // Coach intelligence
  const status = getTrainingStatus(workouts.map((w) => w.date));
  const report = weeklyReport(workouts, stats, status);
  const effort = effortDistribution(workouts);

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
        <h1 className="text-xl font-bold font-round bg-gradient-to-r from-white via-indigo-200 to-teal-200 bg-clip-text text-transparent">
          Progress
        </h1>
      </div>

      {/* Coach report */}
      {workouts.length > 0 && (
        <div className="card-lg p-4">
          <p className={`section-label mb-2 ${status.mode === 'return' ? 'text-acc-ember/85' : ''}`}>
            {status.mode === 'return' ? 'Coach Directive' : 'Coach Report'}
          </p>
          <p
            className={`font-bold text-sm leading-snug ${
              status.mode === 'return' ? 'glow-amber' : 'text-app-tx1'
            }`}
          >
            {report.headline}
          </p>
          {/* Glance: the strongest win and the strongest focus — everything else one tap away */}
          {(report.wins.length > 0 || report.focus.length > 0) && (
            <div className="mt-3 space-y-1.5">
              {report.wins.slice(0, 1).map((win, i) => (
                <p key={i} className="text-app-tx2 text-xs leading-relaxed flex gap-2">
                  <span className="text-acc-teal font-bold flex-shrink-0">✓</span>
                  <span>{win}</span>
                </p>
              ))}
              {report.focus.slice(0, 1).map((item, i) => (
                <p key={i} className="text-app-tx2 text-xs leading-relaxed flex gap-2">
                  <span className="text-rpe-hard font-bold flex-shrink-0">→</span>
                  <span>{item}</span>
                </p>
              ))}
            </div>
          )}
          {(report.wins.length > 1 || report.focus.length > 1 || report.nextSession.length > 0) && (
            <Details label="Full report" className="mt-2">
              {report.wins.length > 0 && (
                <div className="space-y-1.5">
                  {report.wins.map((win, i) => (
                    <p key={i} className="text-app-tx2 text-xs leading-relaxed flex gap-2">
                      <span className="text-acc-teal font-bold flex-shrink-0">✓</span>
                      <span>{win}</span>
                    </p>
                  ))}
                </div>
              )}
              {report.focus.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {report.focus.map((item, i) => (
                    <p key={i} className="text-app-tx2 text-xs leading-relaxed flex gap-2">
                      <span className="text-rpe-hard font-bold flex-shrink-0">→</span>
                      <span>{item}</span>
                    </p>
                  ))}
                </div>
              )}
              {report.nextSession.length > 0 && (
                <div className="mt-3">
                  <p className="section-label mb-1.5">Next Session</p>
                  <div className="space-y-1.5">
                    {report.nextSession.map((item, i) => (
                      <p key={i} className="text-app-tx2 text-xs leading-relaxed flex gap-2">
                        <span className="text-app-tx3 font-bold flex-shrink-0">·</span>
                        <span>{item}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </Details>
          )}
          <div className="mt-4 pt-3 border-t border-app-border">
            <div className="flex items-center justify-between mb-2">
              <p className="section-label">Effort Spectrum · 4 wk</p>
              {effort.total > 0 && (
                <span className="text-[10px] text-app-tx3">{effort.total} rated sets</span>
              )}
            </div>
            <EffortBalanceRow
              effort={effort}
              rpeCap={status.mode === 'return' ? status.returnWeek.rpeCap : null}
            />
          </div>
        </div>
      )}

      {/* Body weight metrics */}
      {latestWeight !== null && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card p-3.5 text-center">
            <div className="text-xl font-light font-round tabular-nums glow-teal">{latestWeight} kg</div>
            <div className="metric-label">Current</div>
          </div>
          <div className="card p-3.5 text-center">
            <div className={`text-xl font-light font-round tabular-nums ${
              weightChange !== null && weightChange < 0 ? 'glow-teal' :
              weightChange !== null && weightChange > 0 ? 'text-rose-400' : 'text-app-tx1'
            }`}>
              {weightChange !== null ? (weightChange > 0 ? `+${weightChange}` : `${weightChange}`) : '—'} kg
            </div>
            <div className="metric-label">Change</div>
          </div>
          <div className="card p-3.5 text-center">
            <div className="text-xl font-light font-round tabular-nums text-app-tx1">{stats.length}</div>
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
              {kgCompact(thisWeekVol)}
              <span className="text-app-tx3 text-sm font-semibold ml-0.5">kg</span>
            </div>
            <div className="metric-label">This week</div>
          </div>
          <div className="card p-4">
            <div className={`metric-value ${
              volChange === null ? 'text-app-tx3' :
              volChange > 0 ? 'text-acc-teal' :
              volChange < 0 ? 'text-rose-400' : 'text-app-tx1'
            }`}>
              {kgCompact(lastWeekVol)}
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

      {/* Workout totals — constellation stats */}
      <div className="card-lg p-4">
        <p className="section-label mb-4">All-Time</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { value: workouts.length.toString(), label: 'Sessions', glow: 'glow-violet' },
            { value: totalSets.toString(), label: 'Sets', glow: 'glow-cyan' },
            { value: kgCompact(totalVolume), label: 'kg Vol', glow: 'glow-teal' },
          ].map((s) => (
            <div key={s.label}>
              <div className={`text-xl font-light font-round tabular-nums ${s.glow}`}>{s.value}</div>
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
              const progression = exerciseProgressions[pr.exerciseId] ?? [];
              const uniqueWeights = [...new Set(progression)];
              const progressStr = uniqueWeights.length > 1
                ? uniqueWeights.length <= 3
                  ? uniqueWeights.join(' → ')
                  : `${uniqueWeights[0]} → … → ${uniqueWeights[uniqueWeights.length - 1]}`
                : null;
              return (
                <div
                  key={pr.exerciseId}
                  className="card flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <span className="text-app-tx1 text-sm font-medium">{pr.name}</span>
                    {progressStr && (
                      <p className="text-app-tx3 text-xs mt-0.5 tabular-nums">{progressStr} kg</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="glow-gold font-round font-semibold text-sm tabular-nums">{pr.weight} kg</div>
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
                  <span className="text-app-tx3 text-xs">{formatDateShort(s.date)}</span>
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
