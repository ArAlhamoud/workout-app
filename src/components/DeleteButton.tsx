'use client';

import { deleteWorkout } from '@/app/actions';

export default function DeleteButton({ workoutId }: { workoutId: string }) {
  return (
    <button
      onClick={async () => {
        if (confirm('Delete this workout?')) {
          await deleteWorkout(workoutId);
        }
      }}
      className="text-red-400 hover:text-red-300 text-sm border border-red-900 hover:border-red-700 px-3 py-2 rounded-lg transition-colors"
    >
      Delete
    </button>
  );
}
