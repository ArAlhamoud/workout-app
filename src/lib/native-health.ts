// Typed client-side wrapper around the native HealthKitBridge Capacitor
// plugin (native/HealthKitBridge/). Safe to import anywhere on the web:
// outside the native iOS shell every call short-circuits via isNativeApp(),
// and the bridge is read off the injected global rather than imported.

export interface WeightSample {
  /** Body mass in kilograms. */
  value: number;
  dateISO: string;
}

export interface WorkoutStats {
  /** Average heart rate over the window, count/min. */
  avgHr: number | null;
  /** Max heart rate over the window, count/min. */
  maxHr: number | null;
  /** Active energy burned over the window, kcal. */
  activeKcal: number | null;
}

export interface SaveWorkoutInput {
  startISO: string;
  endISO: string;
  /**
   * Active energy for the HKWorkout, kcal. Leave undefined unless the value was
   * produced by this app and exists nowhere else in Health. Never pass energy
   * that was READ back out of HealthKit (see queryWorkoutStats.activeKcal):
   * writing it into a new HKWorkout double-counts a session the Watch already
   * logged. No energy value is strictly better than a wrong one.
   */
  kcal?: number;
  name?: string;
}

interface HealthKitBridgePlugin {
  requestAuthorization(): Promise<{ granted: boolean }>;
  queryWeight(options: { sinceISO?: string }): Promise<{ samples: WeightSample[] }>;
  queryWorkoutStats(options: { startISO: string; endISO: string }): Promise<WorkoutStats>;
  saveWorkout(options: SaveWorkoutInput): Promise<{ saved: boolean }>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

/** True only inside the Capacitor native shell (never in Safari / the PWA). */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Reads the bridge straight off the natively-injected `window.Capacitor.Plugins`
 * rather than `registerPlugin()` behind a dynamic `import('@capacitor/core')`.
 * That import was memoised in a module-level promise, so one stalled chunk fetch
 * left it pending forever and wedged every later call — and because the lookup
 * was awaited *before* withTimeout() wrapped anything, the timeout never armed.
 * Synchronous and unmemoised: it either resolves now or throws now.
 */
function getPlugin(): HealthKitBridgePlugin {
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  const plugin = cap?.Plugins?.HealthKitBridge as HealthKitBridgePlugin | undefined;
  if (!plugin) {
    throw new Error('HealthKit is only available in the native iOS app');
  }
  return plugin;
}

/**
 * A native call that never settles leaves the UI stuck forever with nothing to
 * debug — a HealthKit completion handler that silently returns produces exactly
 * that. Every bridge call is bounded so a lost reply surfaces as a real error.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s — no reply from HealthKit`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Pops the iOS Health permission sheet (first call only). */
export async function requestHealthAuthorization(): Promise<{ granted: boolean }> {
  // Generous: the sheet stays up while the user reads and toggles categories.
  return withTimeout(getPlugin().requestAuthorization(), 90_000, 'Connect Health');
}

/**
 * Body-mass samples (kg) since the given ISO date; defaults to last 90 days. Ascending.
 *
 * Callers should pass a fixed rolling window, NOT a "last sync" timestamp: a
 * weigh-in can be entered today but dated last Monday, and a since-last-sync
 * cursor skips those back-dated samples forever.
 */
export async function queryWeight(sinceISO?: string): Promise<WeightSample[]> {
  const { samples } = await withTimeout(
    getPlugin().queryWeight(sinceISO ? { sinceISO } : {}),
    20_000,
    'Weight query',
  );
  return samples;
}

/** Avg/max heart rate + active kcal inside a workout's time window. */
export async function queryWorkoutStats(startISO: string, endISO: string): Promise<WorkoutStats> {
  return withTimeout(
    getPlugin().queryWorkoutStats({ startISO, endISO }),
    20_000,
    'Workout stats',
  );
}

/** Writes a traditional-strength-training HKWorkout to Apple Health. */
export async function saveWorkout(input: SaveWorkoutInput): Promise<{ saved: boolean }> {
  return withTimeout(getPlugin().saveWorkout(input), 20_000, 'Workout save');
}

/**
 * Deep link to the Health app. HealthKit deliberately hides read permissions
 * from apps — we cannot tell "denied" from "no data", so the only honest move
 * is to hand the user a door to the Sharing screen and let them look.
 */
export const HEALTH_APP_URL = 'x-apple-health://';

/** ISO timestamp N days before now — the lower bound of a rolling sync window. */
export function windowStartISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** "just now" / "14m ago" / "2h ago" / "3d ago" for a stored sync marker. */
export function formatSyncAge(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
