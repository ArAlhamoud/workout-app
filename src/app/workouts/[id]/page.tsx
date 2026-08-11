import { notFound } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getPreviousSameDayWorkout, getWorkout } from '../../actions';
import { calendarDaysBetween, getTrainingStatus, isTrainingSession } from '@/lib/program';
import { lifetimeStats } from '@/lib/streak';
import DeleteButton from '@/components/DeleteButton';
import GapReasonInput from '@/components/GapReasonInput';
import { CATEGORY_BADGE, formatDateLong, formatDuration, formatRelative, kgCompact, RPE_LABELS } from '@/lib/format';
import { gymLabel } from '@/lib/program';

/* Effort spectrum — Easy teal-green, Med amber, Hard orange, Grind magenta */
const rpeBadge: Record<number, { label: string; cls: string }> = {
  1: { label: RPE_LABELS[1], cls: 'text-rpe-easy bg-rpe-easy/10 border-rpe-easy/30' },
  2: { label: RPE_LABELS[2], cls: 'text-rpe-med bg-rpe-med/10 border-rpe-med/30' },
  3: { label: RPE_LABELS[3], cls: 'text-rpe-hard bg-rpe-hard/10 border-rpe-hard/30' },
  4: { label: RPE_LABELS[4], cls: 'text-rpe-grind bg-rpe-grind/10 border-rpe-grind/30' },
};

export default async function WorkoutDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const [workout, previous] = await Promise.all([
    getWorkout(params.id),
    getPreviousSameDayWorkout(params.id),
  ]);
  if (!workout) notFound();

  // The welcome-back moment — the highest-leverage screen in the app. The
  // ladder gets him to open the app; what he sees after the first session
  // back decides whether week 2 happens. Shown only right after saving
  // (?new=1), only when this session ended a gap of 4+ days, and it leads
  // with the numbers a gap can never take away.
  // ?new=1 survives in bookmarks and back-navigation; the ceremony is for
  // the moment of saving, so it also requires the row to be minutes old.
  const isFreshSave =
    searchParams?.new === '1' && Date.now() - workout.createdAt.getTime() < 6 * 3_600_000;
  let welcomeBack: { gapDays: number; sessions: number; tonnageLabel: string } | null = null;
  // 6+, not 4: his normal cadence runs 2–4 days, and a full comeback
  // ceremony after an ordinary weekend cheapens the real one (trainer).
  // Walks earn no ceremony and reset no gap — only training does either.
  if (isFreshSave && isTrainingSession(workout)) {
    const previous = await prisma.workout.findFirst({
      where: {
        date: { lt: workout.date },
        id: { not: workout.id },
        NOT: { name: { startsWith: 'Rescue walk' } },
      },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    const gapDays = previous ? calendarDaysBetween(workout.date, previous.date) : 0;
    if (previous && gapDays >= 6) {
      const all = await prisma.workout.findMany({
        select: { sets: { select: { weight: true, reps: true, isWarmup: true } } },
      });
      const life = lifetimeStats(all);
      welcomeBack = { gapDays, sessions: life.sessions, tonnageLabel: life.label };
    }
  }
  // The hardcoded ±2.5/5 kg "Next Session Targets" block below is ramp-blind:
  // on a return-ramp day it says "Easy — add 5 kg" to deliberately deloaded
  // lifts, directly under the comeback card (trainer). Hidden while ramping —
  // the logger's pre-scaled prefill is the only voice then.
  const allDates = await prisma.workout.findMany({
    where: { NOT: { name: { startsWith: 'Rescue walk' } } },
    select: { date: true },
  });
  const inReturnRamp = getTrainingStatus(allDates.map((w) => w.date)).mode === 'return';

  const exerciseOrder: string[] = [];
  const exerciseMap = new Map<string, typeof workout.sets>();
  for (const set of workout.sets) {
    if (!exerciseMap.has(set.exerciseId)) {
      exerciseMap.set(set.exerciseId, []);
      exerciseOrder.push(set.exerciseId);
    }
    exerciseMap.get(set.exerciseId)!.push(set);
  }

  const totalVolume = workout.sets.reduce((sum, s) => sum + (s.isWarmup ? 0 : s.reps * s.weight), 0);

  const dayMatch = workout.name.match(/Day ([AB])/i);
  const dayLetter = dayMatch?.[1]?.toUpperCase();
  const durMatch = workout.name.match(/(\d+)m/);
  const logAgainHref = dayLetter
    ? `/workouts/new?day=${dayLetter}${durMatch ? `&dur=${durMatch[1]}` : ''}`
    : '/workouts/new';

  return (
    <div className="space-y-4">
      {welcomeBack && (
        <div className="card-lg border-acc-teal/40 px-4 py-4 shadow-[0_0_44px_-14px_rgba(45,212,191,0.45)]">
          <p className="glow-teal font-round text-lg font-bold">Welcome back. This is how it&apos;s done.</p>
          <p className="text-app-tx2 text-sm mt-1">
            {welcomeBack.gapDays} days away changed nothing that matters —
            <b className="text-app-tx1"> {welcomeBack.sessions} sessions</b> and
            <b className="text-app-tx1"> {welcomeBack.tonnageLabel}</b> are yours for good.
            Showing up today is the whole game.
          </p>
          {/* Never echo the reason back (editor): it was collected for the
              coach's context, and re-reading your own bad fortnight on a
              celebration card is the -100%-badge class of mistake. */}
          {workout.gapReason ? (
            <p className="mt-2 text-xs text-app-tx3">Noted.</p>
          ) : (
            <GapReasonInput workoutId={workout.id} />
          )}
        </div>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          
          <div className="flex items-center gap-3">
            {dayLetter && (
              <span className={`font-round text-[17px] font-extrabold w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                dayLetter === 'A'
                  ? 'bg-acc-violet-deep/15 border-acc-violet/30 glow-violet shadow-glow-violet'
                  : 'bg-acc-teal-deep/15 border-acc-teal/30 glow-teal shadow-glow-teal'
              }`}>
                {dayLetter}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold font-round tracking-tight leading-tight bg-clip-text text-transparent bg-[linear-gradient(100deg,#ffffff_20%,#c7d2fe_60%,#99f6e4_100%)]">
                {workout.name}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <p className="text-app-tx3 text-sm">{formatDateLong(workout.date)}</p>
                {gymLabel(workout.gym) && (
                  <span className="chip border border-acc-teal/30 bg-acc-teal/10 text-[9px] uppercase tracking-[0.12em] text-acc-teal">
                    {gymLabel(workout.gym)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <DeleteButton
          workoutId={workout.id}
          summary={`${workout.sets.length} sets · ${kgCompact(totalVolume)} kg`}
        />
      </div>

      {/* One number you can act on, plus the rest on one uncaptioned line.
          Four captioned tiles said how much was done; none said whether it
          was more or less than last time, which is the only question a
          finished session raises. Comparison is same-day-letter and
          same-gym — weights are not comparable across buildings. */}
      <div className="card-lg p-4">
        <div className="flex items-baseline gap-2.5">
          <span className="font-round text-3xl font-light tabular-nums glow-teal">
            {kgCompact(totalVolume)} kg
          </span>
          {previous && previous.volume > 0 && (() => {
            const pct = Math.round(((totalVolume - previous.volume) / previous.volume) * 100);
            const up = pct > 0;
            const flat = pct === 0;
            return (
              <span
                className={`text-sm font-semibold tabular-nums ${
                  flat ? 'text-app-tx3' : up ? 'text-rpe-easy' : 'text-rpe-hard'
                }`}
              >
                {flat ? '=' : up ? '▲' : '▼'} {up ? '+' : ''}{pct}%
                <span className="ml-1.5 font-normal text-app-tx3">
                  vs {formatRelative(previous.date)}
                </span>
              </span>
            );
          })()}
        </div>
        <p className="mt-1.5 text-xs tabular-nums text-app-tx3">
          {exerciseOrder.length} ex · {workout.sets.length} sets
          {workout.duration ? ` · ${formatDuration(workout.duration)}` : ''}
        </p>
      </div>

      {workout.notes && (
        <div className="card px-4 py-3">
          <p className="section-label mb-1">Notes</p>
          <p className="text-app-tx2 text-sm">{workout.notes}</p>
        </div>
      )}

      {/* Exercise list */}
      <div className="space-y-3">
        {exerciseOrder.map((exId) => {
          const sets = exerciseMap.get(exId)!;
          const exercise = sets[0].exercise;
          const colorClass = CATEGORY_BADGE[exercise.category] ?? 'text-app-tx2 bg-app-surface2 border-app-border';
          const exVolume = sets.reduce((s, set) => s + (set.isWarmup ? 0 : set.reps * set.weight), 0);

          return (
            <div key={exId} className="card-lg overflow-hidden">
              {/* Exercise header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-semibold text-app-tx1 text-sm truncate">{exercise.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 font-bold uppercase tracking-[0.08em] ${colorClass}`}>
                    {exercise.category}
                  </span>
                </div>
                <span className="text-app-tx3 text-xs flex-shrink-0 ml-2">
                  {exVolume > 0 ? `${exVolume.toLocaleString()} kg` : `${sets.length} sets`}
                </span>
              </div>

              {/* Set rows */}
              <div className="px-4 py-3 space-y-1.5">
                {sets.map((set) => {
                  const rpe = set.rpe ? rpeBadge[set.rpe] : null;
                  return (
                    <div key={set.id} className="flex items-center gap-3 text-sm py-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-app-tx3 tabular-nums w-4 text-center">{set.setNumber}</span>
                        {rpe && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold leading-none ${rpe.cls}`}>
                            {rpe.label}
                          </span>
                        )}
                      </div>
                      <span className="text-app-tx1 tabular-nums">
                        {set.weight > 0 ? `${set.weight} kg` : '—'}
                        <span className="text-app-tx3 mx-1">×</span>
                        {set.reps}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Next session targets */}
      {(() => {
        // Ramp-blind by construction (hardcoded ±2.5/5 kg): silenced during
        // the return ramp, where "Easy — add 5 kg" on a deliberately
        // deloaded lift is exactly wrong. Warm-ups prescribe nothing.
        if (inReturnRamp) return null;
        const targets: { name: string; current: number; next: number; note: string }[] = [];
        for (const exId of exerciseOrder) {
          const sets = exerciseMap.get(exId)!;
          const workingSets = sets.filter((st) => !st.isWarmup);
          if (!workingSets.length) continue;
          const maxWeight = Math.max(...workingSets.map((s) => s.weight));
          if (maxWeight <= 0) continue;
          const maxRpe = workingSets.reduce((m, s) => (s.rpe && s.rpe > m ? s.rpe : m), 0);
          let next = maxWeight;
          let note = '';
          if (maxRpe === 0)      { next = +(maxWeight + 2.5).toFixed(1); note = 'No RPE — try +2.5 kg'; }
          else if (maxRpe === 1) { next = +(maxWeight + 5).toFixed(1);   note = 'Easy — add 5 kg'; }
          else if (maxRpe === 2) { next = +(maxWeight + 2.5).toFixed(1); note = 'Medium — add 2.5 kg'; }
          else if (maxRpe === 3) { next = maxWeight;                      note = 'Hard — hold weight'; }
          else if (maxRpe === 4) { next = +(maxWeight - 2.5).toFixed(1); note = 'Grind — drop 2.5 kg'; }
          targets.push({ name: sets[0].exercise.name, current: maxWeight, next, note });
        }
        if (!targets.length) return null;
        return (
          <div className="card-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-app-border">
              <p className="section-label">Next Session Targets</p>
            </div>
            <div className="divide-y divide-app-border">
              {targets.map((t) => (
                <div key={t.name} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-app-tx1 text-sm font-medium truncate">{t.name}</p>
                    <p className="text-app-tx3 text-xs mt-0.5">{t.note}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {/* raise = teal glow · hold = neutral · drop = magenta */}
                    <span className={`text-sm font-semibold font-round tabular-nums ${
                      t.next > t.current
                        ? 'glow-teal'
                        : t.next < t.current
                          ? 'text-rpe-grind [text-shadow:0_0_14px_rgba(244,63,94,0.4)]'
                          : 'text-app-tx2'
                    }`}>
                      {t.next} kg
                    </span>
                    {t.next !== t.current && (
                      <p className="text-app-tx3 text-xs tabular-nums">was {t.current} kg</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Repeat workout */}
      <Link
        href={logAgainHref}
        className="w-full flex items-center justify-center gap-2 btn-ghost rounded-card-lg py-4 text-sm font-semibold transition-all active:scale-[0.99]"
      >
        Repeat this workout →
      </Link>
    </div>
  );
}
