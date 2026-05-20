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

  if (!draftName || pathname.startsWith('/workouts/new')) return null;

  return (
    <Link
      href="/workouts/new"
      className="fixed bottom-[58px] left-0 right-0 z-40 bg-blue-600 text-white text-sm font-semibold py-2.5 px-4 flex items-center justify-center gap-2.5 max-w-lg mx-auto"
    >
      <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0" />
      <span className="truncate">{draftName} in progress</span>
      <span className="text-blue-200 text-xs flex-shrink-0">· Tap to resume</span>
    </Link>
  );
}
