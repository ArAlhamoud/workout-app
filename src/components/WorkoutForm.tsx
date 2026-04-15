'use client';

import { useState } from 'react';
import { createWorkout } from '@/app/actions';

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
}

interface SetEntry {
  exerciseId: string;
  setNumber: number;
  reps: number;
  weight: number;
}

interface ExerciseBlock {
  uid: string;
  exerciseId: string;
  sets: SetEntry[];
}

function buildBlocks(initialExercises: InitialExercise[]): ExerciseBlock[] {
  return initialExercises.map((ie) => ({
    uid: Math.random().toString(36).slice(2),
    exerciseId: ie.exerciseId,
    sets: Array.from({ length: ie.sets }, (_, i) => ({
      exerciseId: ie.exerciseId,
      setNumber: i + 1,
      reps: ie.defaultReps,
      weight: 0,
    })),
  }));
}

export default function WorkoutForm({
  exercises,
  initialName = '',
  initialExercises = [],
}: {
  exercises: Exercise[];
  initialName?: string;
  initialExercises?: InitialExercise[];
}) {
  const today = new Date().toISOString().split('T')[0];
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() => buildBlocks(initialExercises));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function addExercise() {
    if (!exercises.length) return;
    setBlocks((prev) => [
      ...prev,
      {
        uid: Math.random().toString(36).slice(2),
        exerciseId: exercises[0].id,
        sets: [{ exerciseId: exercises[0].id, setNumber: 1, reps: 10, weight: 0 }],
      },
    ]);
  }

  function removeBlock(uid: string) {
    setBlocks((prev) => prev.filter((b) => b.uid !== uid));
  }

  function updateBlockExercise(uid: string, exerciseId: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.uid === uid
          ? { ...b, exerciseId, sets: b.sets.map((s) => ({ ...s, exerciseId })) }
          : b,
      ),
    );
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
                  reps: b.sets[b.sets.length - 1]?.reps ?? 10,
                  weight: b.sets[b.sets.length - 1]?.weight ?? 0,
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
    if (!name.trim()) {
      setError('Workout name is required');
      return;
    }
    if (!blocks.length) {
      setError('Add at least one exercise');
      return;
    }
    setSubmitting(true);
    try {
      await createWorkout({
        name: name.trim(),
        date,
        notes: notes.trim() || undefined,
        sets: blocks.flatMap((b) => b.sets),
      });
    } catch {
      setError('Failed to save workout. Please try again.');
      setSubmitting(false);
    }
  }

  const exerciseGroups = exercises.reduce<Record<string, Exercise[]>>((acc, ex) => {
    if (!acc[ex.category]) acc[ex.category] = [];
    acc[ex.category].push(ex);
    return acc;
  }, {});

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Workout Details */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Day A — Apr 15"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1.5">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1.5">
              Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Exercise Blocks */}
      {blocks.map((block, blockIdx) => {
        const currentExercise = exerciseById.get(block.exerciseId);
        return (
          <div key={block.uid} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            {/* Exercise header */}
            <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-gray-800">
              <span className="text-gray-700 text-sm font-bold tabular-nums w-5 flex-shrink-0">
                {blockIdx + 1}
              </span>
              <select
                value={block.exerciseId}
                onChange={(e) => updateBlockExercise(block.uid, e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {Object.entries(exerciseGroups).sort().map(([cat, exs]) => (
                  <optgroup key={cat} label={cat}>
                    {exs.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeBlock(block.uid)}
                className="text-gray-600 hover:text-red-400 transition-colors text-xl leading-none flex-shrink-0"
              >
                ×
              </button>
            </div>

            {/* Sets */}
            <div className="px-5 py-3 space-y-2">
              <div className="grid grid-cols-12 text-xs text-gray-600 font-semibold uppercase tracking-wide">
                <span className="col-span-2">Set</span>
                <span className="col-span-5">Weight (kg)</span>
                <span className="col-span-4">Reps</span>
                <span className="col-span-1"></span>
              </div>
              {block.sets.map((set, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <span className="col-span-2 text-sm text-gray-500 font-medium">
                    {set.setNumber}
                  </span>
                  <input
                    type="number"
                    value={set.weight}
                    min="0"
                    step="0.5"
                    onChange={(e) =>
                      updateSet(block.uid, i, 'weight', parseFloat(e.target.value) || 0)
                    }
                    className="col-span-5 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 tabular-nums"
                  />
                  <input
                    type="number"
                    value={set.reps}
                    min="0"
                    onChange={(e) =>
                      updateSet(block.uid, i, 'reps', parseInt(e.target.value) || 0)
                    }
                    className="col-span-4 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => removeSet(block.uid, i)}
                    disabled={block.sets.length === 1}
                    className="col-span-1 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-20 text-lg leading-none text-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="px-5 pb-4">
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

      {/* Add Exercise */}
      {exercises.length > 0 ? (
        <button
          type="button"
          onClick={addExercise}
          className="w-full bg-gray-900 border border-gray-700 border-dashed hover:border-blue-500 rounded-2xl p-4 text-gray-500 hover:text-blue-400 text-sm font-medium transition-colors"
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
        <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-400 text-white py-3.5 rounded-2xl font-bold text-sm transition-colors"
      >
        {submitting ? 'Saving…' : 'Save Workout'}
      </button>
    </form>
  );
}
