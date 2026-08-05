// Client follow-through for hold changes — shared by HoldControl (manual)
// and CoachCard (approved coach proposal), so both paths keep the same
// invariant: the anti-gap machine is never dark across a hold boundary.

import { armGapGuard } from './gap-guard';
import { scheduleLocalNotifications, cancelLocalNotifications } from './native-feedback';

/** The wake-up at the far side of a hold — the ladder's dark-window bridge. */
export const HOLD_END_NOTIFICATION_ID = 2008;

/**
 * After a hold is declared (by hand or by approved proposal): the rungs are
 * already scheduled with iOS, and waiting for the next app-open to honour
 * the hold means day-3/5 fire mid-hold. Cancel now, re-arm the ladder
 * anchored at the hold's END, and book the wake-up on its far side.
 */
export function holdDeclaredFollowThrough(endsAt: string): void {
  armGapGuard(endsAt, null);
  scheduleLocalNotifications([
    {
      id: HOLD_END_NOTIFICATION_ID,
      title: 'Hold complete',
      body: 'Nothing lost — your next session picks up where you paused.',
      schedule: { at: new Date(new Date(endsAt).getTime() + 9 * 3_600_000) },
      sound: 'default',
      extra: { route: '/workouts/new' },
    },
  ]);
}

/** After a hold ends early: gap clock restarts from today, by his own hand. */
export function holdEndedFollowThrough(): void {
  cancelLocalNotifications([HOLD_END_NOTIFICATION_ID]);
  armGapGuard(new Date().toISOString(), null);
}
