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
  if (!cap?.isNativePlatform?.()) return undefined;
  const p = cap.Plugins?.GymGeofence as Record<string, unknown> | undefined;
  if (!p || !METHODS.every((m) => typeof p[m] === 'function')) return undefined;
  return p as unknown as GymGeofencePlugin;
}

export function geofencePlugin(): GymGeofencePlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  return pickGeofencePlugin((window as Window & { Capacitor?: CapacitorLike }).Capacitor);
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
  const set = (['bfit', 'work'] as const).filter((g) => status.gyms[g]?.set);
  return {
    kind: 'on',
    line: `Auto check-in · ${set.length ? set.map((g) => GEOFENCE_GYM_NAME[g]).join(' · ') : 'no gym set'}`,
    selectedSet: set.includes(selected),
  };
}
