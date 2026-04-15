import { getExercises } from '../actions';
import ExerciseForm from '@/components/ExerciseForm';

const CATEGORIES = ['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'CARDIO', 'OTHER'];

export default async function ExercisesPage() {
  const exercises = await getExercises();

  const grouped = exercises.reduce<Record<string, typeof exercises>>((acc, ex) => {
    if (!acc[ex.category]) acc[ex.category] = [];
    acc[ex.category].push(ex);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Exercise Library</h1>
        <p className="text-gray-400 mt-1">Manage your exercise database</p>
      </div>

      <ExerciseForm categories={CATEGORIES} />

      {exercises.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800 border-dashed">
          <p className="text-gray-400">No exercises yet. Add your first one above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, exs]) => (
            <div key={category} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                {category}
              </h2>
              <div className="space-y-1">
                {exs.map((ex) => (
                  <div key={ex.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <span className="text-white">{ex.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
