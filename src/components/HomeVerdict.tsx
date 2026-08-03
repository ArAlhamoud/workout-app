'use client';

// The home screen's instruction line, wired to Apple Health.
//
// WHY THIS IS A CLIENT COMPONENT
// homeVerdict() accepts an optional ReadinessSignal, but that signal can only
// be computed where the HealthKit bridge lives — on `window`, inside the native
// shell. A server-rendered verdict therefore can never have one. This component
// is the seam: it renders the server's verdict verbatim on first paint (so the
// web, the PWA and SSR all get byte-identical output to having no health layer
// at all), then — and only inside the native app — reads readiness and
// recomputes the verdict with it.
//
// Degradation, in order:
//   · plain web / PWA  → isNativeApp() is false, readReadiness() returns null,
//                        nothing re-renders, nothing is logged, nothing breaks
//   · native, no data  → computeReadiness() returns null, same as above
//   · bridge throws    → swallowed inside readReadiness(), same as above
//
// DIVISION OF LABOUR between the two surfaces (this is the reconciliation the
// two agents' pieces needed): the BANNER owns the facts — "EASE OFF · resting
// HR +7 bpm" — and the VERDICT owns the order. So the signal handed to
// homeVerdict carries the verdict but an EMPTY note: 'hold' still downgrades
// TRAIN TODAY into RECOVER, while the verdict's own sub-line survives instead
// of being replaced by a copy of the line directly above it. Two identical
// sentences stacked on the glance layer is exactly what the glance rule is
// there to prevent.

import { useEffect, useState } from 'react';

import ReadinessBanner from '@/components/ReadinessBanner';
import { homeVerdict, type HomeVerdict as HomeVerdictShape, type ReadinessSignal } from '@/lib/coach';
import { readReadiness } from '@/lib/health-metrics';
import { isNativeApp } from '@/lib/native-health';
import type { DayId, DynamicPlan, TrainingStatus } from '@/lib/program';

/* Mirrors the day nebulas on the home screen — A violet, B teal. */
const VERDICT_NEBULA: Record<DayId, string> = {
  A: 'radial-gradient(240px 120px at 100% 0%, rgba(139,92,246,0.13), transparent 70%)',
  B: 'radial-gradient(240px 120px at 100% 0%, rgba(94,234,212,0.13), transparent 70%)',
};

/* ── The verdict ─────────────────────────────────────────────
   First object on the screen: one order, one muted sub-line, nothing else.
   He wants to be TOLD what to do — this is the line that does it. The skin
   follows the day accent (A violet · B teal) and only ever burns ember when
   the return protocol is actually running. */
function verdictSkin(verdict: HomeVerdictShape): { shell: string; nebula: string; lead: string; part: string } {
  if (verdict.tone === 'done') {
    // Session already logged — the screen celebrates instead of nagging.
    return {
      shell: 'border-rpe-easy/30 shadow-[0_0_34px_-14px_rgba(52,211,153,0.65)]',
      nebula: 'radial-gradient(300px 150px at 0% 0%, rgba(52,211,153,0.14), transparent 70%)',
      lead: 'text-rpe-easy [text-shadow:0_0_18px_rgba(52,211,153,0.55)]',
      part: 'text-app-tx1',
    };
  }
  if (verdict.tone === 'return') {
    return {
      shell: 'border-acc-ember/35 shadow-glow-ember',
      nebula: 'radial-gradient(300px 150px at 0% 0%, rgba(245,158,11,0.16), transparent 70%)',
      lead: 'glow-amber',
      part: 'text-app-tx1',
    };
  }
  if (verdict.tone === 'train') {
    if (verdict.day) {
      return {
        shell: verdict.day === 'A' ? 'border-acc-violet/30 shadow-glow-violet' : 'border-acc-teal/30 shadow-glow-teal',
        nebula: VERDICT_NEBULA[verdict.day],
        lead: verdict.day === 'A' ? 'glow-violet' : 'glow-teal',
        part: 'text-app-tx1',
      };
    }
    return {
      shell: 'border-acc-cyan/30',
      nebula: 'radial-gradient(300px 150px at 0% 0%, rgba(103,232,249,0.12), transparent 70%)',
      lead: 'glow-cyan',
      part: 'text-app-tx1',
    };
  }
  return { shell: '', nebula: '', lead: 'text-app-tx2', part: 'text-app-tx3' };
}

export function VerdictLine({ verdict }: { verdict: HomeVerdictShape }) {
  const skin = verdictSkin(verdict);
  return (
    <section
      aria-label="Today’s instruction"
      className={`card-lg relative overflow-hidden px-4 py-3.5 ${skin.shell}`}
    >
      {skin.nebula && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-card-lg" style={{ background: skin.nebula }} />
      )}
      <p className="relative flex flex-wrap items-baseline gap-x-2 gap-y-1.5 font-round">
        <span className={`text-[19px] font-extrabold uppercase leading-none tracking-[0.01em] ${skin.lead}`}>
          {verdict.lead}
        </span>
        {verdict.parts.map((part) => (
          <span key={part} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="text-[12px] leading-none text-app-tx3">·</span>
            <span className={`text-[14px] font-semibold leading-none tabular-nums ${skin.part}`}>{part}</span>
          </span>
        ))}
      </p>
      {verdict.sub && (
        <p className="relative mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3">{verdict.sub}</p>
      )}
    </section>
  );
}

export default function HomeVerdict({
  status,
  plan,
  lastSessionISO,
}: {
  status: TrainingStatus;
  plan: DynamicPlan;
  /** Most recent LOGGED session — powers the "<24 h ago" recovery clause. */
  lastSessionISO?: string | null;
}) {
  const [readiness, setReadiness] = useState<ReadinessSignal | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    // readReadiness() swallows bridge failures into null — a missed HealthKit
    // reply must never put an error where the day's instruction goes.
    readReadiness({ lastSessionISO }).then((signal) => {
      if (!cancelled) setReadiness(signal);
    });
    return () => {
      cancelled = true;
    };
  }, [lastSessionISO]);

  // Note deliberately blanked — see the header. The banner is showing it.
  const verdict = homeVerdict(
    status,
    plan,
    undefined,
    readiness ? { verdict: readiness.verdict, note: '' } : undefined,
  );

  return (
    <>
      {/* Silent on the web, on a normal day, and whenever health data is
          missing. It qualifies the order below rather than competing with it. */}
      <ReadinessBanner signal={readiness} />
      <VerdictLine verdict={verdict} />
    </>
  );
}
