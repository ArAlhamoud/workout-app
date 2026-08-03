'use client';

// One-line readiness read from Apple Health — renders ONLY inside the native
// Capacitor shell, and only when the data actually says something.
//
// Three ways this renders nothing, all deliberate:
//   · not the native app          → no bridge, no banner
//   · no health data at all       → computeReadiness() returns null, and the
//                                   screen behaves exactly as it does today
//   · verdict 'proceed'           → a normal day is the default state. Saying
//                                   "you're fine" every morning trains him to
//                                   stop reading the line, so on the day it
//                                   says HOLD he wouldn't see it either.
//
// ── MOUNTING ─────────────────────────────────────────────────────────────────
// As integrated, this is mounted by <HomeVerdict>, which reads readiness ONCE
// and passes the result down (`signal`) while feeding the same signal into
// homeVerdict(). One bridge read, one source of truth, and the banner and the
// verdict can never disagree about the day.
//
// It also still works standalone: mount it with no `signal` and it reads the
// bridge itself. In that mode pass `lastSessionISO` (the most recent LOGGED
// workout date) to switch on the "<24h since you trained" clause; omit it and
// the resting-HR and sleep clauses still stand on their own. Either way the
// component returns null in every case where it has nothing to say.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { ReadinessSignal } from '@/lib/coach';
import { readReadiness } from '@/lib/health-metrics';
import { isNativeApp } from '@/lib/native-health';

/**
 * Tone per verdict. 'hold' is orange (rpe-hard) rather than ember — ember is
 * reserved for the return protocol, and two amber signals side by side would
 * blur which one is the standing directive and which is today's weather.
 */
const TONE: Record<'hold' | 'push', { lead: string; wrap: string; text: string }> = {
  hold: {
    lead: 'EASE OFF',
    wrap: 'border-rpe-hard/40 bg-rpe-hard/10',
    text: 'text-rpe-hard',
  },
  push: {
    lead: 'GREEN LIGHT',
    wrap: 'border-acc-teal/40 bg-acc-teal/10',
    text: 'text-acc-teal',
  },
};

export default function ReadinessBanner({
  signal: controlled,
  lastSessionISO,
}: {
  /**
   * Pre-computed signal. Passing it (even as null) puts the banner in
   * controlled mode and suppresses its own bridge read — that is how
   * <HomeVerdict> keeps one HealthKit call for both surfaces.
   */
  signal?: ReadinessSignal | null;
  lastSessionISO?: string | null;
}) {
  const controlledMode = controlled !== undefined;
  const [fetched, setFetched] = useState<ReadinessSignal | null>(null);

  useEffect(() => {
    if (controlledMode || !isNativeApp()) return;
    let cancelled = false;
    // readReadiness() swallows bridge failures into null — a missed HealthKit
    // reply must never put an error where the day's instruction goes.
    readReadiness({ lastSessionISO }).then((s) => {
      if (!cancelled) setFetched(s);
    });
    return () => {
      cancelled = true;
    };
  }, [controlledMode, lastSessionISO]);

  const signal = controlledMode ? controlled : fetched;

  if (!signal || signal.verdict === 'proceed') return null;

  const tone = TONE[signal.verdict];

  return (
    <div className={`card flex items-center gap-2.5 px-3.5 py-2.5 ${tone.wrap}`}>
      <span className={`flex-none text-[10px] font-extrabold uppercase tracking-[0.14em] ${tone.text}`}>
        {tone.lead}
      </span>
      <span className="truncate text-[11px] tabular-nums text-app-tx2">{signal.note}</span>
    </div>
  );
}
