'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AUTO_EXPLAIN,
  GEOFENCE_GYM_NAME,
  autoCheckInView,
  geofencePlugin,
  type GeofenceGym,
  type GeofenceStatus,
} from '@/lib/native-gym-geofence';

/**
 * Auto check-in (owner, 2026-10-22): the phone watches each gym's area and
 * asks "Check in?" on arrival, checks out on leaving. This row only sets it
 * up — permission, "Set this as B_Fit" standing at the gym, Clear. Hidden
 * outside a native build that has the plugin. Two lines at a glance.
 */
const kicker = 'font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3';
const btn = 'min-h-[44px] border border-app-border px-3 text-xs font-bold text-app-tx2';

export default function AutoCheckIn({ fixedGym }: { fixedGym?: GeofenceGym }) {
  const [status, setStatus] = useState<GeofenceStatus | null>(null);
  const [picked, setPicked] = useState<GeofenceGym>('bfit');
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const gym = fixedGym ?? picked;

  const refresh = useCallback(() => {
    const p = geofencePlugin();
    if (!p) return;
    p.status().then(setStatus).catch(() => {});
  }, []);

  // Read on mount and on every return: he may have changed it in Settings.
  useEffect(() => {
    refresh();
    const onShow = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : 'Could not do that — try again');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const view = autoCheckInView(status, gym);
  const p = geofencePlugin();
  if (view.kind === 'hidden' || !p) return null;

  return (
    <div className="mt-2.5 space-y-1.5">
      {view.kind === 'ask' && !explain && (
        <div className="flex items-center justify-between gap-2">
          <span className={kicker}>Auto check-in</span>
          <button type="button" className={btn} onClick={() => setExplain(true)}>
            Turn on
          </button>
        </div>
      )}
      {view.kind === 'ask' && explain && (
        <>
          {AUTO_EXPLAIN.map((l) => (
            <p key={l} className="text-xs text-app-tx2">{l}</p>
          ))}
          <button type="button" disabled={busy} className={btn} onClick={() => act(() => p.requestAlways())}>
            Allow
          </button>
        </>
      )}
      {view.kind === 'off' && (
        <div className="flex items-center justify-between gap-2">
          <span className={kicker}>{view.line}</span>
          <button type="button" className={btn} onClick={() => act(() => p.openSettings())}>
            Settings
          </button>
        </div>
      )}
      {view.kind === 'on' && (
        <>
          <p key={view.line} className={kicker}>{view.line}</p>
          <div className="flex flex-wrap gap-2">
            {!fixedGym &&
              (['bfit', 'work'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={g === gym}
                  onClick={() => setPicked(g)}
                  className={`${btn} ${g === gym ? 'border-app-tx1 text-app-tx1' : ''}`}
                >
                  {GEOFENCE_GYM_NAME[g]}
                </button>
              ))}
            <button
              type="button"
              disabled={busy}
              className={`${btn} flex-1`}
              onClick={() =>
                act(async () => {
                  const r = await p.setGym({ gym });
                  setNote(`${GEOFENCE_GYM_NAME[gym]} set · ±${r.accuracyM} m`);
                })
              }
            >
              {busy ? 'Finding you…' : `Set this as ${GEOFENCE_GYM_NAME[gym]}`}
            </button>
            {view.selectedSet && (
              <button type="button" disabled={busy} className={btn} onClick={() => act(() => p.clearGym({ gym }))}>
                Clear
              </button>
            )}
          </div>
        </>
      )}
      {note && <p className={kicker}>{note}</p>}
    </div>
  );
}
