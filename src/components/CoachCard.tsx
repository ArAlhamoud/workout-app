'use client';

// The coach's morning brief on the home screen. Renders NOTHING until a
// note exists — no placeholder, no spinner, no empty state. The
// deterministic HomeVerdict above it always carries the glance; this card
// is the voice underneath it.

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Directive {
  type: string;
  label: string;
}

const CHIP_STYLE: Record<string, string> = {
  session: 'border-acc-teal/40 bg-acc-teal/10 text-acc-teal',
  rescue: 'border-acc-ember/40 bg-acc-ember/10 text-acc-ember',
  rest: 'border-acc-cyan/40 bg-acc-cyan/10 text-acc-cyan',
  'hold-weights': 'border-rpe-med/40 bg-rpe-med/10 text-rpe-med',
  'weigh-in': 'border-app-border bg-app-surface2 text-app-tx2',
  flag: 'border-rpe-hard/40 bg-rpe-hard/10 text-rpe-hard',
};

export default function CoachCard() {
  const [note, setNote] = useState<{ brief: string; directives: Directive[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/brief')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.note?.brief) setNote(data.note);
      })
      .catch(() => { /* the deterministic layer stands alone */ });
    return () => { cancelled = true; };
  }, []);

  if (!note) return null;

  return (
    <Link href="/coach" className="block card-lg px-4 py-3.5 transition-colors hover:border-app-border-hi">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="section-label">Coach</p>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-tx3">ask →</span>
      </div>
      <p className="text-app-tx1 text-sm leading-relaxed">{note.brief}</p>
      {note.directives.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {note.directives.map((d, i) => (
            <span
              key={i}
              className={`chip border ${CHIP_STYLE[d.type] ?? CHIP_STYLE['weigh-in']}`}
            >
              {d.label}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
