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
// the session on replay. Replay without the key is forbidden; there is no
// code path that strips it.
//
// Concurrency contract (review finding, corrupts-data class): flush is a
// read-modify-write whose window spans network awaits, and enqueue can land
// inside that window — a network flap triggers a flush at the same moment a
// failed save enqueues. Every queue mutation therefore runs through one
// promise-chain mutex, and flush's final write RE-READS the queue and
// removes only the entries it actually sent, so a concurrent enqueue can
// never be clobbered by a stale snapshot.

import { createWorkout } from '@/app/actions';
import { durableGet, durableSet, durableRemove } from './native-store';

const OUTBOX_KEY = 'workout-save-outbox';
/** Saves that kept failing past MAX_ATTEMPTS — parked, never silently gone. */
const DEAD_KEY = 'workout-save-outbox-dead';
/** Bound the queue: a runaway enqueue loop must not eat storage forever. */
const OUTBOX_MAX = 20;
/** After this many failed replays the entry parks in the dead queue. */
const MAX_ATTEMPTS = 10;

export type OutboxPayload = Parameters<typeof createWorkout>[0] & { clientSaveId: string };

interface OutboxEntry {
  payload: OutboxPayload;
  queuedAtISO: string;
  attempts: number;
}

export function newClientSaveId(): string {
  return `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Mutex ────────────────────────────────────────────────────
// One chain for every mutation. `.then(fn, fn)` keeps the chain alive after
// a rejection — a failed flush must not wedge every later enqueue.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readQueue(key: string): Promise<OutboxEntry[]> {
  try {
    const raw = await durableGet(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Throws when NO store accepted the write — the caller must know the save is
 * not actually queued, so the form keeps the draft and says so honestly.
 * The cap evicts the OLDEST entries: dropping the newest would silently
 * discard the save that was just queued while reporting it safe.
 */
async function writeQueue(key: string, entries: OutboxEntry[]): Promise<void> {
  const ok = await durableSet(key, JSON.stringify(entries.slice(-OUTBOX_MAX)));
  if (!ok) throw new Error('outbox write failed: no store accepted the write');
}

/** Queue a save whose network attempt failed. Rejects if storage refused. */
export function enqueueSave(payload: OutboxPayload): Promise<void> {
  return withLock(async () => {
    const entries = await readQueue(OUTBOX_KEY);
    // Same clientSaveId re-enqueued (double-tap offline) replaces, not adds.
    const rest = entries.filter((e) => e.payload.clientSaveId !== payload.clientSaveId);
    await writeQueue(OUTBOX_KEY, [
      ...rest,
      { payload, queuedAtISO: new Date().toISOString(), attempts: 0 },
    ]);
  });
}

export async function outboxCount(): Promise<number> {
  return (await readQueue(OUTBOX_KEY)).length;
}

export async function deadCount(): Promise<number> {
  return (await readQueue(DEAD_KEY)).length;
}

/** Move parked saves back into the live queue for another round of retries. */
export function retryDead(): Promise<void> {
  return withLock(async () => {
    const dead = await readQueue(DEAD_KEY);
    if (!dead.length) return;
    const live = await readQueue(OUTBOX_KEY);
    const liveIds = new Set(live.map((e) => e.payload.clientSaveId));
    const revived = dead
      .filter((e) => !liveIds.has(e.payload.clientSaveId))
      .map((e) => ({ ...e, attempts: 0 }));
    await writeQueue(OUTBOX_KEY, [...live, ...revived]);
    await durableRemove(DEAD_KEY);
  });
}

/**
 * Replay every queued save. Successes leave the queue; failures stay for the
 * next flush until MAX_ATTEMPTS, then park in the dead queue (visible via
 * deadCount, revivable via retryDead — parked, never silently gone).
 *
 * The network sends happen OUTSIDE the lock — holding the mutex across
 * serial awaits would block every enqueue for seconds. Instead: snapshot
 * under the lock, send, then reconcile under the lock against a FRESH read,
 * touching only the entries this flush actually processed.
 */
export async function flushOutbox(): Promise<{ sent: number; remaining: number; dead: number }> {
  const snapshot = await withLock(() => readQueue(OUTBOX_KEY));
  if (!snapshot.length) {
    return { sent: 0, remaining: 0, dead: await deadCount() };
  }

  const sentIds = new Set<string>();
  const failedIds = new Set<string>();
  for (const entry of snapshot) {
    try {
      await createWorkout(entry.payload);
      sentIds.add(entry.payload.clientSaveId);
    } catch {
      failedIds.add(entry.payload.clientSaveId);
    }
  }

  return withLock(async () => {
    const current = await readQueue(OUTBOX_KEY);
    const keep: OutboxEntry[] = [];
    const parked: OutboxEntry[] = [];
    for (const entry of current) {
      const id = entry.payload.clientSaveId;
      if (sentIds.has(id)) continue; // actually delivered — done with it
      const bumped = failedIds.has(id) ? { ...entry, attempts: entry.attempts + 1 } : entry;
      if (bumped.attempts >= MAX_ATTEMPTS) parked.push(bumped);
      else keep.push(bumped); // includes entries enqueued mid-flush, untouched
    }
    if (parked.length) {
      const dead = await readQueue(DEAD_KEY);
      await writeQueue(DEAD_KEY, [...dead, ...parked]);
    }
    if (keep.length) await writeQueue(OUTBOX_KEY, keep);
    else await durableRemove(OUTBOX_KEY);
    return { sent: sentIds.size, remaining: keep.length, dead: (await readQueue(DEAD_KEY)).length };
  });
}
