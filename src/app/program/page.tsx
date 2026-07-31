import Link from 'next/link';
import type { Metadata } from 'next';
import { DAY_A, DAY_B, SCHEDULE, PROGRESSION, RETURN_PROGRAM, BREAK_THRESHOLD_DAYS, CARDIO, getTrainingStatus, type Priority } from '@/lib/program';
import { getExercises, getBodyStats, getWorkouts } from '@/app/actions';
import CollapsibleSection from '@/components/CollapsibleSection';
import { getMondayOfWeek, RPE_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Program' };

const priorityBadge: Record<Priority, { label: string; cls: string }> = {
  1: { label: 'Always', cls: 'bg-acc-teal/10 text-acc-teal border-acc-teal/30' },
  2: { label: '45+ min', cls: 'bg-acc-indigo/15 text-indigo-300 border-indigo-400/30' },
  3: { label: '60 min', cls: 'bg-app-surface2 text-app-tx2 border-app-border' },
};

/* Cardio ranking badges — aurora hues; amber stays reserved for the Return Protocol */
const badgeColors: Record<string, string> = {
  BEST: 'bg-rpe-easy/15 text-rpe-easy',
  GREAT: 'bg-acc-teal/15 text-acc-teal',
  GOOD: 'bg-acc-cyan/10 text-acc-cyan',
  CAUTION: 'bg-rpe-hard/15 text-rpe-hard',
};

const phaseColors: Record<string, string> = {
  LEARN: 'bg-white/10 text-app-tx2',
  BUILD: 'bg-acc-indigo/25 text-indigo-300',
  PUSH: 'bg-acc-teal/15 text-acc-teal',
  DELOAD: 'bg-rpe-hard/15 text-rpe-hard',
  REBUILD: 'bg-acc-violet/15 text-acc-violet',
  EVALUATE: 'bg-acc-cyan/15 text-acc-cyan',
};

/* Aurora day accents — Day A glows violet, Day B glows teal */
const dayAccent = {
  A: {
    start:
      'bg-gradient-to-r from-acc-violet to-acc-violet-deep text-[#14082e] shadow-[0_0_20px_-4px_rgba(139,92,246,0.7)] hover:brightness-110',
    chip: 'bg-acc-violet-deep/15 text-acc-violet border border-acc-violet/30',
    linkHover: 'hover:text-acc-violet',
  },
  B: {
    start:
      'bg-gradient-to-r from-acc-teal to-acc-cyan text-[#062521] shadow-[0_0_20px_-4px_rgba(45,212,191,0.7)] hover:brightness-110',
    chip: 'bg-acc-teal-deep/15 text-acc-teal border border-acc-teal/30',
    linkHover: 'hover:text-acc-teal',
  },
} as const;

/* Rotating chevron for disclosure summaries */
function Chevron({ className = '' }: { className?: string }) {
  return (
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
      className={`transition-transform duration-200 group-open:rotate-180 ${className}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

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
        <Chevron />
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

/* Effort-ceiling lockout ladder segments (index by RPE 1–4) —
   Hard/Grind render unlit while the return protocol caps effort */
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

export default async function ProgramPage() {
  const [exercises, bodyStats, workouts] = await Promise.all([
    getExercises(),
    getBodyStats(),
    getWorkouts(),
  ]);
  const exerciseIdByName = new Map(exercises.map((e) => [e.name, e.id]));

  // Where the lifter actually is this week
  const status = getTrainingStatus(workouts.map((w) => w.date));
  const weekStart = getMondayOfWeek(new Date());
  const sessionsThisWeek = workouts.filter((w) => new Date(w.date) >= weekStart).length;
  const currentPhase =
    PROGRESSION.find((p) => {
      const parts = p.weeks.split('–').map((s) => parseInt(s.trim()));
      const [start, end] = parts.length === 2 ? parts : [parts[0], parts[0]];
      return status.week >= start && status.week <= end;
    }) ?? PROGRESSION[0];

  const todayDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
  const latestWeight = [...bodyStats].reverse().find((s) => s.weight !== null)?.weight ?? 132;
  const firstWeight = bodyStats.find((s) => s.weight !== null)?.weight ?? null;
  const weightChange = firstWeight !== null ? +(latestWeight - firstWeight).toFixed(1) : null;

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div>
        <p className="section-label mb-1">
          12-Week Fat Loss
        </p>
        <h1 className="bg-gradient-to-r from-white via-[#c7d2fe] to-[#99f6e4] bg-clip-text font-round text-2xl font-bold tracking-tight text-transparent">
          Your Program
        </h1>
      </div>

      {/* This Week — live status */}
      {status.mode === 'return' ? (
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
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-acc-ember">This week · Return protocol</span>
              <span className="chip ml-auto flex-none bg-gradient-to-r from-acc-ember to-acc-ember-deep text-[9px] uppercase tracking-[0.14em] text-[#1a1206] shadow-[0_0_18px_-4px_rgba(245,158,11,0.75)]">
                {status.returnWeek.phase}
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="glow-amber font-round text-2xl font-light tabular-nums tracking-tight">Week {status.week}</span>
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

            {/* Coach voice — the directive keeps its single line; prose lives one tap away */}
            <p className="mt-3 border-t border-white/10 pt-3 text-[11px] font-semibold uppercase leading-loose tracking-[0.13em] text-app-tx2">
              <span className="glow-amber">We rebuild. We don&apos;t test.</span>
            </p>
            <Details label="More" className="mt-1">
              <p className="text-[11px] leading-relaxed text-app-tx3">
                Run <b className="text-app-tx1">{status.returnWeek.sessions} sessions</b> at{' '}
                <b className="text-app-tx1">{status.returnWeek.loadPct}%</b> of pre-break weights. Nothing heavier. Nothing longer.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-app-tx3">{status.returnWeek.desc}</p>
            </Details>

            <div className="mt-3 flex border-t border-white/10 pt-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">{status.week}/4</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">ramp week</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-white/10 pl-3.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">{status.returnWeek.loadPct}%</b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">load cap</span>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 border-l border-white/10 pl-3.5">
                <b className="font-round text-[15px] font-semibold tabular-nums text-app-tx1">
                  {sessionsThisWeek}/{status.returnWeek.sessions}
                </b>
                <span className="text-[9px] font-bold uppercase tracking-[0.11em] text-app-tx3">sessions</span>
              </div>
            </div>

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
            </div>
          </div>
        </section>
      ) : (
        <section className="card-lg p-4">
          <div className="flex items-center justify-between">
            <p className="section-label">This Week</p>
            <span
              className={`chip flex-shrink-0 ${
                phaseColors[currentPhase.phase] || 'bg-app-surface2 text-app-tx2'
              }`}
            >
              Wk {status.week} · {currentPhase.phase}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-round text-2xl font-light tabular-nums tracking-tight text-app-tx1">
              {sessionsThisWeek}/3
            </span>
            <span className="text-xs text-app-tx3">sessions</span>
          </div>
          <Details label="More" className="mt-1.5">
            <p className="text-app-tx2 text-xs leading-relaxed">{currentPhase.desc}</p>
          </Details>
        </section>
      )}

      {/* Weekly Schedule */}
      <section>
        <p className="section-label mb-3">
          Weekly Schedule
        </p>
        <div className="grid grid-cols-7 gap-1">
          {SCHEDULE.map((s) => {
            // Light IS the information system — Day A glows violet, Day B teal
            const isFlex = s.workout === 'A/B';
            const cellCls =
              s.type === 'gym'
                ? isFlex
                  ? 'border border-app-border-hi bg-white/[0.06]'
                  : s.workout?.includes('A')
                    ? 'border border-acc-violet/40 bg-acc-violet-deep/15 shadow-[0_0_14px_-4px_rgba(139,92,246,0.5)]'
                    : 'border border-acc-teal/40 bg-acc-teal-deep/15 shadow-[0_0_14px_-4px_rgba(45,212,191,0.5)]'
                : 'border border-app-border bg-app-surface';
            const workoutCls = isFlex
              ? 'bg-gradient-to-r from-acc-violet to-acc-teal bg-clip-text text-transparent'
              : s.workout?.includes('A')
                ? 'text-acc-violet [text-shadow:0_0_14px_rgba(139,92,246,0.55)]'
                : 'text-acc-teal [text-shadow:0_0_14px_rgba(45,212,191,0.55)]';
            return (
              <div
                key={s.day}
                className={`rounded-xl p-2 text-center ${
                  s.day === todayDayName ? 'ring-2 ring-white/25 ring-offset-1 ring-offset-app-bg' : ''
                } ${cellCls}`}
              >
                <div className={`text-xs font-medium ${s.day === todayDayName ? 'text-app-tx1' : 'text-app-tx2'}`}>{s.day}</div>
                {s.workout ? (
                  <div className={`font-round text-sm font-extrabold mt-0.5 ${workoutCls}`}>
                    {s.workout}
                  </div>
                ) : (
                  <div className="text-xs text-app-tx3 mt-1">—</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Day A */}
      <CollapsibleSection title="Day A" badge={DAY_A.focus} defaultOpen>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-app-tx1 font-bold text-lg">{DAY_A.focus}</h2>
          <Link
            href="/workouts/new?day=A&dur=45"
            className={`px-4 py-2 rounded-card text-sm font-bold transition-all pressable ${dayAccent.A.start}`}
          >
            Start &#8594;
          </Link>
        </div>
        <details className="group bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mb-3">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Warm-up</span>
            <Chevron className="text-app-tx3" />
          </summary>
          <p className="text-app-tx2 text-xs mt-2 leading-relaxed">{DAY_A.warmup}</p>
        </details>
        <div className="space-y-2">
          {DAY_A.exercises.map((ex, i) => {
            const exId = exerciseIdByName.get(ex.name);
            const pb = priorityBadge[ex.priority];
            return (
              <div key={ex.name} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-app-tx1 font-semibold text-sm">{ex.name}</span>
                      <span className={`chip ${dayAccent.A.chip}`}>
                        {ex.sets}&#215;{ex.repsDisplay}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${pb.cls}`}>
                        {pb.label}
                      </span>
                      {exId && (
                        <Link href={`/progress/${exId}`} className={`text-xs text-app-tx3 transition-colors ${dayAccent.A.linkHover}`}>
                          Progress &#8594;
                        </Link>
                      )}
                    </div>
                    <div className="text-app-tx3 text-xs mt-1">{ex.machine} · {ex.rest} rest</div>
                    <Details label="Technique" className="mt-1.5">
                      <p className="text-app-tx2 text-xs leading-relaxed">{ex.cues}</p>
                    </Details>
                  </div>
                  <div className="text-app-tx3 text-lg font-black flex-shrink-0 tabular-nums">{i + 1}</div>
                </div>
              </div>
            );
          })}
        </div>
        <details className="group bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mt-3">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Cardio finisher</span>
            <Chevron className="text-app-tx3" />
          </summary>
          <p className="text-app-tx2 text-xs mt-2 leading-relaxed">{DAY_A.cardioFinisher}</p>
        </details>
      </CollapsibleSection>

      {/* Day B */}
      <CollapsibleSection title="Day B" badge={DAY_B.focus} defaultOpen>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-app-tx1 font-bold text-lg">{DAY_B.focus}</h2>
          <Link
            href="/workouts/new?day=B&dur=45"
            className={`px-4 py-2 rounded-card text-sm font-bold transition-all pressable ${dayAccent.B.start}`}
          >
            Start &#8594;
          </Link>
        </div>
        <details className="group bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mb-3">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Warm-up</span>
            <Chevron className="text-app-tx3" />
          </summary>
          <p className="text-app-tx2 text-xs mt-2 leading-relaxed">{DAY_B.warmup}</p>
        </details>
        <div className="space-y-2">
          {DAY_B.exercises.map((ex, i) => {
            const exId = exerciseIdByName.get(ex.name);
            const pb = priorityBadge[ex.priority];
            return (
              <div key={ex.name} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-app-tx1 font-semibold text-sm">{ex.name}</span>
                      <span className={`chip ${dayAccent.B.chip}`}>
                        {ex.sets}&#215;{ex.repsDisplay}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${pb.cls}`}>
                        {pb.label}
                      </span>
                      {exId && (
                        <Link href={`/progress/${exId}`} className={`text-xs text-app-tx3 transition-colors ${dayAccent.B.linkHover}`}>
                          Progress &#8594;
                        </Link>
                      )}
                    </div>
                    <div className="text-app-tx3 text-xs mt-1">{ex.machine} · {ex.rest} rest</div>
                    <Details label="Technique" className="mt-1.5">
                      <p className="text-app-tx2 text-xs leading-relaxed">{ex.cues}</p>
                    </Details>
                  </div>
                  <div className="text-app-tx3 text-lg font-black flex-shrink-0 tabular-nums">{i + 1}</div>
                </div>
              </div>
            );
          })}
        </div>
        <details className="group bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mt-3">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Cardio finisher</span>
            <Chevron className="text-app-tx3" />
          </summary>
          <p className="text-app-tx2 text-xs mt-2 leading-relaxed">{DAY_B.cardioFinisher}</p>
        </details>
      </CollapsibleSection>

      {/* Return protocol */}
      <CollapsibleSection title="Return After a Break">
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] leading-loose text-app-tx2">
          <span className="text-acc-ember">We rebuild. We don&apos;t test.</span>
        </p>
        <Details label="How it works" className="mt-1 mb-3">
          <p className="text-app-tx2 text-xs leading-relaxed">
            After {BREAK_THRESHOLD_DAYS}+ days off, the app switches to this 4-week ramp
            automatically and pre-scales every weight. Muscle memory rebuilds fast — the risk
            in the first weeks back is injury, not lost time.
          </p>
          <p className="text-app-tx3 text-xs leading-relaxed mt-1.5">
            Week 5 rejoins the main program at BUILD — the LEARN weeks are redundant once you
            already know the machines.
          </p>
        </Details>
        <div className="space-y-2">
          {RETURN_PROGRAM.map((r) => (
            <div
              key={r.week}
              className="card p-4 flex items-start gap-3"
            >
              <div className="chip border border-acc-ember/40 bg-acc-ember/10 text-acc-ember flex-shrink-0">
                {r.phase}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-app-tx3 text-xs font-semibold">
                  Week {r.week} &middot; <b className="text-acc-ember/90 font-semibold">{r.loadPct}% load</b> &middot; {r.sessions} sessions &middot; max{' '}
                  <b className="text-acc-ember/90 font-semibold">{RPE_LABELS[r.rpeCap]}</b>
                </div>
                <Details label="More" className="mt-1">
                  <p className="text-app-tx2 text-xs leading-relaxed">{r.desc}</p>
                </Details>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* 12-Week Progression */}
      <CollapsibleSection title="12-Week Progression">
        <div className="space-y-2">
          {PROGRESSION.map((p) => (
            <div
              key={p.weeks}
              className="card p-4 flex items-start gap-3"
            >
              <div
                className={`chip flex-shrink-0 ${
                  phaseColors[p.phase] || 'bg-app-surface2 text-app-tx2'
                }`}
              >
                {p.phase}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-app-tx3 text-xs font-semibold">Week {p.weeks}</div>
                <Details label="More" className="mt-1">
                  <p className="text-app-tx2 text-xs leading-relaxed">{p.desc}</p>
                </Details>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Cardio Rankings */}
      <CollapsibleSection title="Cardio Rankings">
        <div className="space-y-2">
          {CARDIO.map((c) => (
            <div
              key={c.name}
              className="card p-4 flex items-start gap-3"
            >
              <div className="text-app-tx3 font-black text-lg w-5 flex-shrink-0 tabular-nums">
                {c.rank}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-app-tx1 font-semibold text-sm">{c.name}</span>
                  <span
                    className={`chip ${
                      badgeColors[c.badge] || 'bg-app-surface2 text-app-tx2'
                    }`}
                  >
                    {c.badge}
                  </span>
                </div>
                <Details label="More" className="mt-1">
                  <p className="text-app-tx2 text-xs leading-relaxed">{c.desc}</p>
                </Details>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Your Profile */}
      <CollapsibleSection title="Your Profile">

        <div className="card overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-app-border">
            <div className="p-3 text-center">
              <div className="glow-teal font-round font-light text-lg tabular-nums leading-tight">{latestWeight} kg</div>
              <div className="metric-label">Weight</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-app-tx1 font-round font-light text-lg tabular-nums leading-tight">169 cm</div>
              <div className="metric-label">Height</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-app-tx1 font-round font-light text-lg tabular-nums leading-tight">37 yrs</div>
              <div className="metric-label">Age</div>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-app-border border-t border-app-border">
            <div className="p-3 text-center">
              <div className="text-rpe-hard font-bold text-base">BMI 46</div>
              <div className="metric-label">Class III</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-acc-teal font-bold text-base">Fat Loss</div>
              <div className="metric-label">Goal</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-acc-cyan font-bold text-base">Desk</div>
              <div className="metric-label">Lifestyle</div>
            </div>
          </div>
          <div className="border-t border-app-border p-3">
            <div className="text-app-tx2 text-xs text-center tabular-nums">
              TDEE ~2,635 kcal · −600 kcal/day · −0.5–0.7 kg/wk
            </div>
            {weightChange !== null && weightChange < 0 && (
              <div className="text-acc-teal text-xs text-center mt-1 font-semibold tabular-nums">
                −{Math.abs(weightChange)} kg from start
              </div>
            )}
            {weightChange !== null && weightChange >= 0 && firstWeight !== null && (
              <div className="text-app-tx3 text-xs text-center mt-1">
                Log weight in Stats to track progress
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Nutrition Guide */}
      <CollapsibleSection title="Nutrition Guide">
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-app-border">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-app-tx1 font-semibold text-sm">Calorie Target</div>
              <div className="font-round font-light text-lg tabular-nums text-app-tx1">
                ~2,050 <span className="text-xs text-app-tx3">kcal/day</span>
              </div>
            </div>
            <Details label="More" className="mt-1">
              <p className="text-app-tx2 text-xs">
                Calculated from your TDEE (2,635) minus a 600 kcal deficit
              </p>
            </Details>
          </div>
          <div className="p-4 border-b border-app-border">
            <div className="text-app-tx1 font-semibold text-sm mb-3">Daily Macros</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-acc-violet-deep/10 rounded-lg p-3 border border-acc-violet/30">
                <div className="glow-violet font-round font-light text-lg tabular-nums">185g</div>
                <div className="metric-label">Protein</div>
                <div className="text-app-tx3 text-xs">740 kcal</div>
              </div>
              <div className="bg-acc-cyan/[0.07] rounded-lg p-3 border border-acc-cyan/30">
                <div className="glow-cyan font-round font-light text-lg tabular-nums">180g</div>
                <div className="metric-label">Carbs</div>
                <div className="text-app-tx3 text-xs">720 kcal</div>
              </div>
              <div className="bg-rpe-easy/[0.07] rounded-lg p-3 border border-rpe-easy/30">
                <div className="text-rpe-easy font-round font-light text-lg tabular-nums [text-shadow:0_0_18px_rgba(52,211,153,0.5)]">65g</div>
                <div className="metric-label">Fat</div>
                <div className="text-app-tx3 text-xs">585 kcal</div>
              </div>
            </div>
          </div>
          <details className="group p-4 border-b border-app-border">
            <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-app-tx1 font-semibold text-sm">Rules · 6</span>
              <Chevron className="text-app-tx3" />
            </summary>
            <ul className="mt-2 space-y-1.5 text-app-tx2 text-xs">
              <li>· Protein at every meal — chicken, eggs, Greek yogurt, legumes, cottage cheese</li>
              <li>· Vegetables fill half the plate — non-negotiable</li>
              <li>· Eat within 60 min after each workout (prioritise protein)</li>
              <li>· Limit ultra-processed foods — not zero, just not daily</li>
              <li>· Drink 3–4 L water/day (higher at your bodyweight)</li>
              <li>· Don&apos;t eat back gym calories — deficit is already moderate</li>
            </ul>
          </details>
          <details className="group p-4">
            <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-app-tx1 font-semibold text-sm">Joint-First · 6</span>
              <Chevron className="text-app-tx3" />
            </summary>
            <ul className="mt-2 space-y-1.5 text-app-tx2 text-xs">
              <li>· All exercises are machine-based — no free-weight barbell loading on joints</li>
              <li>· Back Extension: neutral spine only — do NOT hyperextend at the top, squeeze glutes instead</li>
              <li>· Avoid treadmill running — walking only at 4–5 km/h, low incline</li>
              <li>· Swimming is your best cardio — zero joint impact, maximum calorie burn</li>
              <li>· Progress weight slowly — joint adaptation lags behind muscle strength</li>
              <li>· Pre-lift spinal mobility: 10 cat-cows + 8 bird-dogs each side before every session</li>
            </ul>
          </details>
        </div>
      </CollapsibleSection>
    </div>
  );
}
