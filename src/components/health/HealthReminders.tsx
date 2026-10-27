'use client';

// Health reminders — same architecture as Gap Guard: local notifications
// scheduled ahead at every /health visit, no server, works with the app
// killed. IDs 3001-3004. Cancel-and-re-arm is idempotent (same ids, same
// dates), and all of it is a silent no-op outside the native shell.

import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native-health';
import {
  scheduleLocalNotifications,
  cancelLocalNotifications,
  type LocalNotificationSpec,
} from '@/lib/native-feedback';

const INJECTION_DUE_ID = 3001;
const INJECTION_MISSED_ID = 3002;
const SYMPTOM_FOLLOWUP_ID = 3003;
const PEN_BUY_ID = 3004;

export default function HealthReminders({
  nextDueISO,
  lastInjectionISO,
  buyByISO,
  enabled,
}: {
  nextDueISO: string | null;
  lastInjectionISO: string | null;
  /** The owner's activity day before the first dose the pen can't cover
   *  (src/lib/pen.ts), as UTC midnight of that day. */
  buyByISO: string | null;
  enabled: { injection?: boolean; missed?: boolean; daySymptoms?: boolean };
}) {
  useEffect(() => {
    if (!isNativeApp()) return;
    cancelLocalNotifications([INJECTION_DUE_ID, INJECTION_MISSED_ID, SYMPTOM_FOLLOWUP_ID, PEN_BUY_ID]);

    const specs: LocalNotificationSpec[] = [];
    const at = (iso: string, addDays: number, hour: number): Date => {
      const d = new Date(iso);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays, hour, 0, 0, 0);
    };

    if (nextDueISO && enabled.injection !== false) {
      const due = at(nextDueISO, 0, 18);
      if (due.getTime() > Date.now()) {
        specs.push({
          id: INJECTION_DUE_ID,
          title: 'Injection day',
          body: 'Weekly dose due today.',
          schedule: { at: due },
          sound: 'default',
          extra: { route: '/health/injection' },
        });
      }
    }
    if (nextDueISO && enabled.missed !== false) {
      const missed = at(nextDueISO, 1, 10);
      if (missed.getTime() > Date.now()) {
        specs.push({
          id: INJECTION_MISSED_ID,
          title: 'Dose not logged yet',
          body: 'Yesterday was injection day. If you took it, log it; if not, today still counts.',
          schedule: { at: missed },
          sound: 'default',
          extra: { route: '/health/injection' },
        });
      }
    }
    if (lastInjectionISO && enabled.daySymptoms !== false) {
      const followUp = at(lastInjectionISO, 1, 20);
      if (followUp.getTime() > Date.now()) {
        specs.push({
          id: SYMPTOM_FOLLOWUP_ID,
          title: 'How was day 1?',
          body: 'Ten seconds of symptom logging, if anything showed up.',
          schedule: { at: followUp },
          sound: 'default',
          extra: { route: '/health' },
        });
      }
    }
    if (buyByISO) {
      // A day key, not an instant: read its date digits, so the phone's
      // time zone cannot move it a day.
      const [y, m, d] = buyByISO.slice(0, 10).split('-').map(Number);
      const buy = new Date(y, m - 1, d, 18, 0, 0, 0);
      if (buy.getTime() > Date.now()) {
        specs.push({
          id: PEN_BUY_ID,
          title: 'Buy a new pen',
          body: "Tomorrow's dose needs a new pen.",
          schedule: { at: buy },
          sound: 'default',
          extra: { route: '/health/injection' },
        });
      }
    }
    if (specs.length) scheduleLocalNotifications(specs);
  }, [nextDueISO, lastInjectionISO, buyByISO, enabled.injection, enabled.missed, enabled.daySymptoms]);

  return null;
}
