'use client';

// The ONLY part of the logger that changes every second. While this lived as
// state in WorkoutForm, the 1 Hz tick re-rendered the entire ~1,700-line form
// — every exercise card, every stepper — for 45–60 minutes per session with
// the screen forced awake, and those per-second parent renders already caused
// one real bug (the rest pill's auto-close reset forever). As a child, the
// tick repaints these three DOM nodes and nothing else.

import { useEffect, useState } from 'react';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SessionClock({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));

  // Re-arms if the start moves (a restored draft rewinds it); recomputing
  // from the timestamp keeps it honest through iOS suspend/resume.
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  return (
    <span className="text-xs text-app-tx3 tabular-nums font-round">
      <span className="text-[9px] uppercase tracking-wider opacity-70 mr-1">session</span>
      {formatElapsed(elapsed)}
    </span>
  );
}
