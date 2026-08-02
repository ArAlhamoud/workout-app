'use client';

// Apple Health sync card — renders ONLY inside the native Capacitor shell.
// On the plain web / PWA this component returns null and costs nothing.

import { useEffect, useState } from 'react';
import {
  isNativeApp,
  requestHealthAuthorization,
  queryWeight,
  queryWorkoutStats,
  saveWorkout,
  formatSyncAge,
  windowStartISO,
  HEALTH_APP_URL,
} from '@/lib/native-health';

const TOKEN_KEY = 'health-sync-token';
const LAST_SYNC_KEY = 'health-native-last-sync';
const CONNECTED_KEY = 'health-native-connected';
const API_TIMEOUT_MS = 20_000;

/**
 * Weight is always re-pulled over a fixed rolling window, never "since the last
 * sync". A weigh-in can be ENTERED on Wednesday but DATED Monday; a since-cursor
 * moves past Monday and drops that sample forever, silently. Re-sending overlap
 * is free: /api/health/import upserts on (type, date, source) and refuses to
 * overwrite manually logged days, so this is idempotent.
 */
const WEIGHT_WINDOW_DAYS = 30;

interface ApiWorkout {
  id: string;
  name: string;
  start: string;
  durationMin: number;
  /** App-side estimate. Deliberately NOT written to HealthKit — see sync(). */
  estKcal: number;
}

interface ImportSample {
  type: 'weight' | 'heart_rate' | 'active_energy';
  value: number;
  unit: string;
  date: string;
}

const inputCls =
  'w-full bg-app-surface2 border border-app-border rounded-card px-3 py-2.5 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-acc-teal/60 text-sm transition-colors';
const btnCls =
  'px-3.5 py-2 text-xs font-bold rounded-card transition-all bg-gradient-to-r from-acc-teal to-acc-teal-deep text-[#062521] shadow-glow-teal hover:brightness-105 disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none';
const btnGhostCls =
  'px-3.5 py-2 text-xs font-bold rounded-card transition-colors bg-app-surface2 border border-app-border text-app-tx1 hover:border-app-border-hi disabled:text-app-tx3';
/* Quiet aurora affordance for <details> — the sentence lives one tap away */
const summaryCls =
  'chip inline-flex w-fit cursor-pointer select-none list-none items-center gap-1.5 border border-app-border bg-white/5 text-[10px] uppercase tracking-[0.12em] text-app-tx3 transition-colors hover:border-app-border-hi hover:text-app-tx2 [&::-webkit-details-marker]:hidden';
const linkCls =
  'text-[11px] text-acc-teal/75 underline decoration-acc-teal/30 underline-offset-2 transition-colors hover:text-acc-teal';

function Chevron() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="flex-none transition-transform duration-200 group-open:rotate-180"
    >
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NativeHealthCard() {
  const [native, setNative] = useState(false);
  const [token, setToken] = useState('');
  const [draft, setDraft] = useState('');
  const [editingToken, setEditingToken] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    setToken(localStorage.getItem(TOKEN_KEY) ?? '');
    setConnected(localStorage.getItem(CONNECTED_KEY) === '1');
    setLastSync(localStorage.getItem(LAST_SYNC_KEY));
  }, []);

  if (!native) return null;

  // Bounded like the bridge calls: a request that never comes back would
  // otherwise strand the card on "Syncing…" with nothing to report.
  const api = async (path: string, init?: RequestInit): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(path, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error(`${path} timed out after ${API_TIMEOUT_MS / 1000}s`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  /** Keep the stage name, but carry the real cause so a failure is debuggable. */
  const reason = (e: unknown, stage: string) =>
    e instanceof Error && e.message ? `${stage}: ${e.message}` : stage;

  const saveToken = (e: React.FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    localStorage.setItem(TOKEN_KEY, value);
    setToken(value);
    setDraft('');
    setEditingToken(false);
  };

  const connect = async () => {
    setBusy('connect');
    setErrors([]);
    try {
      const { granted } = await requestHealthAuthorization();
      setConnected(granted);
      localStorage.setItem(CONNECTED_KEY, granted ? '1' : '');
      // NOT "permission denied": iOS never reports which read categories were
      // allowed, so a false here only means the sheet didn't come back confirmed.
      setStatus(granted ? 'Health linked' : 'Not confirmed — check Health sharing');
    } catch (e) {
      // Surface the real reason — a generic "failed" chip hides whether the
      // bridge rejected, timed out, or was never reached at all.
      setErrors([e instanceof Error ? e.message : 'connect failed']);
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    setErrors([]);
    setStatus('Syncing…');
    const errs: string[] = [];
    let weightsUp = 0;
    let workoutsUp = 0;

    // 1 — HealthKit weight → app (rolling window, never a since-last-sync cursor)
    try {
      const samples = await queryWeight(windowStartISO(WEIGHT_WINDOW_DAYS));
      if (samples.length > 0) {
        const body: ImportSample[] = samples.map((s) => ({
          type: 'weight',
          value: s.value,
          unit: 'kg',
          date: s.dateISO,
        }));
        await api('/api/health/import', { method: 'POST', body: JSON.stringify(body) });
        weightsUp = samples.length;
      }
      // Marker is now display-only ("synced 2h ago") — it is never a query bound.
      const stamp = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, stamp);
      setLastSync(stamp);
    } catch (e) {
      errs.push(reason(e, 'weight sync'));
    }

    // 2 — un-synced app workouts → HealthKit (+ HR/energy enrichment back to app)
    try {
      const workouts = (await api('/api/health/workouts')) as ApiWorkout[];
      const savedIds: string[] = [];
      const enrichment: ImportSample[] = [];

      for (const w of workouts) {
        const endISO = new Date(new Date(w.start).getTime() + w.durationMin * 60_000).toISOString();
        try {
          const stats = await queryWorkoutStats(w.start, endISO);
          if (stats.avgHr !== null) {
            enrichment.push({ type: 'heart_rate', value: stats.avgHr, unit: 'count/min', date: w.start });
          }
          if (stats.activeKcal !== null && stats.activeKcal > 0) {
            enrichment.push({ type: 'active_energy', value: stats.activeKcal, unit: 'kcal', date: w.start });
          }
        } catch (e) {
          errs.push(reason(e, 'stats'));
        }
        try {
          // No energy value, on purpose. stats.activeKcal was READ out of Health
          // for this window; writing it back as a new HKWorkout double-counts a
          // session the Watch already logged, and w.estKcal is only our own
          // guess. HealthKit still derives energy from the Watch's own samples,
          // so no value is more honest than a wrong one.
          await saveWorkout({ startISO: w.start, endISO, name: w.name });
          savedIds.push(w.id);
        } catch (e) {
          errs.push(reason(e, 'save'));
        }
      }

      if (enrichment.length > 0) {
        try {
          await api('/api/health/import', { method: 'POST', body: JSON.stringify(enrichment) });
        } catch (e) {
          errs.push(reason(e, 'enrich'));
        }
      }
      if (savedIds.length > 0) {
        await api('/api/health/workouts', { method: 'POST', body: JSON.stringify({ ids: savedIds }) });
        workoutsUp = savedIds.length;
      }
    } catch (e) {
      errs.push(reason(e, 'workout sync'));
    }

    const counts: string[] = [];
    if (weightsUp > 0) counts.push(`${weightsUp} weight${weightsUp === 1 ? '' : 's'}`);
    if (workoutsUp > 0) counts.push(`${workoutsUp} workout${workoutsUp === 1 ? '' : 's'}`);
    // Zero is never proof of denial or of absence — Health won't say which.
    setStatus(counts.length > 0 ? `${counts.join(' · ')} ↑` : 'No data yet');
    // Per-workout stages run in a loop; one cause shouldn't fill the card.
    setErrors([...new Set(errs)]);
    setBusy(null);
  };

  const needsToken = !token || editingToken;
  const syncAge = formatSyncAge(lastSync);

  return (
    <div className="card-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="section-label">Apple Health</p>
        <div className="flex items-center gap-1.5">
          {/* "Linked", not "Connected": the sheet was answered, which is not a
              promise that any category is actually readable. */}
          {connected && (
            <span className="chip bg-acc-teal/10 border border-acc-teal/40 text-acc-teal">
              Linked
            </span>
          )}
          {token && !editingToken && (
            <button
              onClick={() => {
                setDraft(token);
                setEditingToken(true);
              }}
              className="chip bg-app-surface2 border border-app-border text-app-tx3 hover:text-app-tx1 transition-colors"
            >
              Token
            </button>
          )}
        </div>
      </div>

      {needsToken ? (
        <form onSubmit={saveToken} className="flex gap-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Sync token"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            className={inputCls}
          />
          <button type="submit" disabled={!draft.trim()} className={`flex-shrink-0 ${btnCls}`}>
            Save
          </button>
        </form>
      ) : (
        <div className="flex gap-2">
          {/*
            Always available, even once connected. A native build that widens
            the requested type set only takes effect when requestAuthorization
            runs again — and hiding this button made that impossible without
            deleting the app or reaching for Safari's Web Inspector. iOS shows
            the sheet only for types you haven't answered, so re-tapping is
            harmless when there's nothing new.
          */}
          <button
            onClick={connect}
            disabled={busy !== null}
            className={connected ? btnGhostCls : btnCls}
          >
            {busy === 'connect' ? 'Connecting…' : connected ? 'Recheck access' : 'Connect Health'}
          </button>
          <button
            onClick={sync}
            disabled={busy !== null}
            className={connected ? btnCls : btnGhostCls}
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      {status && <p className="text-app-tx2 text-xs tabular-nums mt-3">{status}</p>}

      {errors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {errors.map((err, i) => (
            <span key={i} className="chip bg-rose-400/10 border border-rose-400/40 text-rose-300">
              {err}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {syncAge && <span className="text-[11px] tabular-nums text-app-tx3">synced {syncAge}</span>}
        <a href={HEALTH_APP_URL} className={linkCls}>
          Check what Health is sharing
        </a>
      </div>

      <details className="group mt-2">
        <summary className={summaryCls}>
          Empty?
          <Chevron />
        </summary>
        <p className="mt-2 text-[11px] leading-relaxed text-app-tx3">
          Apple Health never tells apps which categories you&apos;re sharing, so nothing coming
          back means &ldquo;no data yet&rdquo; — not that it was blocked. Open Health to see for
          yourself.
        </p>
      </details>
    </div>
  );
}
