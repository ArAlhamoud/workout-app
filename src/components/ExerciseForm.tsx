'use client';

import { useState } from 'react';
import { createExercise } from '@/app/actions';

const inputCls = 'bg-app-surface2 border border-app-border rounded-card px-3 py-2.5 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-acc-teal/60 text-sm transition-colors';

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
    <form onSubmit={handleSubmit} className="card-lg p-4">
      <p className="section-label mb-3">Add Exercise</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Exercise name..."
          className={`flex-1 min-w-0 ${inputCls}`}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputCls}
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="px-4 py-2.5 bg-gradient-to-r from-acc-teal to-acc-cyan text-white shadow-[0_0_20px_-6px_rgba(45,212,191,0.7)] hover:brightness-110 disabled:bg-none disabled:bg-app-surface2 disabled:text-app-tx3 disabled:shadow-none text-sm font-bold rounded-card transition-all flex-shrink-0 pressable"
        >
          {submitting ? '...' : 'Add'}
        </button>
      </div>
    </form>
  );
}
