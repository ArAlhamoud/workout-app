'use client';

import { useState } from 'react';
import { addBodyStat } from '@/app/actions';

const inputCls = 'w-full bg-app-surface2 border border-app-border rounded-card px-3 py-2.5 text-app-tx1 placeholder-app-tx3 focus:outline-none focus:border-teal-500/60 text-sm transition-colors';

export default function BodyStatForm() {
  const today = new Date().toISOString().split('T')[0];
  const [weight, setWeight] = useState('');
  const [waist, setWaist]   = useState('');
  const [arms, setArms]     = useState('');
  const [date, setDate]     = useState(today);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!weight && !waist && !arms) return;
    setSaving(true);
    try {
      await addBodyStat({
        weight: weight ? parseFloat(weight) : undefined,
        waist:  waist  ? parseFloat(waist)  : undefined,
        arms:   arms   ? parseFloat(arms)   : undefined,
        date,
      });
      setSaved(true);
      setWeight('');
      setWaist('');
      setArms('');
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-lg p-4">
      <p className="section-label mb-3">Log Measurement</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-app-tx3 text-xs mb-1 block">Weight (kg)</label>
            <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)}
              placeholder="131.3" step="0.1" min="30" max="300" className={inputCls} />
          </div>
          <div>
            <label className="text-app-tx3 text-xs mb-1 block">Waist (cm)</label>
            <input type="number" value={waist} onChange={(e) => setWaist(e.target.value)}
              placeholder="110" step="0.5" min="40" max="200" className={inputCls} />
          </div>
          <div>
            <label className="text-app-tx3 text-xs mb-1 block">Arms (cm)</label>
            <input type="number" value={arms} onChange={(e) => setArms(e.target.value)}
              placeholder="42" step="0.5" min="20" max="80" className={inputCls} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className={`flex-1 ${inputCls}`} />
          <button
            type="submit"
            disabled={saving || (!weight && !waist && !arms)}
            className="px-4 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-app-surface2 disabled:text-app-tx3 text-white text-sm font-semibold rounded-card transition-colors flex-shrink-0"
          >
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
