'use client';

import { useTransition } from 'react';
import { deleteBodyStat } from '@/app/actions';

export default function DeleteBodyStatButton({ statId }: { statId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => deleteBodyStat(statId))}
      disabled={pending}
      className="w-8 h-8 -mr-2 flex items-center justify-center text-app-tx3 hover:text-red-400 transition-colors text-sm disabled:opacity-40"
    >
      {pending ? '…' : '×'}
    </button>
  );
}
