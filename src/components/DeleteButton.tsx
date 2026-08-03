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
      // Recessive by default. This screen exists to read a finished session,
      // and a red-outlined button was the loudest thing on it — sitting exactly
      // where a thumb lands. It stays reachable, turns red on press, and no
      // longer competes with the workout title for attention.
      className="text-app-tx3 hover:text-red-300 active:text-red-300 text-sm font-medium border border-app-border hover:border-red-700/60 active:border-red-700/60 px-3 py-2 rounded-card transition-colors pressable flex-shrink-0"
    >
      Delete
    </button>
  );
}
