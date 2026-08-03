'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const DRAFT_KEY = 'workout-draft';

export default function WorkoutDraftBanner() {
  const pathname = usePathname();
  const [draftName, setDraftName] = useState<string | null>(null);

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
  }, [pathname]);

  const visible = Boolean(draftName) && !pathname.startsWith('/workouts/new');

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

  if (!visible) return null;

  return (
    <Link
      href="/workouts/new"
      className="fixed bottom-[calc(88px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-40 flex justify-center px-4"
    >
      {/* Frosted glass pill · teal glow */}
      <span className="glass-overlay flex items-center gap-2.5 max-w-full rounded-full border border-acc-teal/30 shadow-glow-teal px-4 py-2.5 text-sm font-semibold text-app-tx1 pressable">
        <span className="w-2 h-2 rounded-full bg-acc-teal shadow-glow-teal motion-safe:animate-pulse flex-shrink-0" />
        <span className="truncate glow-teal">{draftName} in progress</span>
        <span className="text-app-tx2 text-xs flex-shrink-0">· Tap to resume</span>
      </span>
    </Link>
  );
}
