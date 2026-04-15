'use client';

import { useState } from 'react';
import { createWorkout } from '@/app/actions';

interface Exercise {
  id: string;
  name: string;
  category: string;
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

export default function WorkoutForm({ exercises }: { exercises: Exercise[] }) {
  const today = new Date().toISOString().split('T')[0];
  const [name, setName] = useState('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [blocks, setBlocks] = useState<ExerciseBlock[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function addExercise() {
    if (!exercises.length) return;
    setBlocks((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
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
    if (!name.trim()) { setError('Workout name is required'); return; }
    if (!blocks.length) { setError('Add at least one exercise'); return; }
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Workout details */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
        <h2 className="font-semibold text-white">Workout Details</h2>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Push Day, Leg Day..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Exercise blocks */}
      {blocks.map((block) => (
        <div key={block.uid} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <select
              value={block.exerciseId}
              onChange={(e) => updateBlockExercise(block.uid, e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              {Object.entries(exerciseGroups).map(([cat, exs]) => (
                <optgroup key={cat} label={cat}>
                  {exs.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeBlock(block.uid)}
              className="text-gray-500 hover:text-red-400 transition-colors px-1"
            >
              &times;
            </button>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-12 text-xs text-gray-500 font-medium uppercase tracking-wide px-1">
              <span className="col-span-2">Set</span>
              <span className="col-span-4">Weight (kg)</span>
              <span className="col-span-4">Reps</span>
              <span className="col-span-2"></span>
            </div>
            {block.sets.map((set, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <span className="col-span-2 text-sm text-gray-400 pl-1">{set.setNumber}</span>
                <input
                  type="number"
                  value={set.weight}
                  onChange={(e) => updateSet(block.uid, i, 'weight', parseFloat(e.target.value) || 0)}
                  min="0"
                  step="0.5"
                  className="col-span-4 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
                <input
                  type="number"
                  value={set.reps}
                  onChange={(e) => updateSet(block.uid, i, 'reps', parseInt(e.target.value) || 0)}
                  min="0"
                  className="col-span-4 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removeSet(block.uid, i)}
                  disabled={block.sets.length === 1}
                  className="col-span-2 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-30 text-center"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addSet(block.uid)}
            className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add set
          </button>
        </div>
      ))}

      {exercises.length > 0 ? (
        <button
          type="button"
          onClick={addExercise}
          className="w-full bg-gray-900 border border-gray-700 border-dashed hover:border-blue-500 rounded-xl p-4 text-gray-400 hover:text-blue-400 transition-colors"
        >
          + Add Exercise
        </button>
      ) : (
        <div className="bg-gray-900 border border-yellow-900 rounded-xl p-4 text-yellow-400 text-sm text-center">
          No exercises in library.{' '}
          <a href="/exercises" className="underline">Add exercises first</a>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:text-blue-400 text-white py-3 rounded-xl font-semibold transition-colors"
      >
        {submitting ? 'Saving...' : 'Save Workout'}
      </button>
    </form>
  );
}
