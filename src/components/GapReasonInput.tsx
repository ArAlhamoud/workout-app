'use client';

// One optional line at the welcome-back moment: "what got in the way?"
// The highest-value missing datum in the gap war — both historical collapses
// have no recorded cause, so the app reacts identically to every gap. He
// trains alone; nobody else will ever ask. One line, skippable, zero
// ceremony — the celebration above stays the headline (trainer rule: the
// comeback moment is celebratory, never an intake interview).

import { useState } from 'react';
import { saveGapReason } from '@/app/actions';

export default function GapReasonInput({ workoutId }: { workoutId: string }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  if (state === 'saved') {
    return <p className="mt-2 text-xs text-app-tx3">Noted — your coach will remember.</p>;
  }

  const save = async () => {
    if (!value.trim() || state === 'saving') return;
    setState('saving');
    try {
      await saveGapReason(workoutId, value);
      setState('saved');
    } catch {
      setState('idle'); // saving a footnote must never break the ceremony
    }
  };

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
      <input
        type="text"
        value={value}
        maxLength={140}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
        placeholder="What got in the way? (optional)"
        className="min-w-0 flex-1 bg-transparent text-sm text-app-tx1 placeholder:text-app-tx3 focus:outline-none"
      />
      {value.trim() && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={state === 'saving'}
          className="flex-shrink-0 rounded-full border border-acc-teal/40 bg-acc-teal/10 px-3 py-1 text-xs font-bold text-acc-teal disabled:text-app-tx3"
        >
          {state === 'saving' ? '…' : 'Save'}
        </button>
      )}
    </div>
  );
}
