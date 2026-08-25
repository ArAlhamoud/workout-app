'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface WorkoutCompleteProps {
  exerciseCount: number;
  setCount: number;
  volume: number;
  duration: number | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function WorkoutComplete({
  exerciseCount,
  setCount,
  volume,
  duration,
}: WorkoutCompleteProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // No navigator.vibrate here: iOS has never implemented it, so inside the
    // Capacitor WKWebView shell that call was a silent no-op pretending to be
    // feedback. The card itself is the confirmation. When the native plugin
    // batch lands, raise the cue through the RestTimer seam
    // (scheduleRestAlert / @capacitor/haptics) rather than re-adding it here.
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="card-lg border-acc-teal/30 shadow-glow-teal px-4 py-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-acc-teal text-xs font-bold uppercase tracking-widest mb-1">
            Workout Complete
          </p>
          <p className="glow-teal font-round font-bold text-xl leading-tight">Great work! 💪</p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-app-tx2 text-sm tabular-nums">{exerciseCount} exercises</span>
            <span className="text-app-tx3 text-sm">·</span>
            <span className="text-app-tx2 text-sm tabular-nums">{setCount} sets</span>
            {volume > 0 && (
              <>
                <span className="text-app-tx3 text-sm">·</span>
                <span className="text-app-tx2 text-sm tabular-nums">
                  {volume >= 1000 ? `${(volume / 1000).toFixed(1)}k` : volume.toLocaleString()} kg
                </span>
              </>
            )}
            {duration && (
              <>
                <span className="text-app-tx3 text-sm">·</span>
                <span className="text-app-tx2 text-sm tabular-nums">{formatDuration(duration)}</span>
              </>
            )}
          </div>
          <Link
            href="/stats"
            className="inline-block mt-2 text-xs text-acc-teal hover:text-acc-teal transition-colors"
          >
            Log your weight →
          </Link>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-app-tx3 hover:text-app-tx1 transition-colors text-xl leading-none flex-shrink-0 mt-0.5"
        >
          ×
        </button>
      </div>
    </div>
  );
}
