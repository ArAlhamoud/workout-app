'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createWorkout } from '@/app/actions';
import RestTimer from './RestTimer';
import { scaleReturnWeight } from '@/lib/program';

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
  'w-full bg-app-surface2 border border-app-border rounded-card px-4 py-3 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-teal-500/60 text-sm transition-colors';

const rpeOptions = [
  { v: 1, l: 'Easy',  c: 'bg-green-900/40 border-green-700 text-green-400' },
  { v: 2, l: 'Med',   c: 'bg-yellow-900/40 border-yellow-700 text-yellow-400' },
  { v: 3, l: 'Hard',  c: 'bg-orange-900/40 border-orange-700 text-orange-400' },
  { v: 4, l: 'Grind', c: 'bg-red-900/40 border-red-700 text-red-400' },
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
}) {
  const router = useRouter();
  const today = localTodayStr();
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(today);
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

  // Load per-exercise machine notes after mount (avoids hydration mismatch)
  useEffect(() => {
    try { setExerciseNotes(JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')); } catch { /* ignore */ }
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
    const draft = { savedAt: Date.now(), name, date, notes, blocks, startTime: startRef.current };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [initialized, name, date, notes, blocks]);

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
        sets: [{ exerciseId: exercises[0].id, setNumber: 1, reps: 10, weight: 0, done: false, notes: '', rpe: 0 }],
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
    setBlocks((prev) => {
      const updated = prev.map((b) =>
        b.uid === uid
          ? { ...b, sets: b.sets.map((s, i) => (i === idx ? { ...s, done: !s.done } : s)) }
          : b,
      );
      const block = updated.find((b) => b.uid === uid)!;
      const set = block.sets[idx];
      if (set.done) {
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
      sets.map(({ done: _d, notes: sn, rpe: r, ...rest }, i) => ({
        ...rest,
        setNumber: i + 1,
        notes: sn || undefined,
        rpe: r || undefined,
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
        notes: fullNotes || undefined,
        duration: Math.floor((Date.now() - startRef.current) / 1000),
        sets: setsToSave,
      });
      // Only clear the draft once the save has actually succeeded.
      localStorage.removeItem(DRAFT_KEY);
      router.push(`/workouts/${id}?new=1`);
    } catch {
      setError('Failed to save. Please try again.');
      setSubmitting(false);
      setShowSummary(null);
    }
  }

  const doneCount = blocks.reduce((n, b) => n + b.sets.filter((s) => s.done).length, 0);
  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Draft restored notice */}
        {draftRestored && (
          <div className="bg-teal-950/40 border border-teal-800/40 rounded-card px-4 py-3 flex items-center justify-between">
            <span className="text-teal-300 text-sm">
              ↩ Workout restored
            </span>
            <button
              type="button"
              onClick={clearDraft}
              className="text-teal-400 text-xs font-semibold hover:text-teal-200 transition-colors py-2 -my-2 px-2 -mx-2"
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
                  autoTimer ? 'border-teal-600/60 bg-teal-500/10 text-teal-400' : 'border-app-border text-app-tx3'
                }`}
              >
                ⏱ rest
              </button>
              <span className="text-xs text-app-tx3 tabular-nums font-mono">
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
                      ? 'border-teal-500/70 bg-teal-500/10'
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
                className="bg-green-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${(doneCount / totalSets) * 100}%` }}
              />
            </div>
            <span className="text-app-tx3 text-xs tabular-nums flex-shrink-0">
              {doneCount}/{totalSets}
            </span>
          </div>
        )}

        {/* Return protocol reminder — visible while logging */}
        {returnLoadPct && (
          <div className="bg-amber-950/40 border border-amber-800/40 rounded-card px-4 py-3 flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5 flex-shrink-0">&#8595;</span>
            <div className="min-w-0">
              <p className="text-amber-300 font-bold text-sm">
                Return week &mdash; weights pre-set to {returnLoadPct}%
              </p>
              <p className="text-amber-200/50 text-xs mt-0.5 leading-relaxed">
                Stop every set at{' '}
                <span className="font-semibold text-amber-300">
                  {['', 'Easy', 'Med', 'Hard', 'Grind'][returnRpeCap ?? 2]}
                </span>
                . If a set goes past that, drop a pin — the ramp matters more than the number.
              </p>
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
                allDone ? 'bg-green-950/20 border-green-800/40' : ''
              }`}
            >
              {/* Header — sticky so exercise name stays visible while scrolling through sets */}
              <div className={`sticky top-0 z-10 flex items-center gap-2 px-4 pt-4 pb-2 rounded-t-card-lg ${allDone ? 'bg-green-950/30' : 'bg-app-surface'}`}>
                <span className="text-app-tx3 text-sm font-bold w-5 flex-shrink-0 tabular-nums">
                  {blockIdx + 1}
                </span>
                <select
                  value={block.exerciseId}
                  onChange={(e) => updateBlockExercise(block.uid, e.target.value)}
                  className="flex-1 bg-app-surface2 border border-app-border rounded-card px-3 h-11 text-app-tx1 text-sm focus:outline-none focus:border-teal-500/60 min-w-0 transition-colors"
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
                  className="text-app-tx3 hover:text-teal-400 transition-colors text-base flex-shrink-0 w-8 h-11 flex items-center justify-center"
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
                        block.lastSession.rpe === 1 ? 'text-green-400' :
                        block.lastSession.rpe === 2 ? 'text-yellow-400' :
                        block.lastSession.rpe === 3 ? 'text-orange-400' : 'text-red-400'
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
                {shouldHold && !allDone && (
                  <span className="text-xs bg-orange-950/50 text-orange-400 px-2.5 py-1 rounded-full border border-orange-800/40 font-medium">
                    &#9888; Hold weight
                  </span>
                )}
                {suggestWeight && !allDone && (
                  <span className="text-xs bg-green-950/50 text-green-400 px-2.5 py-1 rounded-full border border-green-800/40 font-medium">
                    &#8594; Try {suggestWeight} kg
                  </span>
                )}
                {returnTarget && !allDone && (
                  <span className="text-xs bg-amber-950/50 text-amber-400 px-2.5 py-1 rounded-full border border-amber-800/40 font-medium">
                    &#8595; Return target {returnTarget} kg
                  </span>
                )}
                {progressionHints[block.exerciseId] && !shouldHold && !allDone && (
                  <span className="text-xs bg-teal-950/50 text-teal-400 px-2.5 py-1 rounded-full border border-teal-800/40 font-medium">
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
                {allDone && (
                  <span className="text-xs bg-green-900/50 text-green-400 px-2.5 py-1 rounded-full border border-green-800/50 font-semibold">
                    &#10003; Done
                  </span>
                )}
                {hasNewPR && !allDone && (
                  <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2.5 py-1 rounded-full border border-yellow-800/40 font-semibold">
                    &#127942; New PR!
                  </span>
                )}
                {block.cues && (
                  <button
                    type="button"
                    onClick={() => toggleCues(block.uid)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      block.showCues
                        ? 'bg-teal-900/40 text-teal-300 border-teal-700/50'
                        : 'bg-app-surface2 text-app-tx2 border-app-border hover:text-app-tx1'
                    }`}
                  >
                    {block.showCues ? 'Hide tip' : '? Tip'}
                  </button>
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
                    className="text-xs bg-app-surface2 border border-teal-500/60 rounded-full px-3 py-1.5 text-app-tx1 placeholder-app-tx3 focus:outline-none w-40"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingNoteFor(block.exerciseId)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                      exerciseNotes[block.exerciseId]
                        ? 'bg-app-primary-muted text-teal-300 border-teal-800/40'
                        : 'bg-app-surface2 text-app-tx3 border-app-border hover:text-app-tx2'
                    }`}
                  >
                    {exerciseNotes[block.exerciseId] ? `⚙ ${exerciseNotes[block.exerciseId]}` : '⚙ note'}
                  </button>
                )}
              </div>

              {/* Cues */}
              {block.showCues && block.cues && (
                <div className="mx-4 mb-3 bg-teal-950/30 border border-teal-900/40 rounded-xl px-3.5 py-2.5">
                  <p className="text-teal-200 text-xs leading-relaxed">{block.cues}</p>
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
                                ? 'bg-green-600 text-white shadow-md shadow-green-900/30'
                                : isCurrentSet
                                ? 'bg-app-surface2 border-2 border-teal-500/70 text-app-tx1'
                                : 'bg-app-surface2 text-app-tx2 active:bg-white/5'
                            }`}
                          >
                            {set.done ? '✓' : set.setNumber}
                          </button>

                          {isTimed ? (
                            <div className="flex items-center flex-1 min-w-0 h-12 bg-app-surface2 border border-app-border rounded-xl overflow-hidden">
                              <button
                                type="button"
                                onClick={() => updateSet(block.uid, i, 'reps', Math.max(5, set.reps - 5))}
                                className="min-w-[44px] h-full px-2 flex items-center justify-center text-app-tx2 active:bg-white/5 font-bold text-sm flex-shrink-0 select-none"
                              >
                                &#8722;5s
                              </button>
                              <span className="flex-1 min-w-0 text-app-tx1 text-sm text-center tabular-nums font-medium">
                                {formatSeconds(set.reps)}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateSet(block.uid, i, 'reps', set.reps + 5)}
                                className="min-w-[44px] h-full px-2 flex items-center justify-center text-app-tx2 active:bg-white/5 font-bold text-sm flex-shrink-0 select-none"
                              >
                                +5s
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center flex-[3] min-w-0 h-12 bg-app-surface2 border border-app-border rounded-xl overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => stepWeight(block, i, -1)}
                                  className="w-11 h-full flex items-center justify-center text-app-tx2 active:bg-white/5 font-bold text-lg flex-shrink-0 select-none leading-none"
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
                                  className="flex-1 bg-transparent text-app-tx1 text-sm text-center focus:outline-none tabular-nums min-w-0 h-full"
                                />
                                <button
                                  type="button"
                                  onClick={() => stepWeight(block, i, 1)}
                                  className="w-11 h-full flex items-center justify-center text-app-tx2 active:bg-white/5 font-bold text-lg flex-shrink-0 select-none leading-none"
                                >
                                  +
                                </button>
                              </div>

                              <div className="flex items-center flex-[2] min-w-0 h-12 bg-app-surface2 border border-app-border rounded-xl overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', Math.max(0, set.reps - 1))}
                                  className="w-11 h-full flex items-center justify-center text-app-tx2 active:bg-white/5 font-bold text-lg flex-shrink-0 select-none leading-none"
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
                                  className="flex-1 bg-transparent text-app-tx1 text-sm text-center focus:outline-none tabular-nums min-w-0 h-full"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', set.reps + 1)}
                                  className="w-11 h-full flex items-center justify-center text-app-tx2 active:bg-white/5 font-bold text-lg flex-shrink-0 select-none leading-none"
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

                      {/* RPE pills after set is done */}
                      {set.done && (
                        <div className="mt-1.5 pl-14 flex gap-1.5 pb-0.5">
                          {rpeOptions.map(({ v, l, c }) => (
                            <button
                              type="button"
                              key={v}
                              onClick={() => updateSetRpe(block.uid, i, set.rpe === v ? 0 : v)}
                              className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 ${
                                set.rpe === v ? c : 'bg-app-surface2 border-app-border text-app-tx3'
                              }`}
                            >
                              {l}
                            </button>
                          ))}
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
                            className="w-full bg-app-surface2 border border-app-border rounded-lg px-3 py-2 text-app-tx1 text-xs placeholder-app-tx3 focus:outline-none focus:border-teal-500/60 transition-colors"
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
                  className="text-xs text-teal-400 hover:text-teal-300 transition-colors font-semibold h-11 flex items-center"
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
                    className="text-xs text-teal-400 bg-teal-500/10 border border-teal-800/40 hover:bg-teal-500/20 transition-colors ml-auto px-4 h-9 flex items-center rounded-full font-semibold"
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
            className="w-full bg-app-surface border border-app-border border-dashed hover:border-teal-500/60 rounded-card-lg py-4 text-app-tx2 hover:text-teal-400 text-sm font-semibold transition-colors"
          >
            + Add Exercise
          </button>
        ) : (
          <div className="bg-app-surface border border-yellow-900/50 rounded-card-lg p-4 text-yellow-400 text-sm text-center">
            No exercises in library.{' '}
            <Link href="/exercises" className="underline">
              Add exercises first
            </Link>
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-card px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full text-sm shadow-glow-teal disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none transition-all active:scale-[0.99]"
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
          <div className="max-w-lg mx-auto bg-yellow-400 text-yellow-950 rounded-card px-5 py-3.5 flex items-center gap-3 shadow-2xl pointer-events-auto">
            <span className="text-2xl leading-none">🏆</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm leading-tight">New Personal Record!</p>
              <p className="text-yellow-700 text-xs mt-0.5 truncate">{prToast}</p>
            </div>
            <button type="button" onClick={() => setPrToast(null)} className="text-yellow-700 hover:text-yellow-900 text-xl leading-none flex-shrink-0 w-11 h-11 flex items-center justify-center -mr-3">×</button>
          </div>
        </div>
      )}

      {showSummary && (
        <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="bg-app-surface border border-app-border rounded-card-lg shadow-card-lg p-8 w-full max-w-sm text-center">
            <div className="text-5xl mb-3 leading-none">🎉</div>
            <h2 className="text-2xl font-black text-app-tx1 mb-1">Workout Done!</h2>
            <p className="text-app-tx2 text-sm mb-5 truncate">{name}</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              <div className="bg-app-surface2 rounded-card p-3">
                <div className="text-xl font-black text-app-tx1 tabular-nums">{showSummary.sets}</div>
                <div className="text-app-tx2 text-xs mt-0.5">Sets</div>
              </div>
              <div className="bg-app-surface2 rounded-card p-3">
                <div className="text-xl font-black text-app-tx1 tabular-nums">
                  {showSummary.vol >= 1000 ? `${(showSummary.vol / 1000).toFixed(1)}k` : showSummary.vol}
                </div>
                <div className="text-app-tx2 text-xs mt-0.5">kg lifted</div>
              </div>
              <div className="bg-app-surface2 rounded-card p-3">
                <div className="text-xl font-black text-app-tx1 tabular-nums">{showSummary.time}</div>
                <div className="text-app-tx2 text-xs mt-0.5">Duration</div>
              </div>
            </div>
            {showSummary.prs.length > 0 && (
              <div className="bg-yellow-950/50 border border-yellow-800/40 rounded-card px-4 py-3 mb-4">
                <p className="text-yellow-400 font-bold text-xs uppercase tracking-widest mb-1.5">🏆 New PRs</p>
                <p className="text-yellow-300 text-sm font-medium leading-relaxed">{showSummary.prs.join(' · ')}</p>
              </div>
            )}
            <div className="flex items-center justify-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
              <p className="text-app-tx2 text-xs">Saving your workout…</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
