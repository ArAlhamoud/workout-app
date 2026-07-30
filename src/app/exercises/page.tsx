import type { Metadata } from 'next';
import { getExercises } from '../actions';
import ExerciseForm from '@/components/ExerciseForm';
import { CATEGORY_BADGE } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Exercises' };

const CATEGORIES = ['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO', 'OTHER'];

export default async function ExercisesPage() {
  const exercises = await getExercises();

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
      {/* Header */}
      <div className="pt-1">
        <h1 className="text-xl font-bold text-app-tx1">Exercise Library</h1>
        <p className="text-app-tx3 text-sm mt-0.5">Manage your exercise database</p>
      </div>

      <ExerciseForm categories={CATEGORIES} />

      {exercises.length === 0 ? (
        <div className="card-lg p-10 text-center border-dashed">
          <p className="text-app-tx2 font-medium mb-1">No exercises yet</p>
          <p className="text-app-tx3 text-sm">
            Add your first one above, or run <code className="text-teal-400">npm run db:seed</code> to load defaults.
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
                  <span className="text-[11px] text-app-tx3">
                    {exs.length} exercise{exs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div>
                  {exs.map((ex) => (
                    <div
                      key={ex.id}
                      className="flex items-center justify-between py-2.5 border-b border-app-border last:border-0 last:pb-0"
                    >
                      <span className="text-app-tx1 text-sm">{ex.name}</span>
                    </div>
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
