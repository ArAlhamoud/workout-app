// Native-only feedback: haptics, local notifications, keep-awake.
//
// Every call is a no-op outside the Capacitor shell, so callers never need to
// branch. Plugins are read off the injected `window.Capacitor.Plugins` global
// rather than imported — the npm packages are thin proxies around exactly that,
// and a memoised dynamic import is what previously wedged the Health bridge.

import { isNativeApp } from './native-health';

/** Notification id for the rest-over alert. Reused so scheduling replaces. */
const REST_ALERT_ID = 1001;

interface HapticsPlugin {
  impact(options: { style: 'HEAVY' | 'MEDIUM' | 'LIGHT' }): Promise<void>;
  notification(options: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
}

interface LocalNotificationsPlugin {
  schedule(options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule?: { at: Date };
      sound?: string;
    }>;
  }): Promise<unknown>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
}

interface KeepAwakePlugin {
  keepAwake(): Promise<void>;
  allowSleep(): Promise<void>;
}

function plugin<T>(name: string): T | undefined {
  if (!isNativeApp()) return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.Plugins?.[name] as T | undefined;
}

/** Swallow plugin errors: feedback is a nicety, never a reason to break a set. */
function safely(work: Promise<unknown> | undefined): void {
  void Promise.resolve(work).catch(() => {});
}

/** A light tap — set logged. */
export function hapticTap(): void {
  safely(plugin<HapticsPlugin>('Haptics')?.impact({ style: 'LIGHT' }));
}

/** A firmer tap — something completed. */
export function hapticSuccess(): void {
  safely(plugin<HapticsPlugin>('Haptics')?.notification({ type: 'SUCCESS' }));
}

/**
 * Schedule the rest-over notification. This is what makes the alert survive
 * backgrounding — the WebAudio beep only works while the app is foregrounded,
 * and a phone in your pocket mid-session is neither.
 */
export function scheduleRestNotification(seconds: number, exerciseName?: string): void {
  const notifications = plugin<LocalNotificationsPlugin>('LocalNotifications');
  if (!notifications) return;
  safely(
    notifications.schedule({
      notifications: [
        {
          id: REST_ALERT_ID,
          title: 'Rest over',
          body: exerciseName ? `Next set — ${exerciseName}` : 'Next set',
          schedule: { at: new Date(Date.now() + Math.max(0, seconds) * 1000) },
          sound: 'default',
        },
      ],
    }),
  );
}

/** Drop a pending rest notification (deadline moved, timer skipped, unmounted). */
export function cancelRestNotification(): void {
  const notifications = plugin<LocalNotificationsPlugin>('LocalNotifications');
  if (!notifications) return;
  safely(notifications.cancel({ notifications: [{ id: REST_ALERT_ID }] }));
}

/** Hold the screen on for the duration of a session. */
export function keepScreenAwake(on: boolean): void {
  const keepAwake = plugin<KeepAwakePlugin>('KeepAwake');
  if (!keepAwake) return;
  safely(on ? keepAwake.keepAwake() : keepAwake.allowSleep());
}
