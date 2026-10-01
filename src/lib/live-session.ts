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
  /**
   * ISO instant this VERSION of the set is from, when it was changed after
   * the tick (a corrected weight, a rating). Lives in the row's JSON only.
   * The tick time cannot order two versions of one tick: a copy the Watch
   * took before the phone's correction carries the same completedAt as
   * the correction (review, 2026-10-02). Absent = never edited; the tick
   * time is the version.
   */
  editedAt?: string;
  source: LiveSource;
  /**
   * A TOMBSTONE: this key was un-ticked at `completedAt` by `source`. Kept
   * in the row so a device that never saw the removal (the Watch re-posts
   * everything it logged at finish) cannot resurrect the set; never shown
   * to a client — see visibleSets (adversary, 2026-09-18).
   */
  removed?: true;
}

/** An incoming row: a logged set, or an explicit un-log (stamped by the server if the client did not). */
export type LiveSetUpdate =
  | LiveSet
  | { exerciseId: string; setNumber: number; isWarmup?: boolean; remove: true; completedAt?: string; source?: LiveSource };

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
 *
 * Two versions of the SAME tick (equal completedAt) are ordered by edit
 * stamp (review, 2026-10-02): the sender's `editedAt`; without one, a
 * device re-posting its own set changed has just edited it (the wrist's
 * rating — stamped on arrival), while the OTHER device's is a copy of the
 * tick and no newer than it — so a stale copy can no longer replace a
 * later correction. Identical content changes nothing, owner and stamp
 * included; and across devices no rating never erases a rating at the
 * same weight × reps.
 */
export function mergeLiveSets(stored: LiveSet[], incoming: LiveSetUpdate[], now: Date = new Date()): LiveSet[] {
  const map = new Map<string, LiveSet>();
  for (const s of stored) map.set(liveKey(s), s);
  for (const u of incoming) {
    const key = liveKey(u);
    const prev = map.get(key);
    if ('remove' in u && u.remove) {
      // A removal is a fact with a time: it replaces an older tick and
      // survives as a tombstone; a tick newer than it wins later.
      const at = u.completedAt && !Number.isNaN(Date.parse(u.completedAt)) ? u.completedAt : now.toISOString();
      if (prev && Date.parse(prev.completedAt) > Date.parse(at)) continue;
      map.set(key, {
        exerciseId: u.exerciseId, setNumber: u.isWarmup ? 0 : u.setNumber, reps: 0, weight: 0,
        isWarmup: u.isWarmup === true, completedAt: at, source: u.source ?? prev?.source ?? 'phone', removed: true,
      });
      continue;
    }
    const set = u as LiveSet;
    if (prev && Date.parse(prev.completedAt) > Date.parse(set.completedAt)) continue;
    if (prev && !prev.removed && Date.parse(prev.completedAt) === Date.parse(set.completedAt)) {
      const sameRating = (prev.rpe || 0) === (set.rpe || 0);
      if (sameLoad(prev, set) && sameRating) continue;
      const own = set.source === prev.source;
      const at = set.editedAt ?? (own ? now.toISOString() : set.completedAt);
      if (Date.parse(at) < versionAt(prev)) {
        // The older version — but a rating it holds for the same load is
        // a fact the newer one simply had not been given yet.
        if (!rated(prev.rpe) && rated(set.rpe) && sameLoad(prev, set)) map.set(key, { ...prev, rpe: set.rpe });
        continue;
      }
      const keepRating = !own && !rated(set.rpe) && rated(prev.rpe) && sameLoad(prev, set);
      const next: LiveSet = { ...set, editedAt: at, rpe: keepRating ? prev.rpe : set.rpe };
      if (Date.parse(at) <= Date.parse(set.completedAt)) delete next.editedAt;
      map.set(key, next);
      continue;
    }
    map.set(key, set);
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
    .slice(-LIVE_MAX_SETS);
}

/**
 * Which building a live row belongs to. First-writer-wins protected the
 * Watch (no gym toggle) from relabelling an Alrajhi session — but the
 * phone opens the row the instant the logger mounts, before the toggle is
 * touched, so an Alrajhi session finished from the Watch saved as B_Fit
 * (adversary, 2026-09-18). Until the row holds a real set the latest
 * writer's gym wins; from the first set the tag is fixed.
 */
export function liveGymFor(existingGym: string | null | undefined, hasSets: boolean, metaGym: string | null | undefined): string | null {
  if (hasSets) return existingGym ?? metaGym ?? null;
  return metaGym ?? existingGym ?? null;
}

/** What a client may see: the row without its tombstones. */
export function visibleSets(sets: LiveSet[]): LiveSet[] {
  return sets.filter((s) => !s.removed);
}

/** Keys removed on the row, with the instant of the removal. */
function tombstones(live: LiveSet[]): Map<string, number> {
  const t = new Map<string, number>();
  for (const s of live) if (s.removed) t.set(liveKey(s), Date.parse(s.completedAt));
  return t;
}

/**
 * The finishing device's own sets, minus any the OTHER device removed
 * after they were logged. A posted set with no stamp yields: the removal
 * is the later fact we can date. Without this the Watch's finish — which
 * re-posts everything it ever logged — put an un-ticked set back into
 * stored history (adversary, 2026-09-18).
 */
export function dropRemovedSets<T extends { exerciseId: string; setNumber: number; isWarmup?: boolean; completedAt?: string | null }>(
  posted: T[],
  live: LiveSet[],
): T[] {
  const t = tombstones(live);
  return posted.filter((s) => {
    const removedAt = t.get(liveKey(s));
    if (removedAt === undefined) return true;
    const loggedAt = s.completedAt ? Date.parse(s.completedAt) : NaN;
    return Number.isFinite(loggedAt) && loggedAt > removedAt;
  });
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
    .filter((s) => !s.removed && !have.has(liveKey(s)) && (!posterSource || s.source !== posterSource))
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

/**
 * The second finisher's contribution, minus anything the OTHER device
 * removed after it was logged: posted sets the saved workout lacks, by
 * key, filtered through the live row's tombstones. The first finisher
 * closes the row, so this must read the row regardless of closedAt — the
 * un-ticked set came back through exactly this path (steward, 2026-09-18).
 */
export function mergeCandidates<T extends { exerciseId: string; setNumber: number; isWarmup?: boolean; completedAt?: string | null }>(
  saved: Array<{ exerciseId: string; setNumber: number; isWarmup?: boolean }>,
  posted: T[],
  live: LiveSet[] | null | undefined,
): T[] {
  const missing = setsMissingFrom(saved, posted);
  return live && live.length ? dropRemovedSets(missing, live) : missing;
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
  // A warm-up is set 0 by convention (the phone's template row, and now
  // the Watch's first slot). The floor was 1, so a warm-up posted to
  // /api/live was silently dropped and the resuming device showed it
  // unticked — the very "4 sets where the watch showed 3" this was meant
  // to fix (adversary, 2026-09-18). Warm-ups are pinned to 0; a working
  // set still has to be 1–20.
  const isWarmup = r.isWarmup === true;
  const floor = isWarmup ? 0 : 1;
  if (!Number.isFinite(r.setNumber) || (r.setNumber as number) < floor || (r.setNumber as number) > 20) return null;
  const setNumber = isWarmup ? 0 : Math.round(r.setNumber as number);
  if (r.remove === true) {
    const rat = typeof r.completedAt === 'string' ? new Date(r.completedAt) : now;
    return {
      exerciseId: r.exerciseId, setNumber, isWarmup, remove: true, source,
      completedAt: (Number.isNaN(rat.getTime()) ? now : rat).toISOString(),
    };
  }
  if (!Number.isFinite(r.reps) || (r.reps as number) < 1 || (r.reps as number) > 200) return null;
  if (!Number.isFinite(r.weight) || (r.weight as number) < 0 || (r.weight as number) > 500) return null;
  const at = typeof r.completedAt === 'string' ? new Date(r.completedAt) : now;
  const completedAt = Number.isNaN(at.getTime()) ? now.toISOString() : at.toISOString();
  const ed = typeof r.editedAt === 'string' ? new Date(r.editedAt) : null;
  const editedAt = ed && !Number.isNaN(ed.getTime()) ? new Date(Math.min(ed.getTime(), now.getTime())).toISOString() : undefined;
  return {
    exerciseId: r.exerciseId,
    setNumber,
    reps: Math.round(r.reps as number),
    weight: r.weight as number,
    rpe: Number.isFinite(r.rpe) && (r.rpe as number) >= 1 && (r.rpe as number) <= 4 ? Math.round(r.rpe as number) : undefined,
    isWarmup,
    completedAt,
    // The sender's edit stamp, when it sent a usable one: junk is dropped
    // (the merge then dates the version itself) and a clock running ahead
    // is pinned to now — a future stamp would outrank every later edit.
    ...(editedAt ? { editedAt } : {}),
    source,
  };
}

/**
 * Is this session PROVABLY already in Apple Health? Only when an HKWorkout
 * uuid came with the save — end() returned it, so the workout was saved.
 * Nothing else is proof. Who opened the live row proves nothing (the Watch
 * may have discarded its recording), and neither does a Watch finish without
 * a uuid (end() gives up after 10 s, and with sharing off nothing is saved at
 * all) — a stamp there hid the session from Health for good (reviews,
 * 2026-09-24). Everything else waits out PUSH_DELAY_MS, then is written only
 * if Health holds no strength workout over that window (coveredByExisting) —
 * by then a Watch copy saved on the next wrist raise has landed.
 */
export function recordedInHealth(p: { healthWorkoutUuid?: string | null }): boolean {
  return !!p.healthWorkoutUuid;
}

/** One set of the Watch's finished-session payload, after validation. */
export interface WatchLogSet {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe?: number;
  isWarmup: boolean;
  /** ISO instant the set was logged on the wrist, when the client sent one. */
  completedAt?: string;
}

type RawWatchSet = {
  exerciseId?: unknown; setNumber?: unknown; reps?: unknown; weight?: unknown;
  rpe?: unknown; isWarmup?: unknown; completedAt?: unknown;
};

/**
 * The sets of a finished Watch session, validated once for /api/watch/log.
 * Bounds mirror sanitizeLiveUpdate; junk sets are dropped, never fatal.
 * Three things the old inline mapping in the route got wrong (watch-map,
 * 2026-09-24):
 *  - it dropped each set's time. The server now keeps one when it is sent,
 *    but the current Watch build (13) sends none, so until the next build
 *    does, a Watch set still reaches the merge unstamped and still yields to
 *    a removal the phone recorded for that key;
 *  - it accepted set 0 without the warm-up flag; now set 0 IS a warm-up (a
 *    flagged warm-up is pinned to 0) or it is dropped, and a working set
 *    must be 1–20, as on the live row;
 *  - it let two sets with one key through, and the WorkoutSet unique index
 *    turned the save into a 500 on EVERY retry — a permanent wedge at the
 *    head of the Watch outbox that held up every later session. Duplicates
 *    now collapse, last one wins.
 */
export function sanitizeWatchLogSets(raw: unknown): WatchLogSet[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, WatchLogSet>();
  let position = 0;
  for (const item of raw as RawWatchSet[]) {
    if (!item || typeof item.exerciseId !== 'string' || item.exerciseId.length > 64) continue;
    const { reps, weight } = item;
    if (typeof reps !== 'number' || !Number.isFinite(reps) || reps < 1 || reps > 200) continue;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 500) continue;
    // Position among VALID sets — what a set with no number has always got.
    position++;
    const isWarmup = item.isWarmup === true;
    const n = typeof item.setNumber === 'number' && Number.isFinite(item.setNumber) ? Math.round(item.setNumber) : position;
    if (!isWarmup && (n < 1 || n > 20)) continue;
    const at = typeof item.completedAt === 'string' ? new Date(item.completedAt) : null;
    const set: WatchLogSet = {
      exerciseId: item.exerciseId,
      setNumber: isWarmup ? 0 : n,
      reps: Math.round(reps),
      weight,
      rpe: typeof item.rpe === 'number' && Number.isFinite(item.rpe) && item.rpe >= 1 && item.rpe <= 4 ? Math.round(item.rpe) : undefined,
      isWarmup,
      completedAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : undefined,
    };
    const key = liveKey(set);
    byKey.delete(key);
    byKey.set(key, set);
  }
  return [...byKey.values()];
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
 * `applied`. `unticked` names the keys the OTHER device removed and this
 * overlay un-ticked: the caller forgets them, so its next push does not
 * send a removal of its own, later-stamped, for a set it never removed. A machine the blocks lack gets a block from `newBlock`.
 */
export function overlayLiveSets<B extends OverlayBlock>(
  blocks: B[],
  sets: LiveSet[],
  newBlock: (exerciseId: string) => B,
): { blocks: B[]; applied: LiveSet[]; unticked: string[] } {
  const next = blocks.map((b) => ({ ...b, sets: [...b.sets] }));
  const applied: LiveSet[] = [];
  const unticked: string[] = [];
  for (const ls of sets) {
    let bi = next.findIndex((b) => b.exerciseId === ls.exerciseId);
    if (ls.removed) {
      // The other device un-ticked this key after we ticked it: un-tick
      // here too. A local tick newer than the removal stands.
      if (bi < 0) continue;
      const b0 = next[bi];
      const ri = ls.isWarmup ? b0.sets.findIndex((x) => x.isWarmup) : b0.sets.findIndex((x) => !x.isWarmup && x.setNumber === ls.setNumber);
      if (ri < 0) continue;
      const cur = b0.sets[ri];
      if (cur.done && (!cur.completedAt || Date.parse(cur.completedAt) < Date.parse(ls.completedAt))) {
        b0.sets[ri] = { ...cur, done: false, completedAt: null };
        unticked.push(liveKey(ls));
      }
      continue;
    }
    if (bi < 0) {
      next.push({ ...newBlock(ls.exerciseId), sets: [] });
      bi = next.length - 1;
    }
    const b = next[bi];
    // A warm-up matches the block's ONE warm-up row. Matching it by number
    // would land on working set 1 and overwrite a 30 kg set with the 15 kg
    // ramp-in — and that half-load row then saves to history as real work.
    let si = ls.isWarmup
      ? b.sets.findIndex((x) => x.isWarmup)
      : b.sets.findIndex((x) => !x.isWarmup && x.setNumber === ls.setNumber);
    if (si < 0 && ls.isWarmup) {
      // The other device warmed up on a movement this one did not open a
      // warm-up row for. Keep it — it happened.
      b.sets.unshift({
        exerciseId: ls.exerciseId, setNumber: 0,
        reps: ls.reps, weight: ls.weight,
        done: false, notes: '', rpe: 0, completedAt: null, isWarmup: true,
      });
      si = 0;
    } else if (si < 0) {
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
      done: true, completedAt: ls.completedAt, isWarmup: ls.isWarmup === true,
    };
    applied.push(ls);
  }
  return { blocks: next, applied, unticked };
}

// ── The phone logger's push: what this device has ticked, and the diff ──
// Pure so both directions of the warm-up bug are assertions (review,
// 2026-10-02) instead of two loops inside a 2,600-line component.

/** A done set as last pushed (or received) — the diff base. The edit stamp
 *  is deliberately not part of it: it dates a version, it is not content. */
export const liveSerial = (x: { reps: number; weight: number; rpe?: number | null; completedAt?: string | null }) =>
  JSON.stringify([x.reps, x.weight, x.rpe || 0, x.completedAt ?? null]);

/**
 * Every set ticked on this device, as the live row holds it. Warm-ups
 * travel like any set, under the key the Watch uses — set 0 with the flag.
 * They were skipped here ("the wrist has no such set"; it has logged them
 * since 2026-09-24), so a warm-up ticked on the phone never reached the row
 * and Continue on the wrist asked for it again — and, worse, the Watch's own
 * warm-up, overlaid into the phone's snapshot, was missing from every push
 * and got "removed" (see liveDiff).
 *
 * The SET's exercise, never the block's. A swap leaves already-done sets on
 * the exercise they were performed on, so the two diverge — and stamping
 * the block's id here pushed a 60 kg Chest Press set to the live row
 * labelled Pec Fly. A Watch finish then wrote it as a 60 kg Pec Fly PR,
 * unbeatable and unrepairable (no per-set editor). Same class as the
 * cross-gym PR bug, laundered through exerciseId instead of gym.
 */
export function ownLiveSets(blocks: OverlayBlock[], source: LiveSource): LiveSet[] {
  const out: LiveSet[] = [];
  for (const b of blocks) {
    for (const st of b.sets) {
      if (!st.done || !st.completedAt) continue;
      const isWarmup = st.isWarmup === true;
      out.push({
        exerciseId: st.exerciseId ?? b.exerciseId, setNumber: isWarmup ? 0 : st.setNumber,
        reps: st.reps, weight: st.weight, rpe: st.rpe || undefined,
        isWarmup, completedAt: st.completedAt, source,
      });
    }
  }
  return out;
}

/**
 * What to push: every set whose content differs from the snapshot, and a
 * removal for every key this device UN-TICKED. "Not in my blocks" is not
 * an un-tick: the old loop removed every snapshot key missing from the
 * push, and the snapshot also holds what the overlay received — so the
 * Watch's warm-up (never in the push) was tombstoned on the next flush and
 * the finish dropped it from history, and a Watch set whose overlay had
 * reached the snapshot but not yet the rendered blocks could go the same
 * way. A removal now needs the key in `ticked` — keys an earlier diff saw
 * ticked HERE; this call adds the current ones. The caller forgets a key
 * (snapshot and ticked) once its removal is acknowledged, or when the
 * removal came from the row (overlayLiveSets `unticked`).
 *
 * A changed set the row already holds carries `editedAt` = now: the tick
 * time cannot order two versions of one tick (see mergeLiveSets). Removals
 * are stamped here too — a tombstone stamped on arrival (0.4 s debounce +
 * gym LTE) beat his own re-tick a second later (adversary pass 4).
 */
export function liveDiff(
  current: LiveSet[],
  snapshot: Map<string, string>,
  ticked: Set<string>,
  nowISO: string,
): { updates: LiveSetUpdate[]; serials: Map<string, string> } {
  const updates: LiveSetUpdate[] = [];
  const serials = new Map<string, string>();
  const have = new Set<string>();
  for (const set of current) {
    const key = liveKey(set);
    have.add(key);
    const ser = liveSerial(set);
    const known = snapshot.get(key);
    if (known === ser) continue;
    updates.push(known === undefined ? set : { ...set, editedAt: nowISO });
    serials.set(key, ser);
  }
  for (const key of snapshot.keys()) {
    if (have.has(key) || !ticked.has(key)) continue;
    const cut = key.lastIndexOf('#');
    const n = key.slice(cut + 1);
    // Warm-ups travel as set 0 with the flag — `Number('w')` was NaN and
    // the sanitizer dropped the removal, so a Watch warm-up came back.
    const isWarmup = n === 'w';
    updates.push({ exerciseId: key.slice(0, cut), setNumber: isWarmup ? 0 : Number(n), isWarmup, remove: true, completedAt: nowISO });
  }
  for (const key of have) ticked.add(key);
  return { updates, serials };
}

// ── The finish: per key, the most recently edited version ──────────────
// Review 2026-10-02. The phone ticked set 1 at 20 kg unrated, the Watch
// copied it, the phone corrected it to 22.5 Hard; the Watch finished and
// "the poster's own copy wins" saved 20 kg with no rating. And when the
// phone finished first, "keys already saved keep the first finisher's
// values" dropped a rating the Watch added afterwards.

/** One set of a finishing device's payload. */
export type FinishSet = {
  exerciseId: string; setNumber: number; reps: number; weight: number;
  rpe?: number | null; isWarmup?: boolean; completedAt?: string | null;
};

/** The instant a version is known to be from: its edit, else its tick. */
const versionAt = (s: { editedAt?: string | null; completedAt?: string | null }): number => {
  const e = s.editedAt ? Date.parse(s.editedAt) : NaN;
  if (Number.isFinite(e)) return e;
  return s.completedAt ? Date.parse(s.completedAt) : NaN;
};
const sameLoad = (a: { reps: number; weight: number }, b: { reps: number; weight: number }) => a.reps === b.reps && a.weight === b.weight;
const rated = (r: number | null | undefined): r is number => typeof r === 'number' && r > 0;

/**
 * One key at the finish: the poster's copy against the live row's.
 *  - The poster wrote the row's version itself → its copy is the newest
 *    there is (it may hold a rating that never got pushed).
 *  - The OTHER device wrote it last → the later version wins. A posted set
 *    is dated by its tick, so a copy of a tick the other device has since
 *    edited is older than the edit; one with no stamp at all (Watch build
 *    13) is a copy by definition. Same instant → the poster (the row never
 *    changed after the tick, so a difference is the poster's own edit).
 *  - Whoever wins, no rating never replaces a rating at the same weight ×
 *    reps: an unrated set is a rating not given yet, not a retraction.
 * Fields the row does not carry (notes) stay the poster's.
 */
function pickFinishVersion<T extends FinishSet>(posted: T, live: LiveSet | undefined, posterSource?: LiveSource): T {
  if (!live || live.removed) return posted;
  let out = posted;
  if (!(posterSource && live.source === posterSource)) {
    const p = versionAt(posted);
    const l = versionAt(live);
    const liveWins = Number.isFinite(p) ? Number.isFinite(l) && l > p : !!posterSource;
    if (liveWins) out = { ...posted, reps: live.reps, weight: live.weight, rpe: live.rpe, completedAt: live.completedAt };
  }
  const other = out === posted ? live : posted;
  if (!rated(out.rpe) && rated(other.rpe) && sameLoad(out, other)) out = { ...out, rpe: other.rpe };
  return out;
}

/**
 * The first finisher's own sets, reconciled with the live row: minus what
 * the other device removed (dropRemovedSets), and each remaining key in
 * its most recently edited version. The union of sets the poster never saw
 * is still unionForFinish's job.
 */
export function resolveFinishSets<T extends FinishSet>(posted: T[], live: LiveSet[], posterSource?: LiveSource): T[] {
  const byKey = new Map<string, LiveSet>();
  for (const s of live) byKey.set(liveKey(s), s);
  return dropRemovedSets(posted, live).map((s) => pickFinishVersion(s, byKey.get(liveKey(s)), posterSource));
}

/**
 * The second finisher against keys the workout ALREADY holds: the saved
 * sets that must take its values. Only logged values come back — reps,
 * weight, rating, tick time; the recorded prescription (allowedKg, rule 10)
 * was written from the save-time memory and no device copy rewrites it.
 *  - Saved equals the row's version → the first finisher added nothing of
 *    its own to this key, so the usual pick applies (the wrist's late
 *    rating of its own set lands; its stale copy of a phone set does not).
 *  - Saved differs from the row, or the row lacks the key → the first
 *    finisher saved an edit that never reached the row (Save inside the
 *    0.4 s push debounce). It cannot be dated, so it stands; only a
 *    missing rating at the same weight × reps is filled.
 * A replay of either finish resolves to what is saved and returns nothing.
 */
export function finishUpdates(
  saved: Array<FinishSet>,
  posted: FinishSet[],
  live: LiveSet[] | null | undefined,
  posterSource?: LiveSource,
): Array<{ exerciseId: string; setNumber: number; isWarmup: boolean; reps: number; weight: number; rpe: number | null; completedAt: string | null }> {
  const rows = live ?? [];
  const liveBy = new Map<string, LiveSet>();
  for (const s of rows) liveBy.set(liveKey(s), s);
  const savedBy = new Map<string, FinishSet>();
  for (const s of saved) savedBy.set(liveKey(s), s);
  const out: ReturnType<typeof finishUpdates> = [];
  for (const p of dropRemovedSets(posted, rows)) {
    const key = liveKey(p);
    const sv = savedBy.get(key);
    if (!sv) continue;
    const lv = liveBy.get(key);
    const rowIsSaved = !!lv && !lv.removed && sameLoad(lv, sv) && (lv.rpe || 0) === (sv.rpe || 0);
    let next: FinishSet = sv;
    if (rowIsSaved) next = pickFinishVersion(p, lv, posterSource);
    else if (!rated(sv.rpe) && rated(p.rpe) && sameLoad(sv, p)) next = { ...sv, rpe: p.rpe };
    if (sameLoad(next, sv) && (next.rpe || 0) === (sv.rpe || 0)) continue;
    out.push({
      exerciseId: sv.exerciseId, setNumber: sv.setNumber, isWarmup: sv.isWarmup === true,
      reps: next.reps, weight: next.weight, rpe: rated(next.rpe) ? next.rpe : null,
      completedAt: next.completedAt ?? sv.completedAt ?? null,
    });
  }
  return out;
}
