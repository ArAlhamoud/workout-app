// The phone logger's DECISIONS, out of the component (audit 2, 2026-10-02).
// What a stored draft is worth, where it restores, which save id it may
// keep, what a deleted row does to the set numbers, when a set is a record:
// each lived inline in WorkoutForm, could only be checked by hand on the
// device, and each was wrong. Pure — no React, no Prisma, no storage — so
// scripts/coach-tests.ts runs every one of them, and the server reads the
// same session-day rule the phone does (createWorkout).

import { isTrainingSession } from './program';

/** What the restore reads of a stored draft. */
export interface DraftLike {
  name?: string;
  savedAt?: number;
  blocks?: unknown;
  /** The day and length the draft was written under. Carried as fields:
   *  parsed from the name, a draft he renamed ("Push day") matched nothing
   *  and an explicit 30 restored the 45 list un-re-fitted (adversary,
   *  2026-10-02). The name is only the fallback for older drafts. */
  day?: string | null;
  dur?: number | null;
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

/** The day and length a draft belongs to: its own fields, else (a draft
 *  written before they existed) its name. null: a freestyle log. */
export function draftHome(draft: DraftLike | null | undefined): { day: 'A' | 'B'; dur: number } | null {
  if (!draft) return null;
  if ((draft.day === 'A' || draft.day === 'B') && typeof draft.dur === 'number' && draft.dur > 0) return { day: draft.day, dur: draft.dur };
  const m = draft.name?.match(/^Day ([AB]) (\d+)m/);
  return m ? { day: m[1] as 'A' | 'B', dur: Number(m[2]) } : null;
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
  const home = draftHome(draft);
  if (home && page.day) {
    const href = `/workouts/new?day=${home.day}&dur=${home.dur}`;
    if (home.day !== page.day) return !started && page.dayExplicit ? { kind: 'discard' } : { kind: 'hop', href };
    if (page.dur != null && home.dur !== page.dur) {
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
export function mergeDraftIntoPlan<B extends { uid: string; exerciseId: string; programName?: string; sets: Array<{ done: boolean }> }>(
  draftBlocks: B[],
  fresh: B[],
  /** Applied to a started machine laid back into its plan slot — where an
   *  earlier day's draft takes today's weight on its undone rows. */
  relay?: (mine: B, slot: B) => B,
): B[] {
  const isStarted = (b: B) => b.sets.some((s) => s.done);
  const used = new Set<B>();
  // A slot is claimed by UID first, then by machine. A swap changes a
  // block's exerciseId and keeps its uid: matched by machine alone, a
  // swapped block matched nothing, the fresh block for the original machine
  // stayed, and the swapped one was appended under the SAME uid — every
  // handler is `b.uid === uid`, so a tick on Chest Press un-ticked Pec Fly,
  // removing one removed both, and React got a duplicate key (adversary's
  // probe, 2026-10-02). A swap he had not started gives the slot back to
  // today's plan.
  const claimed = new Map<B, B>();
  for (const f of fresh) {
    const mine = draftBlocks.find((b) => !used.has(b) && b.uid === f.uid && isStarted(b));
    if (mine) { used.add(mine); claimed.set(f, mine); }
  }
  for (const f of fresh) {
    if (claimed.has(f)) continue;
    const mine = draftBlocks.find((b) => !used.has(b) && b.exerciseId === f.exerciseId && isStarted(b));
    if (mine) { used.add(mine); claimed.set(f, mine); }
  }
  const out = fresh.map((f) => {
    const mine = claimed.get(f);
    if (!mine) return f;
    return relay ? relay(mine, f) : mine;
  });
  const inPlan = new Set(fresh.map((f) => f.exerciseId));
  const slotUids = new Set(fresh.map((f) => f.uid));
  for (const b of draftBlocks) {
    if (used.has(b)) continue;
    if (isStarted(b) || (!b.programName && !inPlan.has(b.exerciseId) && !slotUids.has(b.uid))) out.push(b);
  }
  // One block per uid, whatever the draft held.
  const seen = new Set<string>();
  return out.map((b) => {
    let uid = b.uid;
    for (let n = 2; seen.has(uid); n++) uid = `${b.uid}~${n}`;
    seen.add(uid);
    return uid === b.uid ? b : { ...b, uid };
  });
}

/**
 * The undone rows of a machine at today's weight. Done sets are logged
 * facts; rows are repriced, never added or removed (the rest capsule rates
 * by index). In a draft from an earlier day the machine he had STARTED
 * kept that day's weight on its remaining sets: set 1 of Lat Pulldown
 * ticked at 40 before a break, and 22 days later sets 2–3 still open at 40
 * under "Return 60%" — above the ramp's allowance, two days' prescriptions
 * on one machine (trainer, 2026-10-02). Nothing to prescribe (no working
 * weight) leaves the rows as stored.
 */
export function repriceUndone<S extends { done: boolean; isWarmup?: boolean; weight: number }>(
  sets: S[],
  workingKg: number | null | undefined,
  warmKg: number | null | undefined,
): S[] {
  if (!(workingKg != null && workingKg > 0)) return sets;
  return sets.map((s) => {
    if (s.done) return s;
    if (s.isWarmup) return warmKg != null && warmKg > 0 ? { ...s, weight: warmKg } : s;
    return { ...s, weight: workingKg };
  });
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
  // A scaled machine — a ramp week under 100%, or a rescue — has NO record
  // line, all-time included: in REBOOT, prescribed ~25, a 42.5 against a
  // best of 40 is the lift the save-time judge marks over-ramp, and the app
  // must not celebrate breaking its own ramp (trainer, 2026-10-02). A held
  // machine (first met inside the ramp, allowed its pin) is not scaled.
  if (rec.rampScaled) return null;
  const earlier = rec.earlier ?? [];
  if (set.weight > rec.best) return earlier.some((e) => e.weight >= set.weight) ? null : 'all-time';
  if (!(set.reps > 0)) return null;
  // A rep record beats a set of AT LEAST this many reps. With none on
  // record there is nothing to beat: 20 kg × 20 against a 40 kg best was
  // "best 20-rep set: 20 kg", and every deload day minted one (adversary).
  let repBest = 0;
  for (const [r, kg] of Object.entries(rec.byReps ?? {})) if (Number(r) >= set.reps && kg > repBest) repBest = kg;
  if (!(repBest > 0) || set.weight <= repBest) return null;
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
  /** A ramp-scaled or rescue machine: no record line (see setRecord). */
  rampScaled = false,
): boolean {
  if (isTimedUnit(unit) || rampScaled) return false;
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

/** Sets stamped this close together are one sitting, whatever the calendar
 *  says (a session that runs past 04:00). */
export const SAME_SESSION_GRACE_MS = 4 * 60 * 60 * 1000;

/**
 * What is known of a saved workout (or a closed live row) for routing: its
 * ONE activity day and the stamps of its sets. One day, on purpose: the
 * first version added the day of every set, and the UTC date AND the
 * activity day of an instant-dated Watch row — a row at 03:30 Riyadh owned
 * two days, and a `same`-by-grace set merged at 04:05 widened the owner so
 * the replay re-read tomorrow's sets as its own (steward + adversary,
 * 2026-10-02). The day is the workout's date and never moves.
 */
export interface SaveIdOwner {
  day: string;
  stamps: number[];
}

/** A workout saved under the posted id or one derived from it. */
export interface SavedSitting extends SaveIdOwner {
  saveId: string;
  /** Its sets, by key and tick — a posted copy of one goes back to it. */
  sets?: Array<{ key: string; at: number | null }>;
}

/** The payload's date and whether he set it himself (a back-fill, a
 *  detected session, an edited date field). */
export interface PayloadDate {
  day: string;
  dateByHand?: boolean;
}

type Stamped = {
  completedAt?: string | Date | null;
  exerciseId?: string;
  setNumber?: number;
  isWarmup?: boolean;
  rpe?: number | null;
};

const stampMs = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** One set's identity inside a workout — the live row's key. */
export const setKey = (s: { exerciseId?: string; setNumber?: number; isWarmup?: boolean }): string =>
  `${s.exerciseId ?? ''}:${s.isWarmup ? 0 : s.setNumber ?? 0}:${s.isWarmup ? 'w' : 's'}`;

/** A save id a real client generates: no `~` (ours, for a derived id), no
 *  `%` or `_` (LIKE wildcards — the family lookup is a prefix match on
 *  client-supplied text). */
export const plainSaveId = (id: string): boolean => id.length > 0 && !/[~%_]/.test(id);
/** What follows the posted id in a derived one: `~YYYY-MM-DD`, nothing else. */
export const SAVE_ID_FAMILY = /^~\d{4}-\d{2}-\d{2}$/;

/** A split-off sitting must hold at least this many working sets. */
export const SPLIT_MIN_WORKING_SETS = 4;

/**
 * Is this sitting a SESSION of its own — the only thing that may be split
 * off a payload into its own workout? The app's evidence bar
 * (isTrainingSession, on its own sets and its own length) AND four working
 * sets: two rated ticks pass the bar, and two machines he forgot and ticked
 * the next morning are not a second session (the plan read done-today and
 * the ramp stepped; adversary, 2026-10-02).
 */
export function sessionOfItsOwn(sets: Stamped[]): boolean {
  const working = sets.filter((s) => !s.isWarmup);
  if (working.length < SPLIT_MIN_WORKING_SETS) return false;
  return isTrainingSession({ name: 'Day', duration: sittingSeconds(sets), sets: sets.map((s) => ({ rpe: s.rpe ?? null, isWarmup: s.isWarmup === true })) });
}

/** A phone save is dated a bare activity day at UTC midnight; some Watch
 *  and imported rows carry a real instant. Either way: one day. */
export function ownerOf(
  workout: { date: Date; createdAt?: Date | null; sets: Array<{ completedAt: Date | string | null }> },
  dayOf: (d: Date) => string,
): SaveIdOwner {
  const bare = workout.date.getTime() % 86_400_000 === 0;
  const stamps = workout.sets.map((s) => stampMs(s.completedAt)).filter((t): t is number => t != null).sort((a, b) => a - b);
  // No stamped set (an old Watch build, a pre-upgrade persisted session):
  // the workout stands at the moment it was saved, or the phone's half of
  // a handoff across 04:00 is "another day" and splits one session.
  const savedAt = stamps.length ? null : stampMs(workout.createdAt ?? null);
  return {
    day: bare ? workout.date.toISOString().slice(0, 10) : dayOf(workout.date),
    stamps: savedAt != null ? [savedAt] : stamps,
  };
}

/**
 * A payload's stamped sets as sittings — a function of the payload ALONE,
 * so a replay cuts it the same way every time. Sets in time order; a gap
 * over the grace starts a new cluster; a cluster belongs to the activity
 * day of its FIRST set (03:50 and 04:10 are one sitting, on the day it
 * began); clusters of one day are one sitting (a session paused at noon
 * and finished that evening is one workout).
 */
export function sittingsOf<T extends Stamped>(
  sets: T[],
  dayOf: (d: Date) => string,
): { sittings: Array<{ day: string; stamps: number[]; sets: T[] }>; unstamped: T[] } {
  const unstamped: T[] = [];
  const stamped: Array<{ t: number; s: T }> = [];
  for (const s of sets) {
    const t = stampMs(s.completedAt);
    if (t == null) unstamped.push(s);
    else stamped.push({ t, s });
  }
  stamped.sort((a, b) => a.t - b.t);
  const sittings: Array<{ day: string; stamps: number[]; sets: T[] }> = [];
  let cur: { day: string; stamps: number[]; sets: T[] } | null = null;
  let prev = Number.NEGATIVE_INFINITY;
  for (const { t, s } of stamped) {
    if (!cur || t - prev > SAME_SESSION_GRACE_MS) {
      const day = dayOf(new Date(t));
      cur = sittings.find((x) => x.day === day) ?? null;
      if (!cur) { cur = { day, stamps: [], sets: [] }; sittings.push(cur); }
    }
    cur.stamps.push(t);
    cur.sets.push(s);
    prev = t;
  }
  return { sittings, unstamped };
}

/** The id a sitting of another day is saved under: derived, so the outbox
 *  replaying the same payload finds the workout it already made. */
export const rehomedSaveId = (clientSaveId: string, day: string): string => `${clientSaveId}~${day}`;

/** Where one part of a payload is saved. `day`: the date a NEW workout
 *  takes; null = the workout exists, or it is the payload's own date. */
export interface SetRoute<T> {
  saveId: string;
  day: string | null;
  sets: T[];
}

const gapBetween = (a: number[], b: number[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const x of a) for (const y of b) best = Math.min(best, Math.abs(x - y));
  return best;
};

/**
 * One save id, one session: every posted set goes to the workout of the
 * sitting it was lifted in. A draft once kept the id of a workout saved
 * days before — a tick was merged over the OLD workout's set, or Save came
 * back `deduped` with nothing stored and the form cleared the draft
 * (2026-10-02). And a draft that was started, never saved and finished
 * three days later saved both days under the old date: the plan read "4
 * days since Day B" the morning after he trained (trainer, same day).
 *
 * But a split is the EXCEPTION. The first router cut every payload at
 * every gap: a machine he forgot and ticked the next morning became a
 * second workout dated today (and, rated, a session — done-today, a ramp
 * step); a back-fill ticked across two evenings became two; a warm-up
 * ticked at 02:00 became a one-set row (adversary's probe, same day).
 *
 * THE RULE, in order. `known` is the workout saved under the posted id and
 * every one derived from it.
 *   1. A date he set by hand: ONE workout, never split, never re-dated —
 *      the posted id, or (that id being another session's) a new one on
 *      the date he set.
 *   2. A posted set whose tick a known workout already holds (same key,
 *      same moment) goes back to that workout. A second finisher's copies
 *      can never land in two.
 *   3. The rest is cut into sittings (sittingsOf). A sitting within the
 *      grace of a known workout's sets, else one dated the sitting's day,
 *      goes to that workout — the nearest; ties by id order.
 *   4. Of the sittings still unplaced, the MAIN one is the sitting on the
 *      payload's date. With none on that date and nothing saved under the
 *      id, the date was not the ticks' (a back-fill): everything is one
 *      workout on the payload's date. With the id already another
 *      session's, the main sitting is the largest, saved under a derived
 *      id on its own day.
 *   5. Any other unplaced sitting FOLDS into main — unless it is a session
 *      of its own (sessionOfItsOwn) on another activity day: only then is
 *      it a new workout, under the derived id, dated the day it was lifted.
 *   6. Sets with no stamp go by the payload's date.
 *
 * Replay-stable: once saved, every set is found again by rule 2, and
 * rules 3–5 read only the payload and each workout's date. `deduped`
 * stays a success for the SAME sitting (rule 8).
 */
export function routeSets<T extends Stamped>(
  rootId: string,
  known: SavedSitting[],
  payload: string | PayloadDate,
  sets: T[],
  dayOf: (d: Date) => string,
): SetRoute<T>[] {
  const payloadDay = typeof payload === 'string' ? payload : payload.day;
  const byHand = typeof payload !== 'string' && payload.dateByHand === true;
  // The posted id first, then the derived ones in id order: whatever order
  // the database returned them in, a tie breaks the same way.
  const fam = [...known].sort((a, b) => (a.saveId === rootId ? -1 : b.saveId === rootId ? 1 : a.saveId < b.saveId ? -1 : a.saveId > b.saveId ? 1 : 0));
  const root = fam.find((k) => k.saveId === rootId) ?? null;
  const out: SetRoute<T>[] = [];
  const put = (saveId: string, day: string | null, add: T[]) => {
    if (!add.length) return;
    const r = out.find((x) => x.saveId === saveId);
    if (r) r.sets.push(...add);
    else out.push({ saveId, day, sets: [...add] });
  };
  const holds = (k: SavedSitting, s: Stamped): boolean => {
    const t = stampMs(s.completedAt);
    if (t == null || !k.sets) return false;
    const key = setKey(s);
    return k.sets.some((x) => x.key === key && x.at != null && Math.abs(x.at - t) <= 1000);
  };
  const nearestOf = (stamps: number[]): SavedSitting | null => {
    let best: { k: SavedSitting; gap: number } | null = null;
    for (const k of fam) {
      const gap = gapBetween(k.stamps, stamps);
      if (gap <= SAME_SESSION_GRACE_MS && (!best || gap < best.gap)) best = { k, gap };
    }
    return best ? best.k : null;
  };
  /** A derived id, or the workout already saved on that day. */
  const onDay = (day: string): { saveId: string; day: string | null } => {
    const dated = fam.find((k) => k.day === day && k !== root);
    return dated ? { saveId: dated.saveId, day: null } : { saveId: rehomedSaveId(rootId, day), day };
  };

  // 1 — his date.
  if (byHand) {
    // …into the family workout that already holds one of its ticks, or
    // stands within the grace of them, or is dated that day (the other
    // finisher's copy of this session); else the posted id; else — the id
    // being another session's — a new workout on the date he set.
    const stamps = sets.map((x) => stampMs(x.completedAt)).filter((t): t is number => t != null);
    const theirs = fam.find((k) => sets.some((x) => holds(k, x))) ?? nearestOf(stamps) ?? fam.find((k) => k.day === payloadDay) ?? null;
    const to = theirs ? { saveId: theirs.saveId, day: null } : root ? onDay(payloadDay) : { saveId: rootId, day: null };
    put(to.saveId, to.day, sets);
    return out;
  }

  // 2 — ticks already saved.
  const rest: T[] = [];
  for (const x of sets) {
    const holder = fam.find((k) => holds(k, x));
    if (holder) put(holder.saveId, null, [x]);
    else rest.push(x);
  }

  // 3 — sittings a known workout claims.
  const { sittings, unstamped } = sittingsOf(rest, dayOf);
  const free: typeof sittings = [];
  for (const s of sittings) {
    const k = nearestOf(s.stamps) ?? fam.find((x) => x.day === s.day) ?? null;
    if (k) put(k.saveId, null, s.sets);
    else free.push(s);
  }

  // 4, 5 — the main sitting, and what folds into it.
  let loose: { saveId: string; day: string | null } | null = null;
  if (free.length) {
    const dated = free.find((s) => s.day === payloadDay);
    if (!root && !dated) {
      loose = { saveId: rootId, day: null };
      for (const s of free) put(rootId, null, s.sets);
    } else {
      const working = (s: (typeof free)[number]) => s.sets.filter((x) => !x.isWarmup).length;
      const main = dated ?? free.reduce((m, s) => (working(s) > working(m) || (working(s) === working(m) && s.stamps[0] > m.stamps[0]) ? s : m));
      const mainTo = root ? onDay(main.day) : { saveId: rootId, day: null };
      if (main.day === payloadDay) loose = mainTo;
      put(mainTo.saveId, mainTo.day, main.sets);
      for (const s of free) {
        if (s === main) continue;
        const to = s.day !== main.day && sessionOfItsOwn(s.sets) ? onDay(s.day) : mainTo;
        put(to.saveId, to.day, s.sets);
      }
    }
  }

  // 6 — no stamp: the payload's date.
  if (unstamped.length) {
    const dated = fam.find((k) => k.day === payloadDay);
    const to = dated ? { saveId: dated.saveId, day: null } : loose ?? (root ? onDay(payloadDay) : { saveId: rootId, day: null });
    put(to.saveId, to.day, unstamped);
  }
  return out;
}

/**
 * Posted sets against ONE owner (the phone's view: the workout that owns a
 * draft's save id, or a closed live row): `same` are that session's,
 * `other` are another's. The server routes with routeSets; this is the
 * same rule for a single owner.
 */
export function splitBySessionDay<T extends Stamped>(
  owner: SaveIdOwner,
  posted: T[],
  dayOf: (d: Date) => string,
  payloadDay: string = owner.day,
): { same: T[]; other: T[]; otherDay: string | null } {
  const routes = routeSets('#', [{ ...owner, saveId: '#' }], payloadDay, posted, dayOf);
  const others = routes.filter((r) => r.saveId !== '#');
  return {
    same: routes.find((r) => r.saveId === '#')?.sets ?? [],
    other: others.flatMap((r) => r.sets),
    otherDay: others.map((r) => r.day).filter((d): d is string => d != null).sort()[0] ?? null,
  };
}

/** "Day B 45m — Oct 2" saved for the sitting of 5 Oct reads "— Oct 5": a
 *  re-homed workout carries its own date, not the stale draft's. */
export function datedName(name: string, day: string): string {
  const label = new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${name.replace(/\s+—\s+[^—]*$/, '')} — ${label}`;
}

/** A sitting's length from its own stamps, in seconds — the payload's
 *  duration belongs to the sitting being finished, not to the other day's.
 *  null with fewer than two stamps. */
export function sittingSeconds(sets: Stamped[]): number | null {
  const ts = sets.map((s) => stampMs(s.completedAt)).filter((t): t is number => t != null);
  return ts.length >= 2 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 1000) : null;
}

/**
 * The live row's sets, handed to the sittings of a split save. A tick goes
 * to the sitting holding the same tick, else to the nearest sitting within
 * the grace. A TOMBSTONE goes to the sitting that HOLDS the set it removes
 * (the latest posted copy of that key ticked before the removal) — routed
 * by its own time, an un-tick made during sitting B for a set lifted in
 * sitting A never reached A. A tick no sitting takes and no saved workout
 * holds is an orphan: the caller leaves the row open rather than close it
 * over a set nobody saved (adversary, 2026-10-02).
 */
export function routeLiveSets<L extends { exerciseId: string; setNumber: number; isWarmup?: boolean; completedAt: string; removed?: true }>(
  routes: Array<{ saveId: string; sets: Stamped[] }>,
  live: L[],
  saved: SavedSitting[],
): { byRoute: Map<string, L[]>; orphans: L[] } {
  const byRoute = new Map<string, L[]>();
  const orphans: L[] = [];
  const give = (saveId: string, l: L) => { const a = byRoute.get(saveId); if (a) a.push(l); else byRoute.set(saveId, [l]); };
  const posted = routes.map((r) => ({
    saveId: r.saveId,
    sets: r.sets.map((s) => ({ key: setKey(s), at: stampMs(s.completedAt) })),
  }));
  const nearest = (t: number): string | null => {
    let best: { saveId: string; gap: number } | null = null;
    for (const r of posted) for (const s of r.sets) {
      if (s.at == null) continue;
      const gap = Math.abs(s.at - t);
      if (gap <= SAME_SESSION_GRACE_MS && (!best || gap < best.gap)) best = { saveId: r.saveId, gap };
    }
    return best ? best.saveId : null;
  };
  for (const l of live) {
    const t = stampMs(l.completedAt);
    const key = setKey(l);
    if (t == null) { if (posted.length === 1) give(posted[0].saveId, l); else if (!l.removed) orphans.push(l); continue; }
    if (l.removed) {
      let holder: { saveId: string; at: number } | null = null;
      for (const r of posted) for (const s of r.sets) {
        if (s.key === key && s.at != null && s.at <= t + 1000 && (!holder || s.at > holder.at)) holder = { saveId: r.saveId, at: s.at };
      }
      const to = holder ? holder.saveId : nearest(t);
      if (to) give(to, l);
      continue;
    }
    const same = posted.find((r) => r.sets.some((s) => s.key === key && s.at != null && Math.abs(s.at - t) <= 1000));
    const to = same ? same.saveId : nearest(t);
    if (to) give(to, l);
    else if (!saved.some((k) => k.sets?.some((s) => s.key === key && s.at != null && Math.abs(s.at - t) <= 1000))) orphans.push(l);
  }
  return { byRoute, orphans };
}

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
 * Judged on the sets done WHEN THE ANSWER ARRIVES, not when it was asked:
 * a set ticked during the wait is in no saved workout, so it can never be
 * discarded as a ghost (adversary, 2026-10-02).
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

/**
 * The other device closed this session's row with a saved workout. What do
 * the sets ticked HERE do?
 *   handoff — they are that sitting's: post them under the same id (the
 *             server adds what the workout lacks) and follow it.
 *   new-id  — none is: a draft kept the id of a session finished another
 *             day. A new id; nothing is handed off.
 *   stay    — some are, some are not: stay on this screen. Handing off
 *             threw him to the old workout's page mid-session with today's
 *             tick saved as a one-set workout; Save sorts the sets by
 *             sitting on the server.
 */
export function closedRowVerdict<T extends Stamped>(row: SaveIdOwner, own: T[], dayOf: (d: Date) => string): 'handoff' | 'new-id' | 'stay' {
  if (!own.length) return 'handoff';
  const { same, other } = splitBySessionDay(row, own, dayOf);
  if (!other.length) return 'handoff';
  return same.length ? 'stay' : 'new-id';
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
export function gymSwitchFailure(f: { shown: string; wanted: string; wantedName: string; by: 'tap' | 'session'; tries: number }): { tag: string; retry: boolean; notice: string; blank: boolean } {
  if (f.by === 'tap') return { tag: f.shown, retry: false, notice: `${f.wantedName} did not load · tap again`, blank: false };
  const retry = f.tries < 3;
  // The tag stays on the session's building while the prefills on screen
  // are another's: a set must never be saved under a tag with the other
  // building's number in it (rule 2). The prefilled weights of machines
  // not yet started are blanked until the load lands — he types what he
  // lifts, or taps the gym again to retry (adversary, 2026-10-02).
  return {
    tag: f.wanted,
    retry,
    notice: retry ? `${f.wantedName} numbers did not load · retrying` : `${f.wantedName} numbers did not load · tap it to retry`,
    blank: f.shown !== f.wanted,
  };
}
