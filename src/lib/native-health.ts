// Typed client-side wrapper around the native HealthKitBridge Capacitor
// plugin (native/HealthKitBridge/). Safe to import anywhere on the web:
// outside the native iOS shell every call short-circuits via isNativeApp(),
// and @capacitor/core is only loaded lazily when actually running natively.

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
}

/** True only inside the Capacitor native shell (never in Safari / the PWA). */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

let pluginPromise: Promise<HealthKitBridgePlugin> | null = null;

function getPlugin(): Promise<HealthKitBridgePlugin> {
  if (!isNativeApp()) {
    return Promise.reject(new Error('HealthKit is only available in the native iOS app'));
  }
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/core').then(({ registerPlugin }) =>
      registerPlugin<HealthKitBridgePlugin>('HealthKitBridge'),
    );
  }
  return pluginPromise;
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
  const plugin = await getPlugin();
  // Generous: the sheet stays up while the user reads and toggles categories.
  return withTimeout(plugin.requestAuthorization(), 90_000, 'Connect Health');
}

/** Body-mass samples (kg) since the given ISO date; defaults to last 90 days. Ascending. */
export async function queryWeight(sinceISO?: string): Promise<WeightSample[]> {
  const plugin = await getPlugin();
  const { samples } = await plugin.queryWeight(sinceISO ? { sinceISO } : {});
  return samples;
}

/** Avg/max heart rate + active kcal inside a workout's time window. */
export async function queryWorkoutStats(startISO: string, endISO: string): Promise<WorkoutStats> {
  const plugin = await getPlugin();
  return plugin.queryWorkoutStats({ startISO, endISO });
}

/** Writes a traditional-strength-training HKWorkout to Apple Health. */
export async function saveWorkout(input: SaveWorkoutInput): Promise<{ saved: boolean }> {
  const plugin = await getPlugin();
  return plugin.saveWorkout(input);
}
