'use client';

import { useState, useRef, useEffect } from 'react';
import { createWorkout } from '@/app/actions';
import RestTimer from './RestTimer';

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
  rest?: string;
  targetReps?: string;
}

interface SetEntry {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
  done: boolean;
}

interface ExerciseBlock {
  uid: string;
  exerciseId: string;
  sets: SetEntry[];
  cues?: string;
  rest?: string;
  targetReps?: string;
  showCues: boolean;
  lastSession?: { weight: number; reps: number };
}

function parseRestSeconds(rest: string): number {
  const m = rest.match(/(\d+)/);
  return m ? parseInt(m[1]) : 60;
}

function buildBlocks(
  initialExercises: InitialExercise[],
  lastSession: Record<string, { weight: number; reps: number }>,
): ExerciseBlock[] {
  return initialExercises.map((ie) => {
    const prev = lastSession[ie.exerciseId];
    return {
      uid: Math.random().toString(36).slice(2),
      exerciseId: ie.exerciseId,
      cues: ie.cues,
      rest: ie.rest,
      targetReps: ie.targetReps,
      showCues: false,
      lastSession: prev,
      sets: Array.from({ length: ie.sets }, (_, i) => ({
        exerciseId: ie.exerciseId,
        setNumber: i + 1,
        reps: ie.defaultReps,
        weight: prev?.weight ?? 0,
        done: false,
      })),
    };
  });
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function WorkoutForm({
  exercises,
  initialName = '',
  initialExercises = [],
  lastSession = {},
  personalRecords = {},
}: {
  exercises: Exercise[];
  initialName?: string;
  initialExercises?: InitialExercise[];
  lastSession?: Record<string, { weight: number; reps: number }>;
  personalRecords?: Record<string, number>;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() =>
    buildBlocks(initialExercises, lastSession),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [restTimer, setRestTimer] = useState<{
    seconds: number;
    exerciseName: string;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  // Elapsed workout timer
  useEffect(() => {
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

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
        sets: [{ exerciseId: exercises[0].id, setNumber: 1, reps: 10, weight: 0, done: false }],
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
              showCues: false,
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

  function toggleSetDone(uid: string, idx: number) {
    setBlocks((prev) => {
      const updated = prev.map((b) =>
        b.uid === uid
          ? { ...b, sets: b.sets.map((s, i) => (i === idx ? { ...s, done: !s.done } : s)) }
          : b,
      );
      const block = updated.find((b) => b.uid === uid);
      const set = block?.sets[idx];
      if (set?.done && block?.rest) {
        const exName = exerciseById.get(block.exerciseId)?.name ?? 'exercise';
        setRestTimer({ seconds: parseRestSeconds(block.rest), exerciseName: exName });
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Workout name is required'); return; }
    if (!blocks.length) { setError('Add at least one exercise'); return; }
    setSubmitting(true);
    try {
      await createWorkout({
        name: name.trim(),
        date,
        notes: notes.trim() || undefined,
        duration: Math.floor((Date.now() - startRef.current) / 1000),
        sets: blocks.flatMap((b) => b.sets.map(({ done: _d, ...rest }) => rest)),
      });
    } catch {
      setError('Failed to save. Please try again.');
      setSubmitting(false);
    }
  }

  const doneCount = blocks.reduce((n, b) => n + b.sets.filter((s) => s.done).length, 0);
  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Workout details */}
        <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 uppercase tracking-widest font-semibold">
              Workout Details
            </span>
            <span className="text-xs text-gray-600 tabular-nums font-mono">
              ⏱ {formatElapsed(elapsed)}
            </span>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Day A — Apr 15"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm"
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
        </div>

        {/* Progress bar */}
        {totalSets > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-green-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${(doneCount / totalSets) * 100}%` }}
              />
            </div>
            <span className="text-gray-600 text-xs tabular-nums flex-shrink-0">
              {doneCount}/{totalSets} done
            </span>
          </div>
        )}

        {/* Exercise blocks */}
        {blocks.map((block, blockIdx) => {
          const ex = exerciseById.get(block.exerciseId);
          const pr = ex ? (personalRecords[block.exerciseId] ?? 0) : 0;
          const hasNewPR = block.sets.some((s) => s.weight > 0 && s.weight > pr);

          return (
            <div key={block.uid} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <span className="text-gray-700 text-sm font-bold w-5 flex-shrink-0 tabular-nums">
                  {blockIdx + 1}
                </span>
                <select
                  value={block.exerciseId}
                  onChange={(e) => updateBlockExercise(block.uid, e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 min-w-0"
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
                <button
                  type="button"
                  onClick={() => removeBlock(block.uid)}
                  className="text-gray-700 hover:text-red-400 transition-colors text-xl leading-none px-1 flex-shrink-0"
                >
                  ×
                </button>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 px-4 pb-2.5 flex-wrap">
                {block.lastSession && (
                  <span className="text-xs bg-gray-800 text-gray-400 px-2.5 py-1 rounded-full border border-gray-700">
                    Last: {block.lastSession.weight} kg × {block.lastSession.reps}
                  </span>
                )}
                {block.targetReps && (
                  <span className="text-xs bg-gray-800 text-gray-500 px-2.5 py-1 rounded-full border border-gray-700">
                    Target {block.targetReps}
                  </span>
                )}
                {block.rest && (
                  <span className="text-xs bg-gray-800 text-gray-500 px-2.5 py-1 rounded-full border border-gray-700">
                    Rest {block.rest}
                  </span>
                )}
                {hasNewPR && (
                  <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2.5 py-1 rounded-full border border-yellow-800/40 font-semibold">
                    🏆 New PR!
                  </span>
                )}
                {block.cues && (
                  <button
                    type="button"
                    onClick={() => toggleCues(block.uid)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      block.showCues
                        ? 'bg-blue-900/40 text-blue-300 border-blue-700/50'
                        : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
                    }`}
                  >
                    {block.showCues ? 'Hide tip' : '? Tip'}
                  </button>
                )}
              </div>

              {/* Cues */}
              {block.showCues && block.cues && (
                <div className="mx-4 mb-3 bg-blue-950/30 border border-blue-900/40 rounded-xl px-3.5 py-2.5">
                  <p className="text-blue-200 text-xs leading-relaxed">{block.cues}</p>
                </div>
              )}

              {/* Sets */}
              <div className="px-4 space-y-1.5 pb-1">
                <div className="grid grid-cols-12 text-xs text-gray-600 font-semibold uppercase tracking-wide pb-0.5">
                  <span className="col-span-2">Set</span>
                  <span className="col-span-5">kg</span>
                  <span className="col-span-4">Reps</span>
                  <span className="col-span-1" />
                </div>
                {block.sets.map((set, i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-12 gap-2 items-center rounded-lg px-0.5 py-0.5 transition-colors ${
                      set.done ? 'bg-green-950/30' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSetDone(block.uid, i)}
                      className={`col-span-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        set.done
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                      }`}
                    >
                      {set.done ? '✓' : set.setNumber}
                    </button>
                    <input
                      type="number"
                      value={set.weight}
                      min="0"
                      step="0.5"
                      onChange={(e) =>
                        updateSet(block.uid, i, 'weight', parseFloat(e.target.value) || 0)
                      }
                      className="col-span-5 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 tabular-nums"
                    />
                    <input
                      type="number"
                      value={set.reps}
                      min="0"
                      onChange={(e) =>
                        updateSet(block.uid, i, 'reps', parseInt(e.target.value) || 0)
                      }
                      className="col-span-4 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => removeSet(block.uid, i)}
                      disabled={block.sets.length === 1}
                      className="col-span-1 text-gray-700 hover:text-red-400 transition-colors disabled:opacity-20 text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="px-4 pb-4 pt-2">
                <button
                  type="button"
                  onClick={() => addSet(block.uid)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
                >
                  + Add set
                </button>
              </div>
            </div>
          );
        })}

        {/* Add exercise */}
        {exercises.length > 0 ? (
          <button
            type="button"
            onClick={addExercise}
            className="w-full bg-gray-900 border border-gray-700 border-dashed hover:border-blue-500 rounded-2xl py-4 text-gray-500 hover:text-blue-400 text-sm font-medium transition-colors"
          >
            + Add Exercise
          </button>
        ) : (
          <div className="bg-gray-900 border border-yellow-900/50 rounded-2xl p-4 text-yellow-400 text-sm text-center">
            No exercises in library.{' '}
            <a href="/exercises" className="underline">
              Add exercises first
            </a>
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-900 disabled:text-blue-500 text-white py-4 rounded-2xl font-bold text-sm transition-colors"
        >
          {submitting ? 'Saving…' : 'Save Workout'}
        </button>
      </form>

      {/* Rest timer overlay */}
      {restTimer && (
        <RestTimer
          totalSeconds={restTimer.seconds}
          exerciseName={restTimer.exerciseName}
          onDismiss={() => setRestTimer(null)}
        />
      )}
    </>
  );
}
