// Gap Guard — the notification ladder that fights the app's real enemy.
//
// The history is unambiguous: session quality is fine, gaps are the failure
// mode. May held a 2–7-day rhythm; then a 17-day sickness gap, one session,
// a 43-day gap that regained 3 kg, one session. Both collapses had the same
// shape — one comeback session, then silence past day 7.
//
// So: every time a session is logged (and on every app open, in case the
// phone missed a save), the ladder below is re-armed from the last session
// date. Logging a session cancels and re-arms from day zero. Everything is
// scheduled ahead through LocalNotifications, so it fires with the app
// killed and the phone in airplane mode — no server, no push infra.
//
// Day 19 exists because BREAK_THRESHOLD_DAYS = 21: it is the last useful
// moment to say "train this week and you skip the 4-week return ramp".
// Today the app only mentions the threshold after it has been crossed.

import {
  scheduleLocalNotifications,
  cancelLocalNotifications,
  type LocalNotificationSpec,
} from './native-feedback';
import { isNativeApp } from './native-health';
import type { DayId } from './program';

/** Notification ids 2001–2004: the ladder. 2005: sick. 2006: comeback. */
const LADDER_IDS = [2001, 2002, 2003, 2004];
export const SICK_NOTIFICATION_ID = 2005;
export const COMEBACK_NOTIFICATION_ID = 2006;

const DAY_MS = 86_400_000;

export interface GapRung {
  id: number;
  /** Days after the last session that this rung fires. */
  day: number;
  at: Date;
  title: string;
  body: string;
  /** In-app route the notification tap lands on — always a one-tap action. */
  route: string;
}

/**
 * The ladder for a given last-session date. Pure — feed it a clock in tests.
 * Rungs already in the past are dropped (scheduling a past date fires
 * immediately on iOS, which would greet a 10-day-old install with three
 * stacked guilt notifications).
 */
export function computeGapLadder(
  lastSessionISO: string,
  queuedDay: DayId | null,
  now: Date = new Date(),
): GapRung[] {
  const parsed = new Date(lastSessionISO);
  if (Number.isNaN(parsed.getTime())) return [];
  const day = queuedDay ? `Day ${queuedDay}` : 'Your next session';

  // Workout dates are stored as bare UTC days ("2026-08-01T00:00:00Z").
  // Read as an instant, that is 03:00 in Riyadh — or yesterday evening in
  // any negative-offset zone, which would shift every rung a day early.
  // A bare day means "that calendar day, locally".
  const bare =
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0;
  const anchor = bare
    ? new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
    : parsed;

  // Fire at 17:00 local on the rung day — early evening, when a session is
  // still possible today, rather than a morning nag that is stale by night.
  // Calendar arithmetic, not ms maths: adding days as milliseconds drifts an
  // hour across a DST boundary.
  const at = (days: number): Date =>
    new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + days, 17, 0, 0, 0);

  // Every rung lands on a ONE-TAP action — a notification that opens the
  // home screen hands the moment of motivation to a menu. Day 7 is the mend
  // offer: the streak is repairable, which kills "the record's dead anyway".
  const startRoute = queuedDay ? `/workouts/new?day=${queuedDay}&dur=45` : '/workouts/new';
  const rungs: GapRung[] = [
    {
      id: LADDER_IDS[0],
      day: 3,
      at: at(3),
      title: `${day} is up`,
      body: 'Your best stretch ran every 2–4 days. Your streak holds if you train this week.',
      route: startRoute,
    },
    {
      id: LADDER_IDS[1],
      day: 5,
      at: at(5),
      title: 'Day 5 without a session',
      body: 'Both long breaks started exactly like this. 15 minutes tonight counts — tap for the rescue session.',
      route: '/workouts/new?rescue=1',
    },
    {
      id: LADDER_IDS[2],
      day: 7,
      at: at(7),
      title: 'Your streak is mendable',
      body: 'A missed week isn’t a dead record: two sessions in the next 7 days repair it. The 43-day break cost 3 kg — this one doesn’t have to.',
      route: '/workouts/new?rescue=1',
    },
    {
      id: LADDER_IDS[3],
      day: 19,
      at: at(19),
      title: 'Two days from a program reset',
      body: 'At 21 days off, the app restarts you on the 4-week return ramp. One session this week skips all of it — tap to book it.',
      route: startRoute,
    },
  ];

  return rungs.filter((r) => r.at.getTime() > now.getTime());
}

/**
 * Cancel and re-arm the ladder from the given last session. Call after every
 * save and on every app open — re-arming with unchanged inputs is a no-op in
 * effect (same ids, same dates).
 *
 * `paused` (sick-day protocol): a man in bed with a fever should not be told
 * he is slipping. The ladder is cancelled and nothing is armed; the sick-day
 * recovery path re-arms when his baseline returns.
 */
export function armGapGuard(
  lastSessionISO: string | null,
  queuedDay: DayId | null,
  options: { paused?: boolean; now?: Date } = {},
): void {
  if (!isNativeApp()) return;
  // Ladder only. The comeback (2006) is NOT cancelled here: the app-open
  // re-arm runs moments after notifyComeback schedules it, and a blanket
  // cancel would kill the appointment it just made. Logging a session is
  // what clears a pending comeback — clearComeback() at the save sites.
  cancelLocalNotifications(LADDER_IDS);
  if (options.paused || !lastSessionISO) return;

  const rungs = computeGapLadder(lastSessionISO, queuedDay, options.now);
  const specs: LocalNotificationSpec[] = rungs.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    schedule: { at: r.at },
    sound: 'default',
    extra: { route: r.route },
  }));
  scheduleLocalNotifications(specs);
}

/** A logged session makes a pending comeback appointment moot. */
export function clearComeback(): void {
  if (!isNativeApp()) return;
  cancelLocalNotifications([COMEBACK_NOTIFICATION_ID]);
}

/** One-shot "rest, you look run down" note when the sick signal trips. */
export function notifySickRest(): void {
  if (!isNativeApp()) return;
  scheduleLocalNotifications([
    {
      id: SICK_NOTIFICATION_ID,
      title: 'Rest is the program today',
      body: 'Resting HR is running high — this reads as illness, not laziness. Gap reminders are paused until you recover.',
      schedule: { at: new Date(Date.now() + 5_000) },
      sound: 'default',
    },
  ]);
}

/** The comeback appointment: fires tomorrow at 17:00 once the baseline returns. */
export function notifyComeback(queuedDay: DayId | null): void {
  if (!isNativeApp()) return;
  const at = new Date(Date.now() + DAY_MS);
  at.setHours(17, 0, 0, 0);
  scheduleLocalNotifications([
    {
      id: COMEBACK_NOTIFICATION_ID,
      title: 'You’re back',
      body: `Resting HR is home. ${queuedDay ? `Day ${queuedDay}` : 'Your next session'} tomorrow — ramp loads apply if the break ran long.`,
      schedule: { at },
      sound: 'default',
      extra: { route: queuedDay ? `/workouts/new?day=${queuedDay}&dur=45` : '/workouts/new' },
    },
  ]);
}
