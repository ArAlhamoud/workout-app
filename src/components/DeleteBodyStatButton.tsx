'use client';

import { useTransition } from 'react';
import { deleteBodyStat } from '@/app/actions';

export default function DeleteBodyStatButton({ statId }: { statId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => deleteBodyStat(statId))}
      disabled={pending}
      className="text-gray-700 hover:text-red-400 transition-colors text-sm disabled:opacity-40"
    >
      {pending ? '…' : '×'}
    </button>
  );
}
