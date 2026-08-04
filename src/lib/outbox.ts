// The save outbox — a failed createWorkout is a queued save, not a lost one.
//
// The offline page has promised "your draft is safe on this device —
// reconnect and it syncs" since the day it shipped. This file is what makes
// that sentence true. A save that fails (basement gym, dead spot, Vercel
// hiccup) is written here durably and replayed when the network returns or
// the app next opens.
//
// The idempotency contract: every queued payload carries a clientSaveId, and
// createWorkout dedupes on it server-side. The failure this exists for —
// "timed out client-side but actually landed" — would otherwise double-log
// the session on replay, which is the calorie-loop class of bug. Replay
// without the key is forbidden; there is no code path that strips it.

import { createWorkout } from '@/app/actions';
import { durableGet, durableSet, durableRemove } from './native-store';

const OUTBOX_KEY = 'workout-save-outbox';
/** Bound the queue: a runaway enqueue loop must not eat storage forever. */
const OUTBOX_MAX = 20;

export type OutboxPayload = Parameters<typeof createWorkout>[0] & { clientSaveId: string };

interface OutboxEntry {
  payload: OutboxPayload;
  queuedAtISO: string;
  attempts: number;
}

export function newClientSaveId(): string {
  return `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await durableGet(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  await durableSet(OUTBOX_KEY, JSON.stringify(entries.slice(0, OUTBOX_MAX)));
}

/** Queue a save whose network attempt failed. */
export async function enqueueSave(payload: OutboxPayload): Promise<void> {
  const entries = await readOutbox();
  // Same clientSaveId re-enqueued (user tapped Save twice offline) replaces.
  const rest = entries.filter((e) => e.payload.clientSaveId !== payload.clientSaveId);
  await writeOutbox([...rest, { payload, queuedAtISO: new Date().toISOString(), attempts: 0 }]);
}

export async function outboxCount(): Promise<number> {
  return (await readOutbox()).length;
}

/**
 * Replay every queued save. Successes leave the queue; failures stay for the
 * next flush. Returns what happened so a caller can surface it. Safe to call
 * concurrently-ish: a double flush at worst attempts a payload twice, and the
 * server dedupes on clientSaveId — that race resolves to one workout.
 */
export async function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  const entries = await readOutbox();
  if (!entries.length) return { sent: 0, remaining: 0 };

  const stillQueued: OutboxEntry[] = [];
  let sent = 0;
  for (const entry of entries) {
    try {
      await createWorkout(entry.payload);
      sent++;
    } catch {
      stillQueued.push({ ...entry, attempts: entry.attempts + 1 });
    }
  }

  if (stillQueued.length) await writeOutbox(stillQueued);
  else await durableRemove(OUTBOX_KEY);
  return { sent, remaining: stillQueued.length };
}
