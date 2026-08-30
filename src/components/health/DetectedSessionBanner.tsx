'use client';

// The "phone stayed in the locker" flow: he starts Strength Training on
// the Watch, trains hands-free, and the next app open greets him with the
// session it noticed — one tap lands in the logger prefilled from his last
// time, with the real duration and the HKWorkout identity attached so the
// offer never repeats. Native-only; renders nothing on the web, nothing
// when there is nothing fresh to confirm.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { detectUnlogged } from '@/app/health-actions';
import { isNativeApp, queryWorkouts, windowStartISO } from '@/lib/native-health';

/** Shared with NativeHealthCard: a uuid acted on anywhere stays dismissed. */
const DISMISSED_KEY = 'health-detect-dismissed';
const OWN_BUNDLE_ID = 'com.aralhamoud.workout';
/** Fresh means confirm-worthy; an older session belongs to the Stats card. */
const FRESH_HOURS = 36;

interface Offer {
  uuid: string;
  startISO: string;
  durationMin: number;
  localDay: string | null;
}

function localDayOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export default function DetectedSessionBanner() {
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    (async () => {
      try {
        const workouts = await queryWorkouts(windowStartISO(2));
        const candidates = workouts
          .filter((w) => !w.sourceBundleId?.startsWith(OWN_BUNDLE_ID))
          .map((w) => ({
            uuid: w.uuid,
            startISO: w.startISO,
            endISO: w.endISO,
            durationSec: w.durationSec,
            activityType: w.activityType,
            localDay: localDayOf(w.startISO),
          }));
        if (!candidates.length) return;
        const res = (await detectUnlogged({ candidates })) as {
          candidates?: Array<{ uuid: string; startISO: string; durationSec: number; kind?: string }>;
        };
        if (!alive || !Array.isArray(res?.candidates)) return;
        const dismissed = readDismissed();
        const fresh = res.candidates
          .filter((c) => (c.kind ?? 'strength') === 'strength')
          .filter((c) => !dismissed.includes(c.uuid))
          .filter((c) => Date.now() - new Date(c.startISO).getTime() < FRESH_HOURS * 3_600_000)
          .sort((a, b) => new Date(b.startISO).getTime() - new Date(a.startISO).getTime())[0];
        if (fresh) {
          setOffer({
            uuid: fresh.uuid,
            startISO: fresh.startISO,
            durationMin: Math.round(fresh.durationSec / 60),
            localDay: localDayOf(fresh.startISO),
          });
        }
      } catch {
        /* an offer that fails to load is simply not offered */
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!offer) return null;

  const when = new Date(offer.startISO).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const params = new URLSearchParams({ hk: offer.uuid, mins: String(offer.durationMin) });
  if (offer.localDay) params.set('date', offer.localDay);

  return (
    <Link
      href={`/workouts/new?${params.toString()}`}
      className="card block border-acc-violet/50 px-4 py-3 transition-colors hover:border-app-border-hi"
    >
      <p className="text-sm font-bold text-app-tx1">
        Trained {offer.durationMin} min at {when} — from your Watch.
        <span className="text-acc-violet"> Fill in the sets →</span>
      </p>
      <p className="mt-0.5 text-xs font-semibold text-app-tx2">
        Opens the logger prefilled from last time; adjust and save once.
      </p>
    </Link>
  );
}
