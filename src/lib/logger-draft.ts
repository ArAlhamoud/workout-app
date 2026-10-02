// The phone logger's DECISIONS, out of the component (audit 2, 2026-10-02).
// What a stored draft is worth, where it restores, which save id it may
// keep, what a deleted row does to the set numbers, when a set is a record:
// each lived inline in WorkoutForm, could only be checked by hand on the
// device, and each was wrong. Pure — no React, no Prisma, no storage — so
// scripts/coach-tests.ts runs every one of them, and the server reads the
// same session-day rule the phone does (createWorkout).

/** What the restore reads of a stored draft. */
export interface DraftLike {
  name?: string;
  savedAt?: number;
  blocks?: unknown;
}

type DoneSet = { done?: boolean };
type BlockOfSets = { sets?: DoneSet[] };

/** Has anything in this draft been ticked? A draft with nothing done is a
 *  logger he looked at, not a session. */
export function draftStarted(draft: { blocks?: unknown } | null | undefined): boolean {
  return Array.isArray(draft?.blocks) && (draft!.blocks as BlockOfSets[]).some((b) => Array.isArray(b?.sets) && b.sets.some((s) => s?.done === true));
}

/**
 * May the autosave write a draft right now? Never once the session is saved
 * or handed off: a push or poll resolving after the save changed the blocks,
 * re-armed the writer and put the finished session back as a draft WITH its
 * save id — the ghost the next open restored. Never for a form nothing was
 * done to: the old writer stored the pristine template the moment the form
 * initialised, and a logger he only looked at on 2 Oct restored on 4 Oct
 * with 2 Oct's date, weights and save id (2026-10-02).
 */
export function shouldWriteDraft(s: { finished: boolean; rescue: boolean; started: boolean; touched: boolean }): boolean {
  if (s.finished || s.rescue) return false;
  return s.started || s.touched;
}

/**
 * Is a stored draft rubbish — nothing ticked, and from an earlier activity
 * day (or undated, or empty)? Such a draft is removed from EVERY store: the
 * 24 h purge used to clear localStorage only, and the form fell back to the
 * native copy. A draft with a ticked set is never disposable — that is a
 * session that got interrupted, and discarding it is his tap.
 */
export function draftDisposable(draft: DraftLike | null | undefined, today: string, dayOf: (d: Date) => string): boolean {
  if (!draft || !Array.isArray(draft.blocks) || draft.blocks.length === 0) return true;
  if (draftStarted(draft)) return false;
  const at = typeof draft.savedAt === 'number' && draft.savedAt > 0 ? new Date(draft.savedAt) : null;
  return !at || dayOf(at) !== today;
}

export type DraftPlan =
  /** Remove it from every store and open today's logger. */
  | { kind: 'discard' }
  /** Follow the draft to its own day and length (header and content agree). */
  | { kind: 'hop'; href: string }
  /**
   * Restore it. `represcribe`: the draft is from an earlier activity day —
   * its done sets and its date stand (that session happened then), the
   * machines not yet started take TODAY's prescription. `refit`: he chose
   * another length — done sets stand, the rest is today's list for it.
   */
  | { kind: 'restore'; represcribe: boolean; refit: boolean };

/**
 * What to do with a stored draft when the logger opens.
 *
 * Two incidents, one decision (2026-10-02):
 *  - an untouched draft restored days later with its old date, old weights
 *    and old save id — after a 21-day layoff that is full pre-break weight
 *    under a "Return 60%" header;
 *  - the session-length pills did nothing once the logger had been opened:
 *    only a different DAY hopped, so a same-day draft for 45 minutes
 *    restored over the 30 he had just chosen.
 *
 * An explicit choice (a ?day= / ?dur= he tapped) beats a draft with nothing
 * done; a draft with done sets is never binned for it. A bare open follows
 * the draft, as before.
 */
export function planDraftRestore(
  draft: DraftLike,
  page: { day?: 'A' | 'B' | null; dur?: number | null; dayExplicit: boolean; durExplicit: boolean; today: string },
  dayOf: (d: Date) => string,
): DraftPlan {
  if (!Array.isArray(draft.blocks) || draft.blocks.length === 0) return { kind: 'discard' };
  if (draftDisposable(draft, page.today, dayOf)) return { kind: 'discard' };
  const started = draftStarted(draft);
  const at = typeof draft.savedAt === 'number' && draft.savedAt > 0 ? new Date(draft.savedAt) : null;
  const represcribe = !at || dayOf(at) !== page.today;
  const m = draft.name?.match(/^Day ([AB]) (\d+)m/);
  if (m && page.day) {
    const href = `/workouts/new?day=${m[1]}&dur=${m[2]}`;
    if (m[1] !== page.day) return !started && page.dayExplicit ? { kind: 'discard' } : { kind: 'hop', href };
    if (page.dur != null && Number(m[2]) !== page.dur) {
      if (!page.durExplicit) return { kind: 'hop', href };
      return started ? { kind: 'restore', represcribe, refit: true } : { kind: 'discard' };
    }
  }
  return { kind: 'restore', represcribe, refit: false };
}

/** "Day A 45m — Oct 2" under a 30-minute list: the name follows the length. */
export function renameForDuration(name: string, dur: number | null | undefined): string {
  return dur ? name.replace(/^(Day [AB]) \d+m/, `$1 ${dur}m`) : name;
}

/**
 * A restored draft laid over today's plan. Machines with a done set are his
 * and stay exactly as stored (done sets are logged facts, and the rest
 * capsule rates by index). Every machine not yet started is today's: the
 * fresh block, today's prescription, today's list for the chosen length. A
 * started machine the plan no longer lists stays; so does a block he added
 * himself (no program name). An unstarted template machine the plan dropped
 * goes — that is what choosing 30 minutes means.
 */
export function mergeDraftIntoPlan<B extends { exerciseId: string; programName?: string; sets: Array<{ done: boolean }> }>(
  draftBlocks: B[],
  fresh: B[],
): B[] {
  const isStarted = (b: B) => b.sets.some((s) => s.done);
  const used = new Set<B>();
  const out = fresh.map((f) => {
    const mine = draftBlocks.find((b) => !used.has(b) && b.exerciseId === f.exerciseId && isStarted(b));
    if (!mine) return f;
    used.add(mine);
    return mine;
  });
  const inPlan = new Set(fresh.map((f) => f.exerciseId));
  for (const b of draftBlocks) {
    if (used.has(b)) continue;
    if (isStarted(b) || (!b.programName && !inPlan.has(b.exerciseId))) out.push(b);
  }
  return out;
}

/**
 * The date a session takes when its FIRST set is ticked. A logger left
 * mounted across the 04:00 rollover still held the day it was opened on;
 * the session it then logged was dated yesterday. Only the untouched
 * mount-time date moves — a date he set himself is his.
 */
export function firstTickDay(date: string, mountDay: string, nowDay: string): string {
  return date === mountDay && nowDay !== mountDay ? nowDay : date;
}

/**
 * A row deleted from a machine: WORKING sets renumber from 1, the warm-up
 * stays 0. The old `i + 1` over every row turned W,1,2,3 minus set 3 into
 * W→1, 1→2, 2→3 — the warm-up flag kept it at 0 on save, so the working
 * sets saved as 2 and 3, and each ticked set changed its live key (a
 * tombstone and a new set on the wrist).
 */
export function removeSetAt<S extends { setNumber: number; isWarmup?: boolean }>(sets: S[], idx: number): S[] {
  let n = 0;
  return sets
    .filter((_, i) => i !== idx)
    .map((s) => (s.isWarmup ? (s.setNumber === 0 ? s : { ...s, setNumber: 0 }) : { ...s, setNumber: ++n }));
}

// ── Records: celebrate, never grade ──────────────────────────

/** Timed holds have no weight to set a record with. Every TEMPLATE block
 *  carries unit 'reps', so the old `!block.unit` ("not timed") was false
 *  for every program machine and no record line ever fired for one. */
export const isTimedUnit = (unit: string | null | undefined): boolean => unit === 'seconds';

/**
 * Is the set just ticked a record at THIS gym (rule 2: the records passed
 * in are the tagged building's)? 'all-time' = heavier than anything logged
 * there; 'rep' = heavier than any set of at least this many reps. null:
 *  - a timed hold, a warm-up, no weight;
 *  - no record to beat (the first visit to a machine or a building is not
 *    fourteen records);
 *  - a ramp-scaled set below the real record — 60% of his weight is never
 *    "best 12-rep set";
 *  - a set this session already matched (three sets at the new weight are
 *    one record, not three toasts).
 */
export function setRecord(
  set: { weight: number; reps: number; isWarmup?: boolean },
  rec: { unit?: string | null; best: number; byReps?: Record<number, number>; rampScaled: boolean; earlier?: Array<{ weight: number; reps: number }> },
): 'all-time' | 'rep' | null {
  if (isTimedUnit(rec.unit) || set.isWarmup || !(set.weight > 0) || !(rec.best > 0)) return null;
  const earlier = rec.earlier ?? [];
  if (set.weight > rec.best) return earlier.some((e) => e.weight >= set.weight) ? null : 'all-time';
  if (rec.rampScaled || !(set.reps > 0)) return null;
  let repBest = 0;
  for (const [r, kg] of Object.entries(rec.byReps ?? {})) if (Number(r) >= set.reps && kg > repBest) repBest = kg;
  if (set.weight <= repBest) return null;
  return earlier.some((e) => e.weight >= set.weight && e.reps >= set.reps) ? null : 'rep';
}

/**
 * Does this block hold a record he has LIFTED? Done working sets only —
 * the chip used to light on the prefill, before the lift — each against its
 * own exercise's record (a swap leaves done sets on the machine they were
 * performed on), and only where there is a record to beat.
 */
export function blockHasRecord(
  sets: Array<{ exerciseId?: string; weight: number; done: boolean; isWarmup?: boolean }>,
  blockExerciseId: string,
  unit: string | null | undefined,
  records: Record<string, number>,
): boolean {
  if (isTimedUnit(unit)) return false;
  return sets.some((s) => {
    const best = records[s.exerciseId ?? blockExerciseId] ?? 0;
    return s.done && !s.isWarmup && best > 0 && s.weight > best;
  });
}

/**
 * The "what moved" line for one machine: only a move UP is said. A deload
 * or a step down is the prescription working, and a minus sign on the
 * celebration screen is a grade (zero-shame rule). Whole pins when the
 * difference is one; kilograms otherwise.
 */
export function movedLabel(top: number, prev: number | null | undefined, pin: number): string | null {
  if (!(top > 0) || prev == null || !(top > prev)) return null;
  const diff = +(top - prev).toFixed(1);
  const moves = pin > 0 ? Math.round(diff / pin) : 0;
  return moves > 0 && Math.abs(moves * pin - diff) < 0.01 ? `+${moves} pin${moves === 1 ? '' : 's'}` : `+${diff} kg`;
}

// ── One save id, one session ─────────────────────────────────

/** A set stamped this close to the owner's own sets is the same sitting,
 *  whatever the calendar says (a session that runs past 04:00). */
export const SAME_SESSION_GRACE_MS = 4 * 60 * 60 * 1000;

/** What is known of the workout (or closed live row) that owns a save id. */
export interface SaveIdOwner {
  /** Activity days the owner's sets were lifted on, plus its own date. */
  days: string[];
  /** Earliest and latest set stamp, ms; null when none is stamped. */
  firstAt: number | null;
  lastAt: number | null;
}

const stampMs = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** The owner facts of a saved workout. Its date is a bare activity day at
 *  UTC midnight for a phone save and a real instant for some Watch rows —
 *  both are read. */
export function ownerOf(
  workout: { date: Date; sets: Array<{ completedAt: Date | string | null }> },
  dayOf: (d: Date) => string,
): SaveIdOwner {
  const stamps = workout.sets.map((s) => stampMs(s.completedAt)).filter((t): t is number => t != null);
  const days = new Set(stamps.map((t) => dayOf(new Date(t))));
  days.add(workout.date.toISOString().slice(0, 10));
  if (workout.date.getTime() % 86_400_000 !== 0) days.add(dayOf(workout.date));
  return { days: [...days].sort(), firstAt: stamps.length ? Math.min(...stamps) : null, lastAt: stamps.length ? Math.max(...stamps) : null };
}

/**
 * Posted sets split by whether they belong to the session that owns their
 * save id. A draft once kept the id of a workout saved days before: a tick
 * was posted under it and the merge overwrote the OLD workout's set, or —
 * the live row gone — Save came back `deduped` with nothing stored and the
 * form cleared the draft; that day's session was stored nowhere
 * (2026-10-02). `same`: lifted on one of the owner's activity days, or
 * within the grace of its sets, or carrying no stamp at all (a replay of
 * an old client — it cannot be told apart, so it merges as it always did).
 * `other`: lifted on another day — a NEW session, never a merge.
 */
export function splitBySessionDay<T extends { completedAt?: string | Date | null }>(
  owner: SaveIdOwner,
  posted: T[],
  dayOf: (d: Date) => string,
): { same: T[]; other: T[]; otherDay: string | null } {
  const same: T[] = [];
  const other: T[] = [];
  let first: number | null = null;
  for (const s of posted) {
    const t = stampMs(s.completedAt);
    if (t == null) { same.push(s); continue; }
    const near = owner.firstAt != null && owner.lastAt != null && t >= owner.firstAt - SAME_SESSION_GRACE_MS && t <= owner.lastAt + SAME_SESSION_GRACE_MS;
    if (near || owner.days.includes(dayOf(new Date(t)))) { same.push(s); continue; }
    other.push(s);
    if (first == null || t < first) first = t;
  }
  return { same, other, otherDay: first != null ? dayOf(new Date(first)) : null };
}

/** The id a session lifted on another day is saved under: derived, so the
 *  outbox replaying the same payload finds the workout it already made. */
export const rehomedSaveId = (clientSaveId: string, day: string): string => `${clientSaveId}~${day}`;

/** What the server says of a draft's save id (getSaveIdOwner). */
export interface SaveIdState {
  /** The workout saved under it, if any. */
  owner: (SaveIdOwner & { sets: Array<{ exerciseId: string; setNumber: number; isWarmup: boolean; reps: number; weight: number; rpe: number | null }> }) | null;
  /** Its live row is closed (finished or binned on the other device). */
  liveClosed: boolean;
}

/**
 * A restored draft and its save id.
 *   keep    — nobody owns it, or the draft holds sets of the owner's own
 *             session the workout may lack (the Watch finished first; the
 *             handoff merges them under the same id).
 *   new     — the id belongs to a saved or closed session and the draft's
 *             sets, done or still to do, are another one.
 *   discard — every done set is already in the saved workout as logged:
 *             the draft is that finished session's ghost.
 */
export function draftSaveIdFate(
  state: SaveIdState,
  done: Array<{ exerciseId: string; setNumber: number; isWarmup?: boolean; reps: number; weight: number; rpe?: number | null; completedAt?: string | null }>,
  dayOf: (d: Date) => string,
): 'keep' | 'new' | 'discard' {
  if (!state.owner) return state.liveClosed ? 'new' : 'keep';
  if (!done.length) return 'new';
  const key = (s: { exerciseId: string; setNumber: number; isWarmup?: boolean }) => `${s.exerciseId}:${s.isWarmup ? 0 : s.setNumber}:${s.isWarmup ? 'w' : 's'}`;
  const saved = new Map(state.owner.sets.map((s) => [key(s), s]));
  const ghost = done.every((s) => {
    const o = saved.get(key(s));
    return o != null && o.reps === s.reps && o.weight === s.weight && (o.rpe ?? null) === (s.rpe || null);
  });
  if (ghost) return 'discard';
  return splitBySessionDay(state.owner, done, dayOf).same.length ? 'keep' : 'new';
}

// ── The gym switch ───────────────────────────────────────────

/**
 * A gym switch whose numbers did not load. The tag was moved before the
 * fetch and the failure kept everything: B_Fit's weights sat under the
 * Alrajhi tag in silence, and were saved there (rule 2, 2026-10-02).
 * His tap: the tag goes back to the gym whose numbers are on screen and the
 * next tap retries. A switch the SESSION asked for (the Watch's row, a
 * restored draft) keeps its tag — the session is in that building — and
 * retries by itself, a few times.
 */
export function gymSwitchFailure(f: { shown: string; wanted: string; wantedName: string; by: 'tap' | 'session'; tries: number }): { tag: string; retry: boolean; notice: string } {
  if (f.by === 'tap') return { tag: f.shown, retry: false, notice: `${f.wantedName} did not load · tap again` };
  const retry = f.tries < 3;
  return { tag: f.wanted, retry, notice: retry ? `${f.wantedName} numbers did not load · retrying` : `${f.wantedName} numbers did not load` };
}
