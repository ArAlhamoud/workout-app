'use client';

// "Holding, not losing" — MacroFactor's diet break for training. Declaring
// a bounded pause converts the failure mode from unbounded (43 silent days)
// into a two-week window with an expiry: the ladder goes quiet, the streak
// is excused, and the app greets the end date instead of nagging through it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startHold, endHold } from '@/app/actions';
import { holdDeclaredFollowThrough, holdEndedFollowThrough } from '@/lib/hold-client';

export default function HoldControl({
  active,
}: {
  active: { id: string; endsAt: string; reason: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const startTwoWeeks = async () => {
    const { endsAt } = await startHold(14);
    holdDeclaredFollowThrough(endsAt);
  };

  const endEarly = async (id: string) => {
    await endHold(id);
    holdEndedFollowThrough();
  };

  if (active) {
    const ends = new Date(active.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return (
      <div className="card px-4 py-3 flex items-center justify-between gap-3 border-acc-cyan/30">
        <div className="min-w-0">
          <p className="text-acc-cyan text-sm font-semibold">On hold until {ends}</p>
          <p className="text-app-tx3 text-xs mt-0.5">Reminders paused · streak protected · rescue stays open</p>
        </div>
        <button
          onClick={() => act(() => endEarly(active.id))}
          disabled={busy}
          className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-card bg-app-surface2 border border-app-border text-app-tx2 hover:border-app-border-hi disabled:text-app-tx3"
        >
          {busy ? '…' : 'End early'}
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="card px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-app-tx2 text-xs min-w-0">
          Two weeks of &ldquo;hold, don&apos;t lose&rdquo; — no reminders, streak safe. Sure?
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => act(() => startTwoWeeks())}
            disabled={busy}
            className="text-xs font-bold px-3 py-2 rounded-card bg-acc-cyan/10 border border-acc-cyan/40 text-acc-cyan disabled:text-app-tx3"
          >
            {busy ? '…' : 'Hold 2 wks'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-xs px-2 py-2 text-app-tx3 hover:text-app-tx1"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="w-full card px-4 py-2.5 text-left text-xs text-app-tx3 hover:text-app-tx2 hover:border-app-border-hi transition-colors"
    >
      Life happening? <span className="text-app-tx2">Declare a 2-week hold — bounded beats silent.</span>
    </button>
  );
}
