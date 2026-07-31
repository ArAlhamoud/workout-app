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
      {/* FAB — aurora conic gradient with indigo glow */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Log workout"
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 bg-[conic-gradient(from_200deg,#5eead4,#818cf8,#c084fc,#5eead4)] shadow-[0_0_26px_-4px_rgba(129,140,248,0.85),inset_0_1px_0_rgba(255,255,255,0.5)] ${
          isLog ? 'brightness-110' : 'hover:brightness-110'
        }`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0b1120" strokeWidth="2.5" strokeLinecap="round">
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

      {/* Sheet — frosted glass over the aurora */}
      <div
        className={`fixed left-0 right-0 bottom-0 z-50 max-w-lg mx-auto transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="glass-overlay rounded-t-card-lg border-t border-app-border shadow-card-lg px-4 pt-5 pb-8">
          {/* Handle */}
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-5" />

          <p className="section-label mb-4">
            Start a Workout
          </p>

          {/* 2×3 grid: columns = days, rows = durations.
              Day A glows violet · Day B glows teal. */}
          <div className="grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((day) => (
              <div key={day} className="space-y-2">
                <div className={`text-center text-xs font-bold uppercase tracking-widest py-1 rounded-lg ${
                  day === 'A' ? 'glow-violet bg-acc-violet-deep/10' : 'glow-teal bg-acc-teal-deep/10'
                }`}>
                  Day {day}
                </div>
                {DURATIONS.map((d) => (
                  <Link
                    key={d}
                    href={`/workouts/new?day=${day}&dur=${d}`}
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between px-4 py-3 min-h-[44px] rounded-card border transition-all active:scale-[0.98] ${
                      day === 'A'
                        ? 'bg-acc-violet-deep/15 border-acc-violet/30 hover:bg-acc-violet-deep/25 hover:shadow-glow-violet active:bg-acc-violet-deep/30'
                        : 'bg-acc-teal-deep/15 border-acc-teal/30 hover:bg-acc-teal-deep/25 hover:shadow-glow-teal active:bg-acc-teal-deep/30'
                    }`}
                  >
                    <span className={`font-bold text-sm ${day === 'A' ? 'text-[#ddd6fe]' : 'text-[#ccfbf1]'}`}>
                      {d} min
                    </span>
                    <span className="text-app-tx2 text-xs">{DURATION_LABELS[d]}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {/* Custom log option */}
          <Link
            href="/workouts/new"
            onClick={() => setOpen(false)}
            className="mt-4 w-full flex items-center justify-center py-3 min-h-[44px] rounded-card border border-app-border border-dashed text-app-tx2 hover:text-app-tx1 hover:border-app-border-hi text-sm transition-colors"
          >
            Custom / free-form log
          </Link>
        </div>
      </div>
    </>
  );
}
