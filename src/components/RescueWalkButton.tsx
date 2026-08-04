'use client';

// The zero-equipment escape hatch on the rescue screen. Not near a gym at
// all? A 15-minute brisk walk logged as a real session keeps the streak,
// the dynamic plan and the habit chain alive — which is the entire point of
// a rescue. One tap, one confirmation, done.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logRescueWalk } from '@/app/actions';
import { armGapGuard, clearComeback } from '@/lib/gap-guard';
import { hapticSuccess } from '@/lib/native-feedback';

export default function RescueWalkButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logWalk = async () => {
    setBusy(true);
    try {
      const { id } = await logRescueWalk();
      armGapGuard(new Date().toISOString(), null);
      clearComeback();
      hapticSuccess();
      router.push(`/workouts/${id}?new=1`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={logWalk}
      disabled={busy}
      className="mt-2 text-xs font-semibold px-3 py-2 rounded-card bg-app-surface2 border border-app-border text-app-tx2 hover:border-app-border-hi transition-colors disabled:text-app-tx3"
    >
      {busy ? 'Logging…' : 'No gym today? Log a 15-min walk instead'}
    </button>
  );
}
