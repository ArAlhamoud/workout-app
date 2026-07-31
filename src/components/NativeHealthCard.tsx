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
} from '@/lib/native-health';

const TOKEN_KEY = 'health-sync-token';
const LAST_SYNC_KEY = 'health-native-last-sync';
const CONNECTED_KEY = 'health-native-connected';

interface ApiWorkout {
  id: string;
  name: string;
  start: string;
  durationMin: number;
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

export default function NativeHealthCard() {
  const [native, setNative] = useState(false);
  const [token, setToken] = useState('');
  const [draft, setDraft] = useState('');
  const [editingToken, setEditingToken] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    setToken(localStorage.getItem(TOKEN_KEY) ?? '');
    setConnected(localStorage.getItem(CONNECTED_KEY) === '1');
  }, []);

  if (!native) return null;

  const api = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

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
      setStatus(granted ? 'Health connected' : 'Permission not granted');
    } catch {
      setErrors(['connect failed']);
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

    // 1 — HealthKit weight → app
    try {
      const since = localStorage.getItem(LAST_SYNC_KEY) ?? undefined;
      const samples = await queryWeight(since);
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
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    } catch {
      errs.push('weight sync failed');
    }

    // 2 — un-synced app workouts → HealthKit (+ HR/energy enrichment back to app)
    try {
      const workouts = (await api('/api/health/workouts')) as ApiWorkout[];
      const savedIds: string[] = [];
      const enrichment: ImportSample[] = [];

      for (const w of workouts) {
        const endISO = new Date(new Date(w.start).getTime() + w.durationMin * 60_000).toISOString();
        let kcal = w.estKcal;
        try {
          const stats = await queryWorkoutStats(w.start, endISO);
          if (stats.avgHr !== null) {
            enrichment.push({ type: 'heart_rate', value: stats.avgHr, unit: 'count/min', date: w.start });
          }
          if (stats.activeKcal !== null && stats.activeKcal > 0) {
            enrichment.push({ type: 'active_energy', value: stats.activeKcal, unit: 'kcal', date: w.start });
            kcal = stats.activeKcal;
          }
        } catch {
          errs.push('stats failed');
        }
        try {
          await saveWorkout({ startISO: w.start, endISO, kcal, name: w.name });
          savedIds.push(w.id);
        } catch {
          errs.push('save failed');
        }
      }

      if (enrichment.length > 0) {
        try {
          await api('/api/health/import', { method: 'POST', body: JSON.stringify(enrichment) });
        } catch {
          errs.push('enrich failed');
        }
      }
      if (savedIds.length > 0) {
        await api('/api/health/workouts', { method: 'POST', body: JSON.stringify({ ids: savedIds }) });
        workoutsUp = savedIds.length;
      }
    } catch {
      errs.push('workout sync failed');
    }

    setStatus(
      `${weightsUp} weight${weightsUp === 1 ? '' : 's'} · ${workoutsUp} workout${workoutsUp === 1 ? '' : 's'} ↑`,
    );
    setErrors(errs);
    setBusy(null);
  };

  const needsToken = !token || editingToken;

  return (
    <div className="card-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="section-label">Apple Health</p>
        <div className="flex items-center gap-1.5">
          {connected && (
            <span className="chip bg-acc-teal/10 border border-acc-teal/40 text-acc-teal">
              Connected
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
          {!connected && (
            <button onClick={connect} disabled={busy !== null} className={btnCls}>
              {busy === 'connect' ? 'Connecting…' : 'Connect Health'}
            </button>
          )}
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
    </div>
  );
}
