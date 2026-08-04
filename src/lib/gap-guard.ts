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
  const last = new Date(lastSessionISO).getTime();
  if (Number.isNaN(last)) return [];
  const day = queuedDay ? `Day ${queuedDay}` : 'Your next session';

  // Fire at 17:00 local on the rung day — early evening, when a session is
  // still possible today, rather than a morning nag that is stale by night.
  const at = (days: number): Date => {
    const d = new Date(last + days * DAY_MS);
    d.setHours(17, 0, 0, 0);
    return d;
  };

  const rungs: GapRung[] = [
    {
      id: LADDER_IDS[0],
      day: 3,
      at: at(3),
      title: `${day} is up`,
      body: 'Your best stretch ran every 2–4 days. A 30-min Express counts.',
    },
    {
      id: LADDER_IDS[1],
      day: 5,
      at: at(5),
      title: 'Day 5 without a session',
      body: 'Both long breaks started exactly like this — one session, then quiet.',
    },
    {
      id: LADDER_IDS[2],
      day: 7,
      at: at(7),
      title: 'A week off',
      body: `The 43-day break cost 3 kg. ${day} tonight resets the clock.`,
    },
    {
      id: LADDER_IDS[3],
      day: 19,
      at: at(19),
      title: 'Two days from a program reset',
      body: 'At 21 days off, the app restarts you on the 4-week return ramp. One session this week skips all of it.',
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
  cancelLocalNotifications([...LADDER_IDS, COMEBACK_NOTIFICATION_ID]);
  if (options.paused || !lastSessionISO) return;

  const rungs = computeGapLadder(lastSessionISO, queuedDay, options.now);
  const specs: LocalNotificationSpec[] = rungs.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    schedule: { at: r.at },
    sound: 'default',
  }));
  scheduleLocalNotifications(specs);
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
    },
  ]);
}
