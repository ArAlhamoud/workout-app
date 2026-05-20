'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DURATION_LABELS } from '@/lib/program';

const DURATIONS = [30, 45, 60] as const;

export default function LogWorkoutSheet() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isLog = pathname.startsWith('/workouts/new');

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Log workout"
        className={`absolute left-1/2 -translate-x-1/2 -top-6 w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all active:scale-90 border-[3px] border-gray-950 ${
          isLog ? 'bg-blue-500' : 'bg-blue-600 hover:bg-blue-500'
        }`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sheet */}
      <div
        className={`fixed left-0 right-0 bottom-0 z-50 max-w-lg mx-auto transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="bg-gray-900 rounded-t-2xl border-t border-gray-800 px-4 pt-5 pb-8">
          {/* Handle */}
          <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-5" />

          <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-4">
            Start a Workout
          </p>

          {/* 2×3 grid: columns = days, rows = durations */}
          <div className="grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((day) => (
              <div key={day} className="space-y-2">
                <div className={`text-center text-xs font-bold uppercase tracking-widest py-1 rounded-lg ${
                  day === 'A' ? 'text-blue-400 bg-blue-600/10' : 'text-violet-400 bg-violet-700/10'
                }`}>
                  Day {day}
                </div>
                {DURATIONS.map((d) => (
                  <Link
                    key={d}
                    href={`/workouts/new?day=${day}&dur=${d}`}
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl transition-colors active:scale-[0.98] ${
                      day === 'A'
                        ? 'bg-blue-600/15 border border-blue-700/30 hover:bg-blue-600/25 active:bg-blue-600/30'
                        : 'bg-violet-700/15 border border-violet-700/30 hover:bg-violet-700/25 active:bg-violet-700/30'
                    }`}
                  >
                    <span className={`font-bold text-sm ${day === 'A' ? 'text-blue-300' : 'text-violet-300'}`}>
                      {d} min
                    </span>
                    <span className="text-gray-500 text-xs">{DURATION_LABELS[d]}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {/* Custom log option */}
          <Link
            href="/workouts/new"
            onClick={() => setOpen(false)}
            className="mt-4 w-full flex items-center justify-center py-3 rounded-xl border border-gray-700 border-dashed text-gray-500 hover:text-gray-400 hover:border-gray-600 text-sm transition-colors"
          >
            Custom / free-form log
          </Link>
        </div>
      </div>
    </>
  );
}
