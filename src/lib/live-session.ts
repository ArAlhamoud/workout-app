/**
 * Live session — the shared picture of a workout in progress, so a
 * session started on the phone can continue on the Watch and back. The
 * SERVER owns it (one row, docs/WATCH.md "Live session"); this module is
 * the pure part both the API route and the tests exercise: the set merge
 * and the freshness window. No device state, no Prisma.
 */

export type LiveSource = 'phone' | 'watch';

export interface LiveSet {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe?: number;
  isWarmup?: boolean;
  /** ISO instant the set was logged on its device. */
  completedAt: string;
  source: LiveSource;
}

/** An incoming row: a logged set, or an explicit un-log. */
export type LiveSetUpdate = LiveSet | { exerciseId: string; setNumber: number; remove: true };

export interface LiveSession {
  clientSaveId: string;
  day: 'A' | 'B' | null;
  durationMin: number | null;
  gym: string | null;
  source: LiveSource;
  startedAt: string;
  updatedAt: string;
  closedAt: string | null;
  workoutId: string | null;
  sets: LiveSet[];
}

/** A session older than this since it started is a leftover, not live. */
export const LIVE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** …and one nobody has touched for this long has been abandoned. */
export const LIVE_IDLE_MS = 2 * 60 * 60 * 1000;

/** Set identity across devices: exercise + set NUMBER — the template
 *  number, never an array index — with warm-ups in their own key space so
 *  a ticked warm-up can never collide with working set 1 (steward +
 *  adversary: the save used to renumber 1..n including the warm-up). */
export const liveKey = (s: { exerciseId: string; setNumber: number; isWarmup?: boolean }) =>
  `${s.exerciseId}#${s.isWarmup ? 'w' : s.setNumber}`;

/** Hard cap on keys a live row may hold — the public route must not grow one without bound. */
export const LIVE_MAX_SETS = 200;

/**
 * Merge incoming updates into the stored sets. A device owns what it logs:
 * an incoming set replaces the stored one with the same key unless the
 * stored one was completed LATER (two devices touching the same set while
 * one was offline — the later tick is the truth). `remove` deletes the
 * key; stored keys the update never mentions are untouched, so each
 * device can send only what changed. Output is ordered by completion.
 */
export function mergeLiveSets(stored: LiveSet[], incoming: LiveSetUpdate[]): LiveSet[] {
  const map = new Map<string, LiveSet>();
  for (const s of stored) map.set(liveKey(s), s);
  for (const u of incoming) {
    const key = liveKey(u);
    if ('remove' in u && u.remove) {
      map.delete(key);
      continue;
    }
    const set = u as LiveSet;
    const prev = map.get(key);
    if (prev && Date.parse(prev.completedAt) > Date.parse(set.completedAt)) continue;
    map.set(key, set);
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
    .slice(-LIVE_MAX_SETS);
}

/**
 * Still worth continuing? Not closed, started under four hours ago, and
 * touched in the last two. A row that fails this is a leftover; the
 * reader treats it as no session and a new start replaces it.
 */
export function isLiveFresh(
  s: { startedAt: string | Date; updatedAt: string | Date; closedAt: string | Date | null },
  now: Date = new Date(),
): boolean {
  if (s.closedAt) return false;
  const started = new Date(s.startedAt).getTime();
  const touched = new Date(s.updatedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(touched)) return false;
  return now.getTime() - started < LIVE_MAX_AGE_MS && now.getTime() - touched < LIVE_IDLE_MS;
}

/**
 * The sets a finishing device should save: everything it knows, plus any
 * live set logged on the OTHER device that it never saw. The poster's own
 * copy of a key wins — it is the device that just watched the set happen.
 * Live sets from the poster's OWN source are never re-added: what it does
 * not post now it un-ticked (a failed `remove` push must not resurrect).
 */
export function unionForFinish<T extends { exerciseId: string; setNumber: number; isWarmup?: boolean }>(
  posted: T[],
  live: LiveSet[],
  posterSource?: LiveSource,
): Array<T | { exerciseId: string; setNumber: number; reps: number; weight: number; rpe?: number; isWarmup?: boolean; completedAt?: string }> {
  const have = new Set(posted.map(liveKey));
  const extra = live
    .filter((s) => !have.has(liveKey(s)) && (!posterSource || s.source !== posterSource))
    .map((s) => ({
      exerciseId: s.exerciseId,
      setNumber: s.setNumber,
      reps: s.reps,
      weight: s.weight,
      rpe: s.rpe,
      isWarmup: s.isWarmup,
      completedAt: s.completedAt,
    }));
  return [...posted, ...extra];
}

/** The second finisher's contribution: posted sets the saved workout lacks, by key. */
export function setsMissingFrom<T extends { exerciseId: string; setNumber: number; isWarmup?: boolean }>(
  saved: Array<{ exerciseId: string; setNumber: number; isWarmup?: boolean }>,
  posted: T[],
): T[] {
  const have = new Set(saved.map(liveKey));
  return posted.filter((s) => !have.has(liveKey(s)));
}

/** Bounds shared with the logger and the Watch route; junk is dropped, not fatal. */
export function sanitizeLiveUpdate(raw: unknown, source: LiveSource, now: Date = new Date()): LiveSetUpdate | null {
  const r = raw as Partial<LiveSet> & { remove?: boolean };
  if (!r || typeof r.exerciseId !== 'string' || r.exerciseId.length > 64) return null;
  if (!Number.isFinite(r.setNumber) || (r.setNumber as number) < 1 || (r.setNumber as number) > 20) return null;
  const setNumber = Math.round(r.setNumber as number);
  if (r.remove === true) return { exerciseId: r.exerciseId, setNumber, remove: true };
  if (!Number.isFinite(r.reps) || (r.reps as number) < 1 || (r.reps as number) > 200) return null;
  if (!Number.isFinite(r.weight) || (r.weight as number) < 0 || (r.weight as number) > 500) return null;
  const at = typeof r.completedAt === 'string' ? new Date(r.completedAt) : now;
  const completedAt = Number.isNaN(at.getTime()) ? now.toISOString() : at.toISOString();
  return {
    exerciseId: r.exerciseId,
    setNumber,
    reps: Math.round(r.reps as number),
    weight: r.weight as number,
    rpe: Number.isFinite(r.rpe) && (r.rpe as number) >= 1 && (r.rpe as number) <= 4 ? Math.round(r.rpe as number) : undefined,
    isWarmup: r.isWarmup === true,
    completedAt,
    source,
  };
}

// ── Overlay onto the phone logger's blocks ──────────────────────────
// Pure so the warm-up case is testable: the first two blocks carry a
// warm-up entry at index 0 (setNumber 0), so a set must be found by its
// NUMBER, never by array index — the index version ticked the warm-up
// as set 1 and then "removed" set 2 (live drive, 2026-09-01).

export interface OverlaySet {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  done: boolean;
  notes: string;
  rpe: number;
  completedAt: string | null;
  isWarmup?: boolean;
}
export interface OverlayBlock {
  exerciseId: string;
  sets: OverlaySet[];
}

/**
 * Lay live sets over the blocks: tick, fill, extend. A set this device
 * ticked LATER than the live copy keeps its own values and is not in
 * `applied`. A machine the blocks lack gets a block from `newBlock`.
 */
export function overlayLiveSets<B extends OverlayBlock>(
  blocks: B[],
  sets: LiveSet[],
  newBlock: (exerciseId: string) => B,
): { blocks: B[]; applied: LiveSet[] } {
  const next = blocks.map((b) => ({ ...b, sets: [...b.sets] }));
  const applied: LiveSet[] = [];
  for (const ls of sets) {
    let bi = next.findIndex((b) => b.exerciseId === ls.exerciseId);
    if (bi < 0) {
      next.push({ ...newBlock(ls.exerciseId), sets: [] });
      bi = next.length - 1;
    }
    const b = next[bi];
    let si = b.sets.findIndex((x) => !x.isWarmup && x.setNumber === ls.setNumber);
    if (si < 0) {
      const working = b.sets.filter((x) => !x.isWarmup);
      let n = working.length ? Math.max(...working.map((x) => x.setNumber)) : 0;
      while (n < ls.setNumber) {
        n++;
        const last = b.sets[b.sets.length - 1];
        b.sets.push({
          exerciseId: ls.exerciseId, setNumber: n,
          reps: last?.reps ?? ls.reps, weight: last?.weight ?? ls.weight,
          done: false, notes: '', rpe: 0, completedAt: null,
        });
      }
      si = b.sets.findIndex((x) => !x.isWarmup && x.setNumber === ls.setNumber);
    }
    const cur = b.sets[si];
    if (cur.done && cur.completedAt && Date.parse(cur.completedAt) > Date.parse(ls.completedAt)) continue;
    b.sets[si] = {
      ...cur, reps: ls.reps, weight: ls.weight, rpe: ls.rpe ?? cur.rpe ?? 0,
      done: true, completedAt: ls.completedAt, isWarmup: false,
    };
    applied.push(ls);
  }
  return { blocks: next, applied };
}
