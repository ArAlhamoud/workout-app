import Link from 'next/link';
import { getBodyStats, getWorkouts } from './actions';
import { SCHEDULE, REST_ACTIVITIES, PROGRESSION, BREAK_THRESHOLD_DAYS, getTrainingStatus, getExerciseCountForDuration, getExercisesForDuration } from '@/lib/program';
import { formatDuration, formatRelative, getMondayOfWeek, kgCompact, RPE_LABELS, weekKey } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DURATIONS = [30, 45, 60] as const;

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function getToday(): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}

/* ── Aurora day accents — light IS the information system ────
   Day A glows violet · Day B glows teal. */
type DayId = 'A' | 'B';
type DayVariant = 'primary' | 'muted' | 'neutral' | 'done';

const DAY_FOCUS: Record<DayId, string> = {
  A: 'Chest · Quads · Shoulders',
  B: 'Back · Hamstrings · Arms',
};

const DAY_ACCENT: Record<DayId, {
  glowCard: string;
  nebula: string;
  monogram: string;
  monogramQuiet: string;
  tag: string;
  chip: string;
  accentText: string;
  start: string;
}> = {
  A: {
    glowCard: 'border-acc-violet/30 shadow-glow-violet',
    nebula: 'radial-gradient(240px 120px at 100% 0%, rgba(139,92,246,0.13), transparent 70%)',
    monogram: 'bg-gradient-to-br from-[#ddd6fe] to-acc-violet-deep text-[#14082e] shadow-[0_0_24px_-4px_rgba(139,92,246,0.8)]',
    monogramQuiet: 'border border-acc-violet/35 bg-acc-violet-deep/15 text-acc-violet',
    tag: 'bg-gradient-to-r from-acc-violet to-[#a78bfa] text-[#14082e] shadow-[0_0_14px_-2px_rgba(139,92,246,0.7)]',
    chip: 'border-acc-violet/50 bg-gradient-to-br from-acc-violet/25 to-acc-violet-deep/10 text-violet-100 shadow-[0_0_18px_-4px_rgba(139,92,246,0.55)]',
    accentText: 'text-acc-violet',
    start:
      'bg-gradient-to-r from-acc-violet to-acc-violet-deep text-[#14082e] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_0_30px_-6px_rgba(139,92,246,0.8)]',
  },
  B: {
    glowCard: 'border-acc-teal/30 shadow-glow-teal',
    nebula: 'radial-gradient(240px 120px at 100% 0%, rgba(94,234,212,0.13), transparent 70%)',
    monogram: 'bg-gradient-to-br from-[#99f6e4] to-acc-teal-deep text-[#062521] shadow-[0_0_24px_-4px_rgba(45,212,191,0.8)]',
    monogramQuiet: 'border border-acc-teal/35 bg-acc-teal-deep/15 text-acc-teal',
    tag: 'bg-gradient-to-r from-acc-teal to-acc-cyan text-[#062521] shadow-[0_0_14px_-2px_rgba(94,234,212,0.7)]',
    chip: 'border-acc-teal/50 bg-gradient-to-br from-acc-teal/25 to-acc-teal-deep/10 text-teal-100 shadow-[0_0_18px_-4px_rgba(45,212,191,0.55)]',
    accentText: 'text-acc-teal',
    start:
      'bg-gradient-to-r from-acc-teal to-acc-cyan text-[#062521] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_30px_-6px_rgba(45,212,191,0.8)]',
  },
};

/* Quiet duration chip — plain glass, only the 45-min default lights up */
const CHIP_QUIET = 'border-app-border bg-white/[0.04] text-app-tx2 hover:border-app-border-hi';

/* Quiet aurora affordance for <details> summaries — full copy lives one tap away */
const SUMMARY_CHIP =
  'chip inline-flex w-fit cursor-pointer select-none list-none items-center gap-1.5 border border-app-border bg-white/5 text-[10px] uppercase tracking-[0.12em] text-app-tx3 transition-colors hover:border-app-border-hi hover:text-app-tx2 [&::-webkit-details-marker]:hidden';

function Chevron() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="flex-none transition-transform duration-200 group-open:rotate-180"
    >
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Effort spectrum segments for the lockout ladder (index by RPE 1–4) */
const RPE_SEG_ON = [
  '',
  'border-rpe-easy/50 bg-rpe-easy/10 text-rpe-easy',
  'border-rpe-med/50 bg-rpe-med/10 text-rpe-med',
  'border-rpe-hard/50 bg-rpe-hard/10 text-rpe-hard',
  'border-rpe-grind/50 bg-rpe-grind/10 text-rpe-grind',
] as const;
const RPE_SEG_CAP = [
  '',
  'border-rpe-easy/70 bg-rpe-easy/20 text-rpe-easy',
  'border-rpe-med/70 bg-rpe-med/20 text-rpe-med',
  'border-rpe-hard/70 bg-rpe-hard/20 text-rpe-hard',
  'border-rpe-grind/70 bg-rpe-grind/20 text-rpe-grind',
] as const;
const RPE_CAP_FLAG = [
  '',
  'border-rpe-easy/70 text-rpe-easy',
  'border-rpe-med/70 text-rpe-med',
  'border-rpe-hard/70 text-rpe-hard',
  'border-rpe-grind/70 text-rpe-grind',
] as const;

function DayCard({ day, variant, doneWhen }: { day: DayId; variant: DayVariant; doneWhen: string | null }) {
  const accent = DAY_ACCENT[day];
  const previewNames = getExercisesForDuration(day, 45).slice(0, 4).map((e) => e.name).join(' · ');
  const extra = getExerciseCountForDuration(day, 45) - 4;
  const preview = extra > 0 ? `${previewNames} +${extra}` : previewNames;

  /* Quiet done-row — this day was trained this block; links stay intact */
  if (variant === 'done') {
    return (
      <section className="card p-3.5 opacity-80">
        <div className="flex items-center gap-3">
          <div className={`grid h-9 w-9 flex-none place-items-center rounded-xl font-round text-sm font-extrabold ${accent.monogramQuiet}`}>
            {day}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-round text-sm font-bold text-app-tx1">Day {day}</h3>
          </div>
          <span className="chip flex-none border border-app-border bg-white/5 text-[9px] uppercase tracking-[0.12em] text-app-tx3">
            Done {doneWhen}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {DURATIONS.map((d) => (
            <Link
              key={d}
              href={`/workouts/new?day=${day}&dur=${d}`}
              className="pressable rounded-lg border border-app-border bg-white/[0.03] py-1.5 text-center text-[11px] font-semibold tabular-nums text-app-tx3 transition-colors hover:border-app-border-hi hover:text-app-tx1"
            >
              {d}m
            </Link>
          ))}
        </div>
      </section>
    );
  }

  const primary = variant === 'primary';
  return (
    <section className={`card-lg relative overflow-hidden p-4 ${primary ? accent.glowCard : ''} ${variant === 'muted' ? 'opacity-60' : ''}`}>
      {primary && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-card-lg" style={{ background: accent.nebula }} />
      )}
      <div className="relative">
        <div className="flex items-center gap-3">
          <div className={`grid h-11 w-11 flex-none place-items-center rounded-2xl font-round text-lg font-extrabold ${primary ? accent.monogram : accent.monogramQuiet}`}>
            {day}
          </div>
          <div className="min-w-0">
            <h3 className="font-round text-base font-bold tracking-tight text-app-tx1">Day {day}</h3>
            <p className="mt-0.5 text-xs text-app-tx2">{DAY_FOCUS[day]}</p>
          </div>
          {primary && (
            <span className={`chip ml-auto flex-none text-[9px] uppercase tracking-[0.13em] ${accent.tag}`}>Up next</span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {DURATIONS.map((d) => (
            <Link
              key={d}
              href={`/workouts/new?day=${day}&dur=${d}`}
              className={`pressable flex items-center justify-center rounded-xl border py-3 transition-colors ${
                primary && d === 45 ? accent.chip : CHIP_QUIET
              }`}
            >
              <span className="font-round text-[17px] font-semibold leading-none tabular-nums">
                {d}
                <span className="ml-0.5 text-[9px] font-bold uppercase tracking-[0.12em] opacity-70">min</span>
              </span>
            </Link>
          ))}
        </div>
        {/* The boldest object on the page — full-width gradient Start */}
        {primary && (
          <Link
            href={`/workouts/new?day=${day}&dur=45`}
            className={`pressable mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-round text-[15px] font-bold tracking-tight transition-all hover:brightness-110 active:brightness-95 ${accent.start}`}
          >
            <svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true" className="flex-none">
              <path d="M1.5 1.6c0-.9 1-1.5 1.8-1L12 6a1.2 1.2 0 0 1 0 2.1L3.3 13.4c-.8.5-1.8-.1-1.8-1z" fill="currentColor" />
            </svg>
            Start Day {day} · 45 min
          </Link>
        )}
        {/* Exercise preview — one tap away */}
        <details className="group mt-2.5">
          <summary className={SUMMARY_CHIP}>
            Exercises
            <Chevron />
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-app-tx3">{preview}</p>
          <p className="mt-1 text-[10px] tabular-nums text-app-tx3">
            {DURATIONS.map((d) => `${d}m ${getExerciseCountForDuration(day, d)} ex`).join(' · ')}
          </p>
        </details>
      </div>
    </section>
  );
}

export default async function Home() {
  const [workouts, bodyStats] = await Promise.all([getWorkouts(), getBodyStats()]);
  const recentWorkouts = workouts.slice(0, 4);

  // Weigh-in nudge: bodyStats come back date-ascending
  const lastBodyStat = bodyStats[bodyStats.length - 1];
  const daysSinceWeighIn = lastBodyStat
    ? Math.floor((Date.now() - new Date(lastBodyStat.date).getTime()) / 86400000)
    : null;

  // Body-weight card: latest recorded weight, trend vs the first recorded
  const weightStats = bodyStats.filter((s) => s.weight != null);
  const latestWeight = weightStats.length > 0 ? weightStats[weightStats.length - 1] : null;
  const firstWeight = weightStats.length > 0 ? weightStats[0] : null;
  const weightDelta = latestWeight && firstWeight ? latestWeight.weight! - firstWeight.weight! : 0;

  const totalVolume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );

  // Week stats (Monday-start weeks)
  const weekStart = getMondayOfWeek(new Date());
  const sessionsThisWeek = workouts.filter((w) => new Date(w.date) >= weekStart).length;

  // Week volume
  const weekVolume = workouts
    .filter((w) => new Date(w.date) >= weekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + set.weight * set.reps, 0), 0);

  // Streak: consecutive ISO weeks (Monday-start) with at least one workout,
  // walking backwards from this week. No workout yet in the current week
  // doesn't break the streak — it just doesn't count.
  const workoutWeeks = new Set(workouts.map((w) => weekKey(new Date(w.date))));
  let streak = 0;
  {
    const cursor = getMondayOfWeek(new Date());
    if (workoutWeeks.has(weekKey(cursor))) streak++;
    cursor.setDate(cursor.getDate() - 7);
    while (workoutWeeks.has(weekKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
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
  const suggestedDay: DayId | null = lastDay === 'A' ? 'B' : lastDay === 'B' ? 'A' : null;

  // Was the last-trained day inside the current training block (not before a layoff)?
  const lastWorkout = workouts[0] ?? null;
  const lastTrainedThisBlock =
    lastWorkout !== null &&
    (Date.now() - new Date(lastWorkout.date).getTime()) / 86400000 < BREAK_THRESHOLD_DAYS;

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

  // Where the lifter actually is: fresh, ramping back after a layoff, or mid-program
  const status = getTrainingStatus(workouts.map((w) => w.date));
  const programWeek = status.week;
  const currentPhase = PROGRESSION.find((p) => {
    const parts = p.weeks.split('–').map((s) => parseInt(s.trim()));
    const [start, end] = parts.length === 2 ? parts : [parts[0], parts[0]];
    return programWeek >= start && programWeek <= end;
  }) ?? PROGRESSION[0];

  const phaseColor: Record<string, string> = {
    LEARN:    'bg-white/10 text-app-tx2',
    BUILD:    'bg-acc-indigo/25 text-indigo-300',
    PUSH:     'bg-acc-teal/15 text-acc-teal',
    DELOAD:   'bg-rpe-hard/15 text-rpe-hard',
    REBUILD:  'bg-acc-violet/15 text-acc-violet',
    EVALUATE: 'bg-acc-cyan/15 text-acc-cyan',
  };

  const hour = new Date().getHours();
  const heroVerb = hour >= 17 ? 'Tonight' : 'Today';
  const ringProgress = Math.min(1, sessionsThisWeek / 3);
  const suggestedAccent = suggestedDay ? DAY_ACCENT[suggestedDay] : null;
  const dayOrder: DayId[] = suggestedDay === 'B' ? ['B', 'A'] : ['A', 'B'];

  return (
    <div className="space-y-4">

      {/* ── Greeting header ─────────────────────────────── */}
      <header className="flex items-end justify-between pt-1">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[rgba(147,197,253,0.62)]">{getToday()}</p>
          <h1 className="mt-1 bg-gradient-to-r from-white via-[#c7d2fe] to-[#99f6e4] bg-clip-text font-round text-[26px] font-bold tracking-tight text-transparent">
            {getGreeting()}, Ar.
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          {isSunday && (
            <Link
              href="/stats"
              className="pressable flex items-center gap-1.5 rounded-full border border-acc-teal/40 bg-acc-teal/10 px-3 py-1.5 shadow-[0_0_18px_-6px_rgba(45,212,191,0.5)] transition-colors hover:bg-acc-teal/20"
            >
              <span className="text-xs font-bold text-acc-teal">☀ Weigh-in</span>
            </Link>
          )}
          <div
            aria-hidden="true"
            className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#99f6e4] to-[#a5b4fc] font-round text-[15px] font-bold text-[#0b1120] shadow-[0_0_24px_-6px_rgba(94,234,212,0.55)]"
          >
            AR
          </div>
        </div>
      </header>

      {/* ── Hero: answer first — ring + tonight's plan ──── */}
      <section className="card-lg relative overflow-hidden p-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-card-lg"
          style={{
            background:
              'radial-gradient(220px 130px at 85% 0%, rgba(94,234,212,0.10), transparent 70%), radial-gradient(200px 140px at 0% 100%, rgba(139,92,246,0.10), transparent 70%)',
          }}
        />
        <div className="relative flex items-center gap-4">
          {/* Weekly activity ring */}
          <div className="relative h-[104px] w-[104px] flex-none" role="img" aria-label={`${sessionsThisWeek} of 3 sessions this week`}>
            <svg viewBox="0 0 112 112" fill="none" className="ring-svg h-full w-full" aria-hidden="true">
              <defs>
                <linearGradient id="weekRingGrad" x1="0" y1="0" x2="112" y2="112" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#5eead4" />
                  <stop offset="0.6" stopColor="#22d3ee" />
                  <stop offset="1" stopColor="#818cf8" />
                </linearGradient>
                <filter id="weekRingGlow" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#2dd4bf" floodOpacity="0.8" />
                </filter>
              </defs>
              <circle cx="56" cy="56" r={RING_R} stroke="rgba(255,255,255,0.09)" strokeWidth="10" />
              {ringProgress > 0 && (
                <circle
                  cx="56"
                  cy="56"
                  r={RING_R}
                  stroke="url(#weekRingGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(ringProgress * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`}
                  filter="url(#weekRingGlow)"
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-round text-2xl font-light leading-none tabular-nums text-app-tx1">
                <b className="font-bold text-[#99f6e4]">{sessionsThisWeek}</b>
                <span className="text-base text-app-tx3">/3</span>
              </div>
              <small className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-app-tx3">this week</small>
            </div>
          </div>

          {/* Answer copy */}
          <div className="flex min-w-0 flex-col gap-1.5">
            {isGymDay ? (
              <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-gradient-to-r from-acc-teal to-acc-cyan px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-[#0b1120] shadow-[0_0_20px_-4px_rgba(94,234,212,0.7)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#0b1120] opacity-75" />
                Gym day
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-app-border bg-white/5 px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-app-tx3">
                <span className="h-1.5 w-1.5 rounded-full bg-app-tx3 opacity-60" />
                Rest day
              </span>
            )}
            <h2 className="font-round text-lg font-bold tracking-tight text-app-tx1">
              {isGymDay ? `${heroVerb} you lift.` : 'Today you recover.'}
            </h2>
            {isGymDay ? (
              <p className="text-xs text-app-tx2">
                {suggestedDay ? (
                  <>Day <b className={`font-semibold ${suggestedAccent?.accentText ?? ''}`}>{suggestedDay}</b> queued</>
                ) : (
                  <>Pick Day A or B below</>
                )}
              </p>
            ) : nextGymDay ? (
              <p className="text-xs text-app-tx2">
                Next gym <b className="font-semibold text-app-tx1">{nextGymDay.day}</b>
                {suggestedDay ? <> · Day <b className={`font-semibold ${suggestedAccent?.accentText ?? ''}`}>{suggestedDay}</b></> : null}
              </p>
            ) : null}
            {sessionsThisWeek > 0 && (
              <p className="text-xs tabular-nums text-app-tx2">
                <b className="font-semibold text-[#99f6e4]">{kgCompact(weekVolume)} kg</b> this week
              </p>
            )}
            {sessionsThisWeek >= 3 && (
              <p className="text-[11px] font-bold text-acc-teal">✓ Ring closed</p>
            )}
          </div>
        </div>

        {/* One glowing Start row — suggested day, existing duration links */}
        {suggestedDay && suggestedAccent && (
          <div className="relative mt-3.5">
            <div className="flex items-baseline justify-between">
              <span className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${suggestedAccent.accentText}`}>
                Start Day {suggestedDay}
              </span>
              <span className="text-[10px] text-app-tx3">pick a length</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => (
                <Link
                  key={d}
                  href={`/workouts/new?day=${suggestedDay}&dur=${d}`}
                  className={`pressable flex items-center justify-center rounded-xl border py-3 transition-colors ${d === 45 ? suggestedAccent.chip : CHIP_QUIET}`}
                >
                  <span className="font-round text-[17px] font-semibold leading-none tabular-nums">
                    {d}
                    <span className="ml-0.5 text-[9px] font-bold uppercase tracking-[0.12em] opacity-70">min</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Footer strip: NEAT + rest-activity detail one tap away, phase chip on glance */}
        <div className="relative mt-3.5 flex items-start gap-2 border-t border-white/10 pt-3">
          <details className="group min-w-0 flex-1">
            <summary className={SUMMARY_CHIP}>
              <span aria-hidden="true">🚶</span> 8k steps
              <Chevron />
            </summary>
            <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-app-tx3">
              <p>
                Daily NEAT goal: <span className="font-semibold text-app-tx2">8,000 steps</span>
                {' '}· ~40–50 kcal per 1k steps
              </p>
              {!isGymDay && <p>{restActivity ?? 'Recover & recharge'}.</p>}
            </div>
          </details>
          {isGymDay && (
            status.mode === 'return' ? (
              <span className="chip flex-none border border-acc-ember/40 bg-acc-ember/10 text-acc-ember">
                Return W{status.week} · {status.returnWeek.phase}
              </span>
            ) : (
              <span className={`chip flex-none ${phaseColor[currentPhase.phase] ?? 'bg-white/10 text-app-tx2'}`}>
                Wk {programWeek} · {currentPhase.phase}
              </span>
            )
          )}
        </div>
      </section>

      {/* ── Return Protocol — exclusive ember, coach directive ── */}
      {status.mode === 'return' && (
        <section className="card-lg relative overflow-hidden border-acc-ember/25 p-4">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-card-lg"
            style={{ background: 'radial-gradient(260px 130px at 12% 0%, rgba(245,158,11,0.14), transparent 70%)' }}
          />
          <div className="relative">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="flex-none">
                <path d="M7 1.2c1.4 2 .3 3-.4 4.2C5.8 6.7 6 8.2 7.4 9c-.2-1 .2-1.8 1-2.5.9 1.1 2.1 2.5 2.1 4.1A3.9 3.9 0 0 1 6.6 14 4.6 4.6 0 0 1 2.5 9.4C2.5 5.6 6.4 4.4 7 1.2z" fill="#fcd34d" opacity=".9" />
              </svg>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-acc-ember">Return protocol</span>
              <span className="chip ml-auto flex-none bg-gradient-to-r from-acc-ember to-acc-ember-deep text-[9px] uppercase tracking-[0.14em] text-[#1a1206] shadow-[0_0_18px_-4px_rgba(245,158,11,0.75)]">
                {status.returnWeek.phase}
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="glow-amber font-round text-3xl font-light tabular-nums tracking-tight">Week {status.week}</span>
              <span className="text-sm text-app-tx2">of 4</span>
              <span className="ml-auto flex items-center gap-1.5" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-6 rounded-full ${
                      i <= status.week
                        ? 'bg-gradient-to-r from-acc-ember to-acc-ember-deep shadow-[0_0_12px_-1px_rgba(245,158,11,0.8)]'
                        : 'bg-white/10'
                    }`}
                  />
                ))}
              </span>
            </div>

            {/* Coach voice — one line of personality on the glance layer */}
            <p className="mt-3 border-t border-white/10 pt-3 text-[11px] font-semibold uppercase tracking-[0.13em]">
              <span className="glow-amber">We rebuild. We don&apos;t test.</span>
            </p>

            <div className="mt-3 flex border-t border-white/10 pt-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">{status.returnWeek.loadPct}%</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">load</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-white/10 pl-3.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">{status.returnWeek.sessions}</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">sessions</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-white/10 pl-3.5">
                <b className="font-round text-[15px] font-semibold text-app-tx1">{RPE_LABELS[status.returnWeek.rpeCap]}</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">cap</span>
              </div>
            </div>

            {/* Full directive + effort ladder — one tap away */}
            <details className="group mt-3">
              <summary className={`${SUMMARY_CHIP} border-acc-ember/30 bg-acc-ember/10 text-acc-ember hover:border-acc-ember/50 hover:text-acc-ember`}>
                The rules
                <Chevron />
              </summary>

              <p className="mt-3 text-[11px] font-semibold uppercase leading-loose tracking-[0.13em] text-app-tx2">
                {status.daysOff} days off. Run <b className="text-app-tx1">{status.returnWeek.sessions} sessions</b> at{' '}
                <b className="text-app-tx1">{status.returnWeek.loadPct}%</b> of pre-break weights. Nothing heavier. Nothing longer.
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-app-tx3">{status.returnWeek.desc}</p>

              {/* Effort-ceiling lockout ladder */}
              <div className="mt-4" role="img" aria-label={`Effort capped at ${RPE_LABELS[status.returnWeek.rpeCap]}. Scale: Easy, Med, Hard, Grind.`}>
                <div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[0.16em]">
                  <span className="text-app-tx3">Effort ceiling</span>
                  <span className="glow-amber">{RPE_LABELS[status.returnWeek.rpeCap]}</span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {RPE_LABELS.slice(1).map((label, i) => {
                    const v = i + 1;
                    const cap = status.returnWeek.rpeCap;
                    const seg =
                      v < cap ? RPE_SEG_ON[v] : v === cap ? RPE_SEG_CAP[v] : 'border-app-border bg-white/[0.02] text-app-tx3 line-through opacity-60';
                    return (
                      <span
                        key={label}
                        className={`relative rounded-lg border py-2 text-center text-[9.5px] font-extrabold uppercase tracking-[0.13em] ${seg}`}
                      >
                        {label}
                        {v === cap && (
                          <span className={`absolute -top-2 right-1 rounded border bg-[#140f03] px-1 py-px text-[7px] font-extrabold tracking-[0.1em] no-underline ${RPE_CAP_FLAG[v]}`}>
                            CAP
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-baseline justify-between text-[11px]">
                  <span className="text-app-tx3">Max effort this week</span>
                  <b className="font-semibold text-acc-ember">Nothing past {RPE_LABELS[status.returnWeek.rpeCap]}</b>
                </div>
              </div>
            </details>
          </div>
        </section>
      )}

      {/* ── Weigh-in nudge ──────────────────────────────── */}
      {daysSinceWeighIn !== null && daysSinceWeighIn > 7 && (
        <Link
          href="/stats"
          className="card-lg pressable flex items-center gap-3 border-acc-teal/30 bg-acc-teal/[0.06] px-4 py-3 shadow-[0_0_24px_-8px_rgba(45,212,191,0.45)] transition-colors hover:border-acc-teal/50"
        >
          <span className="chip flex-shrink-0 border border-acc-teal/40 bg-acc-teal/10 text-acc-teal">⚖ Weigh-in</span>
          <span className="text-xs tabular-nums text-acc-teal/80">{daysSinceWeighIn}d ago · log →</span>
        </Link>
      )}

      {/* ── Deload warning ──────────────────────────────── */}
      {deloadWarning && status.mode !== 'return' && (
        <div className="card-lg border-rpe-hard/30 bg-rpe-hard/[0.07] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex-shrink-0 text-xl leading-none">⚠️</span>
            <p className="text-sm font-bold text-rpe-hard">Fatigue signal</p>
            <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-app-tx2">&gt;50% Hard+ · 14d</span>
          </div>
          <details className="group mt-2">
            <summary className={`${SUMMARY_CHIP} border-rpe-hard/30 text-rpe-hard hover:border-rpe-hard/50 hover:text-rpe-hard`}>
              More
              <Chevron />
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-app-tx2">
              Over 50% of your sets in the last 2 weeks were Hard or Grind. Consider a lighter session — reduce weights by 40–50% and focus on form.
            </p>
          </details>
        </div>
      )}

      {/* ── Training days ───────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="section-label">
            {isGymDay ? (hour >= 17 ? 'Tonight’s session' : 'Today’s session') : 'Next session'}
          </p>
        </div>

        <div className="space-y-2.5">
          {dayOrder.map((day) => {
            const isSuggested = suggestedDay === day;
            const variant: DayVariant = isSuggested
              ? 'primary'
              : suggestedDay
                ? (lastTrainedThisBlock ? 'done' : 'muted')
                : 'neutral';
            return (
              <DayCard
                key={day}
                day={day}
                variant={variant}
                doneWhen={variant === 'done' && lastWorkout ? formatRelative(lastWorkout.date) : null}
              />
            );
          })}
        </div>
      </div>

      {/* ── Constellation stats ─────────────────────────── */}
      {workouts.length > 0 && (
        <div>
          <p className="section-label mb-3 px-1">All-time under this sky</p>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="card flex flex-col items-center gap-1 px-2 py-3.5 text-center">
              <b className="glow-violet font-round text-xl font-light leading-none tabular-nums">{workouts.length}</b>
              <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">Sessions</span>
            </div>
            <div className="card flex flex-col items-center gap-1 px-2 py-3.5 text-center">
              {streak > 0 ? (
                <b className="glow-cyan font-round text-xl font-light leading-none tabular-nums">
                  {streak}
                  <sup className="text-[10px] font-semibold text-app-tx3">wk</sup>
                </b>
              ) : (
                <b className="font-round text-xl font-light leading-none tabular-nums text-app-tx3">—</b>
              )}
              <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">Streak</span>
            </div>
            <div className="card flex flex-col items-center gap-1 px-2 py-3.5 text-center">
              <b className="glow-teal font-round text-xl font-light leading-none tabular-nums">
                {kgCompact(totalVolume)}
                <sup className="text-[10px] font-semibold text-app-tx3">kg</sup>
              </b>
              <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">Lifted</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Body weight — teal-green is the body's color ── */}
      {latestWeight && (
        <section className="card-lg flex items-center justify-between px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <b className="glow-teal font-round text-[27px] font-light leading-none tabular-nums tracking-tight">
              {latestWeight.weight!.toFixed(1)}
              <span className="ml-1 text-[13px] font-semibold text-app-tx3">kg</span>
            </b>
            <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-app-tx3">Body weight</span>
          </div>
          {firstWeight && firstWeight !== latestWeight && (
            <div className="flex flex-col items-end gap-0.5">
              <b
                className={`flex items-center gap-1 font-round text-[13px] font-semibold tabular-nums ${
                  weightDelta > 0 ? 'text-rpe-grind' : 'text-acc-teal'
                }`}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="flex-none">
                  {weightDelta > 0 ? (
                    <path d="M1.5 7l3.5-4 3.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M1.5 3l3.5 4 3.5-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
                {Math.abs(weightDelta).toFixed(1)} kg
              </b>
            </div>
          )}
        </section>
      )}

      {/* ── Recent workouts ─────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="section-label">Recent</p>
          {workouts.length > 4 && (
            <Link href="/workouts" className="text-[11px] font-semibold text-acc-teal transition-colors hover:text-[#99f6e4]">
              See all →
            </Link>
          )}
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="card-lg border-dashed p-8 text-center">
            <p className="mb-1 font-medium text-app-tx2">No workouts yet</p>
            <p className="mb-4 text-sm text-app-tx3">Tap a duration above to begin</p>
            <Link href="/program" className="text-sm text-acc-teal transition-colors hover:text-[#99f6e4]">
              Read the program first →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentWorkouts.map((workout) => {
              const dayLetter = workout.name.match(/Day ([AB])/i)?.[1]?.toUpperCase();
              const vol = workout.sets.reduce((s, set) => s + set.weight * set.reps, 0);
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}`}
                  className="card pressable flex items-center px-4 py-3.5 transition-all hover:border-app-border-hi active:scale-[0.99]"
                >
                  {/* Day badge — A glows violet, B glows teal */}
                  {dayLetter ? (
                    <span className={`mr-3 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl font-round text-[13px] font-extrabold ${
                      dayLetter === 'A'
                        ? 'border border-acc-violet/30 bg-acc-violet-deep/15 text-acc-violet'
                        : 'border border-acc-teal/30 bg-acc-teal-deep/15 text-acc-teal'
                    }`}>
                      {dayLetter}
                    </span>
                  ) : (
                    <span className="mr-3 h-8 w-8 flex-shrink-0 rounded-xl border border-app-border bg-white/5" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-app-tx1">{workout.name}</div>
                  </div>

                  <div className="ml-4 flex-shrink-0 text-right">
                    <div className="text-[11px] text-app-tx2">{formatRelative(workout.date)}</div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-app-tx3">
                      {vol > 0 && `${kgCompact(vol)} kg`}
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
