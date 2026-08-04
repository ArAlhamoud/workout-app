'use client';

// The invisible native loop. Mounted once in the root layout; renders
// nothing, ever. On the plain web every call short-circuits at isNativeApp().
//
// What runs on every app open (cheap, must never be stale):
//   - rest-notification action buttons registered + their handler
//   - the save outbox flushed (and re-flushed when the network returns)
//   - Gap Guard re-armed from the server's last-session date
//   - the sick signal checked; Gap Guard paused/resumed accordingly
//
// What runs at most every SYNC_THROTTLE_MIN (heavier, idempotent):
//   - Health bodyMass → body stats (silent weigh-ins)
//   - daily recovery metrics → HealthSample rows (owned history)
//   - unsynced app workouts → HealthKit write-through
//
// Everything here is fire-and-forget with errors swallowed: this is
// housekeeping, and housekeeping must never break a screen. The manual card
// on /stats remains the place where failures are *visible*; this loop is the
// one that makes looking at it optional.

import { useEffect } from 'react';
import {
  isNativeApp,
  queryWeight,
  queryDailyStats,
  queryWorkoutStats,
  saveWorkout,
  windowStartISO,
  type QuantityIdentifier,
} from '@/lib/native-health';
import {
  registerRestActions,
  onRestAction,
  scheduleRestNotification,
  cancelRestNotification,
  REST_DEADLINE_KEY,
  REST_EXERCISE_KEY,
} from '@/lib/native-feedback';
import { armGapGuard, notifySickRest, notifyComeback } from '@/lib/gap-guard';
import { flushOutbox } from '@/lib/outbox';
import { lastNightSleepHours, readSickSignal } from '@/lib/health-metrics';
import type { DayId } from '@/lib/program';

const TOKEN_KEY = 'health-sync-token';
const AUTOPILOT_STAMP_KEY = 'health-autopilot-last-run';
const SICK_FLAG_KEY = 'gap-guard-sick-paused';
const SYNC_THROTTLE_MIN = 30;
const WEIGHT_WINDOW_DAYS = 30;
/** Recovery dailies re-pushed over a rolling week — upserts make this free. */
const RECOVERY_WINDOW_DAYS = 7;
const API_TIMEOUT_MS = 20_000;

/** Daily quantities worth owning server-side, and the import names they get. */
const RECOVERY_METRICS: Array<{ id: QuantityIdentifier; type: string }> = [
  { id: 'restingHeartRate', type: 'resting_hr' },
  { id: 'heartRateVariabilitySDNN', type: 'hrv_sdnn' },
  { id: 'vo2Max', type: 'vo2max' },
  { id: 'appleSleepingWristTemperature', type: 'wrist_temp_c' },
  { id: 'respiratoryRate', type: 'respiratory_rate' },
  { id: 'stepCount', type: 'steps' },
];

interface VerdictPayload {
  queuedDay: DayId | null;
  lastSessionISO: string | null;
}

async function api(token: string, path: string, init?: RequestInit): Promise<unknown> {
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
  } finally {
    clearTimeout(timer);
  }
}

/** "+30 s" / "Done" tapped on the rest-over notification. */
function handleRestAction(actionId: 'plus30' | 'done'): void {
  try {
    if (actionId === 'done') {
      cancelRestNotification();
      localStorage.removeItem(REST_DEADLINE_KEY);
      localStorage.removeItem(REST_EXERCISE_KEY);
      return;
    }
    const stored = Number(localStorage.getItem(REST_DEADLINE_KEY));
    const base = Number.isFinite(stored) ? Math.max(Date.now(), stored) : Date.now();
    const newEnd = base + 30_000;
    localStorage.setItem(REST_DEADLINE_KEY, String(newEnd));
    const name = localStorage.getItem(REST_EXERCISE_KEY) ?? undefined;
    scheduleRestNotification((newEnd - Date.now()) / 1000, name);
    // RestTimer, if mounted, re-syncs from the stored deadline on visibility.
  } catch {
    /* an adjust that fails leaves the original alarm standing — acceptable */
  }
}

/** Gap Guard + sick-day state machine. Runs every open; all local. */
async function runGapGuard(token: string): Promise<void> {
  let verdict: VerdictPayload | null = null;
  try {
    verdict = (await api(token, '/api/verdict')) as VerdictPayload;
  } catch {
    /* offline: re-arm from nothing is worse than leaving the ladder alone */
  }

  const wasSick = localStorage.getItem(SICK_FLAG_KEY) === '1';
  const sick = await readSickSignal(); // null off-native / query failure

  if (sick === 'sick' && !wasSick) {
    localStorage.setItem(SICK_FLAG_KEY, '1');
    notifySickRest();
  } else if (sick === 'clear' && wasSick) {
    localStorage.removeItem(SICK_FLAG_KEY);
    notifyComeback(verdict?.queuedDay ?? null);
  }
  // 'unknown' (or a failed read) changes nothing — the flag keeps its state.

  if (!verdict) return;
  const paused = localStorage.getItem(SICK_FLAG_KEY) === '1';
  armGapGuard(verdict.lastSessionISO, verdict.queuedDay, { paused });
}

/** The heavier, throttled half: weight, recovery metrics, workout push. */
async function runSyncs(token: string): Promise<void> {
  const last = Number(localStorage.getItem(AUTOPILOT_STAMP_KEY));
  if (Number.isFinite(last) && Date.now() - last < SYNC_THROTTLE_MIN * 60_000) return;
  // Stamp before running, not after: two rapid opens must not double-run.
  localStorage.setItem(AUTOPILOT_STAMP_KEY, String(Date.now()));

  // 1 — silent weigh-ins. Rolling window, never a since-cursor (back-dated
  // samples), and the import route refuses to overwrite manual entries.
  try {
    const samples = await queryWeight(windowStartISO(WEIGHT_WINDOW_DAYS));
    if (samples.length) {
      await api(token, '/api/health/import', {
        method: 'POST',
        body: JSON.stringify(
          samples.map((s) => ({ type: 'weight', value: s.value, unit: 'kg', date: s.dateISO })),
        ),
      });
    }
  } catch { /* next open retries */ }

  // 2 — recovery dailies. The phone stops being the only holder of the
  // recovery history. Unit comes from the bridge verbatim (steward's rule).
  try {
    const rows: Array<{ type: string; value: number; unit: string; date: string }> = [];
    for (const metric of RECOVERY_METRICS) {
      try {
        const { days, unit } = await queryDailyStats(metric.id, RECOVERY_WINDOW_DAYS);
        for (const d of days) {
          if (d.value !== null) rows.push({ type: metric.type, value: d.value, unit, date: d.dateISO });
        }
      } catch { /* a type with no data (or iOS 15 wrist temp) just skips */ }
    }
    const sleepH = await lastNightSleepHours();
    if (sleepH !== null) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      rows.push({ type: 'sleep_asleep_h', value: sleepH, unit: 'h', date: today.toISOString() });
    }
    if (rows.length) {
      await api(token, '/api/health/import', { method: 'POST', body: JSON.stringify(rows) });
    }
  } catch { /* next open retries */ }

  // 3 — write-through of unsynced app workouts to HealthKit. Same contract
  // as the manual card: no energy passed (read-back energy double-counts).
  try {
    const workouts = (await api(token, '/api/health/workouts')) as Array<{
      id: string;
      name: string;
      start: string;
      durationMin: number;
    }>;
    const savedIds: string[] = [];
    const enrichment: Array<{ type: string; value: number; unit: string; date: string }> = [];
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
      } catch { /* stats are enrichment, not a gate on the write-through */ }
      try {
        await saveWorkout({ startISO: w.start, endISO, name: w.name });
        savedIds.push(w.id);
      } catch { /* stays unsynced; the card's manual sync can surface why */ }
    }
    if (enrichment.length) {
      await api(token, '/api/health/import', { method: 'POST', body: JSON.stringify(enrichment) });
    }
    if (savedIds.length) {
      await api(token, '/api/health/workouts', { method: 'POST', body: JSON.stringify({ ids: savedIds }) });
    }
  } catch { /* next open retries */ }
}

export default function HealthAutoPilot() {
  useEffect(() => {
    if (!isNativeApp()) return;

    registerRestActions();
    onRestAction(handleRestAction);

    void flushOutbox();
    // Replay queued saves the moment signal comes back, not next open.
    const cap = (window as Window & {
      Capacitor?: { Plugins?: { Network?: { addListener?: (e: string, h: (s: { connected: boolean }) => void) => void } } };
    }).Capacitor;
    try {
      cap?.Plugins?.Network?.addListener?.('networkStatusChange', (status) => {
        if (status.connected) void flushOutbox();
      });
    } catch { /* no Network plugin — app-open flushes still stand */ }

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return; // Gap Guard needs the server; without a token, nothing to do.

    void runGapGuard(token);
    void runSyncs(token);
  }, []);

  return null;
}
