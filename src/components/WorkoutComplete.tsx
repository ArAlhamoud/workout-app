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
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 200]);
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="rounded-2xl bg-gradient-to-br from-green-950/60 to-green-900/30 border border-green-700/50 px-4 py-4 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-green-400 text-xs font-bold uppercase tracking-widest mb-1">
            Workout Complete
          </p>
          <p className="text-white font-black text-xl leading-tight">Great work! 💪</p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-green-300 text-sm">{exerciseCount} exercises</span>
            <span className="text-green-600 text-sm">·</span>
            <span className="text-green-300 text-sm">{setCount} sets</span>
            {volume > 0 && (
              <>
                <span className="text-green-600 text-sm">·</span>
                <span className="text-green-300 text-sm">
                  {volume >= 1000 ? `${(volume / 1000).toFixed(1)}k` : volume.toLocaleString()} kg
                </span>
              </>
            )}
            {duration && (
              <>
                <span className="text-green-600 text-sm">·</span>
                <span className="text-green-300 text-sm">{formatDuration(duration)}</span>
              </>
            )}
          </div>
          <Link
            href="/stats"
            className="inline-block mt-2 text-xs text-green-500 hover:text-green-400 transition-colors"
          >
            Log your weight →
          </Link>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-green-700 hover:text-green-400 transition-colors text-xl leading-none flex-shrink-0 mt-0.5"
        >
          ×
        </button>
      </div>
    </div>
  );
}
