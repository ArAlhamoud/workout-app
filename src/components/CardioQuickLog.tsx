'use client';

import { useState, useTransition } from 'react';
import { logCardio } from '@/app/actions';
import { hapticSuccess } from '@/lib/native-feedback';

/**
 * Swim or walk as an independent workout — one tap, no form. Lives on the
 * Train page in Volt structure: a kicker, a minutes stepper, two buttons.
 * Cardio keeps the streak alive and never touches the plan or the ramp.
 */
export default function CardioQuickLog() {
  const [minutes, setMinutes] = useState(15);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const log = (kind: 'swim' | 'walk') =>
    start(async () => {
      try {
        const r = await logCardio(kind, minutes);
        setDone(r.deduped ? `${kind === 'swim' ? 'Swim' : 'Walk'} already logged today` : `${kind === 'swim' ? 'Swim' : 'Walk'} ${minutes} min · logged`);
        hapticSuccess();
      } catch {
        setDone('Could not save — try again');
      }
    });

  return (
    <div>
      <p className="section-label mb-3">Recovery · swim or walk</p>
      <div className="card flex items-center gap-2 px-3 py-3">
        <div className="flex flex-none items-center font-mono text-sm font-bold text-app-tx1">
          <button type="button" onClick={() => setMinutes((m) => Math.max(5, m - 5))} className="h-9 w-9" aria-label="5 minutes less">−</button>
          <span className="w-12 text-center tabular-nums">{minutes}<span className="ml-0.5 text-[10px] text-app-tx3">MIN</span></span>
          <button type="button" onClick={() => setMinutes((m) => Math.min(120, m + 5))} className="h-9 w-9" aria-label="5 minutes more">+</button>
        </div>
        <button type="button" disabled={pending} onClick={() => log('swim')} className="btn-primary min-h-[40px] flex-1 text-sm font-bold">
          Swim
        </button>
        <button type="button" disabled={pending} onClick={() => log('walk')} className="btn-primary min-h-[40px] flex-1 text-sm font-bold">
          Walk
        </button>
      </div>
      {done && (
        <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-acc-teal" aria-live="polite">{done}</p>
      )}
    </div>
  );
}
