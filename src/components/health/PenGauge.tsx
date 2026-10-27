// The pen at a glance: mg left as the number, one segment per dose with
// the doses left lit, and one line under it (glance rule). Derived from
// the log (src/lib/pen.ts); says nothing about dose or storage.

import { buyByLabel, penSegments, penLine, type PenStatus } from '@/lib/pen';

export default function PenGauge({ pen }: { pen: PenStatus }) {
  const seg = penSegments(pen);
  const finished = pen.dosesLeft === 0;
  return (
    <div className="card-lg p-4">
      <div className="flex items-baseline justify-between">
        <p className="section-label">Pen</p>
        <p className="font-round text-app-tx1">
          <span className="text-xl font-bold tabular-nums">{pen.remainingMg}</span>
          <span className="ml-1 text-xs text-app-tx3">of {pen.totalMg} mg left</span>
        </p>
      </div>
      {seg ? (
        <div className="mt-2.5 flex gap-1" aria-hidden="true">
          {Array.from({ length: seg.count }, (_, k) => (
            <span
              key={k}
              className={`h-3 flex-1 rounded-[3px] ${k < seg.lit ? 'bg-acc-cyan' : 'bg-ink/10'}`}
            />
          ))}
        </div>
      ) : (
        <div className="mt-2.5 h-3 overflow-hidden rounded-[3px] bg-ink/10" aria-hidden="true">
          <div className="h-full bg-acc-cyan" style={{ width: `${(pen.remainingMg / pen.totalMg) * 100}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-app-tx2">
        {finished
          ? penLine(pen)
          : `${pen.dosesLeft} dose${pen.dosesLeft === 1 ? '' : 's'} left · buy by ${buyByLabel(pen.buyByISO)}`}
      </p>
    </div>
  );
}
