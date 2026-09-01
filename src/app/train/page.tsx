import Link from 'next/link';
import type { Metadata } from 'next';
import { getExercises, getLoggerMemory, getWorkouts } from '../actions';
import {
  getDynamicPlan,
  cleanRampSessionDates,
  getTrainingStatus,
  getExercisesForDuration,
  queuedDay,
  isTrainingSession,
  rampBaseBefore,
  rampPrefillWeight,
  DEFAULT_GYM_ID,
} from '@/lib/program';
import { combineIncrement, learnPinIncrements, phaseForWeek } from '@/lib/coach';
import CoachCard from '@/components/CoachCard';
import VoltLetter from '@/components/VoltLetter';
import { formatRelative, RPE_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DURATIONS = [30, 45, 60] as const;

/* Day identity — A violet, B teal, on the Volt stage. */
type DayId = 'A' | 'B';
type DayVariant = 'primary' | 'muted' | 'neutral' | 'done';

const DAY_FOCUS: Record<DayId, string> = {
  A: 'Chest · Quads · Shoulders',
  B: 'Back · Hamstrings · Arms',
};

const DAY_QUIET: Record<DayId, string> = {
  A: 'border border-acc-violet/35 bg-acc-violet-deep/15 text-acc-violet',
  B: 'border border-acc-teal/35 bg-acc-teal-deep/15 text-acc-teal',
};

const CHIP_QUIET = 'border-app-border bg-ink/[0.04] text-app-tx2 hover:border-app-border-hi';

/* Quiet affordance for <details> summaries — full copy lives one tap away */
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
  /* Quiet done-row — this day was trained this block; links stay intact */
  if (variant === 'done') {
    return (
      <section className="card p-3.5 opacity-80">
        <div className="flex items-center gap-3">
          <div className={`grid h-9 w-9 flex-none place-items-center rounded-xl font-round text-sm font-extrabold ${DAY_QUIET[day]}`}>
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

  /* The directive — the mock's solid-volt slab: giant outlined letter,
     black UP NEXT flag, black start bar. */
  if (variant === 'primary') {
    return (
      <section className="volt-card-primary">
        <VoltLetter letter={day} stroke="rgba(0,0,0,0.28)" className="volt-letter-svg" />
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
      </section>
    );
  }

  return (
    <section className={`card relative overflow-hidden p-3.5 ${variant === 'muted' ? 'opacity-60' : ''}`}>
      <VoltLetter
        letter={day}
        stroke={day === 'A' ? '#8b5cf6' : '#14b8a6'}
        strokeWidth={2.5}
        className="volt-letter-svg volt-letter-svg--quiet"
      />
      <div className="relative flex items-center gap-3">
        <div className={`grid h-10 w-10 flex-none place-items-center rounded-xl font-round text-base font-extrabold ${DAY_QUIET[day]}`}>
          {day}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-round text-sm font-bold uppercase tracking-tight text-app-tx1">Day {day}</h3>
          <p className="mt-0.5 text-[11px] text-app-tx2">{DAY_FOCUS[day]}</p>
        </div>
        <div className="flex gap-1.5">
          {DURATIONS.map((d) => (
            <Link
              key={d}
              href={`/workouts/new?day=${day}&dur=${d}`}
              className={`pressable rounded-lg border px-2.5 py-1.5 text-center text-[11px] font-semibold tabular-nums transition-colors ${CHIP_QUIET}`}
            >
              {d}m
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export const metadata: Metadata = { title: 'Train' };

export default async function TrainPage() {
  const [workouts, exercises] = await Promise.all([getWorkouts(), getExercises()]);

  // What his own log says to do today: train (alternating A/B), recover the
  // day after a session, or nothing at all because it's already logged.
  const plan = getDynamicPlan(workouts.map((w) => ({ date: w.date, name: w.name })));
  const isDoneToday = plan.mode === 'done-today';
  const suggestedDay: DayId | null = isDoneToday ? null : plan.day;
  const nextDay: DayId = queuedDay(plan);
  const lastWorkout = workouts[0] ?? null;

  // Where the lifter actually is: fresh, ramping back, or mid-program.
  const trainingOnly = workouts.filter(isTrainingSession);
  const cleanDates = cleanRampSessionDates(trainingOnly);
  const status = getTrainingStatus(trainingOnly.map((w) => w.date), new Date(), cleanDates);
  const currentPhase = phaseForWeek(status.week);
  const returnLoadPct = status.mode === 'return' ? status.returnWeek.loadPct : null;

  // Fatigue signal — one mono line, not a card (the ramp supersedes it).
  const deloadWarning = (() => {
    const cutoff = new Date(Date.now() - 14 * 86400000);
    const recentSets = workouts
      .filter((w) => new Date(w.date) >= cutoff)
      .flatMap((w) => w.sets)
      .filter((s) => s.rpe != null && s.rpe > 0);
    if (recentSets.length < 6) return false;
    return recentSets.filter((s) => s.rpe! >= 3).length / recentSets.length > 0.5;
  })();

  // ── Session preview: the queued day's machines with the weights he will
  // actually see in the logger — gym-scoped to B_Fit (rule 2), pre-scaled
  // by the ramp when it is running. This list IS the plan; the logger just
  // makes it editable.
  const previewDay: DayId = suggestedDay ?? nextDay;
  const template = getExercisesForDuration(previewDay, 45);
  const exerciseByName = new Map(exercises.map((e) => [e.name, e]));
  const previewIds = template
    .map((te) => exerciseByName.get(te.name)?.id)
    .filter((id): id is string => Boolean(id));
  // Same memory and same pin-floored scaler as the logger and the wrist —
  // one plan, not three (adversary: /train once showed a different ramp
  // weight than the logger prefilled the same day).
  const lastByExercise = await getLoggerMemory(
    previewIds,
    DEFAULT_GYM_ID,
    returnLoadPct != null ? rampBaseBefore(trainingOnly, cleanDates) : undefined,
  );
  const learnedPins = learnPinIncrements(workouts.filter((w) => !w.gym || w.gym === DEFAULT_GYM_ID));
  const preview = template.map((te) => {
    const ex = exerciseByName.get(te.name);
    const last = ex ? lastByExercise[ex.id] : undefined;
    const lastW = last && last.weight > 0 ? last.weight : null;
    const pin = ex ? combineIncrement(learnedPins[ex.id], ex.pinIncrement) : 2.5;
    const shownW =
      last && lastW != null && returnLoadPct != null ? rampPrefillWeight(last, returnLoadPct, pin) : lastW;
    return {
      name: te.name,
      setsReps: `${te.sets} × ${te.repsDisplay}`,
      isHold: te.unit === 'seconds',
      weight: te.unit === 'seconds' ? null : shownW,
      scaled: returnLoadPct != null && lastW != null && !last?.rampHold,
    };
  });

  const hour = new Date().getHours();

  return (
    <div className="space-y-5">
      {/* ── Volt masthead — date, live state, the big word, the tape ── */}
      <header>
        <div className="volt-topline">
          <span>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' })}
          </span>
          <span className="volt-live">
            {status.mode === 'return' ? `Return W${status.week}` : `Wk ${status.week} · ${currentPhase.phase}`}
          </span>
        </div>
        <h1 className="volt-h1">Train<span className="volt-dot" aria-hidden="true" /></h1>
        <div className="volt-tape" aria-hidden="true" />
      </header>

      {/* The coach's voice — renders nothing until a note exists */}
      {process.env.ANTHROPIC_API_KEY ? <CoachCard /> : null}

      {/* ── Return Protocol — one ember line while the ramp runs; the
          slab and preview already carry the scaled targets, so the strip
          states the regime once and keeps the rules a tap away. */}
      {status.mode === 'return' && (
        <details className="group">
          <summary className="flex cursor-pointer select-none list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="h-2 w-2 flex-none bg-acc-ember-deep" aria-hidden="true" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-acc-ember">
              Return W{status.week} · {status.returnWeek.phase} · {status.returnWeek.loadPct}% · cap {RPE_LABELS[status.returnWeek.rpeCap]}
            </span>
            <span className="ml-auto flex items-center gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 w-4 ${i <= status.week ? 'bg-acc-ember-deep' : 'shadow-[inset_0_0_0_1px_#5a5d55]'}`}
                />
              ))}
            </span>
            <Chevron />
          </summary>
          <div className="volt-protocol volt-protocol--ember mt-2.5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em]">
              <span className="glow-amber">We rebuild. We don&apos;t test.</span>
            </p>
            <p className="mt-2.5 text-[11px] font-semibold uppercase leading-loose tracking-[0.13em] text-app-tx2">
              {status.daysOff} days off. Run <b className="text-app-tx1">{status.returnWeek.sessions} sessions</b> at{' '}
              <b className="text-app-tx1">{status.returnWeek.loadPct}%</b> of pre-break weights. Nothing heavier. Nothing longer.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-app-tx3">{status.returnWeek.desc}</p>

            <div className="mt-3" role="img" aria-label={`Effort capped at ${RPE_LABELS[status.returnWeek.rpeCap]}. Scale: Easy, Med, Hard, Grind.`}>
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
            </div>
          </div>
        </details>
      )}

      {/* Fatigue signal — one mono line; the ramp supersedes it */}
      {deloadWarning && status.mode !== 'return' && (
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-rpe-hard">
          ⚠ Fatigue · &gt;50% hard+ over 14d — go lighter today
        </p>
      )}

      {/* ── The directive ───────────────────────────────── */}
      <div>
        <p className="section-label mb-3">
          {isDoneToday ? 'Logged today' : hour >= 17 ? 'Tonight’s directive' : 'Today’s directive'}
        </p>
        <DayCard
          day={previewDay}
          variant={isDoneToday ? 'done' : 'primary'}
          doneWhen={isDoneToday && lastWorkout ? formatRelative(lastWorkout.date) : null}
        />
      </div>

      {/* ── Session preview — what the start bar opens ───── */}
      {preview.length > 0 && (
        <div>
          <p className="section-label mb-3">
            Session preview · B_Fit{returnLoadPct != null ? ` · at ${returnLoadPct}%` : ''}
          </p>
          <div className="space-y-2">
            {preview.map((row, i) => (
              <div key={row.name} className="card flex min-h-[60px] items-center gap-3.5 px-4 py-3">
                <span className={`grid h-10 w-10 flex-none place-items-center font-round text-base font-extrabold ${DAY_QUIET[previewDay]}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-app-tx1">{row.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3">{row.setsReps}</p>
                </div>
                <div className="flex-none text-right">
                  {row.isHold ? (
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3">Hold</p>
                  ) : row.weight != null ? (
                    <>
                      <p className="font-round text-[17px] font-extrabold leading-none tabular-nums text-app-tx1">
                        {row.weight}
                        <span className="ml-1 text-[10px] font-bold text-app-tx3">KG</span>
                      </p>
                      <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-app-tx3">
                        {row.scaled ? 'Ramp target' : 'Last time'}
                      </p>
                    </>
                  ) : (
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3">New</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The other day, one line — still startable, never nagging ── */}
      <DayCard
        day={previewDay === 'A' ? 'B' : 'A'}
        variant={suggestedDay ? 'muted' : 'neutral'}
        doneWhen={null}
      />
    </div>
  );
}
