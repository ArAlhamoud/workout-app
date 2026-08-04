import Link from 'next/link';
import { getBodyStats, getWorkouts } from './actions';
import {
  getDynamicPlan,
  getTrainingStatus,
  getExerciseCountForDuration,
  getExercisesForDuration,
  parseDayLetter,
  queuedDay,
  isTrainingSession,
  recoveryActivity,
} from '@/lib/program';
import { phaseForWeek } from '@/lib/coach';
import HomeVerdict from '@/components/HomeVerdict';
import StepsChipLabel from '@/components/StepsChipLabel';
import { formatDuration, formatRelative, getMondayOfWeek, kgCompact, RPE_LABELS, weekKey } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DURATIONS = [30, 45, 60] as const;

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

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

  // Week stats (Monday-start weeks)
  const weekStart = getMondayOfWeek(new Date());
  const sessionsThisWeek = workouts.filter((w) => new Date(w.date) >= weekStart).length;

  // Week volume
  const weekVolume = workouts
    .filter((w) => new Date(w.date) >= weekStart)
    .reduce((sum, w) => sum + w.sets.reduce((s, set) => s + (set.isWarmup ? 0 : set.weight * set.reps), 0), 0);

  const isSunday = new Date().getDay() === 0;

  // What his own log says to do today: train (alternating A/B), recover the
  // day after a session, or nothing at all because it's already logged.
  const plan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })));
  const isTrainDay = plan.mode === 'train';
  const isDoneToday = plan.mode === 'done-today';
  // The glowing day. After a session logged today nothing glows — the day
  // he did shows as done and the other stays neutral, both still startable.
  const suggestedDay: DayId | null = isDoneToday ? null : plan.day;
  const nextDay: DayId = queuedDay(plan);
  const restActivity = recoveryActivity(plan.lastDay);

  const lastWorkout = workouts[0] ?? null;

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
  const status = getTrainingStatus(workouts.filter(isTrainingSession).map((w) => w.date));
  const programWeek = status.week;
  const currentPhase = phaseForWeek(programWeek);

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
  // Whatever is next sits on top — after a logged session that's the alternate.
  const dayOrder: DayId[] = nextDay === 'B' ? ['B', 'A'] : ['A', 'B'];

  return (
    <div className="space-y-4">

      {/* ── The verdict — first thing on the screen ───────
          Server-rendered from the plan + the training status. Inside the native
          shell it upgrades itself with a HealthKit readiness read (and shows the
          readiness banner above it); on the web that read never happens and this
          is exactly the line the plan alone produces. */}
      <HomeVerdict
        status={status}
        plan={plan}
        lastSessionISO={lastWorkout?.date.toISOString() ?? null}
      />

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
          <div className="relative h-[72px] w-[72px] flex-none" role="img" aria-label={`${sessionsThisWeek} of 3 sessions this week`}>
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
              <div className="font-round text-lg font-light leading-none tabular-nums text-app-tx1">
                <b className="font-bold text-[#99f6e4]">{sessionsThisWeek}</b>
                <span className="text-sm text-app-tx3">/3</span>
              </div>
            </div>
          </div>

          {/* Only fact here HomeVerdict does not already carry. */}
          {sessionsThisWeek > 0 && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-xs tabular-nums text-app-tx2">
                <b className="font-semibold text-[#99f6e4]">{kgCompact(weekVolume)} kg</b> this week
              </p>
            </div>
          )}
          <div className="ml-auto flex min-w-0 flex-col items-end gap-1.5">
            <span className="min-w-0 text-[11px] text-app-tx2"><StepsChipLabel /></span>
            {status.mode === 'return' ? (
              <span className="chip flex-none border border-acc-ember/40 bg-acc-ember/10 text-acc-ember">
                Return W{status.week} · {status.returnWeek.phase}
              </span>
            ) : (
              <span className={`chip flex-none ${phaseColor[currentPhase.phase] ?? 'bg-white/10 text-app-tx2'}`}>
                Wk {programWeek} · {currentPhase.phase}
              </span>
            )}
        
          </div>
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
      {/* Widened from >7 days to also cover Sunday: this absorbed the weigh-in
          chip that used to sit in the greeting header, so there is one weigh-in
          affordance instead of two. */}
      {daysSinceWeighIn !== null && (daysSinceWeighIn > 7 || isSunday) && (
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
            {isTrainDay ? (hour >= 17 ? 'Tonight’s session' : 'Today’s session') : 'Next session'}
          </p>
        </div>

        {/* Both days stay startable, always — the plan suggests, it never blocks. */}
        <div className="space-y-2.5">
          {dayOrder.map((day) => {
            const justLogged = isDoneToday && plan.day === day;
            const variant: DayVariant = justLogged
              ? 'done'
              : suggestedDay === day
                ? 'primary'
                : suggestedDay
                  ? 'muted'
                  : 'neutral';
            return (
              <DayCard
                key={day}
                day={day}
                variant={variant}
                doneWhen={justLogged && lastWorkout ? formatRelative(lastWorkout.date) : null}
              />
            );
          })}
        </div>
      </div>

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
              const dayLetter = parseDayLetter(workout.name);
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
