'use client';

// The owner's real step for one machine — "each machine different"
// (2026-09-24). The learner will not guess coarse stacks (CLAUDE.md rule 4),
// so until he sets it here a machine steps 2.5 kg, and the Watch crown
// 0.5 kg. B_Fit only: the step describes the home gym's stack (rule 2).
// Styles are reused from training screens that already wear Volt.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMachinePin } from '@/app/actions';

type Source = 'yours' | 'learned' | 'fallback';

const SOURCE_LABEL: Record<Source, string> = { yours: 'yours', learned: 'learned', fallback: 'not set' };
const inputCls =
  'w-24 bg-app-surface2 border border-app-border rounded-card px-3 py-2.5 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-acc-teal/60 text-sm transition-colors tabular-nums';
const fmt = (kg: number) => String(+kg.toFixed(2));

export default function MachinePinCard({ exerciseId, kg, source }: { exerciseId: string; kg: number; source: Source }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [offGrid, setOffGrid] = useState<{ weights: number[]; kg: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function save(raw: string | null) {
    startTransition(async () => {
      setError(null);
      const r = await setMachinePin(exerciseId, raw);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOffGrid(r.pinKg != null && r.offGrid.length ? { weights: r.offGrid, kg: r.pinKg } : null);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          {/* The label is the ⓘ toggle — the app's disclosure style, and no
              extra line on the card (glance rule). */}
          <details className="group">
            <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3 transition-colors hover:text-app-tx2 [&::-webkit-details-marker]:hidden">
              Step ⓘ
            </summary>
            <p className="mt-1 max-w-[16rem] text-xs text-app-tx3">One pin on this B_Fit stack. The watch crown and the +1 pin move by it.</p>
          </details>
          <div className="text-xl font-light font-round tabular-nums text-app-tx1">
            {fmt(kg)} kg{' '}
            <span className={`text-xs ${source === 'yours' ? 'text-acc-teal' : 'text-app-tx3'}`}>{SOURCE_LABEL[source]}</span>
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setText(source === 'yours' ? fmt(kg) : '');
              setError(null);
              setEditing(true);
            }}
            className="chip border border-app-border bg-app-surface2 text-app-tx2 hover:text-app-tx1 transition-colors"
          >
            {source === 'yours' ? 'Change' : 'Set'}
          </button>
        )}
      </div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(text);
          }}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input
            inputMode="decimal"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="4.5"
            aria-label="Step in kg"
            className={inputCls}
          />
          <span className="text-sm text-app-tx3">kg</span>
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2.5 bg-gradient-to-r from-acc-teal to-acc-cyan text-white shadow-[0_0_20px_-6px_rgba(45,212,191,0.7)] hover:brightness-110 disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none text-sm font-bold rounded-card transition-all flex-shrink-0 pressable"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-app-tx3 hover:text-app-tx2">
            Cancel
          </button>
          {source === 'yours' && (
            <button type="button" disabled={pending} onClick={() => save(null)} className="text-sm text-app-tx3 hover:text-app-tx2">
              Clear
            </button>
          )}
        </form>
      )}

      {error && (
        <div className="mt-3 bg-rpe-grind/10 border border-rpe-grind/40 rounded-card px-4 py-3 text-rpe-grind text-sm">{error}</div>
      )}
      {offGrid && (
        <p className="mt-2 text-xs text-app-tx3">
          Your log has {offGrid.weights.map(fmt).join(', ')} kg — off a {fmt(offGrid.kg)} kg step.
        </p>
      )}
    </div>
  );
}
