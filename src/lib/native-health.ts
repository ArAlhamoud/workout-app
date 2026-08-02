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
  /** Recorded as .segment workout events — e.g. one per exercise block. */
  segments?: WorkoutSegment[];
  /** Custom metadata stored on the HKWorkout. Strings and numbers only. */
  metadata?: Record<string, string | number>;
}

/**
 * Quantity types the native bridge knows about. This list mirrors the Swift
 * registry exactly — and that registry also drives the permission request, so
 * anything here was asked for at authorization time. Adding a new one needs a
 * native build AND a fresh permission sheet, which is why the set is wide.
 */
export type QuantityIdentifier =
  | 'bodyMass'
  | 'bodyFatPercentage'
  | 'leanBodyMass'
  | 'bodyMassIndex'
  | 'heartRate'
  | 'restingHeartRate'
  | 'heartRateVariabilitySDNN'
  | 'respiratoryRate'
  | 'oxygenSaturation'
  | 'vo2Max'
  | 'stepCount'
  | 'distanceWalkingRunning'
  | 'appleExerciseTime'
  | 'activeEnergyBurned'
  | 'basalEnergyBurned'
  | 'sixMinuteWalkTestDistance'
  /** iOS 16+ only; absent on iOS 15 and rejected as unknown there. */
  | 'appleSleepingWristTemperature';

export type CategoryIdentifier = 'sleepAnalysis';

export interface QuantitySample {
  value: number;
  /** Canonical unit the native side used, e.g. "kg", "count/min", "ms". */
  unit: string;
  dateISO: string;
  sourceName: string;
}

export interface CategorySample {
  /** Raw HealthKit category value — for sleepAnalysis, HKCategoryValueSleepAnalysis. */
  value: number;
  startISO: string;
  endISO: string;
  sourceName: string;
}

export interface DailyStat {
  /** Start of the day bucket. */
  dateISO: string;
  /** null when HealthKit held no samples that day — not the same as zero. */
  value: number | null;
  unit: string;
}

export interface HealthWorkout {
  uuid: string;
  startISO: string;
  endISO: string;
  /** Readable name, or "unknown" for a type the bridge doesn't map. */
  activityType: string;
  /** Raw HKWorkoutActivityType, so an unmapped type still round-trips. */
  activityTypeRaw: number;
  durationSec: number;
  energyKcal: number | null;
  sourceName: string;
  sourceBundleId: string;
}

export interface WorkoutSegment {
  startISO: string;
  endISO: string;
}

interface HealthKitBridgePlugin {
  requestAuthorization(): Promise<{ granted: boolean; readTypes: string[] }>;
  queryWeight(options: { sinceISO?: string }): Promise<{ samples: WeightSample[] }>;
  queryWorkoutStats(options: { startISO: string; endISO: string }): Promise<WorkoutStats>;
  saveWorkout(options: SaveWorkoutInput): Promise<{ saved: boolean }>;
  queryQuantity(options: {
    identifier: string;
    startISO?: string;
    endISO?: string;
    limit?: number;
  }): Promise<{ samples: QuantitySample[]; unit: string }>;
  queryCategory(options: {
    identifier: string;
    startISO?: string;
    endISO?: string;
  }): Promise<{ samples: CategorySample[] }>;
  queryDailyStats(options: {
    identifier: string;
    days: number;
  }): Promise<{ days: DailyStat[]; unit: string }>;
  queryWorkouts(options: { sinceISO?: string }): Promise<{ workouts: HealthWorkout[] }>;
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
export async function requestHealthAuthorization(): Promise<{
  granted: boolean;
  /** What was requested — not what was allowed. HealthKit never reveals read grants. */
  readTypes: string[];
}> {
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
 * Raw samples for any quantity type in the registry. Defaults to the last 90
 * days, ascending, unlimited — pass `limit` for high-frequency types like
 * heartRate, which can return tens of thousands of samples over that window.
 */
export async function queryQuantity(
  identifier: QuantityIdentifier,
  options: { startISO?: string; endISO?: string; limit?: number } = {},
): Promise<{ samples: QuantitySample[]; unit: string }> {
  return withTimeout(
    getPlugin().queryQuantity({ identifier, ...options }),
    20_000,
    `${identifier} query`,
  );
}

/** Category samples (currently sleepAnalysis). Defaults to the last 30 days. */
export async function queryCategory(
  identifier: CategoryIdentifier,
  options: { startISO?: string; endISO?: string } = {},
): Promise<CategorySample[]> {
  const { samples } = await withTimeout(
    getPlugin().queryCategory({ identifier, ...options }),
    20_000,
    `${identifier} query`,
  );
  return samples;
}

/**
 * One bucket per calendar day, oldest first, ending today. Cumulative types
 * (steps, energy) are summed; discrete ones (resting HR, HRV) are averaged.
 * A null `value` means no samples that day — treat as zero only if that's
 * meaningful for the metric.
 */
export async function queryDailyStats(
  identifier: QuantityIdentifier,
  days: number,
): Promise<{ days: DailyStat[]; unit: string }> {
  return withTimeout(
    getPlugin().queryDailyStats({ identifier, days }),
    20_000,
    `${identifier} daily stats`,
  );
}

/**
 * Workouts recorded by any source — the Watch, other apps, this one. Useful
 * for spotting sessions that were trained but never logged here, and for
 * avoiding double-counted energy.
 */
export async function queryWorkouts(sinceISO?: string): Promise<HealthWorkout[]> {
  const { workouts } = await withTimeout(
    getPlugin().queryWorkouts(sinceISO ? { sinceISO } : {}),
    20_000,
    'Workout history query',
  );
  return workouts;
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
