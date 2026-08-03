'use client';

// Today's steps against a walking floor — renders ONLY inside the native
// Capacitor shell. On the plain web / PWA this returns null and costs nothing.
//
// One number, one bar, one baseline. No chart: a 14-day step sparkline is
// something to study, and this card exists to be glanced at on the way out the
// door. The window is still read at 14 days so the baseline has room to be
// stable even when a few days hold no samples at all.

import { useEffect, useState } from 'react';
import { dailySteps, STEP_TARGET, type StepsSummary } from '@/lib/health-metrics';
import { isNativeApp } from '@/lib/native-health';

const commas = (n: number) => n.toLocaleString('en-US');

export default function StepsCard() {
  const [summary, setSummary] = useState<StepsSummary | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    // dailySteps() already swallows bridge failures into null — there is no
    // error state to render here, only "a number" or "nothing".
    dailySteps().then((s) => {
      if (!cancelled) setSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing loaded, nothing granted, or the whole window came back empty.
  // An empty card would be pure noise, so there isn't one.
  if (!summary || !summary.hasAnyData) return null;

  const { today, avgPrev7 } = summary;
  const pct = today === null ? 0 : Math.min(100, (today / STEP_TARGET) * 100);
  const hit = today !== null && today >= STEP_TARGET;

  return (
    <div className="card-lg p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="section-label">Steps Today</p>
        <span className="text-[11px] tabular-nums text-app-tx3">
          {/* The target is context for the number above it, not a second metric. */}
          Target {commas(STEP_TARGET)}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={`font-round text-3xl font-light tabular-nums ${
            today === null ? 'text-app-tx3' : 'glow-teal'
          }`}
        >
          {/* null is "HealthKit has no samples yet", which is not zero steps. */}
          {today === null ? '—' : commas(today)}
        </span>
        {hit && (
          <span className="chip border border-acc-teal/40 bg-acc-teal/10 text-acc-teal">Hit</span>
        )}
      </div>

      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-app-surface2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-acc-teal-deep to-acc-teal shadow-[0_0_10px_-2px_rgba(45,212,191,0.9)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] tabular-nums text-app-tx3">
        {avgPrev7 !== null ? (
          <>
            7-day avg <b className="font-semibold text-app-tx2">{commas(avgPrev7)}</b>
          </>
        ) : (
          'No step history yet'
        )}
      </p>
    </div>
  );
}
