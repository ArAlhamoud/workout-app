'use client';

import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AUTO_EXPLAIN,
  GEOFENCE_GYM_NAME,
  autoCheckInView,
  geofencePlugin,
  onGeofenceStatus,
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

/**
 * Wraps the row on /train: a native failure while rendering hides the row,
 * never the page (2026-10-22: a listener crash took /train to the error
 * screen).
 */
export class AutoCheckInBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* the row stays hidden; manual check-in is untouched */
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function AutoCheckIn({ fixedGym }: { fixedGym?: GeofenceGym }) {
  const [status, setStatus] = useState<GeofenceStatus | null>(null);
  const [picked, setPicked] = useState<GeofenceGym>('bfit');
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const gym = fixedGym ?? picked;

  // Every native call goes through a promise and a catch: a plugin that
  // throws or answers oddly hides nothing but this row.
  const refresh = useCallback(() => {
    Promise.resolve()
      .then(() => geofencePlugin()?.status())
      .then((s) => s && setStatus(s))
      .catch(() => {});
  }, []);

  // Read on mount and on every return: he may have changed it in Settings.
  useEffect(() => {
    refresh();
    const onShow = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onShow);
    const off = onGeofenceStatus(setStatus);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      off();
    };
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
                  onClick={() => {
                    setPicked(g);
                    setConfirmClear(false);
                  }}
                  className={`${btn} ${g === gym ? 'border-app-tx1 text-app-tx1' : ''}`}
                >
                  {GEOFENCE_GYM_NAME[g]}
                </button>
              ))}
            {/* Set only an unset gym: one tap at home must never move a set
                gym there (review D3). Re-setting is Clear, then Set. */}
            {!view.selectedSet && (
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
            )}
            {view.selectedSet && !confirmClear && (
              <button type="button" disabled={busy} className={`${btn} flex-1`} onClick={() => setConfirmClear(true)}>
                {GEOFENCE_GYM_NAME[gym]} set · Clear
              </button>
            )}
            {view.selectedSet && confirmClear && (
              <button
                type="button"
                disabled={busy}
                className={`${btn} flex-1 border-app-tx1 text-app-tx1`}
                onClick={() => {
                  setConfirmClear(false);
                  act(() => p.clearGym({ gym }));
                }}
              >
                {`Clear ${GEOFENCE_GYM_NAME[gym]}'s location?`}
              </button>
            )}
          </div>
        </>
      )}
      {note && <p className={kicker}>{note}</p>}
      {/* What the phone saw, behind a tap (2026-10-29: a missed arrival
          could not be told from a missed prompt without the Mac). */}
      {view.kind === 'on' && status?.trace && status.trace.length > 0 && (
        <details>
          <summary className={`${kicker} cursor-pointer`}>Recent events</summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-app-tx3">
            {status.trace.slice(0, 12).map((l, i) => (
              <li key={`${i}-${l}`}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
