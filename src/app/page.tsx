import Link from 'next/link';
import { getWorkouts } from './actions';
import { SCHEDULE, REST_ACTIVITIES, PROGRESSION, getExerciseCountForDuration, getExercisesForDuration } from '@/lib/program';

const DURATIONS = [30, 45, 60] as const;

function formatRelative(date: Date): string {
  const diffDays = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(date));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getToday(): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}

export default async function Home() {
  const workouts = await getWorkouts();
  const recentWorkouts = workouts.slice(0, 4);

  const totalVolume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );

  // Week stats
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const sessionsThisWeek = workouts.filter((w) => new Date(w.date) >= weekStart).length;

  // Week volume
  const weekVolume = workouts
    .filter((w) => new Date(w.date) >= weekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0), 0);

  // Streak (week-based)
  const workoutWeeks = new Set(
    workouts.map((w) => {
      const d = new Date(w.date);
      const jan1 = new Date(d.getFullYear(), 0, 1);
      return `${d.getFullYear()}-${Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)}`;
    }),
  );
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 52; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const key = `${d.getFullYear()}-${Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)}`;
    if (workoutWeeks.has(key)) streak++;
    else if (i === 0) continue;
    else break;
  }

  // Today's schedule
  const todayIdx = new Date().getDay();
  const today = SCHEDULE[todayIdx];
  const isGymDay = today?.type === 'gym';
  const isSunday = todayIdx === 0;
  const restActivity = REST_ACTIVITIES[todayIdx] ?? null;
  let nextGymDay: (typeof SCHEDULE)[0] | null = null;
  if (!isGymDay) {
    for (let i = 1; i <= 7; i++) {
      const s = SCHEDULE[(todayIdx + i) % 7];
      if (s?.type === 'gym') { nextGymDay = s; break; }
    }
  }

  // Next suggested day
  const lastDay = workouts[0]?.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
  const suggestedDay = lastDay === 'A' ? 'B' : lastDay === 'B' ? 'A' : null;

  // Deload signal
  const deloadWarning = (() => {
    const cutoff = new Date(Date.now() - 14 * 86400000);
    const recentSets = workouts
      .filter((w) => new Date(w.date) >= cutoff)
      .flatMap((w) => w.sets)
      .filter((s) => s.rpe != null && s.rpe > 0);
    if (recentSets.length < 6) return false;
    const hardCount = recentSets.filter((s) => s.rpe! >= 3).length;
    return hardCount / recentSets.length > 0.5;
  })();

  // Program week + phase
  const programWeek = (() => {
    if (!workouts.length) return 1;
    const first = workouts[workouts.length - 1];
    const days = Math.floor((Date.now() - new Date(first.date).getTime()) / 86400000);
    return Math.min(12, Math.floor(days / 7) + 1);
  })();
  const currentPhase = PROGRESSION.find((p) => {
    const parts = p.weeks.split('–').map((s) => parseInt(s.trim()));
    const [start, end] = parts.length === 2 ? parts : [parts[0], parts[0]];
    return programWeek >= start && programWeek <= end;
  }) ?? PROGRESSION[0];

  const phaseColor: Record<string, string> = {
    LEARN:    'bg-slate-700/60 text-slate-300',
    BUILD:    'bg-blue-900/60 text-blue-300',
    PUSH:     'bg-teal-900/60 text-teal-300',
    DELOAD:   'bg-amber-900/60 text-amber-300',
    REBUILD:  'bg-violet-900/60 text-violet-300',
    EVALUATE: 'bg-orange-900/60 text-orange-300',
  };

  return (
    <div className="space-y-4">

      {/* ── Greeting header ─────────────────────────────── */}
      <div className="flex items-start justify-between pt-1">
        <div>
          <p className="text-app-tx2 text-sm">{getToday()}</p>
          <h1 className="text-xl font-bold text-app-tx1 mt-0.5">{getGreeting()} 👋</h1>
        </div>
        {isSunday && (
          <Link href="/stats" className="flex items-center gap-1.5 bg-amber-950/50 border border-amber-700/40 rounded-full px-3 py-1.5 transition-colors hover:bg-amber-900/50">
            <span className="text-amber-400 text-xs font-bold">☀ Weigh-in</span>
          </Link>
        )}
      </div>

      {/* ── Metric strip ────────────────────────────────── */}
      {workouts.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            {
              value: workouts.length.toString(),
              label: 'Sessions',
              color: 'text-app-tx1',
            },
            {
              value: `${sessionsThisWeek}/3`,
              label: 'This week',
              color: sessionsThisWeek >= 3 ? 'text-teal-400' : 'text-app-tx1',
            },
            {
              value: streak > 0 ? `${streak}🔥` : '—',
              label: 'Wk streak',
              color: streak > 0 ? 'text-orange-400' : 'text-app-tx3',
            },
            {
              value: totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(0)}k` : Math.round(totalVolume).toString(),
              label: 'kg lifted',
              color: 'text-app-tx1',
            },
          ].map((m) => (
            <div key={m.label} className="card p-3 text-center">
              <div className={`text-lg font-black tabular-nums leading-tight ${m.color}`}>{m.value}</div>
              <div className="text-[10px] text-app-tx3 mt-0.5 leading-tight">{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Status card: gym / rest ──────────────────────── */}
      <div className={`rounded-card-lg border overflow-hidden shadow-card ${
        isGymDay
          ? 'bg-gradient-to-br from-teal-950/50 to-app-surface border-teal-800/30'
          : 'bg-app-surface border-app-border'
      }`}>
        <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-bold uppercase tracking-widest ${isGymDay ? 'text-teal-400' : 'text-app-tx3'}`}>
              {isGymDay ? '● Gym Day' : '◌ Rest Day'}
            </p>
            <p className="font-semibold text-sm mt-1 text-app-tx1">
              {isGymDay ? 'Pick your workout below' : (restActivity ?? 'Recover & recharge')}
            </p>
          </div>
          {isGymDay ? (
            <div className={`chip ${phaseColor[currentPhase.phase] ?? 'bg-slate-700/60 text-slate-300'} flex-shrink-0`}>
              Wk {programWeek} · {currentPhase.phase}
            </div>
          ) : nextGymDay ? (
            <div className="text-right flex-shrink-0">
              <p className="text-app-tx3 text-xs">Next gym</p>
              <p className="text-app-tx1 font-semibold text-sm">{nextGymDay.day}</p>
            </div>
          ) : null}
        </div>
        <div className={`px-4 py-2.5 border-t flex items-center gap-2 ${
          isGymDay ? 'border-teal-900/40 bg-teal-950/20' : 'border-app-border bg-black/10'
        }`}>
          <span className="text-sm leading-none">🚶</span>
          <span className="text-[11px] text-app-tx3">
            Daily NEAT goal: <span className="text-app-tx2 font-semibold">8,000 steps</span>
            <span className="text-app-tx3"> · ~40–50 kcal per 1k steps</span>
          </span>
        </div>
      </div>

      {/* ── Deload warning ──────────────────────────────── */}
      {deloadWarning && (
        <div className="bg-orange-950/40 border border-orange-800/40 rounded-card-lg px-4 py-3.5 flex items-start gap-3">
          <span className="text-xl leading-none mt-0.5 flex-shrink-0">⚠️</span>
          <div>
            <p className="text-orange-300 font-bold text-sm">Your body is signalling fatigue</p>
            <p className="text-orange-600 text-xs mt-0.5 leading-relaxed">
              Over 50% of your sets in the last 2 weeks were Hard or Grind. Consider a lighter session — reduce weights by 40–50% and focus on form.
            </p>
          </div>
        </div>
      )}

      {/* ── Start a workout ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="section-label">Start a Workout</p>
          {suggestedDay && (
            <span className="text-[11px] text-app-tx2">
              Do Day{' '}
              <span className={`font-bold ${suggestedDay === 'A' ? 'text-blue-400' : 'text-violet-400'}`}>
                {suggestedDay}
              </span>{' '}next
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          {/* Day A */}
          <div className={`rounded-card-lg overflow-hidden transition-all ${
            suggestedDay === 'A'
              ? 'shadow-glow-blue ring-1 ring-blue-500/50'
              : suggestedDay === 'B' ? 'opacity-50' : ''
          }`}>
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-4 pt-4 pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-white font-black text-lg tracking-tight">Day A</div>
                  <div className="text-blue-200 text-xs mt-0.5">Chest · Quads · Shoulders</div>
                </div>
                {suggestedDay === 'A' && (
                  <span className="chip bg-white/20 text-white backdrop-blur-sm">Next ↑</span>
                )}
              </div>
              <p className="text-blue-200/50 text-[11px] mt-2 truncate">
                {getExercisesForDuration('A', 45).slice(0, 4).map((e) => e.name).join(' · ')}
                {getExerciseCountForDuration('A', 45) > 4 && ` +${getExerciseCountForDuration('A', 45) - 4}`}
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-blue-800/40 bg-blue-700/80">
              {DURATIONS.map((d) => (
                <Link
                  key={d}
                  href={`/workouts/new?day=A&dur=${d}`}
                  className="py-3 text-center hover:bg-blue-600/60 active:bg-blue-800/60 transition-colors"
                >
                  <div className="text-white font-bold text-sm">{d} min</div>
                  <div className="text-blue-200/70 text-[10px] mt-0.5">{getExerciseCountForDuration('A', d)} exercises</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Day B */}
          <div className={`rounded-card-lg overflow-hidden transition-all ${
            suggestedDay === 'B'
              ? 'shadow-glow-violet ring-1 ring-violet-400/50'
              : suggestedDay === 'A' ? 'opacity-50' : ''
          }`}>
            <div className="bg-gradient-to-br from-violet-600 to-violet-700 px-4 pt-4 pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-white font-black text-lg tracking-tight">Day B</div>
                  <div className="text-violet-200 text-xs mt-0.5">Back · Hamstrings · Arms</div>
                </div>
                {suggestedDay === 'B' && (
                  <span className="chip bg-white/20 text-white backdrop-blur-sm">Next ↑</span>
                )}
              </div>
              <p className="text-violet-200/50 text-[11px] mt-2 truncate">
                {getExercisesForDuration('B', 45).slice(0, 4).map((e) => e.name).join(' · ')}
                {getExerciseCountForDuration('B', 45) > 4 && ` +${getExerciseCountForDuration('B', 45) - 4}`}
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-violet-800/40 bg-violet-700/80">
              {DURATIONS.map((d) => (
                <Link
                  key={d}
                  href={`/workouts/new?day=B&dur=${d}`}
                  className="py-3 text-center hover:bg-violet-600/60 active:bg-violet-800/60 transition-colors"
                >
                  <div className="text-white font-bold text-sm">{d} min</div>
                  <div className="text-violet-200/70 text-[10px] mt-0.5">{getExerciseCountForDuration('B', d)} exercises</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── This week summary ───────────────────────────── */}
      {sessionsThisWeek > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">This Week</p>
            <span className="text-[11px] text-app-tx2">
              {weekVolume >= 1000 ? `${(weekVolume / 1000).toFixed(1)}k` : Math.round(weekVolume)} kg lifted
            </span>
          </div>
          {/* Progress bar toward 3-session goal */}
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-app-surface2 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-500 transition-all"
                style={{ width: `${Math.min(100, (sessionsThisWeek / 3) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-app-tx2 flex-shrink-0">{sessionsThisWeek}/3 sessions</span>
          </div>
          {sessionsThisWeek >= 3 && (
            <p className="text-teal-400 text-[11px] font-bold mt-2">✓ Weekly goal hit</p>
          )}
        </div>
      )}

      {/* ── Recent workouts ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="section-label">Recent</p>
          {workouts.length > 4 && (
            <Link href="/workouts" className="text-[11px] font-semibold text-teal-400 hover:text-teal-300 transition-colors">
              See all →
            </Link>
          )}
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="card-lg p-8 text-center border-dashed">
            <p className="text-app-tx2 font-medium mb-1">No workouts yet</p>
            <p className="text-app-tx3 text-sm mb-4">Tap a duration above to begin</p>
            <Link href="/program" className="text-teal-400 text-sm hover:text-teal-300 transition-colors">
              Read the program first →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentWorkouts.map((workout) => {
              const exerciseNames = Array.from(new Set(workout.sets.map((s) => s.exercise.name)));
              const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
              const vol = workout.sets.reduce((s, set) => s + set.weight * set.reps, 0);
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}`}
                  className="flex items-center card px-4 py-3.5 hover:border-white/15 hover:bg-app-surface2/60 active:scale-[0.99] transition-all pressable"
                >
                  {/* Day badge */}
                  {dayLetter ? (
                    <span className={`text-[10px] font-black w-7 h-7 rounded-lg flex items-center justify-center mr-3 flex-shrink-0 ${
                      dayLetter === 'A'
                        ? 'bg-blue-600/25 text-blue-400'
                        : 'bg-violet-700/25 text-violet-400'
                    }`}>
                      {dayLetter}
                    </span>
                  ) : (
                    <span className="w-7 h-7 rounded-lg bg-app-surface2 mr-3 flex-shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-app-tx1 text-sm truncate">{workout.name}</div>
                    <div className="text-app-tx3 text-[11px] mt-0.5 truncate">
                      {exerciseNames.slice(0, 3).join(' · ')}
                      {exerciseNames.length > 3 && ` +${exerciseNames.length - 3}`}
                    </div>
                  </div>

                  <div className="text-right ml-4 flex-shrink-0">
                    <div className="text-app-tx2 text-[11px]">{formatRelative(workout.date)}</div>
                    <div className="text-app-tx3 text-[11px] mt-0.5">
                      {vol > 0 && `${vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : Math.round(vol)} kg`}
                      {workout.duration ? ` · ${formatDuration(workout.duration)}` : ''}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
