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

/** Body-mass samples (kg) since the given ISO date; defaults to last 90 days. Ascending. */
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
