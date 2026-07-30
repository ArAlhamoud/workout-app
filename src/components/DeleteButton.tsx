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
      className="text-red-400 hover:text-red-300 text-sm font-medium border border-red-900/50 hover:border-red-700/60 px-3 py-2 rounded-card transition-colors pressable flex-shrink-0"
    >
      Delete
    </button>
  );
}
