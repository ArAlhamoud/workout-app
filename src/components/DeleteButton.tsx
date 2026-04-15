'use client';

import { useTransition } from 'react';
import { deleteWorkout } from '@/app/actions';

export default function DeleteButton({ workoutId }: { workoutId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => {
        if (confirm('Delete this workout?')) {
          startTransition(() => deleteWorkout(workoutId));
        }
      }}
      className="text-red-400 hover:text-red-300 text-sm border border-red-900 hover:border-red-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
    >
      {isPending ? 'Deleting...' : 'Delete'}
    </button>
  );
}
