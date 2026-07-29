import Link from 'next/link';
import type { Metadata } from 'next';
import { DAY_A, DAY_B, SCHEDULE, PROGRESSION, RETURN_PROGRAM, BREAK_THRESHOLD_DAYS, CARDIO, getTrainingStatus, type Priority } from '@/lib/program';
import { getExercises, getBodyStats, getWorkouts } from '@/app/actions';
import CollapsibleSection from '@/components/CollapsibleSection';
import { getMondayOfWeek, RPE_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Program' };

const priorityBadge: Record<Priority, { label: string; cls: string }> = {
  1: { label: 'Always', cls: 'bg-green-900/40 text-green-300 border-green-800/40' },
  2: { label: '45+ min', cls: 'bg-blue-900/40 text-blue-300 border-blue-800/40' },
  3: { label: '60 min', cls: 'bg-app-surface2 text-app-tx2 border-app-border' },
};

const badgeColors: Record<string, string> = {
  BEST: 'bg-green-900/50 text-green-300',
  GREAT: 'bg-blue-900/50 text-blue-300',
  GOOD: 'bg-yellow-900/50 text-yellow-300',
  CAUTION: 'bg-red-900/50 text-red-300',
};

const phaseColors: Record<string, string> = {
  LEARN: 'bg-slate-700/60 text-slate-300',
  BUILD: 'bg-blue-900/60 text-blue-300',
  PUSH: 'bg-teal-900/60 text-teal-300',
  DELOAD: 'bg-amber-900/60 text-amber-300',
  REBUILD: 'bg-violet-900/60 text-violet-300',
  EVALUATE: 'bg-orange-900/60 text-orange-300',
};

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
        <h1 className="text-2xl font-black text-app-tx1">Your Program</h1>
      </div>

      {/* This Week — live status */}
      {status.mode === 'return' ? (
        <section className="rounded-card-lg border border-amber-700/40 bg-gradient-to-br from-amber-950/50 to-app-surface shadow-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-500">
              This Week · Return Ramp
            </p>
            <span className="chip bg-amber-900/60 text-amber-300 flex-shrink-0">
              {status.returnWeek.phase}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { value: `${status.week}/4`, label: 'Ramp week' },
              { value: `${status.returnWeek.loadPct}%`, label: 'Load' },
              { value: `${sessionsThisWeek}/${status.returnWeek.sessions}`, label: 'Sessions' },
              { value: RPE_LABELS[status.returnWeek.rpeCap], label: 'RPE cap' },
            ].map((m) => (
              <div key={m.label}>
                <div className="text-app-tx1 font-bold text-base tabular-nums">{m.value}</div>
                <div className="metric-label">{m.label}</div>
              </div>
            ))}
          </div>
          <p className="text-amber-200/50 text-xs mt-3 leading-relaxed">{status.returnWeek.desc}</p>
        </section>
      ) : (
        <section className="card-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="section-label">This Week</p>
            <span
              className={`chip flex-shrink-0 ${
                phaseColors[currentPhase.phase] || 'bg-app-surface2 text-app-tx2'
              }`}
            >
              Wk {status.week} · {currentPhase.phase}
            </span>
          </div>
          <p className="text-app-tx2 text-xs leading-relaxed">{currentPhase.desc}</p>
          <p className="text-app-tx3 text-xs mt-2">
            {sessionsThisWeek}/3 sessions logged this week
          </p>
        </section>
      )}

      {/* Weekly Schedule */}
      <section>
        <p className="section-label mb-3">
          Weekly Schedule
        </p>
        <div className="grid grid-cols-7 gap-1">
          {SCHEDULE.map((s) => (
            <div
              key={s.day}
              className={`rounded-xl p-2 text-center ${
                s.day === todayDayName ? 'ring-2 ring-white/25 ring-offset-1 ring-offset-app-bg' : ''
              } ${
                s.type === 'gym'
                  ? s.workout && s.workout.includes('A')
                    ? 'bg-blue-600/15 border border-blue-700/40'
                    : 'bg-violet-700/15 border border-violet-700/40'
                  : 'bg-app-surface border border-app-border'
              }`}
            >
              <div className={`text-xs font-medium ${s.day === todayDayName ? 'text-app-tx1' : 'text-app-tx2'}`}>{s.day}</div>
              {s.workout ? (
                <div
                  className={`text-sm font-black mt-0.5 ${
                    s.workout.includes('A') ? 'text-blue-400' : 'text-violet-400'
                  }`}
                >
                  {s.workout}
                </div>
              ) : (
                <div className="text-xs text-app-tx3 mt-1">—</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Day A */}
      <CollapsibleSection title="Day A" badge={DAY_A.focus} defaultOpen>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-app-tx1 font-bold text-lg">{DAY_A.focus}</h2>
          <Link
            href="/workouts/new?day=A&dur=45"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-card text-sm font-semibold transition-colors pressable"
          >
            Start &#8594;
          </Link>
        </div>
        <div className="bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mb-3">
          <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Warm-up: </span>
          <span className="text-app-tx2 text-xs">{DAY_A.warmup}</span>
        </div>
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
                      <span className="chip bg-blue-600/20 text-blue-300 border border-blue-700/40">
                        {ex.sets}&#215;{ex.repsDisplay}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${pb.cls}`}>
                        {pb.label}
                      </span>
                      {exId && (
                        <Link href={`/progress/${exId}`} className="text-xs text-app-tx3 hover:text-blue-400 transition-colors">
                          Progress &#8594;
                        </Link>
                      )}
                    </div>
                    <div className="text-app-tx3 text-xs mt-1">{ex.machine} · {ex.rest} rest</div>
                    <div className="text-app-tx2 text-xs mt-1.5 leading-relaxed">{ex.cues}</div>
                  </div>
                  <div className="text-app-tx3 text-lg font-black flex-shrink-0 tabular-nums">{i + 1}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mt-3">
          <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Cardio finisher: </span>
          <span className="text-app-tx2 text-xs">{DAY_A.cardioFinisher}</span>
        </div>
      </CollapsibleSection>

      {/* Day B */}
      <CollapsibleSection title="Day B" badge={DAY_B.focus} defaultOpen>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-app-tx1 font-bold text-lg">{DAY_B.focus}</h2>
          <Link
            href="/workouts/new?day=B&dur=45"
            className="bg-violet-700 hover:bg-violet-600 text-white px-4 py-2 rounded-card text-sm font-semibold transition-colors pressable"
          >
            Start &#8594;
          </Link>
        </div>
        <div className="bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mb-3">
          <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Warm-up: </span>
          <span className="text-app-tx2 text-xs">{DAY_B.warmup}</span>
        </div>
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
                      <span className="chip bg-violet-700/20 text-violet-300 border border-violet-700/40">
                        {ex.sets}&#215;{ex.repsDisplay}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${pb.cls}`}>
                        {pb.label}
                      </span>
                      {exId && (
                        <Link href={`/progress/${exId}`} className="text-xs text-app-tx3 hover:text-violet-400 transition-colors">
                          Progress &#8594;
                        </Link>
                      )}
                    </div>
                    <div className="text-app-tx3 text-xs mt-1">{ex.machine} · {ex.rest} rest</div>
                    <div className="text-app-tx2 text-xs mt-1.5 leading-relaxed">{ex.cues}</div>
                  </div>
                  <div className="text-app-tx3 text-lg font-black flex-shrink-0 tabular-nums">{i + 1}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="bg-app-surface/60 rounded-card border border-app-border px-4 py-3 mt-3">
          <span className="text-app-tx3 uppercase tracking-wide font-semibold text-xs">Cardio finisher: </span>
          <span className="text-app-tx2 text-xs">{DAY_B.cardioFinisher}</span>
        </div>
      </CollapsibleSection>

      {/* Return protocol */}
      <CollapsibleSection title="Return After a Break">
        <p className="text-app-tx2 text-xs leading-relaxed mb-3">
          After {BREAK_THRESHOLD_DAYS}+ days off, the app switches to this 4-week ramp
          automatically and pre-scales every weight. Muscle memory rebuilds fast — the risk
          in the first weeks back is injury, not lost time.
        </p>
        <div className="space-y-2">
          {RETURN_PROGRAM.map((r) => (
            <div
              key={r.week}
              className="card p-4 flex items-start gap-3"
            >
              <div className="chip bg-amber-900/60 text-amber-300 flex-shrink-0">
                {r.phase}
              </div>
              <div className="min-w-0">
                <div className="text-app-tx3 text-xs font-semibold mb-0.5">
                  Week {r.week} &middot; {r.loadPct}% load &middot; {r.sessions} sessions &middot; max{' '}
                  {RPE_LABELS[r.rpeCap]}
                </div>
                <div className="text-app-tx2 text-xs leading-relaxed">{r.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-app-tx3 text-xs leading-relaxed mt-3">
          Week 5 rejoins the main program at BUILD — the LEARN weeks are redundant once you
          already know the machines.
        </p>
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
              <div>
                <div className="text-app-tx3 text-xs font-semibold mb-0.5">Week {p.weeks}</div>
                <div className="text-app-tx2 text-xs leading-relaxed">{p.desc}</div>
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
                <div className="text-app-tx2 text-xs mt-1">{c.desc}</div>
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
              <div className="text-app-tx1 font-bold text-base">{latestWeight} kg</div>
              <div className="metric-label">Weight</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-app-tx1 font-bold text-base">169 cm</div>
              <div className="metric-label">Height</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-app-tx1 font-bold text-base">37 yrs</div>
              <div className="metric-label">Age</div>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-app-border border-t border-app-border">
            <div className="p-3 text-center">
              <div className="text-orange-400 font-bold text-base">BMI 46</div>
              <div className="metric-label">Class III</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-teal-400 font-bold text-base">Fat Loss</div>
              <div className="metric-label">Goal</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-blue-400 font-bold text-base">Desk</div>
              <div className="metric-label">Lifestyle</div>
            </div>
          </div>
          <div className="border-t border-app-border p-3">
            <div className="text-app-tx2 text-xs text-center">
              TDEE ~2,635 kcal · Target deficit −600 kcal/day · ~0.5–0.7 kg/week loss
            </div>
            {weightChange !== null && weightChange < 0 && (
              <div className="text-teal-400 text-xs text-center mt-1 font-semibold">
                Down {Math.abs(weightChange)} kg from start — keep going!
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
            <div className="text-app-tx1 font-semibold text-sm mb-1">Calorie Target</div>
            <div className="text-app-tx2 text-xs">
              ~2,050 kcal/day — calculated from your TDEE (2,635) minus a 600 kcal deficit
            </div>
          </div>
          <div className="p-4 border-b border-app-border">
            <div className="text-app-tx1 font-semibold text-sm mb-3">Daily Macros</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-800/30">
                <div className="text-blue-400 font-bold text-lg">185g</div>
                <div className="metric-label">Protein</div>
                <div className="text-app-tx3 text-xs">740 kcal</div>
              </div>
              <div className="bg-yellow-900/20 rounded-lg p-3 border border-yellow-800/30">
                <div className="text-yellow-400 font-bold text-lg">180g</div>
                <div className="metric-label">Carbs</div>
                <div className="text-app-tx3 text-xs">720 kcal</div>
              </div>
              <div className="bg-green-900/20 rounded-lg p-3 border border-green-800/30">
                <div className="text-green-400 font-bold text-lg">65g</div>
                <div className="metric-label">Fat</div>
                <div className="text-app-tx3 text-xs">585 kcal</div>
              </div>
            </div>
          </div>
          <div className="p-4 border-b border-app-border">
            <div className="text-app-tx1 font-semibold text-sm mb-2">Rules</div>
            <ul className="space-y-1.5 text-app-tx2 text-xs">
              <li>· Protein at every meal — chicken, eggs, Greek yogurt, legumes, cottage cheese</li>
              <li>· Vegetables fill half the plate — non-negotiable</li>
              <li>· Eat within 60 min after each workout (prioritise protein)</li>
              <li>· Limit ultra-processed foods — not zero, just not daily</li>
              <li>· Drink 3–4 L water/day (higher at your bodyweight)</li>
              <li>· Don&apos;t eat back gym calories — deficit is already moderate</li>
            </ul>
          </div>
          <div className="p-4">
            <div className="text-app-tx1 font-semibold text-sm mb-2">Joint-First Approach</div>
            <ul className="space-y-1.5 text-app-tx2 text-xs">
              <li>· All exercises are machine-based — no free-weight barbell loading on joints</li>
              <li>· Back Extension: neutral spine only — do NOT hyperextend at the top, squeeze glutes instead</li>
              <li>· Avoid treadmill running — walking only at 4–5 km/h, low incline</li>
              <li>· Swimming is your best cardio — zero joint impact, maximum calorie burn</li>
              <li>· Progress weight slowly — joint adaptation lags behind muscle strength</li>
              <li>· Pre-lift spinal mobility: 10 cat-cows + 8 bird-dogs each side before every session</li>
            </ul>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
