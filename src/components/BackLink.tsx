'use client';

// A back control that goes back, rather than to a hardcoded destination.
//
// /progress/[exerciseId] used a fixed "← Program" link, but the chart icon in
// the logger opens that same route mid-session — so the only way out dumped
// you into Program and abandoned a live workout. router.back() returns to
// wherever you actually came from.
//
// 44x44 to meet the minimum touch target; the label is for screen readers,
// since a lone chevron in the top-left needs no caption for a sighted user.

import { useRouter } from 'next/navigation';

export default function BackLink({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label={label}
      className="pressable -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-app-tx3 transition-colors hover:text-app-tx1"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
