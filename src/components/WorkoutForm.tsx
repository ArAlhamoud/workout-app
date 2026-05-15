'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
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
  rest?: string;
  targetReps?: string;
  unit?: 'reps' | 'seconds';
  showCues: boolean;
  expandedNoteIdx: number | null;
  lastSession?: { weight: number; reps: number };
}

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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildBlocks(
  initialExercises: InitialExercise[],
  lastSession: Record<string, { weight: number; reps: number }>,
): ExerciseBlock[] {
  return initialExercises.map((ie) => {
    const prev = lastSession[ie.exerciseId];
    const isTimed = ie.unit === 'seconds';
    return {
      uid: Math.random().toString(36).slice(2),
      exerciseId: ie.exerciseId,
      cues: ie.cues,
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
        weight: isTimed ? 0 : (prev?.weight ?? 0),
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
  const [restTimer, setRestTimer] = useState<{ seconds: number; exerciseName: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

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

  function updateSetNote(uid: string, idx: number, note: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? { ...b, sets: b.sets.map((s, i) => (i === idx ? { ...s, notes: note } : s)) }
          : b,
      ),
    );
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
    setSubmitting(true);
    try {
      await createWorkout({
        name: name.trim(),
        date,
        notes: notes.trim() || undefined,
        duration: Math.floor((Date.now() - startRef.current) / 1000),
        sets: blocks.flatMap((b) =>
          b.sets.map(({ done: _d, notes: sn, rpe: r, ...rest }) => ({
            ...rest,
            notes: sn || undefined,
            rpe: r || undefined,
          }))
        ),
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
              &#9201; {formatElapsed(elapsed)}
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
              {doneCount}/{totalSets}
            </span>
          </div>
        )}

        {/* Exercise blocks */}
        {blocks.map((block, blockIdx) => {
          const ex = exerciseById.get(block.exerciseId);
          const isTimed = block.unit === 'seconds';
          const pr = ex ? (personalRecords[block.exerciseId] ?? 0) : 0;
          const hasNewPR = !isTimed && block.sets.some((s) => s.weight > 0 && s.weight > pr);
          const allDone = block.sets.length > 0 && block.sets.every((s) => s.done);

          const suggestWeight =
            !isTimed && block.lastSession?.weight
              ? +(block.lastSession.weight + 2.5).toFixed(1)
              : null;

          const est1RM = !isTimed
            ? block.sets.reduce((best, s) => Math.max(best, epley1RM(s.weight, s.reps)), 0)
            : 0;

          return (
            <div
              key={block.uid}
              className={`rounded-2xl border overflow-hidden transition-all duration-300 ${
                allDone
                  ? 'bg-green-950/20 border-green-800/40'
                  : 'bg-gray-900 border-gray-800'
              }`}
            >
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
                <Link
                  href={`/progress/${block.exerciseId}`}
                  className="text-gray-700 hover:text-blue-400 transition-colors text-base flex-shrink-0 px-0.5"
                  title="View progress"
                >
                  &#128200;
                </Link>
                <button
                  type="button"
                  onClick={() => removeBlock(block.uid)}
                  className="text-gray-700 hover:text-red-400 transition-colors text-xl leading-none px-1 flex-shrink-0"
                >
                  &#215;
                </button>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
                {block.lastSession && !isTimed && (
                  <span className="text-xs bg-gray-800 text-gray-400 px-2.5 py-1 rounded-full border border-gray-700">
                    Last: {block.lastSession.weight} kg &#215; {block.lastSession.reps}
                  </span>
                )}
                {block.lastSession && isTimed && (
                  <span className="text-xs bg-gray-800 text-gray-400 px-2.5 py-1 rounded-full border border-gray-700">
                    Last: {formatSeconds(block.lastSession.reps)}
                  </span>
                )}
                {suggestWeight && !allDone && (
                  <span className="text-xs bg-green-950/50 text-green-400 px-2.5 py-1 rounded-full border border-green-800/40 font-medium">
                    &#8594; Try {suggestWeight} kg
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
                {est1RM > 0 && !isTimed && (
                  <span className="text-xs bg-gray-800 text-gray-500 px-2.5 py-1 rounded-full border border-gray-700 tabular-nums">
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

              {/* Column headers */}
              <div className="px-4 pb-1">
                {isTimed ? (
                  <div className="flex items-center gap-2 text-xs text-gray-600 font-semibold uppercase tracking-wide">
                    <span className="w-12 flex-shrink-0 text-center">Set</span>
                    <span className="flex-1 text-center">Duration</span>
                    <span className="w-16 flex-shrink-0" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-gray-600 font-semibold uppercase tracking-wide">
                    <span className="w-12 flex-shrink-0 text-center">Set</span>
                    <span className="flex-1 text-center">Weight &middot; kg</span>
                    <span className="w-[108px] flex-shrink-0 text-center">Reps</span>
                    <span className="w-5 flex-shrink-0" />
                  </div>
                )}
              </div>

              {/* Sets */}
              <div className="px-4 space-y-1.5 pb-1 pt-1">
                {block.sets.map((set, i) => {
                  // Highlight the first undone set as "current"
                  const isCurrentSet = !set.done && block.sets.slice(0, i).every((s) => s.done);

                  return (
                    <div key={i}>
                      <div className={`transition-all ${set.done ? 'opacity-40' : ''}`}>
                        <div className="flex items-center gap-2">
                          {/* Done button — blue ring on current set */}
                          <button
                            type="button"
                            onClick={() => toggleSetDone(block.uid, i)}
                            className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all flex-shrink-0 active:scale-90 ${
                              set.done
                                ? 'bg-green-600 text-white shadow-md shadow-green-900/30'
                                : isCurrentSet
                                ? 'bg-gray-800 border-2 border-blue-600/70 text-white'
                                : 'bg-gray-800 text-gray-500 active:bg-gray-700'
                            }`}
                          >
                            {set.done ? '&#10003;' : set.setNumber}
                          </button>

                          {isTimed ? (
                            <div className="flex items-center flex-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                              <button
                                type="button"
                                onClick={() => updateSet(block.uid, i, 'reps', Math.max(5, set.reps - 5))}
                                className="px-4 py-3 text-gray-300 active:bg-gray-700 font-bold text-sm flex-shrink-0 select-none"
                              >
                                &#8722;5s
                              </button>
                              <span className="flex-1 text-white text-sm text-center tabular-nums py-3 font-medium">
                                {formatSeconds(set.reps)}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateSet(block.uid, i, 'reps', set.reps + 5)}
                                className="px-4 py-3 text-gray-300 active:bg-gray-700 font-bold text-sm flex-shrink-0 select-none"
                              >
                                +5s
                              </button>
                            </div>
                          ) : (
                            <>
                              {/* Weight stepper — bigger hit area */}
                              <div className="flex items-center flex-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSet(block.uid, i, 'weight', Math.max(0, +(set.weight - 2.5).toFixed(1)))
                                  }
                                  className="px-4 py-3 text-gray-300 active:bg-gray-700 font-bold text-lg flex-shrink-0 select-none leading-none"
                                >
                                  &#8722;
                                </button>
                                <input
                                  type="number"
                                  value={set.weight}
                                  min="0"
                                  step="0.5"
                                  onChange={(e) =>
                                    updateSet(block.uid, i, 'weight', parseFloat(e.target.value) || 0)
                                  }
                                  className="flex-1 bg-transparent text-white text-sm text-center focus:outline-none tabular-nums min-w-0 py-3"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSet(block.uid, i, 'weight', +(set.weight + 2.5).toFixed(1))
                                  }
                                  className="px-4 py-3 text-gray-300 active:bg-gray-700 font-bold text-lg flex-shrink-0 select-none leading-none"
                                >
                                  +
                                </button>
                              </div>

                              {/* Reps stepper — bigger hit area */}
                              <div className="flex items-center w-[108px] flex-shrink-0 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', Math.max(0, set.reps - 1))}
                                  className="px-3 py-3 text-gray-300 active:bg-gray-700 font-bold text-lg flex-shrink-0 select-none leading-none"
                                >
                                  &#8722;
                                </button>
                                <input
                                  type="number"
                                  value={set.reps}
                                  min="0"
                                  onChange={(e) =>
                                    updateSet(block.uid, i, 'reps', parseInt(e.target.value) || 0)
                                  }
                                  className="flex-1 bg-transparent text-white text-sm text-center focus:outline-none tabular-nums min-w-0 py-3"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateSet(block.uid, i, 'reps', set.reps + 1)}
                                  className="px-3 py-3 text-gray-300 active:bg-gray-700 font-bold text-lg flex-shrink-0 select-none leading-none"
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
                            className="w-5 flex-shrink-0 text-gray-700 hover:text-red-400 transition-colors disabled:opacity-20 text-xl leading-none text-center"
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
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex-shrink-0 ${
                                set.rpe === v ? c : 'bg-gray-800 border-gray-700 text-gray-600'
                              }`}
                            >
                              {l}
                            </button>
                          ))}
                          <span className="text-gray-700 text-xs self-center">effort</span>
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
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add set + note toggle row */}
              <div className="px-4 pb-4 pt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => addSet(block.uid)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-semibold"
                >
                  + Add set
                </button>
                <button
                  type="button"
                  onClick={() => toggleNoteIdx(block.uid, block.expandedNoteIdx !== null ? block.expandedNoteIdx : block.sets.length - 1)}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  &#183;&#183;&#183; note
                </button>
              </div>
            </div>
          );
        })}

        {exercises.length > 0 ? (
          <button
            type="button"
            onClick={addExercise}
            className="w-full bg-gray-900 border border-gray-700 border-dashed hover:border-blue-500 rounded-2xl py-4 text-gray-500 hover:text-blue-400 text-sm font-semibold transition-colors"
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
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-900 disabled:text-blue-500 text-white py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.99]"
        >
          {submitting ? 'Saving&#8230;' : 'Save Workout'}
        </button>
      </form>

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
