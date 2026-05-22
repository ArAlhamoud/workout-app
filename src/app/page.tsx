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

  // Streak
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

  // Today
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

  // Deload signal: if >50% of logged sets (with RPE) in last 14 days were Hard/Grind
  const deloadWarning = (() => {
    const cutoff = new Date(Date.now() - 14 * 86400000);
    const recentSets = workouts
      .filter((w) => new Date(w.date) >= cutoff)
      .flatMap((w) => w.sets)
      .filter((s) => s.rpe != null && s.rpe > 0);
    if (recentSets.length < 6) return false; // not enough data
    const hardCount = recentSets.filter((s) => s.rpe! >= 3).length;
    return hardCount / recentSets.length > 0.5;
  })();

  // Program week + current phase
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

  return (
    <div className="space-y-4">
      {/* Contextual hero card — gym/rest/sunday merged into one */}
      <div className={`rounded-2xl border overflow-hidden ${
        isGymDay
          ? 'bg-gradient-to-br from-green-950/60 to-gray-950 border-green-800/40'
          : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Sunday weigh-in badge */}
            {isSunday && (
              <Link href="/stats" className="inline-flex items-center gap-1.5 mb-2 text-amber-400 hover:text-amber-300 transition-colors">
                <span className="text-xs font-bold uppercase tracking-widest">&#9878; Sunday check-in</span>
                <span className="text-xs opacity-70">&#8594;</span>
              </Link>
            )}
            <p className={`text-xs font-bold uppercase tracking-widest ${isGymDay ? 'text-green-500' : 'text-gray-600'}`}>
              {isGymDay ? 'Gym Day' : 'Rest Day'}
            </p>
            <p className={`font-semibold text-sm mt-0.5 ${isGymDay ? 'text-white' : 'text-gray-300'}`}>
              {isGymDay ? 'Pick your workout below' : (restActivity ?? 'Recover & recharge')}
            </p>
          </div>
          {isGymDay ? (
            <span className="text-green-500 text-xl mt-0.5 flex-shrink-0">&#8595;</span>
          ) : nextGymDay ? (
            <div className="text-right flex-shrink-0">
              <p className="text-gray-600 text-xs">Next gym</p>
              <p className="text-gray-300 font-semibold text-sm">{nextGymDay.day}</p>
            </div>
          ) : null}
        </div>
        {/* Step goal footer strip */}
        <div className={`px-4 py-2.5 border-t flex items-center gap-2 ${
          isGymDay ? 'border-green-900/40 bg-green-950/20' : 'border-gray-800 bg-gray-950/40'
        }`}>
          <span className="text-base leading-none">&#128694;</span>
          <span className="text-xs text-gray-600">
            Daily NEAT goal: <span className="text-gray-400 font-semibold">8,000 steps</span>
            <span className="text-gray-700"> &mdash; ~40&ndash;50 kcal per 1k steps</span>
          </span>
        </div>
      </div>

      {/* Phase banner */}
      {workouts.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-gray-600 text-xs uppercase tracking-widest font-semibold">Program</p>
            <p className="text-white font-bold text-sm mt-0.5">
              Week {programWeek}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-bold ${
                currentPhase.phase === 'LEARN' ? 'bg-gray-800 text-gray-300' :
                currentPhase.phase === 'BUILD' ? 'bg-blue-900/50 text-blue-300' :
                currentPhase.phase === 'PUSH' ? 'bg-green-900/50 text-green-300' :
                currentPhase.phase === 'DELOAD' ? 'bg-yellow-900/50 text-yellow-300' :
                currentPhase.phase === 'REBUILD' ? 'bg-violet-900/50 text-violet-300' :
                'bg-orange-900/50 text-orange-300'
              }`}>{currentPhase.phase}</span>
            </p>
          </div>
          <p className="text-gray-600 text-xs max-w-[160px] text-right leading-relaxed">
            {currentPhase.desc.split('.')[0]}.
          </p>
        </div>
      )}

      {/* Deload warning */}
      {deloadWarning && (
        <div className="bg-orange-950/40 border border-orange-800/50 rounded-2xl px-4 py-3.5 flex items-start gap-3">
          <span className="text-xl leading-none mt-0.5">⚠️</span>
          <div>
            <p className="text-orange-300 font-bold text-sm">Your body is signalling fatigue</p>
            <p className="text-orange-600 text-xs mt-0.5 leading-relaxed">
              Over 50% of your sets in the last 2 weeks were Hard or Grind. Consider a lighter session this week — reduce weights by 40–50% and focus on form.
            </p>
          </div>
        </div>
      )}

      {/* Start workout */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-gray-600 text-xs uppercase tracking-widest font-semibold">Start a Workout</p>
          {suggestedDay && (
            <span className="text-xs text-gray-500">
              Do Day{' '}
              <span className={suggestedDay === 'A' ? 'text-blue-400 font-bold' : 'text-violet-400 font-bold'}>
                {suggestedDay}
              </span>{' '}next
            </span>
          )}
        </div>
        <div className="space-y-2.5">
          {/* Day A */}
          <div className={`bg-blue-600 rounded-2xl overflow-hidden transition-all ${
            suggestedDay === 'A'
              ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-950 shadow-lg shadow-blue-950/50'
              : suggestedDay === 'B' ? 'opacity-60' : ''
          }`}>
            <div className="px-4 pt-3.5 pb-1 flex items-center justify-between">
              <div>
                <div className="text-white font-black text-base tracking-tight">Day A</div>
                <div className="text-blue-200 text-xs mt-0.5">Chest &middot; Quads &middot; Shoulders</div>
              </div>
              {suggestedDay === 'A' && (
                <span className="text-xs bg-white/20 backdrop-blur text-white px-2.5 py-1 rounded-full font-bold">Next &#8593;</span>
              )}
            </div>
            <div className="px-4 pb-2">
              <p className="text-blue-200/50 text-xs truncate">
                {getExercisesForDuration('A', 45).slice(0, 4).map((e) => e.name).join(' · ')}
                {getExerciseCountForDuration('A', 45) > 4 && ` +${getExerciseCountForDuration('A', 45) - 4}`}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px bg-blue-800/40">
              {DURATIONS.map((d) => (
                <Link
                  key={d}
                  href={`/workouts/new?day=A&dur=${d}`}
                  className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 px-2 py-3.5 text-center transition-colors"
                >
                  <div className="text-white font-bold text-sm">{d} min</div>
                  <div className="text-blue-200/80 text-xs mt-0.5">{getExerciseCountForDuration('A', d)} exercises</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Day B */}
          <div className={`bg-violet-700 rounded-2xl overflow-hidden transition-all ${
            suggestedDay === 'B'
              ? 'ring-2 ring-violet-400 ring-offset-2 ring-offset-gray-950 shadow-lg shadow-violet-950/50'
              : suggestedDay === 'A' ? 'opacity-60' : ''
          }`}>
            <div className="px-4 pt-3.5 pb-1 flex items-center justify-between">
              <div>
                <div className="text-white font-black text-base tracking-tight">Day B</div>
                <div className="text-violet-200 text-xs mt-0.5">Back &middot; Hamstrings &middot; Arms</div>
              </div>
              {suggestedDay === 'B' && (
                <span className="text-xs bg-white/20 backdrop-blur text-white px-2.5 py-1 rounded-full font-bold">Next &#8593;</span>
              )}
            </div>
            <div className="px-4 pb-2">
              <p className="text-violet-200/50 text-xs truncate">
                {getExercisesForDuration('B', 45).slice(0, 4).map((e) => e.name).join(' · ')}
                {getExerciseCountForDuration('B', 45) > 4 && ` +${getExerciseCountForDuration('B', 45) - 4}`}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px bg-violet-900/40">
              {DURATIONS.map((d) => (
                <Link
                  key={d}
                  href={`/workouts/new?day=B&dur=${d}`}
                  className="bg-violet-700 hover:bg-violet-600 active:bg-violet-800 px-2 py-3.5 text-center transition-colors"
                >
                  <div className="text-white font-bold text-sm">{d} min</div>
                  <div className="text-violet-200/80 text-xs mt-0.5">{getExerciseCountForDuration('B', d)} exercises</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {workouts.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-2xl font-black text-white tabular-nums">{workouts.length}</div>
            <div className="text-gray-600 text-xs mt-0.5">Total sessions</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-2xl font-black text-white tabular-nums">{sessionsThisWeek}<span className="text-gray-600 text-base font-semibold">/3</span></div>
            <div className="text-gray-600 text-xs mt-0.5">This week</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className={`text-2xl font-black tabular-nums ${streak > 0 ? 'text-orange-400' : 'text-gray-700'}`}>
              {streak > 0 ? streak : '—'}
              {streak > 0 && <span className="text-lg ml-0.5">&#128293;</span>}
            </div>
            <div className="text-gray-600 text-xs mt-0.5">Week streak</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-2xl font-black text-white tabular-nums">
              {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)}
            </div>
            <div className="text-gray-600 text-xs mt-0.5">kg lifted</div>
          </div>
        </div>
      )}

      {/* Recent workouts */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-gray-600 text-xs uppercase tracking-widest font-semibold">Recent</p>
          {workouts.length > 4 && (
            <Link href="/workouts" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
              See all &#8594;
            </Link>
          )}
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800 border-dashed">
            <p className="text-gray-600 font-medium mb-1">No workouts yet</p>
            <p className="text-gray-700 text-sm mb-4">Tap a duration button above to begin</p>
            <Link href="/program" className="text-blue-400 text-sm hover:text-blue-300 transition-colors">
              Read the program first &#8594;
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentWorkouts.map((workout) => {
              const exerciseNames = Array.from(new Set(workout.sets.map((s) => s.exercise.name)));
              const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}`}
                  className="flex items-center bg-gray-900 rounded-xl px-4 py-3.5 border border-gray-800 hover:border-gray-700 hover:bg-gray-800/60 active:scale-[0.99] transition-all"
                >
                  {dayLetter && (
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md mr-2.5 flex-shrink-0 ${
                      dayLetter === 'A' ? 'bg-blue-600/25 text-blue-400' : 'bg-violet-700/25 text-violet-400'
                    }`}>
                      {dayLetter}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white text-sm truncate">{workout.name}</div>
                    <div className="text-gray-600 text-xs mt-0.5 truncate">
                      {exerciseNames.slice(0, 3).join(' · ')}
                      {exerciseNames.length > 3 && ` +${exerciseNames.length - 3}`}
                    </div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <div className="text-gray-500 text-xs">{formatRelative(workout.date)}</div>
                    {workout.duration && (
                      <div className="text-gray-700 text-xs mt-0.5">{formatDuration(workout.duration)}</div>
                    )}
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
