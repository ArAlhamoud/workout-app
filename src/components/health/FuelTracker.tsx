'use client';

// The fuel room's working half: one 10-second entry per day — the four
// numbers straight off the meal-subscription screen, or what he actually
// ate. PATCH upsert, so correcting a number later never wipes the rest.
// Targets live behind a fold; the suggestion stays visible so "why these
// numbers" is never a mystery.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logNutrition, updateFuelTargets } from '@/app/health-actions';
import { hapticSuccess } from '@/lib/native-feedback';
import { FUEL_DEFAULTS, type FuelTargets } from '@/lib/health-insights';

const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';
const saveBtn =
  'w-full min-h-[48px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] disabled:opacity-40';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function FuelTracker({ targets }: { targets: FuelTargets }) {
  const router = useRouter();
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [tKcal, setTKcal] = useState(String(targets.kcal));
  const [tProtein, setTProtein] = useState(String(targets.proteinG));
  const [tCarbs, setTCarbs] = useState(String(targets.carbsG));
  const [tFat, setTFat] = useState(String(targets.fatG));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      hapticSuccess();
      setMsg(done);
      router.refresh();
    } catch {
      setMsg('Could not save.');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 2000);
    }
  };

  const anyLog = kcal || protein || carbs || fat;

  return (
    <div className="space-y-4">
      {/* Log today */}
      <div className="card-lg space-y-2.5 p-4">
        <p className="section-label">Log today</p>
        <p className="text-xs font-semibold text-app-tx2">
          Any subset saves; re-saving corrects.
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          <input className={inputCls} inputMode="numeric" placeholder="kcal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          <input className={inputCls} inputMode="numeric" placeholder="P g" value={protein} onChange={(e) => setProtein(e.target.value)} />
          <input className={inputCls} inputMode="numeric" placeholder="C g" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          <input className={inputCls} inputMode="numeric" placeholder="F g" value={fat} onChange={(e) => setFat(e.target.value)} />
        </div>
        <button
          type="button"
          className={saveBtn}
          disabled={busy || !anyLog}
          onClick={() =>
            run(
              () =>
                logNutrition({
                  day: todayKey(),
                  kcal: kcal ? Number(kcal) : undefined,
                  proteinG: protein ? Number(protein) : undefined,
                  carbsG: carbs ? Number(carbs) : undefined,
                  fatG: fat ? Number(fat) : undefined,
                }),
              'Day saved',
            ).then(() => { setKcal(''); setProtein(''); setCarbs(''); setFat(''); })
          }
        >
          Save today
        </button>
        {msg && <p className="text-xs font-bold text-acc-teal">{msg}</p>}
      </div>

      {/* Targets */}
      <details className="card-lg p-4">
        <summary className="section-label cursor-pointer list-none">
          Targets · {targets.kcal} kcal · {targets.proteinG}P / {targets.carbsG}C / {targets.fatG}F
        </summary>
        <div className="mt-3 space-y-2.5">
          <div className="grid grid-cols-4 gap-1.5">
            <input className={inputCls} inputMode="numeric" value={tKcal} onChange={(e) => setTKcal(e.target.value)} aria-label="Calorie target" />
            <input className={inputCls} inputMode="numeric" value={tProtein} onChange={(e) => setTProtein(e.target.value)} aria-label="Protein target" />
            <input className={inputCls} inputMode="numeric" value={tCarbs} onChange={(e) => setTCarbs(e.target.value)} aria-label="Carb target" />
            <input className={inputCls} inputMode="numeric" value={tFat} onChange={(e) => setTFat(e.target.value)} aria-label="Fat target" />
          </div>
          <button
            type="button"
            className={saveBtn}
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  updateFuelTargets({
                    kcal: Number(tKcal),
                    fuelProteinG: Number(tProtein),
                    carbsG: Number(tCarbs),
                    fatG: Number(tFat),
                  }),
                'Targets saved',
              )
            }
          >
            Save targets
          </button>
          <button
            type="button"
            className="w-full py-2 text-center text-xs font-bold text-app-tx3"
            onClick={() => {
              setTKcal(String(FUEL_DEFAULTS.kcal));
              setTProtein(String(FUEL_DEFAULTS.proteinG));
              setTCarbs(String(FUEL_DEFAULTS.carbsG));
              setTFat(String(FUEL_DEFAULTS.fatG));
            }}
          >
            use the suggested numbers ({FUEL_DEFAULTS.kcal} · {FUEL_DEFAULTS.proteinG}P / {FUEL_DEFAULTS.carbsG}C / {FUEL_DEFAULTS.fatG}F)
          </button>
          <p className="text-[11px] leading-relaxed text-app-tx3">
            Suggested from your own numbers: protein ≈1.5 g/kg adjusted weight (the muscle
            floor on a GLP-1 appetite); kcal is maintenance minus a steady deficit; fat is the
            hormone floor; carbs fill the rest. Starting points — a dietitian outranks this
            arithmetic.
          </p>
        </div>
      </details>
    </div>
  );
}
