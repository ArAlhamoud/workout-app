import { getExercises } from '../../actions';
import WorkoutForm from '@/components/WorkoutForm';

export default async function NewWorkoutPage() {
  const exercises = await getExercises();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Log Workout</h1>
        <p className="text-gray-400 mt-1">Record your training session</p>
      </div>
      <WorkoutForm exercises={exercises} />
    </div>
  );
}
