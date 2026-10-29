// Automatic gym check-in — the web card's handle on the native GymGeofence
// plugin (native/HealthKitBridge/GymGeofencePlugin.swift). Settings only:
// region events, the "Check in?" prompt and the sends to /api/gym/visit all
// happen natively, with no webview (docs/GYM-GEOFENCE.md).
//
// A build that predates the plugin, the web, and Safari get nothing back, and
// the card simply has no auto check-in row.

export type GeoAuth = 'notDetermined' | 'whenInUse' | 'always' | 'denied';
export type GeofenceGym = 'bfit' | 'work';

export interface GeofenceStatus {
  authorization: GeoAuth;
  gyms: { bfit?: { set: true }; work?: { set: true } };
  monitoring: boolean;
  /** Approximate location: iOS cannot watch a gym circle (review D4). */
  reducedAccuracy?: boolean;
  /** Newest first: what iOS and the server said, with times — never a
   *  location. Builds before 17 send none. */
  trace?: string[];
}

interface GymGeofencePlugin {
  status(): Promise<GeofenceStatus>;
  requestAlways(): Promise<GeofenceStatus>;
  setGym(options: { gym: GeofenceGym }): Promise<{ ok: boolean; accuracyM: number }>;
  clearGym(options: { gym: GeofenceGym }): Promise<GeofenceStatus>;
  openSettings(): Promise<void>;
}

const METHODS = ['status', 'requestAlways', 'setGym', 'clearGym', 'openSettings'] as const;

type CapacitorLike = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } | undefined;

/** The plugin, only inside the native shell and only with every method. */
export function pickGeofencePlugin(cap: CapacitorLike): GymGeofencePlugin | undefined {
  try {
    if (!cap?.isNativePlatform?.()) return undefined;
    const p = cap.Plugins?.GymGeofence as Record<string, unknown> | undefined;
    if (!p || !METHODS.every((m) => typeof p[m] === 'function')) return undefined;
    return p as unknown as GymGeofencePlugin;
  } catch {
    return undefined;
  }
}

export function geofencePlugin(): GymGeofencePlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  return pickGeofencePlugin((window as Window & { Capacitor?: CapacitorLike }).Capacitor);
}

// Kept apart from the plugin interface: addListener is Capacitor's own, not
// one of the plugin's CAPPluginMethods (the suite matches those two lists).
type ListenerHandle = { remove?: () => unknown };
interface GeofenceEvents {
  addListener?: (event: 'statusChange', cb: (s: GeofenceStatus) => void) => unknown;
}

/**
 * Subscribe to "statusChange" on whatever the native side hands back.
 * addListener returns a handle synchronously in the shell (the 2026-10-22
 * blocker: `.then` on it crashed /train) and a promise elsewhere; it may
 * also throw or reject. Every shape is absorbed; this never throws.
 */
export function subscribeGeofenceStatus(p: GeofenceEvents | undefined, cb: (s: GeofenceStatus) => void): () => void {
  let handle: ListenerHandle | null = null;
  let gone = false;
  const drop = (h: ListenerHandle | null) => {
    try {
      h?.remove?.();
    } catch {
      /* already gone */
    }
  };
  try {
    if (typeof p?.addListener !== 'function') return () => {};
    Promise.resolve(p.addListener('statusChange', cb))
      .then((h) => {
        const got = (h ?? null) as ListenerHandle | null;
        if (gone) drop(got);
        else handle = got;
      })
      .catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    gone = true;
    drop(handle);
    handle = null;
  };
}

/**
 * Every authorization change, pushed by the plugin. iOS answers the Always
 * prompt AFTER requestAlways resolves (it neither resigns the app nor reports
 * "Keep Only While Using"), so the card listens instead of waiting.
 */
export function onGeofenceStatus(cb: (s: GeofenceStatus) => void): () => void {
  return subscribeGeofenceStatus(geofencePlugin() as GeofenceEvents | undefined, cb);
}

/** Shown before iOS asks — two short lines (owner's wording). */
export const AUTO_EXPLAIN = [
  'To check you in when you arrive and out when you leave, the app needs location Always.',
  'It only watches the two gym areas; no location history is kept.',
] as const;

export const GEOFENCE_GYM_NAME: Record<GeofenceGym, string> = { bfit: 'B_Fit', work: 'Alrajhi' };

export type AutoCheckInView =
  | { kind: 'hidden' }
  | { kind: 'ask' }
  | { kind: 'off'; line: string }
  | { kind: 'on'; line: string; selectedSet: boolean };

/** What the auto check-in row shows, for the gym selected in the card. */
export function autoCheckInView(status: GeofenceStatus | null, selected: GeofenceGym): AutoCheckInView {
  if (!status) return { kind: 'hidden' };
  if (status.authorization === 'notDetermined') return { kind: 'ask' };
  if (status.authorization !== 'always') return { kind: 'off', line: 'Auto check-in off · location not allowed' };
  if (status.reducedAccuracy) return { kind: 'off', line: 'Precise location off' };
  const set = (['bfit', 'work'] as const).filter((g) => status.gyms?.[g]?.set);
  return {
    kind: 'on',
    line: `Auto check-in · ${set.length ? set.map((g) => GEOFENCE_GYM_NAME[g]).join(' · ') : 'no gym set'}`,
    selectedSet: set.includes(selected),
  };
}
