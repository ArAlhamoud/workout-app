'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createWorkout, getGymMemory, getRecentExerciseSessions } from '@/app/actions';
import RestTimer from './RestTimer';
import SessionClock from './SessionClock';
import { scaleReturnWeight, GYMS, DEFAULT_GYM_ID } from '@/lib/program';
import { gymSwap, gymWeightNote } from '@/lib/gym-equipment';
import { hapticTap, hapticSuccess, keepScreenAwake } from '@/lib/native-feedback';
import { endRestActivity } from '@/lib/native-live-activity';
import { durableGet, durableSet, durableRemove } from '@/lib/native-store';
import { enqueueSave, newClientSaveId } from '@/lib/outbox';
import { armGapGuard, clearComeback, rearmGapGuardFromServer } from '@/lib/gap-guard';
import { readReadiness } from '@/lib/health-metrics';
import type { ReadinessSignal } from '@/lib/coach';
import { captureWorkoutHr } from '@/lib/hr-capture';

interface Exercise {
  id: string;
  name: string;
  category: string;
}

interface InitialExercise {
  exerciseId: string;
  sets: number;
  defaultReps: number;
  name: string;
  machine?: string;
  cues?: string;
  youtubeUrl?: string;
  rest?: string;
  targetReps?: string;
  unit?: 'reps' | 'seconds';
}

interface SetEntry {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  done: boolean;
  notes: string;
  rpe: number;
  /** ISO instant the set was ticked done; cleared when it is un-ticked. */
  completedAt: string | null;
  /** Warm-up sets are logged but never counted in records or volume. */
  isWarmup?: boolean;
}

interface ExerciseBlock {
  uid: string;
  exerciseId: string;
  sets: SetEntry[];
  /** Program name — the key a per-gym equipment swap is looked up by. */
  programName?: string;
  machine?: string;
  cues?: string;
  youtubeUrl?: string;
  rest?: string;
  targetReps?: string;
  unit?: 'reps' | 'seconds';
  showCues: boolean;
  expandedNoteIdx: number | null;
  lastSession?: { weight: number; reps: number; rpe: number | null; overload?: boolean };
  /** Overload by default took one learned pin at seed time; tap undoes it. */
  overloadApplied?: { from: number; to: number };
}

const DRAFT_KEY = 'workout-draft';
const NOTES_KEY = 'exercise-notes';
const DEFAULT_PIN_INCREMENT = 2.5;

const inputCls =
  'w-full bg-app-surface2 border border-app-border rounded-card px-4 py-3 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-acc-teal/60 text-sm transition-colors';

import { rpeOptions } from '@/lib/effort-tokens';

function parseRestSeconds(rest: string): number {
  const m = rest.match(/(\d+)/);
  return m ? parseInt(m[1]) : 60;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}:00` : `${m}:${String(rem).padStart(2, '0')}`;
}

function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildBlocks(
  initialExercises: InitialExercise[],
  lastSession: Record<string, { weight: number; reps: number; rpe: number | null; overload?: boolean }>,
  returnLoadPct?: number,
  pinIncrements: Record<string, number> = {},
  deloadHints: Record<string, { weight: number; note: string }> = {},
  isRescue = false,
): ExerciseBlock[] {
  return initialExercises.map((ie, blockIdx) => {
    const prev = lastSession[ie.exerciseId];
    const isTimed = ie.unit === 'seconds';
    // Overload by default: two straight all-Easy sessions at this weight
    // already proved it light — the prefill takes one learned pin, and the
    // chip beside the exercise undoes it in a tap. Never during a ramp
    // (pre-scaled loads win) and never on top of a deload.
    const inc = pinIncrements[ie.exerciseId] ?? DEFAULT_PIN_INCREMENT;
    // Rescue is excluded explicitly: mid-ramp it arrives with returnLoadPct
    // deliberately unset, and the one day readiness says "shrink" must not
    // open machines a pin heavier (adversary).
    const overloadTo =
      !returnLoadPct && !isRescue && !isTimed && prev?.overload && prev.weight > 0 && prev.reps >= ie.defaultReps
        ? +(prev.weight + inc).toFixed(1)
        : null;
    // The prefill IS the instruction (that is why ramp weights pre-scale).
    // A deload rendered only as a chip beside a full-weight prefill loses to
    // the prefill every time — so a plateaued machine opens AT the deload
    // weight with half the sets, and building back is the explicit act.
    const deload = !returnLoadPct && !isTimed ? deloadHints[ie.exerciseId] : undefined;
    const seededWeight = deload ? null : overloadTo;
    const setCount = deload ? Math.max(1, Math.ceil(ie.sets / 2)) : ie.sets;
    return {
      // Deterministic, NOT Math.random(): buildBlocks runs during SSR and
      // again at hydration, and the id={`block-${uid}`} attribute made a
      // random uid a server/client mismatch — React recovers, but the
      // reconciliation flashed blank cards under the revamp (seen in the
      // merge audit). Client-only paths (add/swap) may stay random.
      uid: `b${blockIdx}-${ie.exerciseId}`,
      exerciseId: ie.exerciseId,
      programName: ie.name,
      machine: ie.machine,
      cues: ie.cues,
      youtubeUrl: ie.youtubeUrl,
      rest: ie.rest,
      targetReps: ie.targetReps,
      unit: ie.unit,
      showCues: false,
      expandedNoteIdx: null,
      lastSession: prev,
      overloadApplied: seededWeight && prev?.weight ? { from: prev.weight, to: seededWeight } : undefined,
      // One auto warm-up set on the first two machines of the session, at
      // ~55% of the working weight rounded DOWN to a real pin. Cold joints
      // meet the day's two heaviest compound movements first; later machines
      // arrive warm. Flagged so it never touches records, volume or plateaus.
      sets: [
        ...(blockIdx < 2 && !isTimed && prev?.weight
          ? (() => {
              const working = returnLoadPct
                ? scaleReturnWeight(prev.weight, returnLoadPct)
                : seededWeight ?? prev.weight;
              const warm = Math.max(inc, Math.floor((working * 0.55) / inc) * inc);
              return [{
                exerciseId: ie.exerciseId,
                setNumber: 0,
                reps: ie.defaultReps,
                weight: warm,
                done: false,
                notes: '',
                rpe: 0,
                completedAt: null,
                isWarmup: true,
              }];
            })()
          : []),
        ...Array.from({ length: setCount }, (_, i) => ({
        exerciseId: ie.exerciseId,
        setNumber: i + 1,
        // Last session's reps, same as weight on the line below. The template's
        // repsMin is only a floor; starting every set there means stepping up to
        // what you actually did, once per set, ~27 times a session.
        reps: prev?.reps ?? ie.defaultReps,
        weight: isTimed
          ? 0
          : deload
            ? deload.weight
            : prev?.weight
              ? (returnLoadPct
                  ? scaleReturnWeight(prev.weight, returnLoadPct)
                  : seededWeight ?? prev.weight)
              : 0,
        done: false,
        notes: '',
        rpe: 0,
        completedAt: null,
      })),
      ],
    };
  });
}

export default function WorkoutForm({
  exercises,
  initialName = '',
  initialExercises = [],
  lastSession = {} as Record<string, { weight: number; reps: number; rpe: number | null; overload?: boolean }>,
  personalRecords = {},
  progressionHints = {},
  returnLoadPct,
  returnRpeCap,
  pinIncrements = {},
  repRecords = {},
  deloadHints = {},
  rescueMode = false,
  dayAccent,
  healthWorkoutUuid,
  initialDate,
  detectedDurationMin,
  detectedStartISO,
}: {
  exercises: Exercise[];
  initialName?: string;
  initialExercises?: InitialExercise[];
  lastSession?: Record<string, { weight: number; reps: number; rpe: number | null; overload?: boolean }>;
  personalRecords?: Record<string, number>;
  progressionHints?: Record<string, boolean>;
  returnLoadPct?: number;
  returnRpeCap?: number;
  pinIncrements?: Record<string, number>;
  /** exerciseId → reps → best kg at this gym. Drives the rep-record toast. */
  repRecords?: Record<string, Record<number, number>>;
  /** exerciseId → plateau deload prescription, when detection fired. */
  deloadHints?: Record<string, { weight: number; note: string }>;
  /** 15-minute rescue session — compressed by construction. */
  rescueMode?: boolean;
  /** Presentation only — threads the Aurora day accent (A violet · B teal) through steppers. */
  dayAccent?: 'A' | 'B';
  /** Set when this log confirms a Watch/Health-detected session: stored on
   *  the workout so the detect list never offers the same HKWorkout again. */
  healthWorkoutUuid?: string;
  /** The detected session's local calendar day — seeds the date field. */
  initialDate?: string;
  /** The detected session's real length; overrides the form-open timer,
   *  which measures typing time, not training time, on a retro log. */
  detectedDurationMin?: number;
  /** The detected session's real start instant — the HR capture window
   *  must cover the TRAINING, not the minutes spent typing it in later
   *  (device-tester M2). */
  detectedStartISO?: string;
}) {
  const router = useRouter();
  const today = localTodayStr();
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(initialDate ?? today);
  const [gym, setGym] = useState(DEFAULT_GYM_ID);
  const [notes, setNotes] = useState('');
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() =>
    buildBlocks(initialExercises, lastSession, returnLoadPct, pinIncrements, deloadHints, rescueMode),
  );
  // Weight memory for the gym currently tagged. Seeded for the home gym by
  // the server; replaced wholesale when the tag changes.
  const [sessionMemory, setSessionMemory] = useState(lastSession);
  const [gymRecords, setGymRecords] = useState(personalRecords);
  const [repRecordsState, setRepRecordsState] = useState(repRecords);
  /** Health-derived read on today; 'hold' softens every push-harder cue. */
  const [readiness, setReadiness] = useState<ReadinessSignal | null>(null);
  /** Lazy per-exercise history for the ⓘ drawer, keyed by exerciseId. */
  const [recentSessions, setRecentSessions] = useState<
    Record<string, Array<{ date: string; topWeight: number; reps: number; rpe: number | null }>>
  >({});
  const [compressed, setCompressed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // nonce keys the <RestTimer> so a set ticked mid-rest REMOUNTS it (fresh
  // deadline, fresh Live Activity attributes) instead of reusing the old
  // instance with a stale countdown — the adversary's back-to-back case.
  const [restTimer, setRestTimer] = useState<{
    seconds: number;
    exerciseName: string;
    nonce: number;
    /** The set the capsule's effort pills rate — the one just ticked. */
    ratedUid: string;
    ratedIdx: number;
    /** The true next set, so 'Rest complete' names where you're going. */
    next: { blockUid: string; name: string; setLabel: string; weight: number; isTimed: boolean } | null;
  } | null>(null);
  const restNonce = useRef(0);
  const [initialized, setInitialized] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  /** Restored draft is >24 h old — worth an explicit look before continuing. */
  const [draftIsStale, setDraftIsStale] = useState(false);
  /** Save failed but the session is queued — it is NOT lost. */
  const [queuedOffline, setQueuedOffline] = useState(false);
  const startRef = useRef(Date.now());
  /** Idempotency key for this submission — survives retries, reset on clear. */
  const saveIdRef = useRef<string | null>(null);
  /** Last gym the memory refetch ran for — also synced by a draft restore. */
  const lastGymRef = useRef<string | null>(null);
  /** True once the user touches anything — gates the async vault restore. */
  const dirtyRef = useRef(false);
  const [autoTimer, setAutoTimer] = useState(true);
  const [prToast, setPrToast] = useState<string | null>(null);
  const [mood, setMood] = useState('');
  const [showSummary, setShowSummary] = useState<{
    sets: number; vol: number; prs: string[]; time: string;
  } | null>(null);
  const [swipedSet, setSwipedSet] = useState<{ uid: string; idx: number } | null>(null);
  const touchStartX = useRef(0);
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>({});
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  // Glance layer — per-block "ⓘ" detail row (target/rest/1RM/video/note) and
  // the return-protocol expander. Presentation state only.
  const [infoOpen, setInfoOpen] = useState<Record<string, boolean>>({});
  const [showReturnInfo, setShowReturnInfo] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsAutoClosed, setDetailsAutoClosed] = useState(false);

  function toggleInfo(uid: string) {
    setInfoOpen((prev) => {
      const opening = !prev[uid];
      if (opening) {
        const block = blocksRef.current.find((b) => b.uid === uid);
        if (block && !recentSessions[block.exerciseId]) {
          getRecentExerciseSessions(block.exerciseId, gym)
            .then((rows) =>
              setRecentSessions((cur) => ({ ...cur, [block.exerciseId]: rows })),
            )
            .catch(() => { /* the drawer just stays empty */ });
        }
      }
      return { ...prev, [uid]: opening };
    });
  }

  // One readiness read per form life. A 'hold' verdict quiets the try-more
  // suggestions and offers the rescue session instead — shrink, don't skip.
  useEffect(() => {
    let cancelled = false;
    readReadiness().then((r) => { if (!cancelled && r) setReadiness(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The readiness verdict lands AFTER the overload seeds were applied at
  // build time. On a red-recovery morning the app that quiets try-more
  // suggestions must not open machines a pin heavier — auto-revert every
  // untouched seed (done sets are logged facts; undoOverload skips them).
  useEffect(() => {
    if (readiness?.verdict !== 'hold') return;
    setBlocks((prev) =>
      prev.map((b) => {
        if (!b.overloadApplied) return b;
        const from = b.overloadApplied.from;
        const inc = pinIncrements[b.exerciseId] ?? DEFAULT_PIN_INCREMENT;
        const warm = Math.max(inc, Math.floor((from * 0.55) / inc) * inc);
        return {
          ...b,
          overloadApplied: undefined,
          sets: b.sets.map((st) => (st.done ? st : { ...st, weight: st.isWarmup ? warm : from })),
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readiness?.verdict]);

  // Load per-exercise machine notes after mount (avoids hydration mismatch)
  useEffect(() => {
    try { setExerciseNotes(JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')); } catch { /* ignore */ }
  }, []);

  // Hold the screen on for the whole session: the phone sits on a bench
  // between sets, and auto-lock mid-workout means unlocking with chalky hands
  // to log every set. Released on unmount so it can never leak past the form.
  useEffect(() => {
    keepScreenAwake(true);
    // Leaving the logger with a rest up (saved and navigated, back button)
    // is the one unmount the timer's own lifecycle can't see.
    return () => {
      keepScreenAwake(false);
      endRestActivity();
    };
  }, []);

  // Restore draft on mount. localStorage is the fast path; the durable vault
  // (native UserDefaults) is the copy that survives WKWebView storage
  // eviction — checked only when localStorage came up empty.
  //
  // NEVER when confirming a detected session (adversary C2): restoring an
  // abandoned Tuesday draft over a Thursday Watch session would save
  // Tuesday's junk sets under Thursday's HKWorkout uuid — and that uuid
  // then suppresses the real session from the detect list forever. The
  // draft stays in the vault for the next plain open.
  useEffect(() => {
    if (healthWorkoutUuid) return;
    const applyDraft = (draft: {
      name?: string; date?: string; notes?: string; gym?: string;
      blocks?: unknown; startTime?: number; savedAt?: number;
    }): boolean => {
      if (!Array.isArray(draft.blocks) || draft.blocks.length === 0) return false;
      const age = Date.now() - (draft.savedAt ?? 0);
      // An old draft is a real session that got interrupted — sickness, a
      // dead phone. It used to be silently deleted at 24 h, which threw away
      // ticked sets with real completedAt stamps. Now it restores with a
      // prompt; discarding is his tap, never the app's.
      setName(draft.name ?? initialName);
      setDate(draft.date ?? today);
      setNotes(draft.notes ?? '');
      // Sync the ref too, or the gym-change effect reads the restore as a
      // switch and refetches weights over the draft's own numbers.
      if (draft.gym) { lastGymRef.current = draft.gym; setGym(draft.gym); }
      setBlocks(draft.blocks as ExerciseBlock[]);
      if (draft.startTime) startRef.current = draft.startTime;
      setDraftRestored(true);
      setDraftIsStale(age > 24 * 60 * 60 * 1000);
      return true;
    };

    let restored = false;
    if (rescueMode) { setInitialized(true); return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) restored = applyDraft(JSON.parse(raw));
      if (!restored && raw) localStorage.removeItem(DRAFT_KEY);
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }

    if (restored) {
      setInitialized(true);
    } else {
      // The autosave gate stays CLOSED until the vault check settles — were
      // it open, the first autosave would write the pristine template over
      // the vault copy before the async read could restore it.
      void durableGet(DRAFT_KEY)
        .then((vaulted) => {
          if (!vaulted) return;
          // The vault read lost a race against the user: they already
          // started typing. Their live keystrokes outrank a stored copy.
          if (dirtyRef.current) return;
          try {
            applyDraft(JSON.parse(vaulted));
          } catch { /* a corrupt vault copy restores nothing */ }
        })
        .finally(() => setInitialized(true));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any form-state change after mount marks the form dirty — the signal the
  // async vault restore checks so it never overwrites live keystrokes.
  const firstChangeRef = useRef(true);
  useEffect(() => {
    if (firstChangeRef.current) { firstChangeRef.current = false; return; }
    dirtyRef.current = true;
  }, [name, date, gym, notes, blocks]);

  // Auto-save draft, debounced. The old per-keystroke version did a full
  // JSON.stringify of every block plus a synchronous localStorage write and
  // an awaited bridge hop ON EVERY DIGIT — the "keyboard lags the thumb"
  // path. The pending draft sits in a ref as an object (no stringify until
  // flush); worst-case loss on a hard crash is ≤500 ms of typing, and the
  // pagehide/hidden flush below covers backgrounding, which is how sessions
  // actually end on a phone.
  const pendingDraftRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!initialized) return;
    // Rescue sessions are draft-free: merely opening the rescue screen from
    // a notification and backing out must not leave a 60% "Rescue" draft
    // that tomorrow's normal logger restores (adversary).
    if (rescueMode) return;
    pendingDraftRef.current = { savedAt: Date.now(), name, date, gym, notes, blocks, startTime: startRef.current };
    const t = setTimeout(() => {
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (draft) void durableSet(DRAFT_KEY, JSON.stringify(draft));
    }, 500);
    return () => clearTimeout(t);
  }, [initialized, rescueMode, name, date, gym, notes, blocks]);
  // NOTE the real contract here: React runs unmount cleanups in DECLARATION
  // order, so the debounce effect's clearTimeout runs FIRST. The flush below
  // still works because clearTimeout never nulls pendingDraftRef — which
  // means the debounce cleanup MUST NEVER null the ref, or flush-on-unmount
  // dies silently. (An earlier comment claimed reverse order; adversary F4.)
  useEffect(() => {
    const flush = () => {
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (draft) void durableSet(DRAFT_KEY, JSON.stringify(draft));
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, []);

  // Switching gyms mid-setup invalidates every prefilled number: the machine
  // is different, and at Alrajhi Tower the stack is labelled in pounds. Pull
  // that gym's own memory instead of carrying B_Fit's weights across.
  // Blocks with a completed set are left alone — those are logged facts.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  useEffect(() => {
    if (!initialized) return;
    if (lastGymRef.current === null) { lastGymRef.current = gym; return; }
    if (lastGymRef.current === gym) return;
    lastGymRef.current = gym;

    const ids = Array.from(new Set(blocksRef.current.map((b) => b.exerciseId)));
    if (!ids.length) return;
    let cancelled = false;
    // ONE round trip for all three memories — three separate POSTs used to
    // race from gym LTE to us-east-1, and the prefill waited on the slowest.
    getGymMemory(ids, gym)
      .then(({ lastSession: next, personalRecords, repRecords }) => {
        if (cancelled) return;
        setGymRecords(personalRecords);
        setRepRecordsState(repRecords);
        setSessionMemory(next);
        setBlocks((prev) =>
          prev.map((b) => {
            const prevSession = next[b.exerciseId];
            // overloadApplied dies with the switch: its undo held the OTHER
            // building's weight, and pressing it after a switch would write
            // a B_Fit number into an Alrajhi machine (trainer, rule 2).
            if (b.sets.some((s) => s.done)) return { ...b, lastSession: prevSession, overloadApplied: undefined };
            const isTimed = b.unit === 'seconds';
            const working = prevSession?.weight
              ? (returnLoadPct ? scaleReturnWeight(prevSession.weight, returnLoadPct) : prevSession.weight)
              : 0;
            // The warm-up stays a warm-up across a gym switch: 55% floored
            // to a pin — mapping it to the other gym's FULL working weight
            // made the cold first set the heaviest of the day (adversary).
            const inc = pinIncrements[b.exerciseId] ?? DEFAULT_PIN_INCREMENT;
            const warm = working > 0 ? Math.max(inc, Math.floor((working * 0.55) / inc) * inc) : 0;
            return {
              ...b,
              lastSession: prevSession,
              overloadApplied: undefined,
              sets: b.sets.map((s) => ({
                ...s,
                weight: isTimed ? 0 : s.isWarmup ? warm : working,
              })),
            };
          }),
        );
        // 6: the ⓘ drawer cache is B_Fit numbers — poison at another gym.
        setRecentSessions({});
      })
      .catch(() => { /* keep the current numbers (and badges) rather than blanking the form */ });
    return () => { cancelled = true; };
  }, [gym, initialized, returnLoadPct, pinIncrements]);

  // Auto-dismiss draft restored banner after 4s
  useEffect(() => {
    if (!draftRestored) return;
    const t = setTimeout(() => setDraftRestored(false), 4000);
    return () => clearTimeout(t);
  }, [draftRestored]);

  // Auto-dismiss PR toast
  useEffect(() => {
    if (!prToast) return;
    const t = setTimeout(() => setPrToast(null), 3000);
    return () => clearTimeout(t);
  }, [prToast]);

  /**
   * "I have 25 minutes." Keeps every machine but only its first not-yet-done
   * working set (done sets always survive; warm-ups drop — a short session
   * warms up on the first work set). One-way by design: un-compressing
   * mid-session would re-add sets whose rest you already banked.
   */
  function compressSession() {
    setRestTimer(null); // block/set indices all change; a live capsule would rate blind
    endRestActivity();
    hapticTap();
    setCompressed(true);
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.unit === 'seconds') return b;
        let keptWorking = false;
        return {
          ...b,
          rest: '60s',
          sets: b.sets.filter((s) => {
            if (s.done) return true;
            if (s.isWarmup) return false;
            if (!keptWorking) { keptWorking = true; return true; }
            return false;
          }),
        };
      }),
    );
  }

  function clearDraft() {
    // Disarm the debounced writer too: with a pending draft still in the
    // ref, the 500 ms timer or the unmount flush would write the draft BACK
    // after this removal (adversary F1 — the resurrected-ghost-draft race).
    pendingDraftRef.current = null;
    void durableRemove(DRAFT_KEY);
    setName(initialName);
    setDate(today);
    setGym(DEFAULT_GYM_ID);
    setNotes('');
    setBlocks(buildBlocks(initialExercises, lastSession, returnLoadPct, pinIncrements, deloadHints, rescueMode));
    startRef.current = Date.now();
    saveIdRef.current = null;
    setDraftRestored(false);
    setDraftIsStale(false);
  }

  // Stable across renders — these rebuilt on every render of a form that,
  // until tonight, re-rendered every second.
  const exerciseGroups = useMemo(
    () =>
      exercises.reduce<Record<string, Exercise[]>>((acc, ex) => {
        if (!acc[ex.category]) acc[ex.category] = [];
        acc[ex.category].push(ex);
        return acc;
      }, {}),
    [exercises],
  );
  const exerciseById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  /** Overload by default, reverted: working sets go back to the proven
   *  weight, the warm-up recomputes from it, the chip disappears. Sets
   *  already ticked are logged facts and stay exactly as logged. */
  function undoOverload(uid: string) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.uid !== uid || !b.overloadApplied) return b;
        const from = b.overloadApplied.from;
        const inc = pinIncrements[b.exerciseId] ?? DEFAULT_PIN_INCREMENT;
        const warm = Math.max(inc, Math.floor((from * 0.55) / inc) * inc);
        return {
          ...b,
          overloadApplied: undefined,
          sets: b.sets.map((st) =>
            st.done ? st : { ...st, weight: st.isWarmup ? warm : from },
          ),
        };
      }),
    );
  }

  function addExercise() {
    if (!exercises.length) return;
    setBlocks((prev) => [
      ...prev,
      {
        uid: Math.random().toString(36).slice(2),
        exerciseId: exercises[0].id,
        showCues: false,
        expandedNoteIdx: null,
        sets: [{ exerciseId: exercises[0].id, setNumber: 1, reps: 10, weight: 0, done: false, notes: '', rpe: 0, completedAt: null }],
      },
    ]);
  }

  function removeBlock(uid: string) {
    setBlocks((prev) => prev.filter((b) => b.uid !== uid));
  }

  function updateBlockExercise(uid: string, exerciseId: string) {
    // sessionMemory, not the prop: the prop is seeded for the home gym, so
    // swapping an exercise while tagged to Alrajhi would prefill a B_Fit
    // weight off a different machine.
    const prev = sessionMemory[exerciseId];
    setBlocks((cur) =>
      cur.map((b) =>
        b.uid === uid
          ? {
              ...b,
              exerciseId,
              // Equipment metadata belongs to the exercise that was here, not
              // the one replacing it. Left behind, a Chest Press → Pec Fly swap
              // would keep showing the chest press machine and, at Alrajhi,
              // apply the chest press swap instead of the cable-fly cues.
              // The chip dies with the swap: its undo held the PREVIOUS
              // machine's weight, and pressing it after a swap would write
              // Chest Press kilos into Pec Fly rows — then a fake PR on save
              // (adversary; same class as the gym-switch leak).
              overloadApplied: undefined,
              programName: undefined,
              machine: undefined,
              cues: undefined,
              rest: undefined,
              targetReps: undefined,
              unit: undefined,
              showCues: false,
              expandedNoteIdx: null,
              lastSession: prev,
              sets: b.sets.map((s) => ({ ...s, exerciseId, weight: prev?.weight ?? 0 })),
            }
          : b,
      ),
    );
  }

  function toggleCues(uid: string) {
    setBlocks((prev) =>
      prev.map((b) => (b.uid === uid ? { ...b, showCues: !b.showCues } : b)),
    );
  }

  function toggleNoteIdx(uid: string, idx: number) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? { ...b, expandedNoteIdx: b.expandedNoteIdx === idx ? null : idx }
          : b,
      ),
    );
  }

  function toggleSetDone(uid: string, idx: number) {
    const now = new Date().toISOString();
    setBlocks((prev) => {
      const updated = prev.map((b) =>
        b.uid === uid
          ? {
              ...b,
              sets: b.sets.map((s, i) =>
                // Stamp the moment the set was ticked; un-ticking clears it so
                // a mis-tap never leaves a bogus time on the record.
                i === idx ? { ...s, done: !s.done, completedAt: s.done ? null : now } : s,
              ),
            }
          : b,
      );
      const block = updated.find((b) => b.uid === uid)!;
      const set = block.sets[idx];
      if (set.done) {
        // Confirm the tap in the hand — you are usually not looking at the phone.
        hapticTap();
        const exName = exerciseById.get(block.exerciseId)?.name ?? 'exercise';
        if (autoTimer) {
          const restSecs = block.rest ? parseRestSeconds(block.rest) : 90;
          // The true next set: the rest of THIS block first, then the first
          // undone set of any later block. Computed from the just-updated
          // state, so "Next" never names the set that was just ticked —
          // the wrong-copy defect the old "Next set of X" line shipped.
          const here = updated.findIndex((b) => b.uid === uid);
          let next: { blockUid: string; name: string; setLabel: string; weight: number; isTimed: boolean } | null = null;
          // Full wrap, not a forward scan: he trains out of order (skips a
          // busy machine, comes back), and a forward-only scan would call
          // "all done" with sets still waiting ABOVE the current block —
          // the editor caught that lie before it shipped. Scan order:
          // rest of this block, later blocks, earlier blocks, then the
          // skipped-over earlier sets of this block.
          const scanOrder: Array<[number, number]> = [];
          for (let si = idx + 1; si < updated[here].sets.length; si++) scanOrder.push([here, si]);
          for (let bi = here + 1; bi < updated.length; bi++)
            for (let si = 0; si < updated[bi].sets.length; si++) scanOrder.push([bi, si]);
          for (let bi = 0; bi < here; bi++)
            for (let si = 0; si < updated[bi].sets.length; si++) scanOrder.push([bi, si]);
          for (let si = 0; si < idx; si++) scanOrder.push([here, si]);
          for (const [bi, si] of scanOrder) {
            const cand = updated[bi];
            const st = cand.sets[si];
            if (st.done) continue;
            next = {
              blockUid: cand.uid,
              name: exerciseById.get(cand.exerciseId)?.name ?? 'exercise',
              setLabel: st.isWarmup ? 'warm-up' : `set ${st.setNumber}`,
              weight: st.weight,
              isTimed: cand.unit === 'seconds',
            };
            break;
          }
          restNonce.current += 1;
          setRestTimer({
            seconds: restSecs,
            exerciseName: exName,
            nonce: restNonce.current,
            ratedUid: uid,
            ratedIdx: idx,
            next,
          });
        }
        // Two record ladders, checked in order of glory. All-time heaviest
        // first; else the per-rep-count record (Hevy's insight) — on a
        // 12–15-rep pin program, "9 reps where 8 was the best" is the usual
        // form of progress and used to pass in silence. Warm-ups never count.
        if (!block.unit && !set.isWarmup && set.weight > 0) {
          const currentPR = gymRecords[block.exerciseId] ?? 0;
          const repBest = repRecordsState[block.exerciseId]?.[set.reps] ?? 0;
          if (set.weight > currentPR) {
            setPrToast(`${exName} — all-time record`);
          } else if (set.reps > 0 && set.weight > repBest) {
            setPrToast(`${exName} — best ${set.reps}-rep set: ${set.weight} kg`);
          }
        }
      }
      return updated;
    });
  }

  function addSet(uid: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? {
              ...b,
              sets: [
                ...b.sets,
                {
                  exerciseId: b.exerciseId,
                  setNumber: b.sets.length + 1,
                  reps: b.sets.at(-1)?.reps ?? 10,
                  weight: b.sets.at(-1)?.weight ?? 0,
                  done: false,
                  notes: '',
                  rpe: 0,
                  completedAt: null,
                },
              ],
            }
          : b,
      ),
    );
  }

  function removeSet(uid: string, idx: number) {
    // The capsule rates by position; removing a set below the rated one
    // shifts every index. Re-point the address — or disarm the pills when
    // the rated set itself goes — so a mid-rest delete can never land an
    // "Easy" on a set that was never performed (adversary, corrupts-data).
    setRestTimer((rt) => {
      if (!rt || rt.ratedUid !== uid || rt.ratedIdx < 0) return rt;
      if (idx === rt.ratedIdx) return { ...rt, ratedIdx: -1 };
      if (idx < rt.ratedIdx) return { ...rt, ratedIdx: rt.ratedIdx - 1 };
      return rt;
    });
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? {
              ...b,
              sets: b.sets
                .filter((_, i) => i !== idx)
                .map((s, i) => ({ ...s, setNumber: i + 1 })),
            }
          : b,
      ),
    );
  }

  function updateSet(uid: string, idx: number, field: 'reps' | 'weight', value: number) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? { ...b, sets: b.sets.map((s, i) => (i === idx ? { ...s, [field]: value } : s)) }
          : b,
      ),
    );
  }

  // Step the weight by the exercise's pin increment. Stepping from an empty
  // (zero) weight jumps to the last-session weight when known — scaled during
  // the return protocol, same as the pre-fill — else to one pin increment.
  function stepWeight(block: ExerciseBlock, idx: number, dir: 1 | -1) {
    const inc = pinIncrements[block.exerciseId] ?? DEFAULT_PIN_INCREMENT;
    const cur = block.sets[idx].weight;
    const next =
      cur > 0
        ? Math.max(0, +(cur + dir * inc).toFixed(2))
        : block.lastSession?.weight
          ? (returnLoadPct
              ? scaleReturnWeight(block.lastSession.weight, returnLoadPct)
              : block.lastSession.weight)
          : inc;
    updateSet(block.uid, idx, 'weight', next);
  }

  function updateSetNote(uid: string, idx: number, note: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? { ...b, sets: b.sets.map((s, i) => (i === idx ? { ...s, notes: note } : s)) }
          : b,
      ),
    );
  }

  function fillDown(uid: string) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.uid !== uid) return b;
        const firstUndoneWeight = b.sets.find((s) => !s.done)?.weight ?? 0;
        if (!firstUndoneWeight) return b;
        return { ...b, sets: b.sets.map((s) => (s.done ? s : { ...s, weight: firstUndoneWeight })) };
      }),
    );
  }

  function saveExerciseNote(exerciseId: string, note: string) {
    const updated = { ...exerciseNotes, [exerciseId]: note };
    if (!note.trim()) delete updated[exerciseId];
    setExerciseNotes(updated);
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  }

  function updateSetRpe(uid: string, idx: number, value: number) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? { ...b, sets: b.sets.map((s, i) => (i === idx ? { ...s, rpe: value } : s)) }
          : b,
      ),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Workout name is required'); return; }
    if (!blocks.length) { setError('Add at least one exercise'); return; }

    // If any set is ticked done, save only done sets; otherwise the user
    // forgot to tick — save every non-empty set so nothing is lost.
    const anyDone = blocks.some((b) => b.sets.some((s) => s.done));
    const isEmpty = (b: ExerciseBlock, s: SetEntry) =>
      b.unit === 'seconds' ? s.reps <= 0 : s.weight <= 0 && s.reps <= 0;
    const submitBlocks = blocks.map((b) => ({
      block: b,
      sets: b.sets.filter((s) => (anyDone ? s.done : !isEmpty(b, s))),
    }));
    const setsToSave = submitBlocks.flatMap(({ sets }) =>
      sets.map(({ done: _d, notes: sn, rpe: r, completedAt: at, ...rest }, i) => ({
        ...rest,
        setNumber: i + 1,
        notes: sn || undefined,
        rpe: r || undefined,
        // Untouched sets (and drafts saved before this existed) carry no stamp.
        completedAt: at ?? undefined,
      })),
    );
    if (!setsToSave.length) { setError('Log at least one set'); return; }

    const vol = Math.round(setsToSave.reduce((sum, s) => sum + (s.isWarmup ? 0 : s.weight * s.reps), 0));
    const prs = submitBlocks
      .filter(({ block: b, sets }) => !b.unit && sets.some((s) => !s.isWarmup && s.weight > (gymRecords[b.exerciseId] ?? 0)))
      .map(({ block: b }) => exerciseById.get(b.exerciseId)?.name ?? '')
      .filter(Boolean);

    setShowSummary({ sets: setsToSave.length, vol, prs, time: formatElapsed(Math.floor((Date.now() - startRef.current) / 1000)) });
    setSubmitting(true);

    const fullNotes = [mood ? `Feeling ${mood}` : '', notes.trim()].filter(Boolean).join(' · ');
    // One id per submission attempt, held across retries in the same form
    // life: if the first try lands server-side but times out client-side, the
    // retry (or the outbox replay) dedupes into the same workout.
    if (!saveIdRef.current) saveIdRef.current = newClientSaveId();
    const payload = {
      name: name.trim(),
      date: date || localTodayStr(),
      gym,
      notes: fullNotes || undefined,
      duration: Math.floor((Date.now() - startRef.current) / 1000),
      clientSaveId: saveIdRef.current,
      healthWorkoutUuid,
      sets: setsToSave,
    };
    // A restored multi-day draft carries an ancient startRef; without a clamp
    // the HR capture would bin DAYS of background heart rate onto one workout
    // and the duration would read as 50 hours. 3 h matches the server's cap.
    const sessionStart = Math.max(startRef.current, Date.now() - 3 * 3_600_000);
    payload.duration = detectedDurationMin
      ? detectedDurationMin * 60
      : Math.floor((Date.now() - sessionStart) / 1000);
    const startISO = detectedStartISO ?? new Date(sessionStart).toISOString();
    try {
      const { id, deduped } = await createWorkout(payload);
      if (deduped) {
        // This clientSaveId already landed — the outbox flushed it in the
        // background. The CURRENT form contents were NOT saved; pretending
        // otherwise would swallow them. Fresh id so a deliberate re-save
        // creates a real workout.
        saveIdRef.current = null;
        setSubmitting(false);
        setShowSummary(null);
        setError('This session already uploaded in the background. Tap Save again to log what’s on screen as a new workout.');
        return;
      }
      // Only clear the draft once the save has actually succeeded — and
      // disarm the debounced writer, or a save landing inside the 500 ms
      // window gets resurrected as a ghost draft by the still-armed flush;
      // re-saving that ghost would mint a DUPLICATE workout under a fresh
      // clientSaveId (adversary F1, corrupts-data class).
      pendingDraftRef.current = null;
      void durableRemove(DRAFT_KEY);
      // Fire-and-forget: pull the session's real HR curve off the Watch data
      // and re-arm Gap Guard from today. Neither may delay navigation.
      captureWorkoutHr(
        id,
        startISO,
        detectedStartISO && detectedDurationMin
          ? new Date(new Date(detectedStartISO).getTime() + detectedDurationMin * 60_000).toISOString()
          : new Date().toISOString(),
      );
      void rearmGapGuardFromServer(new Date().toISOString());
      clearComeback();
      hapticSuccess();
      router.push(`/workouts/${id}?new=1`);
    } catch {
      // The session is not lost — queue it durably and say so. The outbox
      // replays on network restore and on every app open; clientSaveId makes
      // a replay of a save that secretly landed a no-op.
      try {
        await enqueueSave(payload);
        // The queued session is owned SOLELY by the outbox now. Reset the
        // form completely: a live copy of already-queued sets would be
        // re-autosaved as a draft on the next keystroke, restore tomorrow,
        // and double-log with a fresh id (review finding, corrupts-data).
        clearDraft();
        armGapGuard(new Date().toISOString(), null);
        clearComeback();
        setQueuedOffline(true);
        setSubmitting(false);
        setShowSummary(null);
        hapticSuccess();
      } catch {
        // Even the durable queue failed — keep the draft, tell the truth.
        setError('Failed to save. Your sets are still in the draft — try again.');
        setSubmitting(false);
        setShowSummary(null);
      }
    }
  }

  const doneCount = blocks.reduce((n, b) => n + b.sets.filter((s) => s.done).length, 0);

  // Fold the admin card away the first time a set is ticked — from then on the
  // screen is about lifting, not metadata. Once only: reopening it is a
  // deliberate tap that must not be undone by the next set.
  useEffect(() => {
    if (!detailsAutoClosed && doneCount > 0) {
      setDetailsOpen(false);
      setDetailsAutoClosed(true);
    }
  }, [doneCount, detailsAutoClosed]);
  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);

  // Aurora day accent — Day A glows violet, Day B (and freestyle) teal.
  const violetDay = dayAccent === 'A';
  const stepAccent = violetDay
    ? 'volt-stepbtn text-acc-violet active:bg-acc-violet-deep/20'
    : 'volt-stepbtn text-acc-teal active:bg-acc-teal-deep/20';
  const stepperShell = `volt-step flex items-center min-w-0 h-12 bg-app-surface2 border border-app-border rounded-xl overflow-hidden transition-colors ${
    violetDay ? 'focus-within:border-acc-violet/50' : 'focus-within:border-acc-teal/50'
  }`;
  const currentSetRing = violetDay
    ? 'bg-app-surface2 border-2 border-acc-violet/70 text-app-tx1 shadow-glow-violet'
    : 'bg-app-surface2 border-2 border-acc-teal/70 text-app-tx1 shadow-glow-teal';

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Session queued offline — the save is safe, not lost */}
        {queuedOffline && (
          <div className="card rounded-card border-acc-teal/40 px-4 py-3">
            <p className="text-acc-teal text-sm font-semibold">✓ Saved on this phone</p>
            <p className="text-app-tx2 text-xs mt-0.5">
              No connection right now — it uploads by itself when signal returns.
            </p>
          </div>
        )}

        {/* Readiness hold — shrink, don't skip */}
        {readiness?.verdict === 'hold' && !rescueMode && (
          <div className="card rounded-card border-acc-ember/40 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-acc-ember text-sm font-semibold">Recovery is low — hold weights today</p>
              {readiness.note && <p className="text-app-tx3 text-xs mt-0.5 truncate">{readiness.note}</p>}
            </div>
            <Link
              href="/workouts/new?rescue=1"
              className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-card bg-acc-ember/10 border border-acc-ember/40 text-acc-ember"
            >
              15-min rescue
            </Link>
          </div>
        )}

        {/* One tap shrinks the session — a short session beats a skipped one */}
        {!compressed && !rescueMode && blocks.length > 1 && (
          <button
            type="button"
            onClick={compressSession}
            className="w-full card rounded-card px-4 py-2.5 text-left text-xs text-app-tx2 hover:border-app-border-hi transition-colors"
          >
            ⏱ Short on time? <span className="text-app-tx3">One tap keeps every machine, first set only.</span>
          </button>
        )}
        {compressed && (
          <p className="text-app-tx3 text-[11px] px-1">Compressed — one working set per machine · 60s rests.</p>
        )}

        {/* Draft restored notice */}
        {draftRestored && (
          <div className="card rounded-card border-acc-teal/30 px-4 py-3 flex items-center justify-between">
            <span className="text-acc-teal text-sm">
              {draftIsStale ? '↩ Old session restored — still yours to keep' : '↩ Workout restored'}
            </span>
            <button
              type="button"
              onClick={clearDraft}
              className="text-acc-teal text-xs font-semibold hover:text-[#ccfbf1] transition-colors py-2 -my-2 px-2 -mx-2"
            >
              Start fresh
            </button>
          </div>
        )}

        {/* Workout details — collapses once lifting starts. Name, date, notes,
            gym and mood are answered before set 1 and re-read almost never, but
            they occupied a full screen between the header and exercise 1. The
            header row (with the session clock and rest toggle) always stays. */}
        <div className="card-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex items-center gap-1.5 -m-1 p-1"
              aria-expanded={detailsOpen}
            >
              <span className="section-label">Workout Details</span>
              <span className={`text-[9px] text-app-tx3 transition-transform duration-200 ${detailsOpen ? 'rotate-180' : ''}`}>
                &#9660;
              </span>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoTimer((v) => !v)}
                title="Toggle auto rest timer"
                className={`text-[10px] px-3 py-1.5 rounded-full border transition-colors ${
                  autoTimer ? 'border-acc-teal/50 bg-acc-teal/10 text-acc-teal' : 'border-app-border text-app-tx3'
                }`}
              >
                ⏱ rest
              </button>
              {/* Labelled because it sits next to the "rest" toggle and was
                  being read as rest time — it is the whole session's clock.
                  A child on purpose: its 1 Hz tick must not re-render the
                  form (see SessionClock.tsx). */}
              <SessionClock startedAt={startRef.current} />
            </div>
          </div>
          {detailsOpen && (
            <>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Day A — Apr 15"
            className={inputCls}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className={inputCls}
            />
          </div>

          {/* Which gym — weights are only comparable within one building */}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${GYMS.length}, minmax(0, 1fr))` }}>
            {GYMS.map((g) => {
              const active = g.id === gym;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGym(g.id)}
                  aria-pressed={active}
                  className={`pressable min-h-[44px] rounded-card border px-3 py-2 text-sm font-semibold transition-all ${
                    active
                      ? 'border-acc-teal/60 bg-gradient-to-br from-acc-teal/20 to-acc-teal-deep/10 text-acc-teal shadow-[0_0_18px_-5px_rgba(45,212,191,0.6)]'
                      : 'border-app-border bg-ink/[0.04] text-app-tx2 hover:border-app-border-hi hover:text-app-tx1'
                  }`}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
          {gymWeightNote(gym) && (
            <p className="text-acc-ember/80 text-[11px] leading-relaxed -mt-1">
              {gymWeightNote(gym)}
            </p>
          )}
          {/* First time at the work gym: no per-gym history means blank pins
              on unfamiliar machines. The coach can translate B_Fit strength
              into conservative starting guidance — chat text only, never a
              prefill, so nothing touches per-gym weight memory. */}
          {gym !== DEFAULT_GYM_ID && Object.keys(gymRecords).length === 0 && (
            <a
              href={`/coach?q=${encodeURIComponent('Plan my first Alrajhi Tower session.')}`}
              className="-mt-1 block text-[11px] font-semibold text-acc-cyan"
            >
              First time here? Ask the coach for starting pins →
            </a>
          )}
          <div>
            <p className="text-app-tx3 text-xs mb-1.5">How do you feel?</p>
            <div className="flex gap-2">
              {(['😴', '🙂', '💪', '🔥'] as const).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setMood(mood === emoji ? '' : emoji)}
                  className={`flex-1 h-11 rounded-card border text-base transition-all ${
                    mood === emoji
                      ? 'border-acc-teal/60 bg-acc-teal/10 shadow-glow-teal'
                      : 'border-app-border bg-app-surface2/60 text-app-tx2'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
            </>
          )}
        </div>

        {/* Progress bar */}
        {totalSets > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-app-surface2 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 bg-gradient-to-r from-acc-teal via-acc-cyan to-[#818cf8] shadow-[0_0_10px_rgba(45,212,191,0.7)]"
                style={{ width: `${(doneCount / totalSets) * 100}%` }}
              />
            </div>
            <span className="text-app-tx3 text-xs tabular-nums flex-shrink-0">
              {doneCount}/{totalSets}
            </span>
        </div>
        )}

        {/* Return protocol — coach directive, ember amber on glass */}
        {returnLoadPct && (
          <div className="card rounded-card border-acc-ember/25 relative overflow-hidden px-4 py-3.5">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(240px_120px_at_8%_0%,rgba(245,158,11,0.14),transparent_70%)]"
            />
            <div className="relative min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-acc-ember/90">
                  Return protocol ·{' '}
                  <span className="glow-amber font-round text-xs tracking-[0.05em] tabular-nums">
                    {returnLoadPct}%
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowReturnInfo((v) => !v)}
                  aria-expanded={showReturnInfo}
                  className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 flex-shrink-0 ${
                    showReturnInfo
                      ? 'bg-acc-ember/15 text-acc-ember border-acc-ember/40'
                      : 'bg-app-surface2 text-app-tx3 border-app-border hover:text-app-tx2'
                  }`}
                >
                  More
                  <span
                    aria-hidden
                    className={`inline-block transition-transform duration-200 ${showReturnInfo ? 'rotate-180' : ''}`}
                  >
                    ▾
                  </span>
                </button>
              </div>
              {/* Cap ladder — allowed effort lit, locked effort struck */}
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {rpeOptions.map(({ v, l, c }) => {
                  const cap = returnRpeCap ?? 2;
                  const locked = v > cap;
                  return (
                    <span
                      key={v}
                      className={`relative text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-1 rounded-full border ${
                        locked
                          ? 'bg-transparent border-ink/[0.07] text-[rgba(206,213,248,0.32)] line-through decoration-[rgba(206,213,248,0.4)]'
                          : c
                      }`}
                    >
                      {l}
                      {v === cap && (
                        <span className="absolute -top-2 -right-1.5 text-[7px] font-extrabold tracking-[0.12em] leading-none px-1 py-0.5 rounded bg-[#1a1206] border border-acc-ember/60 text-acc-ember no-underline">
                          CAP
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              {showReturnInfo && (
                <div className="mt-2.5">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-acc-ember/70">
                    Coach directive
                  </p>
                  <p className="glow-amber font-round font-bold text-sm uppercase tracking-[0.05em] mt-1">
                    We rebuild. We don&apos;t test.
                  </p>
                  <p className="text-app-tx2 text-xs mt-1 leading-relaxed">
                    Weights pre-set to{' '}
                    <span className="font-semibold text-acc-ember">{returnLoadPct}%</span> of pre-break.
                    Stop every set at{' '}
                    <span className="font-semibold text-acc-ember">
                      {['', 'Easy', 'Med', 'Hard', 'Grind'][returnRpeCap ?? 2]}
                    </span>
                    {' '}&mdash; past that, drop a pin. The ramp beats the number.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Exercise blocks */}
        {blocks.map((block, blockIdx) => {
          const ex = exerciseById.get(block.exerciseId);
          const isTimed = block.unit === 'seconds';
          const pr = ex ? (gymRecords[block.exerciseId] ?? 0) : 0;
          const hasNewPR = !isTimed && block.sets.some((s) => s.weight > 0 && s.weight > pr);
          const allDone = block.sets.length > 0 && block.sets.every((s) => s.done);

          const lastRpe = block.lastSession?.rpe ?? null;
          // While ramping back, the scaled target replaces the normal
          // progress/hold advice — that advice reads pre-break sessions.
          const returnTarget = returnLoadPct && !isTimed && block.lastSession?.weight
            ? scaleReturnWeight(block.lastSession.weight, returnLoadPct)
            : null;
          const deload = deloadHints[block.exerciseId];
          const readinessHold = readiness?.verdict === 'hold';
          const shouldHold =
            (!returnTarget && !isTimed && block.lastSession?.weight != null && lastRpe != null && lastRpe >= 3) ||
            readinessHold;
          const suggestWeight =
            !returnTarget && !isTimed && block.lastSession?.weight != null && !shouldHold && !deload &&
            !block.overloadApplied
              ? +(block.lastSession.weight + (lastRpe === 1 ? 5 : 2.5)).toFixed(1)
              : null;

          const est1RM = !isTimed
            ? block.sets.reduce((best, s) => Math.max(best, epley1RM(s.weight, s.reps)), 0)
            : 0;

          // Away from the home gym the movement is the same but the hardware
          // is not — five of these have no machine at Alrajhi at all and get
          // rebuilt on the crossover, so the cues and video must follow.
          const swap = gymSwap(block.programName ?? '', gym);
          const cues = swap?.cues ?? block.cues;
          const videoUrl = swap?.youtubeUrl ?? block.youtubeUrl;
          const machine = swap?.machine ?? block.machine;

          return (
            <div
              key={block.uid}
              id={`block-${block.uid}`}
              className={`card-lg scroll-mt-24 transition-all duration-300 ${
                allDone
                  ? 'bg-acc-teal/[0.05] border-acc-teal/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_0_44px_-14px_rgba(45,212,191,0.45)]'
                  : ''
              }`}
            >
              {/* Header — sticky so exercise name stays visible while scrolling through sets */}
              {/* top-0 parked this under the status bar, so the exercise name
                  sat behind the clock and the Dynamic Island while scrolling.
                  The page draws into the safe area by design, so the sticky
                  offset has to add it back. */}
              <div className={`sticky top-[env(safe-area-inset-top)] z-10 flex items-center gap-2 px-4 pt-4 pb-2 rounded-t-card-lg glass-overlay ${allDone ? 'bg-teal-950/70' : ''}`}>
                <span className="text-app-tx3 text-sm font-bold w-5 flex-shrink-0 tabular-nums">
                  {blockIdx + 1}
                </span>
                {/* Static, not a control. This was a full-width <select> over the
                    whole library: a stray thumb mid-set opened the iOS wheel, and
                    landing on another exercise ran updateBlockExercise, which
                    wipes machine, cues, target, rest and every prefilled weight in
                    the block. Swapping is deliberate now — it lives in the info
                    panel, behind a tap you meant to make. */}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-tx1">
                  {exerciseById.get(block.exerciseId)?.name ?? 'Exercise'}
                </span>
                <Link
                  href={`/progress/${block.exerciseId}`}
                  className="text-app-tx3 hover:text-acc-teal transition-colors text-base flex-shrink-0 w-8 h-11 flex items-center justify-center"
                  title="View progress"
                >
                  &#128200;
                </Link>
                <button
                  type="button"
                  onClick={() => removeBlock(block.uid)}
                  className="text-app-tx3 hover:text-red-400 transition-colors text-xl leading-none flex-shrink-0 w-8 h-11 flex items-center justify-center"
                >
                  &#215;
                </button>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
                {/* One actionable suggestion — return target while ramping, else hold/try */}
                {returnTarget && !allDone && (
                  <span className="text-xs bg-acc-ember/10 text-acc-ember px-2.5 py-1 rounded-full border border-acc-ember/30 font-medium tabular-nums shadow-[0_0_14px_-4px_rgba(245,158,11,0.6)]">
                    &#8595; Return {returnTarget} kg
                  </span>
                )}
                {shouldHold && !allDone && (
                  <span className="text-xs bg-rpe-hard/10 text-rpe-hard px-2.5 py-1 rounded-full border border-rpe-hard/30 font-medium">
                    &#9888; Hold
                  </span>
                )}
                {suggestWeight && !allDone && (
                  <span className="text-xs bg-rpe-easy/10 text-rpe-easy px-2.5 py-1 rounded-full border border-rpe-easy/30 font-medium tabular-nums">
                    &#8594; Try {suggestWeight} kg
                  </span>
                )}
                {block.overloadApplied && !allDone && (
                  <button
                    type="button"
                    onClick={() => undoOverload(block.uid)}
                    aria-label={`Undo the increase, back to ${block.overloadApplied.from} kg`}
                    className="pressable text-xs bg-rpe-easy/10 text-rpe-easy px-2.5 py-1 rounded-full border border-rpe-easy/30 font-medium tabular-nums"
                  >
                    +{+(block.overloadApplied.to - block.overloadApplied.from).toFixed(1)} kg &#183; 2&#215; Easy &#183; undo
                  </button>
                )}
                {deload && gym === DEFAULT_GYM_ID && !returnTarget && !allDone && (
                  <span className="text-xs bg-acc-ember/10 text-acc-ember px-2.5 py-1 rounded-full border border-acc-ember/40 font-medium">
                    {deload.note}
                  </span>
                )}
                {allDone && (
                  <span className="text-xs bg-acc-teal/15 text-acc-teal px-2.5 py-1 rounded-full border border-acc-teal/40 font-semibold shadow-[0_0_14px_-4px_rgba(45,212,191,0.7)]">
                    &#10003; Done
                  </span>
                )}
                {hasNewPR && !allDone && (
                  <span className="text-xs bg-acc-gold/10 text-acc-gold px-2.5 py-1 rounded-full border border-acc-gold/40 font-semibold shadow-[0_0_14px_-4px_rgba(250,204,21,0.7)]">
                    &#127942; PR
                  </span>
                )}
                {cues && (
                  <button
                    type="button"
                    onClick={() => toggleCues(block.uid)}
                    aria-expanded={block.showCues}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      block.showCues
                        ? 'bg-acc-teal/15 text-[#ccfbf1] border-acc-teal/40'
                        : 'bg-app-surface2 text-app-tx2 border-app-border hover:text-app-tx1'
                    }`}
                  >
                    ? Tip
                  </button>
                )}
                {/* Detail layer toggle — target/rest/1RM/video/machine note */}
                <button
                  type="button"
                  onClick={() => toggleInfo(block.uid)}
                  aria-expanded={!!infoOpen[block.uid]}
                  title="Exercise details"
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1 flex-shrink-0 ${
                    infoOpen[block.uid]
                      ? 'bg-acc-teal/15 text-[#ccfbf1] border-acc-teal/40'
                      : 'bg-app-surface2 text-app-tx3 border-app-border hover:text-app-tx2'
                  }`}
                >
                  ⓘ
                  <span
                    aria-hidden
                    className={`inline-block text-[9px] transition-transform duration-200 ${infoOpen[block.uid] ? 'rotate-180' : ''}`}
                  >
                    ▾
                  </span>
                </button>
              </div>

              {/* Detail layer — relocated glance-row chips, one tap away */}
              {infoOpen[block.uid] && (
                <div className="mx-4 mb-3 bg-ink/[0.03] border border-app-border rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap">
                  <label className="w-full text-[10px] font-bold uppercase tracking-[0.12em] text-app-tx3">
                    Swap exercise
                    <select
                      value={block.exerciseId}
                      onChange={(e) => updateBlockExercise(block.uid, e.target.value)}
                      className="mt-1 h-10 w-full min-w-0 rounded-card border border-app-border bg-app-surface2 px-3 text-sm font-normal normal-case tracking-normal text-app-tx1 transition-colors focus:border-acc-teal/60 focus:outline-none"
                    >
                      {Object.entries(exerciseGroups)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([cat, exs]) => (
                          <optgroup key={cat} label={cat}>
                            {exs.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                  </label>
                  {progressionHints[block.exerciseId] && !shouldHold && !allDone && (
                    <span className="text-xs bg-acc-teal/10 text-acc-teal px-2.5 py-1 rounded-full border border-acc-teal/30 font-medium">
                      ⬆ Ready to progress
                    </span>
                  )}
                  {block.targetReps && (
                    <span className="text-xs bg-app-surface2 text-app-tx2 px-2.5 py-1 rounded-full border border-app-border">
                      Target {block.targetReps}
                    </span>
                  )}
                  {block.rest && (
                    <span className="text-xs bg-app-surface2 text-app-tx2 px-2.5 py-1 rounded-full border border-app-border">
                      Rest {block.rest}
                    </span>
                  )}
                  {est1RM > 0 && !isTimed && (
                    <span className="text-xs bg-app-surface2 text-app-tx2 px-2.5 py-1 rounded-full border border-app-border tabular-nums">
                      ~{est1RM} kg 1RM
                    </span>
                  )}
                  {machine && (
                    <span className="text-xs bg-app-surface2 text-app-tx2 px-2.5 py-1 rounded-full border border-app-border">
                      {machine}
                    </span>
                  )}
                  {(recentSessions[block.exerciseId] ?? []).length > 0 && (
                    <span className="w-full text-[11px] text-app-tx3 tabular-nums">
                      {(recentSessions[block.exerciseId] ?? [])
                        .map((r) => `${r.date.slice(5).replace('-', '/')} · ${r.topWeight} kg × ${r.reps}${r.rpe ? ` · ${['','Easy','Med','Hard','Grind'][r.rpe]}` : ''}`)
                        .join('   ')}
                    </span>
                  )}
                  {videoUrl && (
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-full border bg-red-950/40 text-red-400 border-red-800/40 hover:bg-red-900/50 transition-colors flex-shrink-0"
                    >
                      ▶ Watch
                    </a>
                  )}
                  {/* Machine / equipment note */}
                  {editingNoteFor === block.exerciseId ? (
                    <input
                      autoFocus
                      type="text"
                      defaultValue={exerciseNotes[block.exerciseId] ?? ''}
                      onBlur={(e) => { saveExerciseNote(block.exerciseId, e.target.value); setEditingNoteFor(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingNoteFor(null); }}
                      placeholder="e.g. Seat 4, pin 8…"
                      className="text-xs bg-app-surface2 border border-acc-teal/60 rounded-full px-3 py-1.5 text-app-tx1 placeholder-app-tx3 focus:outline-none w-40"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingNoteFor(block.exerciseId)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                        exerciseNotes[block.exerciseId]
                          ? 'bg-app-primary-muted text-[#ccfbf1] border-acc-teal/30'
                          : 'bg-app-surface2 text-app-tx3 border-app-border hover:text-app-tx2'
                      }`}
                    >
                      {exerciseNotes[block.exerciseId] ? `⚙ ${exerciseNotes[block.exerciseId]}` : '⚙ note'}
                    </button>
                  )}
                </div>
              )}

              {/* Cues */}
              {block.showCues && cues && (
                <div className="mx-4 mb-3 bg-acc-teal/[0.07] border border-acc-teal/20 rounded-xl px-3.5 py-2.5">
                  <p className="text-[#ccfbf1] text-xs leading-relaxed">{cues}</p>
                </div>
              )}

              {/* Sets */}
              <div className="px-4 space-y-1.5 pb-1 pt-1">
                {block.sets.map((set, i) => {
                  const isCurrentSet = !set.done && block.sets.slice(0, i).every((s) => s.done);

                  const isSwipedOpen = !set.done && block.sets.length > 1 && swipedSet?.uid === block.uid && swipedSet?.idx === i;
                  return (
                    <div
                      key={i}
                      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                      onTouchEnd={(e) => {
                        const dx = touchStartX.current - e.changedTouches[0].clientX;
                        if (dx > 60 && !set.done && block.sets.length > 1) setSwipedSet({ uid: block.uid, idx: i });
                        else if (dx < -20) setSwipedSet(null);
                      }}
                    >
                      <div className={`relative overflow-hidden rounded-xl ${set.done ? 'opacity-40' : ''}`}>
                        {isSwipedOpen && (
                          <div className="absolute right-0 top-0 bottom-0 flex items-center z-10">
                            <button
                              type="button"
                              onClick={() => { removeSet(block.uid, i); setSwipedSet(null); }}
                              className="bg-red-600 h-full px-5 text-white font-bold text-xs rounded-r-xl"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                        <div className={`flex items-center gap-1.5 transition-transform duration-200 ${isSwipedOpen ? '-translate-x-16' : ''}`}>
                          <span className={`w-6 flex-shrink-0 text-center text-xs font-bold tabular-nums ${
                            set.done ? 'text-acc-teal' : 'text-app-tx3'
                          }`}>
                            {set.isWarmup ? 'W' : set.setNumber}
                          </span>

                          {isTimed ? (
                            <div className={`flex-1 ${stepperShell}`}>
                              <button
                                type="button"
                                onClick={() => updateSet(block.uid, i, 'reps', Math.max(5, set.reps - 5))}
                                className={`min-w-[44px] h-full px-2 flex items-center justify-center font-bold text-sm flex-shrink-0 select-none transition-colors ${stepAccent}`}
                              >
                                &#8722;5s
                              </button>
                              <span className="flex-1 min-w-0 text-app-tx1 text-base text-center tabular-nums font-semibold">
                                {formatSeconds(set.reps)}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateSet(block.uid, i, 'reps', set.reps + 5)}
                                className={`min-w-[44px] h-full px-2 flex items-center justify-center font-bold text-sm flex-shrink-0 select-none transition-colors ${stepAccent}`}
                              >
                                +5s
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className={`flex-[3] ${stepperShell}`}>
                                <button
                                  type="button"
                                  onClick={() => stepWeight(block, i, -1)}
                                  className={`w-9 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
                                >
                                  &#8722;
                                </button>
                                <input
                                  type="number"
                                  value={set.weight}
                                  min="0"
                                  step="any"
                                  inputMode="decimal"
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) =>
                                    updateSet(block.uid, i, 'weight', parseFloat(e.target.value) || 0)
                                  }
                                  className="flex-1 bg-transparent text-app-tx1 text-base font-semibold text-center focus:outline-none tabular-nums min-w-0 h-full"
                                />
                                <button
                                  type="button"
                                  onClick={() => stepWeight(block, i, 1)}
                                  className={`w-9 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
                                >
                                  +
                                </button>
                              </div>

                              {/* Reps shell: w-9 buttons + min-w-[30px] input, not w-11 +
                                  min-w-0 — at iPhone width the old math left ~12px for the
                                  value and the digits clipped to an invisible sliver
                                  (device-tester, Aug 5). */}
                              <div className={`flex-[2] ${stepperShell}`}>
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', Math.max(0, set.reps - 1))}
                                  className={`w-9 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
                                >
                                  &#8722;
                                </button>
                                <input
                                  type="number"
                                  value={set.reps}
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) =>
                                    updateSet(block.uid, i, 'reps', parseInt(e.target.value) || 0)
                                  }
                                  className="flex-1 bg-transparent text-app-tx1 text-base font-semibold text-center focus:outline-none tabular-nums min-w-[30px] h-full"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', set.reps + 1)}
                                  className={`w-9 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
                                >
                                  +
                                </button>
                              </div>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleSetDone(block.uid, i)}
                            className={`volt-done w-14 h-14 rounded-2xl flex items-center justify-center text-sm font-bold transition-all flex-shrink-0 active:scale-90 ${
                              set.done
                                ? 'bg-gradient-to-br from-acc-teal to-acc-teal-deep text-white shadow-glow-teal'
                                : set.isWarmup
                                ? 'bg-app-surface2 text-app-tx3 border border-dashed border-app-border active:bg-ink/5'
                                : isCurrentSet
                                ? currentSetRing
                                : 'bg-app-surface2 text-app-tx2 active:bg-ink/5'
                            }`}
                          >
                            {set.done ? '✓' : set.isWarmup ? 'W' : set.setNumber}
                          </button>

                        </div>
                      </div>

                      {/* RPE spectrum ladder after set is done. While the return
                          protocol is active the cap sits at Med: steps past the
                          cap render struck-through/unlit like locked switches —
                          visual only, they stay tappable. */}
                      {set.done && (
                        <div className="mt-1.5 pl-14 flex gap-1.5 pb-0.5">
                          {rpeOptions.map(({ v, l, c }) => {
                            const locked = returnRpeCap != null && v > returnRpeCap;
                            const isCap = returnRpeCap != null && v === returnRpeCap;
                            return (
                              <button
                                type="button"
                                key={v}
                                onClick={() => updateSetRpe(block.uid, i, set.rpe === v ? 0 : v)}
                                className={`volt-rpe relative text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                                  set.rpe === v
                                    ? c
                                    : locked
                                      ? 'bg-transparent border-ink/[0.07] text-[rgba(206,213,248,0.32)] line-through decoration-[rgba(206,213,248,0.4)]'
                                      : 'bg-app-surface2 border-app-border text-app-tx3'
                                }`}
                              >
                                {l}
                                {isCap && (
                                  <span className="absolute -top-2 -right-1.5 text-[7px] font-extrabold tracking-[0.12em] leading-none px-1 py-0.5 rounded bg-[#1a1206] border border-acc-ember/60 text-acc-ember no-underline">
                                    CAP
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          <span className="text-app-tx3 text-xs self-center">effort</span>
                        </div>
                      )}

                      {/* Inline note for this set */}
                      {block.expandedNoteIdx === i && (
                        <div className="mt-1.5 pl-14">
                          <input
                            type="text"
                            value={set.notes}
                            onChange={(e) => updateSetNote(block.uid, i, e.target.value)}
                            placeholder="Note for this set&#8230;"
                            className="w-full bg-app-surface2 border border-app-border rounded-lg px-3 py-2 text-app-tx1 text-xs placeholder-app-tx3 focus:outline-none focus:border-acc-teal/60 transition-colors"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add set + note toggle + fill-all row */}
              <div className="px-4 pb-3 pt-1 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => addSet(block.uid)}
                  className="text-xs text-acc-teal hover:text-[#ccfbf1] transition-colors font-semibold h-11 flex items-center"
                >
                  + Add set
                </button>
                <button
                  type="button"
                  onClick={() => toggleNoteIdx(block.uid, block.expandedNoteIdx !== null ? block.expandedNoteIdx : block.sets.length - 1)}
                  className="text-xs text-app-tx3 hover:text-app-tx2 transition-colors h-11 flex items-center"
                >
                  &#183;&#183;&#183; note
                </button>
                {!isTimed && block.sets.filter((s) => !s.done).length > 1 && (block.sets.find((s) => !s.done)?.weight ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => fillDown(block.uid)}
                    className="text-xs text-acc-teal bg-acc-teal/10 border border-acc-teal/30 hover:bg-acc-teal/20 transition-colors ml-auto px-4 h-9 flex items-center rounded-full font-semibold"
                  >
                    ↓ Fill all
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {exercises.length > 0 ? (
          <button
            type="button"
            onClick={addExercise}
            className="w-full bg-app-surface border border-app-border border-dashed hover:border-acc-teal/60 rounded-card-lg py-4 text-app-tx2 hover:text-acc-teal text-sm font-semibold transition-colors"
          >
            + Add Exercise
          </button>
        ) : (
          <div className="card-lg p-4 text-app-tx2 text-sm text-center">
            No exercises in library.{' '}
            <Link href="/exercises" className="underline text-acc-teal">
              Add exercises first
            </Link>
          </div>
        )}

        {error && (
          <div className="bg-rpe-grind/10 border border-rpe-grind/40 rounded-card px-4 py-3 text-rpe-grind text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full text-sm shadow-glow-teal disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none transition-all active:scale-[0.99]"
        >
          {submitting ? 'Saving…' : 'Save Workout'}
        </button>
      </form>

      {restTimer && (
        <RestTimer
          key={restTimer.nonce}
          totalSeconds={restTimer.seconds}
          exerciseName={restTimer.exerciseName}
          nextUp={restTimer.next}
          rpeCap={returnRpeCap}
          currentRpe={
            restTimer.ratedIdx >= 0
              ? blocks.find((b) => b.uid === restTimer.ratedUid)?.sets[restTimer.ratedIdx]?.rpe ?? 0
              : 0
          }
          onRate={
            restTimer.ratedIdx >= 0
              ? (v) => {
                  const cur = blocks.find((b) => b.uid === restTimer.ratedUid)?.sets[restTimer.ratedIdx]?.rpe;
                  updateSetRpe(restTimer.ratedUid, restTimer.ratedIdx, cur === v ? 0 : v);
                }
              : undefined
          }
          onDismiss={() => {
            // Done knows where you're going: if the next set lives in a
            // different exercise, bring its card to the thumb.
            const next = restTimer.next;
            if (next && next.blockUid !== restTimer.ratedUid) {
              document.getElementById(`block-${next.blockUid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            setRestTimer(null);
            // The activity ends HERE, not in the timer's unmount: a keyed
            // swap unmounts the old timer a breath before the new one
            // starts, and an unmount-time endRest can land AFTER the new
            // startRest and kill the fresh Island. Dismissal is the only
            // unmount that truly means "the rest is over".
            endRestActivity();
          }}
        />
      )}

      {prToast && (
        <div className="fixed top-4 left-0 right-0 z-[60] px-4 pointer-events-none">
          <div className="max-w-lg mx-auto glass-overlay border border-acc-gold/40 rounded-card px-5 py-3.5 flex items-center gap-3 shadow-glow-gold pointer-events-auto">
            <span className="text-2xl leading-none">🏆</span>
            <div className="flex-1 min-w-0">
              <p className="glow-gold font-bold text-sm leading-tight">New Personal Record!</p>
              <p className="text-app-tx2 text-xs mt-0.5 truncate">{prToast}</p>
            </div>
            <button type="button" onClick={() => setPrToast(null)} className="text-app-tx3 hover:text-app-tx1 text-xl leading-none flex-shrink-0 w-11 h-11 flex items-center justify-center -mr-3 transition-colors">×</button>
          </div>
        </div>
      )}

      {showSummary && (
        <div className="fixed inset-0 z-[70] bg-[#05060f]/90 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="relative overflow-hidden sheet-surface border border-app-border-hi rounded-card-lg shadow-card-lg p-8 w-full max-w-sm text-center">
            {/* soft inner nebula — the observatory treatment */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(220px_130px_at_85%_0%,rgba(94,234,212,0.12),transparent_70%),radial-gradient(200px_140px_at_0%_100%,rgba(139,92,246,0.12),transparent_70%)]"
            />
            <div className="relative">
              <div className="text-5xl mb-3 leading-none">🎉</div>
              <h2 className="text-2xl font-bold font-round tracking-tight mb-1 text-app-tx1">
                Session complete.
              </h2>
              <p className="text-app-tx2 text-sm mb-5 truncate">{name}</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className="bg-ink/[0.04] border border-app-border rounded-card p-3">
                  <div className="font-round text-2xl font-light tabular-nums glow-violet">{showSummary.sets}</div>
                </div>
                <div className="bg-ink/[0.04] border border-app-border rounded-card p-3">
                  <div className="font-round text-2xl font-light tabular-nums glow-teal">
                    {showSummary.vol >= 1000 ? `${(showSummary.vol / 1000).toFixed(1)}k` : showSummary.vol}
                  </div>
                </div>
                <div className="bg-ink/[0.04] border border-app-border rounded-card p-3">
                  <div className="font-round text-2xl font-light tabular-nums glow-cyan">{showSummary.time}</div>
                </div>
              </div>
              {showSummary.prs.length > 0 && (
                <div className="bg-acc-gold/[0.08] border border-acc-gold/40 rounded-card px-4 py-3 mb-4 shadow-[0_0_24px_-8px_rgba(250,204,21,0.5)]">
                  <p className="glow-gold font-bold text-xs uppercase tracking-widest mb-1.5">🏆 New PRs</p>
                  <p className="text-app-tx1 text-sm font-medium leading-relaxed">{showSummary.prs.join(' · ')}</p>
                </div>
              )}
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-acc-teal animate-pulse motion-reduce:animate-none" />
                <p className="text-app-tx2 text-xs">Saving your workout…</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
