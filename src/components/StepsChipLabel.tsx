'use client';

// The walking chip on Home, upgraded from a static goal to today's real count.
//
// Home is the screen you glance at on the way out the door, so this is where
// the number earns its place — Stats already carries the fuller card. Renders
// "2,485 / 8k" with a progress underline once HealthKit answers.
//
// Falls back to the plain "8k steps" label whenever there is nothing honest to
// show: outside the native shell, before the read returns, or when Health has
// no samples. A goal is still useful information; a wrong number is not.

import { useEffect, useState } from 'react';
import { dailySteps, STEP_TARGET, type StepsSummary } from '@/lib/health-metrics';
import { isNativeApp } from '@/lib/native-health';

const commas = (n: number) => n.toLocaleString('en-US');
const targetShort = `${Math.round(STEP_TARGET / 1000)}k`;

export default function StepsChipLabel() {
  const [summary, setSummary] = useState<StepsSummary | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    // dailySteps() swallows bridge failures into null: there is no error state
    // to render on a chip, only "a number" or "the goal".
    dailySteps().then((s) => {
      if (!cancelled) setSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const today = summary?.hasAnyData ? summary.today : null;

  if (today === null || today === undefined) {
    return (
      <>
        <span aria-hidden="true">🚶</span> {targetShort} steps
      </>
    );
  }

  const pct = Math.min(100, (today / STEP_TARGET) * 100);
  const hit = today >= STEP_TARGET;

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true">🚶</span>
        <span className={`tabular-nums ${hit ? 'text-acc-teal' : ''}`}>{commas(today)}</span>
        <span className="opacity-60">/ {targetShort}</span>
      </span>
      {/* Underline rather than a bar: this lives inside a chip, and the shape
          should read as progress on the number, not as a second component. */}
      <span className="h-[2px] w-full overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-acc-teal-deep to-acc-teal transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}
