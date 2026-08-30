import Link from 'next/link';
import type { Metadata } from 'next';
import { getBodyStats, getWorkouts } from '../actions';
import {
  getDynamicPlan,
  cleanRampSessionDates,
  getTrainingStatus,
  getExerciseCountForDuration,
  getExercisesForDuration,
  parseDayLetter,
  queuedDay,
  isTrainingSession,
  recoveryActivity,
} from '@/lib/program';
import { phaseForWeek } from '@/lib/coach';
import CoachCard from '@/components/CoachCard';
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
    monogram: 'bg-gradient-to-br from-[#ddd6fe] to-acc-violet-deep text-white shadow-[0_0_24px_-4px_rgba(139,92,246,0.8)]',
    monogramQuiet: 'border border-acc-violet/35 bg-acc-violet-deep/15 text-acc-violet',
    tag: 'bg-gradient-to-r from-acc-violet to-[#a78bfa] text-white shadow-[0_0_14px_-2px_rgba(139,92,246,0.7)]',
    chip: 'border-acc-violet/50 bg-gradient-to-br from-acc-violet/25 to-acc-violet-deep/10 text-acc-violet shadow-[0_0_18px_-4px_rgba(139,92,246,0.55)]',
    accentText: 'text-acc-violet',
    start:
      'bg-gradient-to-r from-acc-violet to-acc-violet-deep text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_0_30px_-6px_rgba(139,92,246,0.8)]',
  },
  B: {
    glowCard: 'border-acc-teal/30 shadow-glow-teal',
    nebula: 'radial-gradient(240px 120px at 100% 0%, rgba(94,234,212,0.13), transparent 70%)',
    monogram: 'bg-gradient-to-br from-[#99f6e4] to-acc-teal-deep text-white shadow-[0_0_24px_-4px_rgba(45,212,191,0.8)]',
    monogramQuiet: 'border border-acc-teal/35 bg-acc-teal-deep/15 text-acc-teal',
    tag: 'bg-gradient-to-r from-acc-teal to-acc-cyan text-white shadow-[0_0_14px_-2px_rgba(94,234,212,0.7)]',
    chip: 'border-acc-teal/50 bg-gradient-to-br from-acc-teal/25 to-acc-teal-deep/10 text-acc-teal shadow-[0_0_18px_-4px_rgba(45,212,191,0.55)]',
    accentText: 'text-acc-teal',
    start:
      'bg-gradient-to-r from-acc-teal to-acc-cyan text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_30px_-6px_rgba(45,212,191,0.8)]',
  },
};

/* Quiet duration chip — plain glass, only the 45-min default lights up */
const CHIP_QUIET = 'border-app-border bg-ink/[0.04] text-app-tx2 hover:border-app-border-hi';

/* Quiet aurora affordance for <details> summaries — full copy lives one tap away */
const SUMMARY_CHIP =
  'chip inline-flex w-fit cursor-pointer select-none list-none items-center gap-1.5 border border-app-border bg-ink/5 text-[10px] uppercase tracking-[0.12em] text-app-tx3 transition-colors hover:border-app-border-hi hover:text-app-tx2 [&::-webkit-details-marker]:hidden';

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
          <span className="chip flex-none border border-app-border bg-ink/5 text-[9px] uppercase tracking-[0.12em] text-app-tx3">
            Done {doneWhen}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {DURATIONS.map((d) => (
            <Link
              key={d}
              href={`/workouts/new?day=${day}&dur=${d}`}
              className="pressable rounded-lg border border-app-border bg-ink/[0.03] py-1.5 text-center text-[11px] font-semibold tabular-nums text-app-tx3 transition-colors hover:border-app-border-hi hover:text-app-tx1"
            >
              {d}m
            </Link>
          ))}
        </div>
      </section>
    );
  }

  const primary = variant === 'primary';

  /* Volt directive card — the mock's solid-volt slab: giant outlined
     letter, black UP NEXT flag, black start bar. Day identity stays in
     the letter and label; the slab itself is always volt. */
  if (primary) {
    return (
      <section className="volt-card-primary">
        <span aria-hidden="true" className="volt-letter">{day}</span>
        <span className="volt-flag">Up next</span>
        <h3 className="relative mt-2 font-round text-[32px] font-black uppercase leading-none tracking-tight">Day {day}</h3>
        <p className="relative mt-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black/70">{DAY_FOCUS[day]}</p>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          {DURATIONS.map((d) => (
            <Link
              key={d}
              href={`/workouts/new?day=${day}&dur=${d}`}
              className={`pressable flex min-h-[44px] flex-col items-center justify-center gap-0.5 font-round text-[15px] font-extrabold leading-none tabular-nums ${
                d === 45
                  ? 'bg-black text-[#cdff00]'
                  : 'bg-black/10 text-black shadow-[inset_0_0_0_1.5px_#000]'
              }`}
            >
              {d}
              <span className="font-mono text-[8.5px] font-bold tracking-[0.18em] opacity-70">MIN</span>
            </Link>
          ))}
        </div>
        <Link href={`/workouts/new?day=${day}&dur=45`} className="volt-startbar pressable relative mt-3.5 w-full">
          <svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true" className="flex-none">
            <path d="M1.5 1.6c0-.9 1-1.5 1.8-1L12 6a1.2 1.2 0 0 1 0 2.1L3.3 13.4c-.8.5-1.8-.1-1.8-1z" fill="currentColor" />
          </svg>
          Start Day {day}
        </Link>
        <p className="relative mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black/55">
          B_Fit default · pins learned per machine
        </p>
      </section>
    );
  }

  return (
    <section className={`card-lg relative overflow-hidden p-4 ${variant === 'muted' ? 'opacity-60' : ''}`}>
      <span
        aria-hidden="true"
        className="volt-letter-quiet"
        style={{ WebkitTextStroke: `1.5px ${day === 'A' ? '#8b5cf6' : '#14b8a6'}` }}
      >
        {day}
      </span>
      <div className="relative">
        <div className="flex items-center gap-3">
          <div className={`grid h-11 w-11 flex-none place-items-center rounded-2xl font-round text-lg font-extrabold ${accent.monogramQuiet}`}>
            {day}
          </div>
          <div className="min-w-0">
            <h3 className="font-round text-base font-bold uppercase tracking-tight text-app-tx1">Day {day}</h3>
            <p className="mt-0.5 text-xs text-app-tx2">{DAY_FOCUS[day]}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {DURATIONS.map((d) => (
            <Link
              key={d}
              href={`/workouts/new?day=${day}&dur=${d}`}
              className={`pressable flex items-center justify-center rounded-xl border py-3 transition-colors ${CHIP_QUIET}`}
            >
              <span className="font-round text-[17px] font-semibold leading-none tabular-nums">
                {d}
                <span className="ml-0.5 text-[9px] font-bold uppercase tracking-[0.12em] opacity-70">min</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export const metadata: Metadata = { title: 'Train' };

export default async function TrainPage() {
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
  const trainingOnly = workouts.filter(isTrainingSession);
  const status = getTrainingStatus(trainingOnly.map((w) => w.date), new Date(), cleanRampSessionDates(trainingOnly));
  const programWeek = status.week;
  const currentPhase = phaseForWeek(programWeek);

  const phaseColor: Record<string, string> = {
    LEARN:    'bg-ink/10 text-app-tx2',
    BUILD:    'bg-acc-indigo/25 text-acc-indigo',
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

      {/* ── Volt masthead — date, live state, the big word, the tape ── */}
      <header>
        <div className="volt-topline">
          <span>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' })}
          </span>
          <span className="volt-live">
            {status.mode === 'return' ? `Return W${status.week}` : `Wk ${programWeek} · ${currentPhase.phase}`}
          </span>
        </div>
        <h1 className="volt-h1">Train<span className="volt-hollow">.</span></h1>
        <div className="volt-tape" aria-hidden="true" />
      </header>

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

      {/* The coach's voice — renders nothing until a note exists */}
      {process.env.ANTHROPIC_API_KEY ? <CoachCard /> : null}

      {/* ── The week, as a strip — mock's metgrid, not a card of air ── */}
      <section className="border-y border-app-border py-3">
        <div className="grid grid-cols-3">
          <div className="pr-3">
            <p className="font-round text-[22px] font-black leading-none tabular-nums text-app-tx1">
              {sessionsThisWeek}<span className="text-[14px] text-app-tx3">/3</span>
            </p>
            <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-app-tx3">Sessions · wk</p>
          </div>
          <div className="border-l border-app-border px-3">
            <p className="font-round text-[22px] font-black leading-none tabular-nums text-app-tx1">
              {sessionsThisWeek > 0 ? kgCompact(weekVolume) : '—'}
            </p>
            <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-app-tx3">kg this wk</p>
          </div>
          <div className="border-l border-app-border pl-3">
            <p className="font-round text-[13px] font-bold leading-tight text-app-tx1"><StepsChipLabel /></p>
            <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-app-tx3">Today</p>
          </div>
        </div>
      </section>

      {/* ── Return Protocol — exclusive ember, coach directive ── */}
      {status.mode === 'return' && (
        <section className="volt-protocol volt-protocol--ember p-4">
          <div className="relative">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-acc-ember">Return protocol</span>
              <span className="ml-auto flex-none bg-acc-ember-deep px-2 py-1 font-mono text-[9px] font-extrabold uppercase tracking-[0.2em] text-black">
                {status.returnWeek.phase}
              </span>
            </div>

            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-round text-[28px] font-black uppercase leading-none tracking-tight text-acc-ember">Week {status.week}</span>
              <span className="text-sm text-app-tx2">of 4</span>
              <span className="ml-auto flex items-center gap-1.5" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`h-2.5 w-6 ${i <= status.week ? 'bg-acc-ember-deep' : 'shadow-[inset_0_0_0_1.5px_#5a5d55]'}`}
                  />
                ))}
              </span>
            </div>

            {/* Coach voice — one line of personality on the glance layer */}
            <p className="mt-3 border-t border-ink/10 pt-3 text-[11px] font-semibold uppercase tracking-[0.13em]">
              <span className="glow-amber">We rebuild. We don&apos;t test.</span>
            </p>

            <div className="mt-3 flex border-t border-ink/10 pt-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">{status.returnWeek.loadPct}%</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">load</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-ink/10 pl-3.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">{status.returnWeek.sessions}</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">sessions</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-ink/10 pl-3.5">
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
                      v < cap ? RPE_SEG_ON[v] : v === cap ? RPE_SEG_CAP[v] : 'border-app-border bg-ink/[0.02] text-app-tx3 line-through opacity-60';
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

      {/* Program lives inside the Train section now — the tab it used to
          own belongs to the health-first IA. */}
      <Link
        href="/program"
        className="card flex items-center justify-between px-4 py-3 transition-colors hover:border-app-border-hi"
      >
        <div>
          <p className="text-sm font-semibold text-app-tx1">Program</p>
          <p className="text-[11px] text-app-tx3">the 12-week plan · return protocol · technique</p>
        </div>
        <span className="text-app-tx3">→</span>
      </Link>

      {/* ── Recent workouts ─────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="section-label">Recent</p>
          {workouts.length > 4 && (
            <Link href="/workouts" className="text-[11px] font-semibold text-acc-teal transition-colors hover:text-acc-teal">
              See all →
            </Link>
          )}
        </div>

        {recentWorkouts.length === 0 ? (
          <div className="card-lg border-dashed p-8 text-center">
            <p className="mb-1 font-medium text-app-tx2">No workouts yet</p>
            <p className="mb-4 text-sm text-app-tx3">Tap a duration above to begin</p>
            <Link href="/program" className="text-sm text-acc-teal transition-colors hover:text-acc-teal">
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
                    <span className="mr-3 h-8 w-8 flex-shrink-0 rounded-xl border border-app-border bg-ink/5" />
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
