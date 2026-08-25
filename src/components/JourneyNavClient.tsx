'use client';

// The navigation IS the journey (owner's third push: stop thinking like a
// workout app). The bottom bar is the treatment road itself — dose
// stations as dots, the doctor gate in ember, him as the ring — plus ONE
// morphing action that knows what today asks (syringe / barbell / talk),
// and one door to every room. No generic icon strip.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavStation {
  state: 'done' | 'next' | 'future' | 'gate';
  kind: 'dose' | 'checkpoint';
}

export interface NavAction {
  href: string;
  label: string;
  kind: 'dose' | 'train' | 'talk';
}

const ROOMS: Array<{ href: string; label: string }> = [
  { href: '/train', label: 'Training' },
  { href: '/workouts', label: 'History' },
  { href: '/stats', label: 'Stats' },
  { href: '/program', label: 'Program' },
  { href: '/exercises', label: 'Exercises' },
  { href: '/health/report', label: 'Doctor report' },
  { href: '/health/plan', label: 'Plan & profile' },
  { href: '/health/analytics', label: 'Patterns' },
  { href: '/health/timeline', label: 'The full log' },
];

function ActionIcon({ kind }: { kind: NavAction['kind'] }) {
  if (kind === 'dose') {
    // A syringe, simplified to strokes.
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 5l-1.5-1.5M14 4l6 6M12 6l6 6-7 7-6-6zM5 13l-2 2M8 19l-2 2" />
      </svg>
    );
  }
  if (kind === 'train') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="7" y1="12" x2="17" y2="12" />
        <rect x="3" y="8" width="3" height="8" rx="1" />
        <rect x="18" y="8" width="3" height="8" rx="1" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />
    </svg>
  );
}

export default function JourneyNavClient({
  stations,
  action,
}: {
  stations: NavStation[];
  action: NavAction;
}) {
  const pathname = usePathname();
  const [roomsOpen, setRoomsOpen] = useState(false);
  const onHome = pathname === '/';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 print:hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#f2f0ea] via-[#f2f0ea]/70 to-transparent" />

      {/* Rooms sheet */}
      {roomsOpen && (
        <div className="relative mx-auto max-w-lg px-3 pb-2">
          <div className="sheet-surface rounded-card-lg border-2 border-ink p-2 shadow-[5px_5px_0_#0b0b0f]">
            <div className="grid grid-cols-2 gap-1.5">
              {ROOMS.map((r) => (
                <Link
                  key={r.href}
                  href={r.href}
                  onClick={() => setRoomsOpen(false)}
                  className={`min-h-[46px] rounded-card border-2 px-3 py-2.5 text-sm font-extrabold transition-colors ${
                    pathname.startsWith(r.href)
                      ? 'border-ink bg-acc-teal-deep text-white'
                      : 'border-ink/20 bg-app-surface text-app-tx1'
                  }`}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="relative mx-auto max-w-lg px-3 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
        <div className="flex items-center gap-2">
          {/* The road — the bar IS the journey. Tap = the full path. */}
          <Link
            href={onHome ? '/journey' : '/'}
            aria-label={onHome ? 'Open the journey' : 'Go home'}
            className="glass-overlay flex h-[54px] min-w-0 flex-1 items-center rounded-[28px] border-2 border-ink px-4 shadow-nav"
          >
            <span className="mr-3 flex-none text-[9px] font-black uppercase tracking-[0.14em] text-app-tx3">
              {onHome ? 'Journey' : 'Home'}
            </span>
            <span className="relative flex min-w-0 flex-1 items-center">
              <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-ink/15" aria-hidden="true" />
              <span className="relative flex w-full items-center justify-between">
                {stations.slice(0, 8).map((s, i) => (
                  <span
                    key={i}
                    className={`rounded-full border-2 border-ink ${
                      s.state === 'next'
                        ? 'h-3.5 w-3.5 bg-white ring-4 ring-acc-teal-deep/30'
                        : s.kind === 'checkpoint'
                        ? 'h-2.5 w-2.5 bg-acc-ember-deep'
                        : s.state === 'done'
                        ? 'h-2.5 w-2.5 bg-acc-teal-deep'
                        : 'h-2 w-2 bg-app-surface2'
                    }`}
                  />
                ))}
              </span>
            </span>
          </Link>

          {/* Today's one action, morphing */}
          <Link
            href={action.href}
            aria-label={action.label}
            className={`flex h-[54px] flex-none items-center gap-2 rounded-[28px] border-2 border-ink px-4 text-sm font-extrabold text-white shadow-[4px_4px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] ${
              action.kind === 'train' ? 'bg-acc-violet-deep' : 'bg-acc-teal-deep'
            }`}
          >
            <ActionIcon kind={action.kind} />
            <span className="hidden min-[380px]:inline">{action.label}</span>
          </Link>

          {/* The rooms */}
          <button
            type="button"
            aria-label="All rooms"
            aria-expanded={roomsOpen}
            onClick={() => setRoomsOpen((v) => !v)}
            className={`flex h-[54px] w-[54px] flex-none items-center justify-center rounded-[28px] border-2 border-ink shadow-nav transition-colors ${
              roomsOpen ? 'bg-ink text-white' : 'glass-overlay text-app-tx1'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="6" cy="6" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="12" cy="6" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="18" cy="6" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="6" cy="18" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="12" cy="18" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="18" cy="18" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
