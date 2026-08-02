'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createWorkout } from '@/app/actions';
import RestTimer from './RestTimer';
import { scaleReturnWeight, GYMS, DEFAULT_GYM_ID } from '@/lib/program';
import { hapticTap, hapticSuccess, keepScreenAwake } from '@/lib/native-feedback';

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
}

interface ExerciseBlock {
  uid: string;
  exerciseId: string;
  sets: SetEntry[];
  cues?: string;
  youtubeUrl?: string;
  rest?: string;
  targetReps?: string;
  unit?: 'reps' | 'seconds';
  showCues: boolean;
  expandedNoteIdx: number | null;
  lastSession?: { weight: number; reps: number; rpe: number | null };
}

const DRAFT_KEY = 'workout-draft';
const NOTES_KEY = 'exercise-notes';
const DEFAULT_PIN_INCREMENT = 2.5;

const inputCls =
  'w-full bg-app-surface2 border border-app-border rounded-card px-4 py-3 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-acc-teal/60 text-sm transition-colors';

// Effort spectrum — Easy teal-green, Med amber, Hard orange, Grind magenta.
// Each lit pill carries its own soft glow (light IS the information system).
const rpeOptions = [
  { v: 1, l: 'Easy',  c: 'bg-rpe-easy/15 border-rpe-easy/60 text-rpe-easy shadow-[0_0_14px_-2px_rgba(52,211,153,0.55)]' },
  { v: 2, l: 'Med',   c: 'bg-rpe-med/15 border-rpe-med/60 text-rpe-med shadow-[0_0_14px_-2px_rgba(251,191,36,0.55)]' },
  { v: 3, l: 'Hard',  c: 'bg-rpe-hard/15 border-rpe-hard/60 text-rpe-hard shadow-[0_0_14px_-2px_rgba(251,146,60,0.55)]' },
  { v: 4, l: 'Grind', c: 'bg-rpe-grind/15 border-rpe-grind/60 text-rpe-grind shadow-[0_0_14px_-2px_rgba(244,63,94,0.55)]' },
];

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
  lastSession: Record<string, { weight: number; reps: number; rpe: number | null }>,
  returnLoadPct?: number,
): ExerciseBlock[] {
  return initialExercises.map((ie) => {
    const prev = lastSession[ie.exerciseId];
    const isTimed = ie.unit === 'seconds';
    return {
      uid: Math.random().toString(36).slice(2),
      exerciseId: ie.exerciseId,
      cues: ie.cues,
      youtubeUrl: ie.youtubeUrl,
      rest: ie.rest,
      targetReps: ie.targetReps,
      unit: ie.unit,
      showCues: false,
      expandedNoteIdx: null,
      lastSession: prev,
      sets: Array.from({ length: ie.sets }, (_, i) => ({
        exerciseId: ie.exerciseId,
        setNumber: i + 1,
        reps: isTimed ? (prev?.reps ?? ie.defaultReps) : ie.defaultReps,
        weight: isTimed
          ? 0
          : prev?.weight
            ? (returnLoadPct ? scaleReturnWeight(prev.weight, returnLoadPct) : prev.weight)
            : 0,
        done: false,
        notes: '',
        rpe: 0,
        completedAt: null,
      })),
    };
  });
}

export default function WorkoutForm({
  exercises,
  initialName = '',
  initialExercises = [],
  lastSession = {} as Record<string, { weight: number; reps: number; rpe: number | null }>,
  personalRecords = {},
  progressionHints = {},
  returnLoadPct,
  returnRpeCap,
  pinIncrements = {},
  dayAccent,
}: {
  exercises: Exercise[];
  initialName?: string;
  initialExercises?: InitialExercise[];
  lastSession?: Record<string, { weight: number; reps: number; rpe: number | null }>;
  personalRecords?: Record<string, number>;
  progressionHints?: Record<string, boolean>;
  returnLoadPct?: number;
  returnRpeCap?: number;
  pinIncrements?: Record<string, number>;
  /** Presentation only — threads the Aurora day accent (A violet · B teal) through steppers. */
  dayAccent?: 'A' | 'B';
}) {
  const router = useRouter();
  const today = localTodayStr();
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(today);
  const [gym, setGym] = useState(DEFAULT_GYM_ID);
  const [notes, setNotes] = useState('');
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() =>
    buildBlocks(initialExercises, lastSession, returnLoadPct),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [restTimer, setRestTimer] = useState<{ seconds: number; exerciseName: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const startRef = useRef(Date.now());
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

  function toggleInfo(uid: string) {
    setInfoOpen((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }

  // Load per-exercise machine notes after mount (avoids hydration mismatch)
  useEffect(() => {
    try { setExerciseNotes(JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')); } catch { /* ignore */ }
  }, []);

  // Hold the screen on for the whole session: the phone sits on a bench
  // between sets, and auto-lock mid-workout means unlocking with chalky hands
  // to log every set. Released on unmount so it can never leak past the form.
  useEffect(() => {
    keepScreenAwake(true);
    return () => keepScreenAwake(false);
  }, []);

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        const age = Date.now() - (draft.savedAt ?? 0);
        if (age < 24 * 60 * 60 * 1000 && Array.isArray(draft.blocks) && draft.blocks.length > 0) {
          setName(draft.name ?? initialName);
          setDate(draft.date ?? today);
          setNotes(draft.notes ?? '');
          if (draft.gym) setGym(draft.gym);
          setBlocks(draft.blocks);
          if (draft.startTime) startRef.current = draft.startTime;
          setDraftRestored(true);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    setInitialized(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft on every change (skips until draft check is done)
  useEffect(() => {
    if (!initialized) return;
    const draft = { savedAt: Date.now(), name, date, gym, notes, blocks, startTime: startRef.current };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [initialized, name, date, gym, notes, blocks]);

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

  // Elapsed timer
  useEffect(() => {
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setName(initialName);
    setDate(today);
    setGym(DEFAULT_GYM_ID);
    setNotes('');
    setBlocks(buildBlocks(initialExercises, lastSession, returnLoadPct));
    startRef.current = Date.now();
    setDraftRestored(false);
  }

  const exerciseGroups = exercises.reduce<Record<string, Exercise[]>>((acc, ex) => {
    if (!acc[ex.category]) acc[ex.category] = [];
    acc[ex.category].push(ex);
    return acc;
  }, {});
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

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
    const prev = lastSession[exerciseId];
    setBlocks((cur) =>
      cur.map((b) =>
        b.uid === uid
          ? {
              ...b,
              exerciseId,
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
          setRestTimer({ seconds: restSecs, exerciseName: exName });
        }
        const currentPR = personalRecords[block.exerciseId] ?? 0;
        if (!block.unit && set.weight > 0 && set.weight > currentPR) {
          setPrToast(exName);
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

    const vol = Math.round(setsToSave.reduce((sum, s) => sum + s.weight * s.reps, 0));
    const prs = submitBlocks
      .filter(({ block: b, sets }) => !b.unit && sets.some((s) => s.weight > (personalRecords[b.exerciseId] ?? 0)))
      .map(({ block: b }) => exerciseById.get(b.exerciseId)?.name ?? '')
      .filter(Boolean);

    setShowSummary({ sets: setsToSave.length, vol, prs, time: formatElapsed(elapsed) });
    setSubmitting(true);

    await new Promise((r) => setTimeout(r, 2200));

    const fullNotes = [mood ? `Feeling ${mood}` : '', notes.trim()].filter(Boolean).join(' · ');
    try {
      const { id } = await createWorkout({
        name: name.trim(),
        date: date || localTodayStr(),
        gym,
        notes: fullNotes || undefined,
        duration: Math.floor((Date.now() - startRef.current) / 1000),
        sets: setsToSave,
      });
      // Only clear the draft once the save has actually succeeded.
      localStorage.removeItem(DRAFT_KEY);
      hapticSuccess();
      router.push(`/workouts/${id}?new=1`);
    } catch {
      setError('Failed to save. Please try again.');
      setSubmitting(false);
      setShowSummary(null);
    }
  }

  const doneCount = blocks.reduce((n, b) => n + b.sets.filter((s) => s.done).length, 0);
  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);

  // Aurora day accent — Day A glows violet, Day B (and freestyle) teal.
  const violetDay = dayAccent === 'A';
  const stepAccent = violetDay
    ? 'text-acc-violet active:bg-acc-violet-deep/20'
    : 'text-acc-teal active:bg-acc-teal-deep/20';
  const stepperShell = `flex items-center min-w-0 h-12 bg-app-surface2 border border-app-border rounded-xl overflow-hidden transition-colors ${
    violetDay ? 'focus-within:border-acc-violet/50' : 'focus-within:border-acc-teal/50'
  }`;
  const currentSetRing = violetDay
    ? 'bg-app-surface2 border-2 border-acc-violet/70 text-app-tx1 shadow-glow-violet'
    : 'bg-app-surface2 border-2 border-acc-teal/70 text-app-tx1 shadow-glow-teal';

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Draft restored notice */}
        {draftRestored && (
          <div className="card rounded-card border-acc-teal/30 px-4 py-3 flex items-center justify-between">
            <span className="text-acc-teal text-sm">
              ↩ Workout restored
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

        {/* Workout details */}
        <div className="card-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="section-label">
              Workout Details
            </span>
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
              <span className="text-xs text-app-tx3 tabular-nums font-round">
                {formatElapsed(elapsed)}
              </span>
            </div>
          </div>
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
                      ? 'border-acc-teal/60 bg-gradient-to-br from-acc-teal/20 to-acc-teal-deep/10 text-teal-100 shadow-[0_0_18px_-5px_rgba(45,212,191,0.6)]'
                      : 'border-app-border bg-white/[0.04] text-app-tx2 hover:border-app-border-hi hover:text-app-tx1'
                  }`}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
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
                          ? 'bg-transparent border-white/[0.07] text-[rgba(206,213,248,0.32)] line-through decoration-[rgba(206,213,248,0.4)]'
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
          const pr = ex ? (personalRecords[block.exerciseId] ?? 0) : 0;
          const hasNewPR = !isTimed && block.sets.some((s) => s.weight > 0 && s.weight > pr);
          const allDone = block.sets.length > 0 && block.sets.every((s) => s.done);

          const lastRpe = block.lastSession?.rpe ?? null;
          // While ramping back, the scaled target replaces the normal
          // progress/hold advice — that advice reads pre-break sessions.
          const returnTarget = returnLoadPct && !isTimed && block.lastSession?.weight
            ? scaleReturnWeight(block.lastSession.weight, returnLoadPct)
            : null;
          const shouldHold = !returnTarget && !isTimed && block.lastSession?.weight != null && lastRpe != null && lastRpe >= 3;
          const suggestWeight = !returnTarget && !isTimed && block.lastSession?.weight != null && !shouldHold
            ? +(block.lastSession.weight + (lastRpe === 1 ? 5 : 2.5)).toFixed(1)
            : null;

          const est1RM = !isTimed
            ? block.sets.reduce((best, s) => Math.max(best, epley1RM(s.weight, s.reps)), 0)
            : 0;

          return (
            <div
              key={block.uid}
              className={`card-lg transition-all duration-300 ${
                allDone
                  ? 'bg-acc-teal/[0.05] border-acc-teal/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_0_44px_-14px_rgba(45,212,191,0.45)]'
                  : ''
              }`}
            >
              {/* Header — sticky so exercise name stays visible while scrolling through sets */}
              <div className={`sticky top-0 z-10 flex items-center gap-2 px-4 pt-4 pb-2 rounded-t-card-lg glass-overlay ${allDone ? 'bg-teal-950/70' : ''}`}>
                <span className="text-app-tx3 text-sm font-bold w-5 flex-shrink-0 tabular-nums">
                  {blockIdx + 1}
                </span>
                <select
                  value={block.exerciseId}
                  onChange={(e) => updateBlockExercise(block.uid, e.target.value)}
                  className="flex-1 bg-app-surface2 border border-app-border rounded-card px-3 h-11 text-app-tx1 text-sm focus:outline-none focus:border-acc-teal/60 min-w-0 transition-colors"
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
                {block.lastSession && !isTimed && (
                  <span className="text-xs bg-app-surface2 text-app-tx2 px-2.5 py-1 rounded-full border border-app-border">
                    Last: {block.lastSession.weight} kg &#215; {block.lastSession.reps}
                    {block.lastSession.rpe != null && block.lastSession.rpe > 0 && (
                      <span className={`ml-1.5 font-semibold ${
                        block.lastSession.rpe === 1 ? 'text-rpe-easy' :
                        block.lastSession.rpe === 2 ? 'text-rpe-med' :
                        block.lastSession.rpe === 3 ? 'text-rpe-hard' : 'text-rpe-grind'
                      }`}>
                        · {['','Easy','Med','Hard','Grind'][block.lastSession.rpe]}
                      </span>
                    )}
                  </span>
                )}
                {block.lastSession && isTimed && (
                  <span className="text-xs bg-app-surface2 text-app-tx2 px-2.5 py-1 rounded-full border border-app-border">
                    Last: {formatSeconds(block.lastSession.reps)}
                  </span>
                )}
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
                {block.cues && (
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
                <div className="mx-4 mb-3 bg-white/[0.03] border border-app-border rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap">
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
                  {block.youtubeUrl && (
                    <a
                      href={block.youtubeUrl}
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
              {block.showCues && block.cues && (
                <div className="mx-4 mb-3 bg-acc-teal/[0.07] border border-acc-teal/20 rounded-xl px-3.5 py-2.5">
                  <p className="text-[#ccfbf1] text-xs leading-relaxed">{block.cues}</p>
                </div>
              )}

              {/* Column headers */}
              <div className="px-4 pb-1">
                {isTimed ? (
                  <div className="flex items-center gap-1.5 text-xs text-app-tx3 font-semibold uppercase tracking-wide">
                    <span className="w-12 flex-shrink-0 text-center">Set</span>
                    <span className="flex-1 text-center">Duration</span>
                    <span className="w-5 flex-shrink-0" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-app-tx3 font-semibold uppercase tracking-wide">
                    <span className="w-12 flex-shrink-0 text-center">Set</span>
                    <span className="flex-[3] min-w-0 text-center">Weight &middot; kg</span>
                    <span className="flex-[2] min-w-0 text-center">Reps</span>
                    <span className="w-5 flex-shrink-0" />
                  </div>
                )}
              </div>

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
                          <button
                            type="button"
                            onClick={() => toggleSetDone(block.uid, i)}
                            className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all flex-shrink-0 active:scale-90 ${
                              set.done
                                ? 'bg-gradient-to-br from-acc-teal to-acc-teal-deep text-[#062521] shadow-glow-teal'
                                : isCurrentSet
                                ? currentSetRing
                                : 'bg-app-surface2 text-app-tx2 active:bg-white/5'
                            }`}
                          >
                            {set.done ? '✓' : set.setNumber}
                          </button>

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
                                  className={`w-11 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
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
                                  className={`w-11 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
                                >
                                  +
                                </button>
                              </div>

                              <div className={`flex-[2] ${stepperShell}`}>
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', Math.max(0, set.reps - 1))}
                                  className={`w-11 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
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
                                  className="flex-1 bg-transparent text-app-tx1 text-base font-semibold text-center focus:outline-none tabular-nums min-w-0 h-full"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', set.reps + 1)}
                                  className={`w-11 h-full flex items-center justify-center font-bold text-lg flex-shrink-0 select-none leading-none transition-colors ${stepAccent}`}
                                >
                                  +
                                </button>
                              </div>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => removeSet(block.uid, i)}
                            disabled={block.sets.length === 1}
                            className="w-5 h-12 flex-shrink-0 flex items-center justify-center text-app-tx3 hover:text-red-400 transition-colors disabled:opacity-20 text-xl leading-none"
                          >
                            &#215;
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
                                className={`relative text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                                  set.rpe === v
                                    ? c
                                    : locked
                                      ? 'bg-transparent border-white/[0.07] text-[rgba(206,213,248,0.32)] line-through decoration-[rgba(206,213,248,0.4)]'
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
          totalSeconds={restTimer.seconds}
          exerciseName={restTimer.exerciseName}
          onDismiss={() => setRestTimer(null)}
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
          <div className="relative overflow-hidden glass-overlay border border-app-border-hi rounded-card-lg shadow-card-lg p-8 w-full max-w-sm text-center">
            {/* soft inner nebula — the observatory treatment */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(220px_130px_at_85%_0%,rgba(94,234,212,0.12),transparent_70%),radial-gradient(200px_140px_at_0%_100%,rgba(139,92,246,0.12),transparent_70%)]"
            />
            <div className="relative">
              <div className="text-5xl mb-3 leading-none">🎉</div>
              <h2 className="text-2xl font-bold font-round tracking-tight mb-1 bg-gradient-to-r from-white via-[#c7d2fe] to-[#99f6e4] bg-clip-text text-transparent">
                Session complete.
              </h2>
              <p className="text-app-tx2 text-sm mb-5 truncate">{name}</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className="bg-white/[0.04] border border-app-border rounded-card p-3">
                  <div className="font-round text-2xl font-light tabular-nums glow-violet">{showSummary.sets}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-app-tx3 mt-1">Sets</div>
                </div>
                <div className="bg-white/[0.04] border border-app-border rounded-card p-3">
                  <div className="font-round text-2xl font-light tabular-nums glow-teal">
                    {showSummary.vol >= 1000 ? `${(showSummary.vol / 1000).toFixed(1)}k` : showSummary.vol}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-app-tx3 mt-1">kg lifted</div>
                </div>
                <div className="bg-white/[0.04] border border-app-border rounded-card p-3">
                  <div className="font-round text-2xl font-light tabular-nums glow-cyan">{showSummary.time}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-app-tx3 mt-1">Duration</div>
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
