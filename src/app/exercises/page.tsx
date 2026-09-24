import Link from 'next/link';
import type { Metadata } from 'next';
import { getExercises, getMachinePins } from '../actions';
import { getDayTemplate } from '@/lib/program';
import ExerciseForm from '@/components/ExerciseForm';
import { CATEGORY_BADGE } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Exercises' };

const CATEGORIES = ['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO', 'OTHER'];

export default async function ExercisesPage() {
  const [exercises, pins] = await Promise.all([getExercises(), getMachinePins()]);
  // Timed holds and cardio have no stack, so no step.
  const timed = new Set(
    [...getDayTemplate('A').exercises, ...getDayTemplate('B').exercises].filter((t) => t.unit === 'seconds').map((t) => t.name),
  );
  const fmt = (kg: number) => String(+kg.toFixed(2));

  const grouped = exercises.reduce<Record<string, typeof exercises>>((acc, ex) => {
    if (!acc[ex.category]) acc[ex.category] = [];
    acc[ex.category].push(ex);
    return acc;
  }, {});

  const orderedCategories = [
    ...CATEGORIES.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !CATEGORIES.includes(c)),
  ];

  return (
    <div className="space-y-5">
      {/* Volt masthead */}
      <header className="pt-1">
        <div className="volt-topline">
          <span>Your movements</span>
        </div>
        <h1 className="volt-h1" style={{ fontSize: 36 }}>Exercise <span className="volt-hollow">library</span></h1>
        <div className="volt-tape" aria-hidden="true" />
      </header>

      <ExerciseForm categories={CATEGORIES} />

      {exercises.length === 0 ? (
        <div className="card-lg p-10 text-center border-dashed">
          <p className="text-app-tx2 font-medium mb-1">No exercises yet</p>
          <p className="text-app-tx3 text-sm">
            Add your first one above.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orderedCategories.map((category) => {
            const exs = grouped[category];
            const badgeCls = CATEGORY_BADGE[category] ?? 'text-app-tx2 bg-app-surface2 border-app-border';
            return (
              <div key={category} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`chip border ${badgeCls}`}>{category}</span>
                  <span className="text-[11px] tabular-nums text-app-tx3">
                    {exs.length} exercise{exs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div>
                  {exs.map((ex) => (
                    <Link
                      key={ex.id}
                      href={`/progress/${ex.id}`}
                      className="flex items-center justify-between py-2.5 border-b border-app-border last:border-0 last:pb-0 transition-colors hover:text-acc-teal"
                    >
                      <span className="text-app-tx1 text-sm">{ex.name}</span>
                      {/* Each machine's step at B_Fit: his own in teal, learned
                          in grey, "set" where he has not said yet. */}
                      {pins[ex.id] && !timed.has(ex.name) && ex.category !== 'CARDIO' ? (
                        <span className={`text-xs tabular-nums ${pins[ex.id].source === 'yours' ? 'text-acc-teal' : 'text-app-tx3'}`}>
                          {pins[ex.id].source === 'fallback' ? 'set step →' : `${fmt(pins[ex.id].kg)} kg →`}
                        </span>
                      ) : (
                        <span className="text-app-tx3 text-xs">→</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
