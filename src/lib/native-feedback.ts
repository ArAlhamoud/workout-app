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

export interface LocalNotificationSpec {
  id: number;
  title: string;
  body: string;
  schedule?: { at: Date };
  sound?: string;
  /** Category with action buttons, registered via registerRestActions(). */
  actionTypeId?: string;
  /** Carried back on localNotificationActionPerformed. */
  extra?: Record<string, string | number>;
}

interface LocalNotificationsPlugin {
  schedule(options: { notifications: LocalNotificationSpec[] }): Promise<unknown>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
  registerActionTypes(options: {
    types: Array<{
      id: string;
      actions: Array<{ id: string; title: string; foreground?: boolean; destructive?: boolean }>;
    }>;
  }): Promise<void>;
  addListener(
    event: 'localNotificationActionPerformed',
    handler: (payload: { actionId: string; notification: LocalNotificationSpec }) => void,
  ): Promise<unknown>;
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
          actionTypeId: REST_ACTION_TYPE,
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

// ── Generic scheduling (Gap Guard, sick-day protocol) ────────
// Same swallow-errors contract as the rest of this file: a notification that
// fails to schedule must never break the flow that tried to schedule it.

/** Schedule a batch of local notifications. Same-id scheduling replaces. */
export function scheduleLocalNotifications(specs: LocalNotificationSpec[]): void {
  if (!specs.length) return;
  const notifications = plugin<LocalNotificationsPlugin>('LocalNotifications');
  if (!notifications) return;
  safely(notifications.schedule({ notifications: specs }));
}

/** Cancel by id. Cancelling something never scheduled is a harmless no-op. */
export function cancelLocalNotifications(ids: number[]): void {
  if (!ids.length) return;
  const notifications = plugin<LocalNotificationsPlugin>('LocalNotifications');
  if (!notifications) return;
  safely(notifications.cancel({ notifications: ids.map((id) => ({ id })) }));
}

// ── Rest-notification actions ────────────────────────────────

export const REST_ACTION_TYPE = 'REST_TIMER';

/**
 * The live rest deadline, shared between RestTimer (writes while mounted) and
 * the global notification-action handler (moves it on "+30 s", clears it on
 * "Done"). localStorage, not React state: the action fires while the timer
 * component may be anywhere, including unmounted.
 */
export const REST_DEADLINE_KEY = 'rest-timer-endsat';
export const REST_EXERCISE_KEY = 'rest-timer-exercise';

/**
 * Register the "+30 s / Done" buttons on the rest-over notification. Safe to
 * call on every app open — re-registering the same category is idempotent.
 * foreground:true on both, deliberately: acting without opening the app would
 * need the WebView awake to hear the event, and in remote-URL mode a
 * backgrounded WebView may be suspended. Opening into the right state is the
 * reliable version of this feature.
 */
export function registerRestActions(): void {
  const notifications = plugin<LocalNotificationsPlugin>('LocalNotifications');
  if (!notifications) return;
  safely(
    notifications.registerActionTypes({
      types: [
        {
          id: REST_ACTION_TYPE,
          actions: [
            { id: 'plus30', title: '+30 s', foreground: true },
            { id: 'done', title: 'Done', foreground: true },
          ],
        },
      ],
    }),
  );
}

/**
 * Listen for a notification action tap. Returns nothing to unsubscribe with —
 * the listener lives for the whole app session by design.
 */
export function onRestAction(handler: (actionId: 'plus30' | 'done') => void): void {
  const notifications = plugin<LocalNotificationsPlugin>('LocalNotifications');
  if (!notifications) return;
  safely(
    notifications.addListener('localNotificationActionPerformed', (payload) => {
      if (payload?.notification?.actionTypeId !== REST_ACTION_TYPE) return;
      if (payload.actionId === 'plus30' || payload.actionId === 'done') handler(payload.actionId);
    }),
  );
}
