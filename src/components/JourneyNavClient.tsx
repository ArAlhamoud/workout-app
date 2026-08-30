'use client';

// The navigation IS the journey (owner's third push: stop thinking like a
// workout app). The bottom bar is the treatment road itself — dose
// a Home button (the person), plus ONE
// morphing action that knows what today asks (syringe / barbell / talk),
// and one door to every room. No generic icon strip.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getNowDoors, getRoomGlances } from '@/app/nav-actions';

export interface NavStation {
  state: 'done' | 'next' | 'future' | 'gate';
  kind: 'dose' | 'checkpoint';
}

export interface NavAction {
  href: string;
  label: string;
  kind: 'dose' | 'train' | 'talk';
  /** For kind 'train': which day the CTA starts — it wears that day's color. */
  day?: 'A' | 'B';
}

// The map: every room, grouped by world, each with a stroke icon and one
// live glance line (fetched lazily on first open — the names never wait on
// the network). Three groups mirror how he thinks: the body, the training,
// and the record both of them write.
type Room = { href: string; label: string; icon: RoomIconKind };
type NowDoor = { href: string; label: string; icon: string };
const ROOM_GROUPS: Array<{ title: string; rooms: Room[] }> = [
  {
    title: 'Body',
    rooms: [
      { href: '/health/injection', label: 'Injection day', icon: 'dose' },
      { href: '/health/bp', label: 'Pressure', icon: 'cuff' },
      { href: '/health/diet', label: 'Diet', icon: 'bowl' },
      { href: '/health/plan', label: 'Plan & profile', icon: 'person' },
      { href: '/health/report', label: 'Doctor report', icon: 'doc' },
    ],
  },
  {
    title: 'Training',
    rooms: [
      { href: '/train', label: 'Train', icon: 'train' },
      { href: '/workouts', label: 'History', icon: 'clock' },
      { href: '/program', label: 'Program', icon: 'list' },
      { href: '/exercises', label: 'Exercises', icon: 'grid' },
    ],
  },
  {
    title: 'The record',
    rooms: [
      { href: '/health/timeline', label: 'Timeline', icon: 'lines' },
      { href: '/health/analytics', label: 'Patterns', icon: 'zigzag' },
      { href: '/stats', label: 'Stats', icon: 'bars' },
    ],
  },
];

type RoomIconKind = 'dose' | 'cuff' | 'bowl' | 'person' | 'doc' | 'train' | 'clock' | 'list' | 'grid' | 'lines' | 'zigzag' | 'bars';

/** Tiny stroke glyphs in the bar's own visual language — no emoji, no fills. */
function RoomIcon({ kind }: { kind: RoomIconKind }) {
  const p: Record<RoomIconKind, React.ReactNode> = {
    dose: <path d="M14 4l6 6M12 6l6 6-7 7-6-6zM5 13l-2 2" />,
    cuff: <><circle cx="12" cy="12" r="6" /><path d="M12 9v3l2 2M12 2v2M12 20v2" /></>,
    bowl: <><path d="M4 12h16a8 8 0 0 1-16 0z" /><path d="M9 8c0-2 6-2 6 0" /></>,
    person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
    train: <><line x1="7" y1="12" x2="17" y2="12" /><rect x="3" y="8" width="3" height="8" rx="1" /><rect x="18" y="8" width="3" height="8" rx="1" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 3" /></>,
    list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
    lines: <path d="M4 7h16M4 12h16M4 17h10" />,
    zigzag: <path d="M3 16l5-7 4 5 5-8 4 6" />,
    bars: <path d="M5 20V12M11 20V6M17 20V9M21 20H3" />,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[kind]}
    </svg>
  );
}

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
  action,
}: {
  action: NavAction;
}) {
  const pathname = usePathname();
  const [roomsOpen, setRoomsOpen] = useState(false);
  // Refetched on EVERY open: the webview process lives for days, and a
  // once-per-mount cache showed yesterday's map — or, worse, cached one
  // basement network failure as a permanently glance-less sheet
  // (device-tester, HIGH). Stale lines still paint instantly; fresh ones
  // swap in; a failure keeps the previous lines and retries next open.
  const [glances, setGlances] = useState<Record<string, string> | null>(null);
  // The Now row: today's 2-3 doors, picked by state — same fetch-on-open,
  // same keep-stale-on-failure contract as the glances.
  const [nowDoors, setNowDoors] = useState<NowDoor[]>([]);
  useEffect(() => {
    if (!roomsOpen) return;
    let cancelled = false;
    getRoomGlances()
      .then((g) => { if (!cancelled) setGlances(g); })
      .catch(() => { /* keep what we have; next open retries */ });
    getNowDoors()
      .then((d) => { if (!cancelled) setNowDoors(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomsOpen]);

  // 2: the sheet must not outlive the screen it was opened on — the CTA,
  // the journey pill, and the iOS back-swipe all navigate without touching
  // the room links' own onClick close.
  useEffect(() => {
    setRoomsOpen(false);
  }, [pathname]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 print:hidden">
      {/* Ground fade under the bar — token-driven so Volt fades to black,
          not to bone (the literal hex here was the one white ghost on the
          dark training screens). */}
      <div className="nav-scrim pointer-events-none absolute inset-x-0 bottom-0 h-24" />

      {/* The map — every room, grouped, glanceable. Tap outside to close. */}
      {roomsOpen && (
        <>
          <button
            type="button"
            aria-label="Close rooms"
            onClick={() => setRoomsOpen(false)}
            className="fixed inset-0 cursor-default touch-none bg-ink/20"
            tabIndex={-1}
          />
          <div className="relative mx-auto max-w-lg px-3 pb-2">
            <div className="sheet-surface max-h-[72vh] overflow-y-auto overscroll-contain rounded-card-lg border-2 border-ink p-3 shadow-[5px_5px_0_#0b0b0f]">
              {[
                ...(nowDoors.length
                  ? [{ title: 'Now', rooms: nowDoors as Room[] }]
                  : []),
                ...ROOM_GROUPS,
              ].map((g, gi) => (
                <div key={g.title} className={gi > 0 ? 'mt-3' : ''}>
                  <p className="px-1 pb-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-app-tx3">
                    {g.title}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {g.rooms.map((r) => {
                      const here = pathname.startsWith(r.href);
                      const glance = glances?.[r.href];
                      return (
                        <Link
                          key={r.href}
                          href={r.href}
                          onClick={() => setRoomsOpen(false)}
                          className={`flex min-h-[56px] items-center gap-2.5 rounded-card border-2 px-3 py-2 transition-colors ${
                            here ? 'border-ink bg-acc-teal-deep text-ink' : 'border-ink/20 bg-app-surface text-app-tx1'
                          }`}
                        >
                          <span className={here ? 'text-white' : 'text-app-tx2'}>
                            <RoomIcon kind={r.icon} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-extrabold leading-tight">{r.label}</span>
                            {glance && (
                              <span className={`block truncate text-[10px] font-semibold tabular-nums leading-tight ${here ? 'text-white/75' : 'text-app-tx3'}`}>
                                {glance}
                              </span>
                            )}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="relative mx-auto max-w-lg px-3 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
        {/* Gap taps close the sheet — misses 3px off ROOMS must not no-op. */}
        <div className="flex items-center gap-2" onClick={() => roomsOpen && setRoomsOpen(false)}>
          {/* Home — the person. The road now lives under his feet on Home. */}
          <Link
            href="/"
            aria-label="Home"
            className="glass-overlay grid h-[54px] w-[54px] flex-none place-items-center rounded-full border-2 border-ink shadow-nav"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="5.5" r="3" />
              <path d="M8 21v-6c0-3 1.5-5 4-5s4 2 4 5v6" />
            </svg>
          </Link>

          {/* Today's one action, morphing */}
          <Link
            href={action.href}
            aria-label={action.label}
            className={`flex h-[54px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[28px] border-2 border-ink px-4 text-sm font-extrabold text-ink shadow-[4px_4px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] ${
              // Day color is law: A violet, B teal — the train CTA wears ITS day.
              action.kind === 'train' ? (action.day === 'B' ? 'bg-acc-teal-deep' : 'bg-acc-violet-deep') : 'bg-acc-teal-deep'
            }`}
          >
            <ActionIcon kind={action.kind} />
            <span>{action.label}</span>
          </Link>

          {/* The rooms */}
          {/* Named, not a naked glyph: 'where are the other pages' was asked
              twice before this word appeared. */}
          <button
            type="button"
            aria-label="All rooms"
            aria-expanded={roomsOpen}
            onClick={() => setRoomsOpen((v) => !v)}
            className={`flex h-[54px] w-[54px] flex-none flex-col items-center justify-center gap-0.5 rounded-[28px] border-2 border-ink shadow-nav transition-colors ${
              roomsOpen ? 'bg-ink text-white' : 'glass-overlay text-app-tx1'
            }`}
          >
            <svg width="16" height="12" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="6" cy="4" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="12" cy="4" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="18" cy="4" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="6" cy="10" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="12" cy="10" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="18" cy="10" r="1.6" fill="currentColor" stroke="none" />
            </svg>
            <span className="text-[8px] font-black uppercase tracking-[0.12em] leading-none">Rooms</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
