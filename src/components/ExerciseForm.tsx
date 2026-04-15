'use client';

import { useState } from 'react';
import { createExercise } from '@/app/actions';

export default function ExerciseForm({ categories }: { categories: string[] }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'CHEST');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const formData = new FormData();
    formData.set('name', name.trim());
    formData.set('category', category);
    await createExercise(formData);
    setName('');
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h2 className="font-semibold text-white mb-4">Add Exercise</h2>
      <div className="flex gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Exercise name..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:text-blue-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {submitting ? '...' : 'Add'}
        </button>
      </div>
    </form>
  );
}
