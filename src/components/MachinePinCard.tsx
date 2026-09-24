'use client';

// The owner's real step for one machine — "each machine different"
// (2026-09-24). The learner will not guess coarse stacks (CLAUDE.md rule 4),
// so until he sets it here a machine steps 2.5 kg, and the Watch crown
// 0.5 kg. B_Fit only: the step describes the home gym's stack (rule 2).
// Styles are reused from training screens that already wear Volt.

import { useEffect, useState, useTransition } from 'react';
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
  /** The step he typed looked like a slipped decimal — one more tap saves it anyway. */
  const [doubted, setDoubted] = useState<string | null>(null);
  /** Clear is destructive and sits beside Cancel: the first tap only arms it. */
  const [clearArmed, setClearArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!clearArmed) return;
    const t = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(t);
  }, [clearArmed]);

  function save(raw: string | null, force = false) {
    startTransition(async () => {
      setError(null);
      setDoubted(null);
      // A dropped connection or a deploy landing mid-save rejects (or returns
      // nothing). Uncaught inside the transition that replaced the whole page
      // with the root error screen and lost what he typed (device-tester).
      let r: Awaited<ReturnType<typeof setMachinePin>> | undefined;
      try {
        r = await setMachinePin(exerciseId, raw, force);
      } catch {
        r = undefined;
      }
      if (!r) {
        setError('Not saved — no connection. Try again.');
        return;
      }
      if (!r.ok) {
        setError(r.error);
        if (r.confirmable) setDoubted(raw);
        return;
      }
      setOffGrid(r.pinKg != null && r.offGrid.length ? { weights: r.offGrid, kg: r.pinKg } : null);
      setEditing(false);
      setClearArmed(false);
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
            <p className="mt-1 max-w-[16rem] text-xs text-app-tx3">
              {source === 'yours'
                ? 'One pin on this B_Fit stack. The +1 pin and the Watch crown move by it.'
                : 'One pin on this B_Fit stack. The +1 pin moves by it; the Watch crown moves 0.5 kg until you set it.'}
            </p>
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
              setDoubted(null);
              setEditing(true);
            }}
            className="chip inline-flex min-h-[44px] min-w-[64px] items-center justify-center border border-app-border bg-app-surface2 text-app-tx2 hover:text-app-tx1 transition-colors"
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
          className="mt-3 space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2">
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
            className="min-h-[44px] px-4 py-2.5 bg-gradient-to-r from-acc-teal to-acc-cyan text-white shadow-[0_0_20px_-6px_rgba(45,212,191,0.7)] hover:brightness-110 disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none text-sm font-bold rounded-card transition-all flex-shrink-0 pressable"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setClearArmed(false);
              setDoubted(null);
            }}
            className="min-h-[44px] px-3 text-sm text-app-tx3 hover:text-app-tx2"
          >
            Cancel
          </button>
          </div>
          {/* Clear on its own row, away from Cancel, and armed by the first
              tap: it erases his step with no undo (device-tester). */}
          {source === 'yours' && (
            <button
              type="button"
              disabled={pending}
              onClick={() => (clearArmed ? save(null) : setClearArmed(true))}
              className={`min-h-[44px] text-sm transition-colors ${clearArmed ? 'font-semibold text-rpe-grind' : 'text-app-tx3 hover:text-app-tx2'}`}
            >
              {clearArmed ? 'Tap again to clear' : 'Clear my step'}
            </button>
          )}
        </form>
      )}

      {error && (
        <div className="mt-3 bg-rpe-grind/10 border border-rpe-grind/40 rounded-card px-4 py-3 text-rpe-grind text-sm">
          {error}
          {doubted != null && (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(doubted, true)}
              className="mt-2 block min-h-[44px] text-sm font-semibold underline underline-offset-2"
            >
              Save {doubted.trim().replace(',', '.')} kg anyway
            </button>
          )}
        </div>
      )}
      {offGrid && (
        <p className="mt-2 text-xs text-app-tx3">
          Your log has {offGrid.weights.map(fmt).join(', ')} kg — off a {fmt(offGrid.kg)} kg step.
        </p>
      )}
    </div>
  );
}
