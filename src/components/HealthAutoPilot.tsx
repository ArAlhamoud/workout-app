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
import { useRouter } from 'next/navigation';
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
  onNotificationRoute,
  scheduleRestNotification,
  cancelRestNotification,
  REST_DEADLINE_KEY,
  REST_EXERCISE_KEY,
} from '@/lib/native-feedback';
import { armGapGuard, notifySickRest, notifyComeback, refreshLadderCopy } from '@/lib/gap-guard';
import { scheduleLocalNotifications } from '@/lib/native-feedback';
import { flushOutbox, retryDead } from '@/lib/outbox';
import { importHealth, getWorkoutsToPush, markWorkoutsPushed } from '@/app/health-actions';
import { durableGet, durableSet, durableRemove } from '@/lib/native-store';
import { runCloudBackup } from '@/lib/native-cloud-backup';
import { lastNightSleepHours, readSickSignal } from '@/lib/health-metrics';
import type { DayId } from '@/lib/program';

const AUTOPILOT_STAMP_KEY = 'health-autopilot-last-run';
const SICK_FLAG_KEY = 'gap-guard-sick-paused';
const DEAD_RETRY_STAMP_KEY = 'outbox-dead-last-retry';
const DEAD_NOTIFICATION_ID = 2007;
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
  holdUntilISO?: string | null;
}

/** Only /api/verdict now — the health endpoints became server actions. */
async function api(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flush the outbox and keep the dead queue honest. Entries that failed
 * MAX_ATTEMPTS times park rather than vanish; once a day they get another
 * chance, and while any exist a notification says so — a stuck workout must
 * never be silently stuck.
 */
async function flushAndWatch(): Promise<void> {
  try {
    const lastRetry = Number(localStorage.getItem(DEAD_RETRY_STAMP_KEY));
    if (!Number.isFinite(lastRetry) || Date.now() - lastRetry > 24 * 3_600_000) {
      localStorage.setItem(DEAD_RETRY_STAMP_KEY, String(Date.now()));
      await retryDead();
    }
    const result = await flushOutbox();
    if (result.dead > 0) {
      scheduleLocalNotifications([
        {
          id: DEAD_NOTIFICATION_ID,
          title: 'A workout is stuck',
          body: `${result.dead} saved session${result.dead === 1 ? '' : 's'} keep${result.dead === 1 ? 's' : ''} failing to upload. They are safe on this phone — open the app while online to retry.`,
          schedule: { at: new Date(Date.now() + 3_000) },
        },
      ]);
    }
  } catch {
    /* housekeeping never breaks a screen */
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
async function runGapGuard(): Promise<void> {
  let verdict: VerdictPayload | null = null;
  try {
    verdict = (await api('/api/verdict')) as VerdictPayload;
  } catch {
    /* offline: re-arm from nothing is worse than leaving the ladder alone */
  }

  // Durable, not localStorage: losing this flag to WKWebView eviction would
  // un-pause the ladder mid-illness and nag a man with a fever.
  const wasSick = (await durableGet(SICK_FLAG_KEY)) === '1';
  const sick = await readSickSignal(); // null off-native / query failure

  if (sick === 'sick' && !wasSick) {
    await durableSet(SICK_FLAG_KEY, '1');
    notifySickRest();
  } else if (sick === 'clear' && wasSick) {
    await durableRemove(SICK_FLAG_KEY);
    notifyComeback(verdict?.queuedDay ?? null);
  }
  // 'unknown' (or a failed read) changes nothing — the flag keeps its state.

  if (!verdict) return;
  // Paused while sick AND while a declared hold runs — a bounded break he
  // asked for must not be nagged through.
  const holdActive = !!verdict.holdUntilISO && new Date(verdict.holdUntilISO).getTime() > Date.now();
  const paused = (await durableGet(SICK_FLAG_KEY)) === '1' || holdActive;
  armGapGuard(verdict.lastSessionISO, verdict.queuedDay, { paused });
  // The static ladder is now armed. Upgrade rungs 7/19 to coach-written
  // copy if the server has any — fire-and-forget, never blocks, never
  // downgrades (any failure leaves the static words standing).
  if (!paused && verdict.lastSessionISO) {
    void refreshLadderCopy(verdict.lastSessionISO, verdict.queuedDay);
  }
}

/** The heavier, throttled half: weight, recovery metrics, workout push. */
async function runSyncs(): Promise<void> {
  const last = Number(await durableGet(AUTOPILOT_STAMP_KEY));
  if (Number.isFinite(last) && Date.now() - last < SYNC_THROTTLE_MIN * 60_000) return;
  // Stamp before running, not after: two rapid opens must not double-run.
  await durableSet(AUTOPILOT_STAMP_KEY, String(Date.now()));

  // 1 — silent weigh-ins. Rolling window, never a since-cursor (back-dated
  // samples), and the import route refuses to overwrite manual entries.
  try {
    const samples = await queryWeight(windowStartISO(WEIGHT_WINDOW_DAYS));
    if (samples.length) {
      await importHealth(
        samples.map((s) => ({ type: 'weight', value: s.value, unit: 'kg', date: s.dateISO })),
      );
    }
  } catch { /* next open retries */ }

  // 2 — recovery dailies. The phone stops being the only holder of the
  // recovery history. Unit comes from the bridge verbatim (steward's rule).
  // Dates go over as bare local calendar days ("2026-08-04"): an ISO instant
  // shifts across midnight UTC, splitting one metric-day into two rows and
  // breaking the one-value-per-day meaning of @@unique(type, date, source).
  const localDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const rows: Array<{ type: string; value: number; unit: string; date: string }> = [];
    for (const metric of RECOVERY_METRICS) {
      try {
        const { days, unit } = await queryDailyStats(metric.id, RECOVERY_WINDOW_DAYS);
        for (const d of days) {
          if (d.value !== null) {
            rows.push({ type: metric.type, value: d.value, unit, date: localDay(new Date(d.dateISO)) });
          }
        }
      } catch { /* a type with no data (or iOS 15 wrist temp) just skips */ }
    }
    const sleepH = await lastNightSleepHours();
    if (sleepH !== null) {
      rows.push({ type: 'sleep_asleep_h', value: sleepH, unit: 'h', date: localDay(new Date()) });
    }
    if (rows.length) {
      await importHealth(rows);
    }
  } catch { /* next open retries */ }

  // 3 — write-through of unsynced app workouts to HealthKit. Same contract
  // as the manual card: no energy passed (read-back energy double-counts).
  try {
    const workouts = (await getWorkoutsToPush()) as Array<{
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
      await importHealth(enrichment);
    }
    if (savedIds.length) {
      await markWorkoutsPushed(savedIds);
    }
  } catch { /* next open retries */ }
}

export default function HealthAutoPilot() {
  const router = useRouter();
  useEffect(() => {
    // The outbox is NOT native-only: a failed save in plain Safari queues
    // through the localStorage fallback, and must replay there too. Flush
    // before the native gate, and again whenever the browser reports the
    // network back.
    void flushAndWatch();
    const onOnline = () => void flushAndWatch();
    window.addEventListener('online', onOnline);

    if (!isNativeApp()) {
      return () => window.removeEventListener('online', onOnline);
    }

    registerRestActions();
    onRestAction(handleRestAction);
    onNotificationRoute((route) => router.push(route));

    // Replay queued saves the moment signal comes back, not next open.
    const cap = (window as Window & {
      Capacitor?: { Plugins?: { Network?: { addListener?: (e: string, h: (s: { connected: boolean }) => void) => void } } };
    }).Capacitor;
    try {
      cap?.Plugins?.Network?.addListener?.('networkStatusChange', (status) => {
        if (status.connected) void flushAndWatch();
      });
    } catch { /* no Network plugin — app-open flushes still stand */ }

    // No token gate any more: the server is reachable from the app by being
    // the same origin, so autopilot runs on every open instead of waiting for
    // a value the owner had to paste in by hand.
    const run = () => {
      void runGapGuard();
      void runSyncs(); // self-throttled to once per 30 min
      void runCloudBackup(); // self-throttled to once per day
    };
    run();

    // iOS keeps the WebView alive across days — a layout mount effect that
    // runs once would mean Gap Guard re-arms once a week. Foregrounding the
    // app is the real "app open" event.
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      void flushAndWatch();
      run();
    };
    document.addEventListener('visibilitychange', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onOnline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
