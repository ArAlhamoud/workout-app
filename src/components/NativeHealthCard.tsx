'use client';

// Apple Health sync card — renders ONLY inside the native Capacitor shell.
// On the plain web / PWA this component returns null and costs nothing.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importHealthWorkout } from '@/app/actions';
import {
  importHealth,
  detectUnlogged as detectUnloggedAction,
  getWorkoutsToPush,
  markWorkoutsPushed,
} from '@/app/health-actions';
import {
  isNativeApp,
  requestHealthAuthorization,
  queryQuantity,
  queryWeight,
  queryWorkouts,
  queryWorkoutStats,
  saveWorkout,
  formatSyncAge,
  windowStartISO,
  HEALTH_APP_URL,
} from '@/lib/native-health';

const LAST_SYNC_KEY = 'health-native-last-sync';
const CONNECTED_KEY = 'health-native-connected';
/** UUIDs the user has already acted on — never offered again on this device. */
const DISMISSED_KEY = 'health-detect-dismissed';

/** This app's own bundle id — sessions it wrote to Health are already logged. */
const OWN_BUNDLE_ID = 'com.aralhamoud.workout';
/** How far back to look for sessions that were trained but never logged. */
const DETECT_WINDOW_DAYS = 14;
/** Cap on the local dismissed list so it can't grow forever in localStorage. */
const DISMISSED_MAX = 60;

/**
 * Weight is always re-pulled over a fixed rolling window, never "since the last
 * sync". A weigh-in can be ENTERED on Wednesday but DATED Monday; a since-cursor
 * moves past Monday and drops that sample forever, silently. Re-sending overlap
 * is free: importHealth upserts on (type, date, source) and refuses to
 * overwrite manually logged days, so this is idempotent.
 */
const WEIGHT_WINDOW_DAYS = 30;

interface ImportSample {
  type: 'weight' | 'heart_rate' | 'active_energy';
  value: number;
  unit: string;
  date: string;
}

/** A HealthKit session the server confirmed is not in the log yet. */
interface Detected {
  uuid: string;
  startISO: string;
  durationMin: number;
  durationSec: number;
  kind: 'strength' | 'cardio';
  label: string;
  /** Ready-made workout name for the one-tap cardio import ("Swim 28m"). */
  name: string;
}

/** Device-local calendar day (YYYY-MM-DD) — the server can't derive this. */
function localDayOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Sun 18:12" — the glance format for an unlogged session. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/**
 * Sessions Apple Health knows about that this app doesn't.
 *
 * Workouts this app wrote are filtered out here by bundle id — they are, by
 * definition, already in the log. Everything else goes to the server, which is
 * the only side that can check the Workout table. Failure is silent on purpose:
 * this is an offer, not a sync, and an error chip for "we couldn't check"
 * would be pure noise on a card that already reports real sync failures.
 */
async function detectUnlogged(): Promise<Detected[]> {
  try {
    const workouts = await queryWorkouts(windowStartISO(DETECT_WINDOW_DAYS));
    const candidates = workouts
      .filter((w) => w.sourceBundleId !== OWN_BUNDLE_ID)
      .map((w) => ({
        uuid: w.uuid,
        startISO: w.startISO,
        endISO: w.endISO,
        durationSec: w.durationSec,
        activityType: w.activityType,
        localDay: localDayOf(w.startISO),
      }));
    if (!candidates.length) return [];

    const res = await detectUnloggedAction({ candidates });
    const list = (res as { candidates?: unknown })?.candidates;
    return Array.isArray(list) ? (list as Detected[]) : [];
  } catch {
    return [];
  }
}

const btnCls =
  'px-3.5 py-2 text-xs font-bold rounded-card transition-all bg-gradient-to-r from-acc-teal to-acc-teal-deep text-white shadow-glow-teal hover:brightness-105 disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none';
const btnGhostCls =
  'px-3.5 py-2 text-xs font-bold rounded-card transition-colors bg-app-surface2 border border-app-border text-app-tx1 hover:border-app-border-hi disabled:text-app-tx3';
/* Quiet aurora affordance for <details> — the sentence lives one tap away */
const summaryCls =
  'chip inline-flex w-fit cursor-pointer select-none list-none items-center gap-1.5 border border-app-border bg-ink/5 text-[10px] uppercase tracking-[0.12em] text-app-tx3 transition-colors hover:border-app-border-hi hover:text-app-tx2 [&::-webkit-details-marker]:hidden';
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
  const router = useRouter();
  const [native, setNative] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  // Bumped after a sync so the offer list re-checks without a page reload.
  const [detectNonce, setDetectNonce] = useState(0);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    setConnected(localStorage.getItem(CONNECTED_KEY) === '1');
    setLastSync(localStorage.getItem(LAST_SYNC_KEY));
    try {
      const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
      if (Array.isArray(raw)) setDismissed(raw.filter((v): v is string => typeof v === 'string'));
    } catch {
      /* a corrupt list just means nothing is dismissed */
    }
  }, []);

  // Auto-detect runs on its own, unprompted: the whole point is that he does
  // NOT have to remember a session went unlogged.
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    detectUnlogged().then((found) => {
      if (!cancelled) setDetected(found);
    });
    return () => {
      cancelled = true;
    };
  }, [native, detectNonce]);

  if (!native) return null;


  /** Keep the stage name, but carry the real cause so a failure is debuggable. */
  const reason = (e: unknown, stage: string) =>
    e instanceof Error && e.message ? `${stage}: ${e.message}` : stage;

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
    let workoutsEnriched = 0;

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
        await importHealth(body);
        weightsUp = samples.length;
      }
      // Marker is now display-only ("synced 2h ago") — it is never a query bound.
      const stamp = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, stamp);
      setLastSync(stamp);
    } catch (e) {
      errs.push(reason(e, 'weight sync'));
    }

    // 1b — blood-pressure readings (+ the cuff's pulse via narrow HR
    // windows) — same contract as the autopilot's pass, so the manual
    // button syncs everything the background pass does. Silently skipped
    // on a bridge without the BP types or before the re-grant.
    let bpUp = 0;
    try {
      const [sys, dia] = await Promise.all([
        queryQuantity('bloodPressureSystolic', { startISO: windowStartISO(WEIGHT_WINDOW_DAYS) }),
        queryQuantity('bloodPressureDiastolic', { startISO: windowStartISO(WEIGHT_WINDOW_DAYS) }),
      ]);
      if (sys.samples.length && dia.samples.length) {
        const rows: ImportSample[] = [
          ...sys.samples.map((s2) => ({ type: 'bp_systolic', value: s2.value, unit: 'mmHg', date: s2.dateISO })),
          ...dia.samples.map((s2) => ({ type: 'bp_diastolic', value: s2.value, unit: 'mmHg', date: s2.dateISO })),
        ];
        for (const s2 of sys.samples.slice(-40)) {
          try {
            const t = new Date(s2.dateISO).getTime();
            const hr = await queryQuantity('heartRate', {
              startISO: new Date(t - 2 * 60_000).toISOString(),
              endISO: new Date(t + 2 * 60_000).toISOString(),
            });
            rows.push(...hr.samples.map((h) => ({ type: 'heart_rate', value: h.value, unit: 'count/min', date: h.dateISO })));
          } catch { /* pulse is a bonus */ }
        }
        await importHealth(rows);
        bpUp = sys.samples.length;
      }
    } catch { /* pre-link build or denied reads: quiet, like the autopilot */ }

    // 2 — un-synced app workouts → HealthKit (+ HR/energy enrichment back to app)
    try {
      const workouts = await getWorkoutsToPush();
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
          const res = (await importHealth(enrichment)) as { workoutsEnriched?: number };
          // Counts, not checkmarks: this pipeline once looked green for weeks
          // while delivering zero rows. The number is the honest signal.
          if (typeof res.workoutsEnriched === 'number') workoutsEnriched = res.workoutsEnriched;
        } catch (e) {
          errs.push(reason(e, 'enrich'));
        }
      }
      if (savedIds.length > 0) {
        await markWorkoutsPushed(savedIds);
        workoutsUp = savedIds.length;
      }
    } catch (e) {
      errs.push(reason(e, 'workout sync'));
    }

    const counts: string[] = [];
    if (weightsUp > 0) counts.push(`${weightsUp} weight${weightsUp === 1 ? '' : 's'}`);
    if (bpUp > 0) counts.push(`${bpUp} BP reading${bpUp === 1 ? '' : 's'}`);
    if (workoutsUp > 0) counts.push(`${workoutsUp} workout${workoutsUp === 1 ? '' : 's'}`);
    if (workoutsEnriched > 0) counts.push(`${workoutsEnriched} enriched ↓`);
    // Zero is never proof of denial or of absence — Health won't say which.
    //
    // But zero is also the NORMAL steady state, and "No data yet" read as a
    // failure every time: weight only flows Health → app, and weigh-ins are
    // entered in the app, so Health usually has none to give; workouts only
    // flow app → Health, and only once each. Both counters at zero with no
    // errors means everything is already where it belongs. Say that instead,
    // and keep a distinct wording for the case where something did fail.
    setStatus(
      counts.length > 0
        ? `${counts.join(' · ')} ↑`
        : errs.length > 0
          ? 'Sync incomplete'
          : 'Everything already in sync',
    );
    // Per-workout stages run in a loop; one cause shouldn't fill the card.
    setErrors([...new Set(errs)]);
    setBusy(null);
    // A sync may have just pushed app workouts into Health; re-ask what's left.
    setDetectNonce((n) => n + 1);
  };

  /** Never offer this HealthKit session again on this device. */
  const dismiss = (uuid: string) => {
    setDismissed((prev) => {
      const next = [uuid, ...prev.filter((u) => u !== uuid)].slice(0, DISMISSED_MAX);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch {
        /* a full quota only costs us the "don't re-offer" memory */
      }
      return next;
    });
  };

  /**
   * Strength sessions open the EXISTING logger, pre-filled — there is no second
   * logging flow, and there shouldn't be: sets, weights and effort still have
   * to be typed in by hand. Only the facts HealthKit actually knows are carried
   * over: which day it was, how long it ran, and which HKWorkout it came from.
   */
  const logIt = (c: Detected) => {
    dismiss(c.uuid);
    const day = localDayOf(c.startISO);
    const params = new URLSearchParams({ mins: String(c.durationMin), hk: c.uuid });
    if (day) params.set('date', day);
    router.push(`/workouts/new?${params.toString()}`);
  };

  /** Swims import in one tap — a duration and a name, no sets to type. */
  const importCardio = async (c: Detected) => {
    setImporting(c.uuid);
    try {
      await importHealthWorkout({
        healthWorkoutUuid: c.uuid,
        name: c.name,
        dateISO: c.startISO,
        durationSec: c.durationSec,
      });
      dismiss(c.uuid);
      setDetected((prev) => prev.filter((d) => d.uuid !== c.uuid));
      router.refresh();
    } catch (e) {
      setErrors((prev) => [...new Set([...prev, reason(e, 'import')])]);
    } finally {
      setImporting(null);
    }
  };

  const syncAge = formatSyncAge(lastSync);
  // Silent when there is nothing to offer — no empty state, no placeholder.
  const offers = detected.filter((d) => !dismissed.includes(d.uuid));

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
        </div>
      </div>

      {/*
        Two buttons, no setup step. Connect stays available even once linked: a
        native build that widens the requested type set only takes effect when
        requestAuthorization runs again — and hiding this button made that
        impossible without deleting the app or reaching for Safari's Web
        Inspector. iOS shows the sheet only for types you haven't answered, so
        re-tapping is harmless when there's nothing new.
      */}
      <div className="flex gap-2">
        <button onClick={connect} disabled={busy !== null} className={connected ? btnGhostCls : btnCls}>
          {busy === 'connect' ? 'Connecting…' : connected ? 'Recheck access' : 'Connect Health'}
        </button>
        <button onClick={sync} disabled={busy !== null} className={connected ? btnCls : btnGhostCls}>
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

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

      {/* Trained but never logged — one row per session, one number each.
          Renders nothing at all when Health has nothing to offer. */}
      {offers.length > 0 && (
        <div className="mt-3 border-t border-app-border pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="section-label">Not logged</p>
            <span className="text-[11px] tabular-nums text-app-tx3">{offers.length}</span>
          </div>
          <div className="space-y-1.5">
            {offers.map((c) => {
              const cardio = c.kind === 'cardio';
              return (
                <div
                  key={c.uuid}
                  className={`flex items-center gap-2 rounded-card border px-3 py-2 ${
                    cardio ? 'border-acc-cyan/25 bg-acc-cyan/[0.05]' : 'border-app-border bg-ink/[0.03]'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-app-tx2">
                    {whenLabel(c.startISO)}
                    <span className="mx-1 text-app-tx3">·</span>
                    <b className="font-semibold text-app-tx1">{c.durationMin} min</b>
                    <span className="mx-1 text-app-tx3">·</span>
                    <span className={cardio ? 'text-acc-cyan' : 'text-app-tx2'}>{c.label}</span>
                  </span>
                  <button
                    onClick={() => (cardio ? importCardio(c) : logIt(c))}
                    disabled={importing !== null}
                    className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors disabled:text-app-tx3 ${
                      cardio
                        ? 'border-acc-cyan/40 bg-acc-cyan/10 text-acc-cyan hover:bg-acc-cyan/20'
                        : 'border-acc-teal/40 bg-acc-teal/10 text-acc-teal hover:bg-acc-teal/20'
                    }`}
                  >
                    {importing === c.uuid ? 'Adding…' : cardio ? 'Add it' : 'Log it'}
                  </button>
                  <button
                    onClick={() => dismiss(c.uuid)}
                    aria-label="Not a session"
                    className="flex-shrink-0 text-lg leading-none text-app-tx3 transition-colors hover:text-app-tx1"
                  >
                    &#215;
                  </button>
                </div>
              );
            })}
          </div>
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
