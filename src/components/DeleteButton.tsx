'use client';

// Deleting a workout is the only irreversible action in the app: the row and
// its sets go, and until the next daily snapshot runs there is no copy.
// Until soft-delete lands, the protection is making it hard to do by accident
// and impossible to do without seeing what goes.

import { useState } from 'react';
import { deleteWorkout } from '@/app/actions';

export default function DeleteButton({
  workoutId,
  summary,
}: {
  workoutId: string;
  /** What is about to be lost, e.g. "18 sets · 4.0k kg". Shown in the confirm. */
  summary?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <div className="flex flex-shrink-0 items-center gap-2">
        {/* The count is the point: "Delete this workout?" told him nothing
            about the size of what he was about to lose. */}
        <span className="text-right text-[11px] leading-tight text-app-tx3">
          Delete
          {summary ? <span className="block tabular-nums text-app-tx2">{summary}</span> : ' this?'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await deleteWorkout(workoutId);
          }}
          className="pressable rounded-card border border-rpe-grind/50 bg-rpe-grind/10 px-3 py-2 text-sm font-bold text-rpe-grind transition-colors hover:bg-rpe-grind/20 disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="px-2 py-2 text-sm font-semibold text-app-tx3 transition-colors hover:text-app-tx1"
        >
          Keep
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      // Recessive by default. This screen exists to read a finished session,
      // and a red-outlined button was the loudest thing on it — sitting exactly
      // where a thumb lands. It stays reachable, turns red on press, and no
      // longer competes with the workout title for attention.
      className="pressable flex-shrink-0 rounded-card border border-app-border px-3 py-2 text-sm font-medium text-app-tx3 transition-colors hover:border-red-700/60 hover:text-red-300 active:border-red-700/60 active:text-red-300"
    >
      Delete
    </button>
  );
}
