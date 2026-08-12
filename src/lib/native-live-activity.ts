// Rest-timer Live Activity (Dynamic Island + Lock Screen countdown).
//
// Same contract as native-feedback.ts: every call is a no-op outside the
// Capacitor shell — and, here, also on a native build that predates the
// RestActivity plugin, so this can deploy to the web before the phone has
// the new binary. Failures are swallowed: the Island is a nicety, and the
// in-app timer plus the local notification remain the source of truth.

import { isNativeApp } from './native-health';

interface RestActivityPlugin {
  startRest(options: { endsAtMs: number; totalSeconds: number; exerciseName: string }): Promise<unknown>;
  endRest(): Promise<void>;
}

function plugin(): RestActivityPlugin | undefined {
  if (!isNativeApp()) return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.RestActivity as RestActivityPlugin | undefined;
}

/**
 * Start the activity, or move its deadline if one is already up — the native
 * side decides, so a ±15 s adjust never tears the Island down and rebuilds it.
 */
export function startOrUpdateRestActivity(
  endsAtMs: number,
  totalSeconds: number,
  exerciseName: string,
): void {
  void Promise.resolve(plugin()?.startRest({ endsAtMs, totalSeconds, exerciseName })).catch(() => {});
}

/** End the activity. Only the timer's unmount calls this. */
export function endRestActivity(): void {
  void Promise.resolve(plugin()?.endRest()).catch(() => {});
}
