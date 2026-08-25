// Training's face on the health-first Home — the inversion of the old
// HealthHomeCard. Two lines and a start button; the whole training world
// (verdict, day cards, program, history) lives one tap away in /train.

import Link from 'next/link';
import type { DynamicPlan } from '@/lib/program';

const DAY_FOCUS: Record<'A' | 'B', string> = {
  A: 'Chest · Quads · Shoulders',
  B: 'Back · Hamstrings · Arms',
};

export default function TrainingCard({
  plan,
  nextDay,
  returnMode,
}: {
  plan: DynamicPlan;
  nextDay: 'A' | 'B';
  returnMode: boolean;
}) {
  const accent = nextDay === 'A' ? 'text-acc-violet' : 'text-acc-teal';
  const fill = nextDay === 'A' ? 'bg-acc-violet-deep' : 'bg-acc-teal-deep';
  const doneToday = plan.mode === 'done-today';
  const recover = plan.mode === 'recover';

  return (
    <div className="card-lg p-4">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="section-label">Training</p>
        <Link href="/train" className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-tx3">
          open →
        </Link>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-app-tx1">
          {doneToday ? (
            <>
              <b className={accent}>Trained today.</b>
              <span className="text-app-tx2"> Next up: Day {nextDay}</span>
            </>
          ) : recover ? (
            <>
              <b className="text-app-tx1">Recovery day.</b>
              <span className="text-app-tx2"> Day {nextDay} is queued</span>
            </>
          ) : (
            <>
              <b className={accent}>Day {nextDay} is up{returnMode ? ' · ramp loads' : ''}.</b>
              <span className="text-app-tx2"> {DAY_FOCUS[nextDay]}</span>
            </>
          )}
        </p>
        {!doneToday && (
          <Link
            href={`/workouts/new?day=${nextDay}&dur=45`}
            className={`flex-none rounded-card border-2 border-ink px-4 py-2.5 text-xs font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] ${fill}`}
          >
            Start
          </Link>
        )}
      </div>
    </div>
  );
}
