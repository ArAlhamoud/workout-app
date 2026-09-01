'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { durableRemove } from '@/lib/native-store';
import { closeLiveSession, getLiveSession } from '@/app/actions';

const DRAFT_KEY = 'workout-draft';

export default function WorkoutDraftBanner() {
  const pathname = usePathname();
  const [draftName, setDraftName] = useState<string | null>(null);
  // Discard is two taps on purpose: the pill is fixed above the nav bar, and a
  // single stray thumb should never bin a session that is mid-flight.
  const [confirming, setConfirming] = useState(false);
  /** A session running on the Watch right now — offered as "Continue" here. */
  const [watchLive, setWatchLive] = useState<{ day: string | null; dur: number | null; sets: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLiveSession()
      .then((row) => {
        if (cancelled) return;
        setWatchLive(row && row.source === 'watch' ? { day: row.day, dur: row.durationMin, sets: row.sets.length } : null);
      })
      .catch(() => { if (!cancelled) setWatchLive(null); });
    return () => { cancelled = true; };
  }, [pathname]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) { setDraftName(null); return; }
      const draft = JSON.parse(raw);
      const age = Date.now() - (draft.savedAt ?? 0);
      if (age < 24 * 60 * 60 * 1000 && Array.isArray(draft.blocks) && draft.blocks.length > 0) {
        setDraftName(draft.name || 'Workout');
      } else {
        localStorage.removeItem(DRAFT_KEY);
        setDraftName(null);
      }
    } catch {
      setDraftName(null);
    }
    setConfirming(false);
  }, [pathname]);

  const showWatch = Boolean(watchLive) && !draftName;
  const visible = (Boolean(draftName) || showWatch) && !pathname.startsWith('/workouts/new');

  // The banner is fixed at 88px with ~44px of its own height, which overruns
  // main's pb-32 (128px) and clips whatever ends the page — on Home that was
  // the Return Protocol card's LOAD / SESSIONS / CAP labels. Reserve the extra
  // room only while the banner is actually up, so no screen pays for it
  // otherwise.
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add('has-draft-banner');
    return () => document.body.classList.remove('has-draft-banner');
  }, [visible]);

  const shell =
    'glass-overlay flex items-center gap-2.5 max-w-full rounded-full border shadow-glow-teal px-4 py-2.5 text-sm font-semibold text-app-tx1';

  if (!visible) return null;

  if (showWatch && watchLive) {
    const href = `/workouts/new?day=${watchLive.day ?? 'A'}&dur=${watchLive.dur ?? 45}`;
    return (
      <div className="fixed bottom-[calc(88px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-40 flex justify-center px-4 print:hidden">
        <Link href={href} className={`${shell} border-acc-teal/40`}>
          <span className="truncate">⌚ Day {watchLive.day ?? '?'} · {watchLive.sets} set{watchLive.sets === 1 ? '' : 's'}</span>
          <span className="flex-shrink-0 text-acc-teal text-xs font-bold">Continue →</span>
        </Link>
      </div>
    );
  }

  /** Clear both stores: the logger persists through durableSet, which writes
   *  native Preferences as well as localStorage. Removing only one leaves a
   *  draft that reappears on the next cold start. */
  async function discard() {
    // The live row goes with the draft, or the Watch keeps offering the
    // binned session and the next logger open re-ticks it (steward).
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const saveId = raw ? (JSON.parse(raw) as { saveId?: string }).saveId : undefined;
      if (saveId) await closeLiveSession(saveId).catch(() => {});
    } catch { /* no draft to read — nothing live to close */ }
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch { /* the durable remove below still runs */ }
    await durableRemove(DRAFT_KEY).catch(() => {});
    setDraftName(null);
    setConfirming(false);
  }


  return (
    <div className="fixed bottom-[calc(88px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-40 flex justify-center px-4 print:hidden">
      {confirming ? (
        <div className={`${shell} border-rpe-grind/40`}>
          <span className="truncate text-app-tx2">Discard {draftName}?</span>
          <button
            type="button"
            onClick={discard}
            className="flex-shrink-0 rounded-full border border-rpe-grind/50 bg-rpe-grind/10 px-3 py-1 text-xs font-bold text-rpe-grind transition-colors hover:bg-rpe-grind/20"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex-shrink-0 px-2 py-1 text-xs font-semibold text-app-tx3 transition-colors hover:text-app-tx1"
          >
            Keep
          </button>
        </div>
      ) : (
        <div className={`${shell} border-acc-teal/30`}>
          <Link href="/workouts/new" className="flex min-w-0 items-center gap-2.5 pressable">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-acc-teal shadow-glow-teal motion-safe:animate-pulse" />
            {/* No " in progress" suffix — beside "Tap to resume" it said
                nothing, and it was the first thing truncation ate. */}
            <span className="truncate glow-teal">{draftName}</span>
            <span className="flex-shrink-0 text-xs text-app-tx2">· Tap to resume</span>
          </Link>
          <button
            type="button"
            aria-label="Discard this workout"
            onClick={() => setConfirming(true)}
            className="-mr-1.5 flex-shrink-0 px-2 py-1 text-lg leading-none text-app-tx3 transition-colors hover:text-rpe-grind"
          >
            &#215;
          </button>
        </div>
      )}
    </div>
  );
}
