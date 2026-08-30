'use client';

// The pressure room's working half: log a reading with its moment tagged,
// and keep the history honest (delete needs a second tap; imported rows
// wear their provenance). Averages and trends stay server-side — this
// component only writes and lists.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteBpReading, logBp } from '@/app/health-actions';
import { BP_CONTEXT_LABEL } from '@/lib/health-insights';
import { hapticSuccess } from '@/lib/native-feedback';

export interface BpRow {
  id: string;
  at: string; // ISO
  systolic: number;
  diastolic: number;
  pulse: number | null;
  context: string | null;
  imported: boolean;
}

const CONTEXTS = [
  ['morning', 'Morning'],
  ['evening', 'Evening'],
  ['before-med', 'Before med'],
  ['after-med', 'After med'],
  ['clinic', 'Clinic'],
] as const;

const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';

export default function BpTracker({ readings }: { readings: BpRow[] }) {
  const router = useRouter();
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [context, setContext] = useState<string | null>(
    new Date().getHours() < 12 ? 'morning' : 'evening',
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      hapticSuccess();
      setMsg(done);
      router.refresh();
    } catch {
      setMsg('Could not save.');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 2000);
    }
  };

  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const grouped: Array<{ day: string; rows: BpRow[] }> = [];
  for (const r of readings) {
    const day = dayKey(r.at);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else grouped.push({ day, rows: [r] });
  }

  return (
    <div className="space-y-4">
      {/* Log a reading */}
      <div className="card-lg space-y-2.5 p-4">
        <p className="section-label">New reading</p>
        <div className="grid grid-cols-3 gap-2">
          <input className={inputCls} inputMode="numeric" placeholder="Sys" value={sys} onChange={(e) => setSys(e.target.value)} />
          <input className={inputCls} inputMode="numeric" placeholder="Dia" value={dia} onChange={(e) => setDia(e.target.value)} />
          <input className={inputCls} inputMode="numeric" placeholder="Pulse" value={pulse} onChange={(e) => setPulse(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CONTEXTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setContext(context === key ? null : key)}
              className={`min-h-[40px] rounded-full border-2 px-3 text-xs font-bold ${
                context === key
                  ? 'border-ink bg-ink text-white'
                  : 'border-ink/20 bg-app-surface text-app-tx2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !sys || !dia}
          className="w-full min-h-[48px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-ink shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] disabled:opacity-40"
          onClick={() =>
            run(
              () =>
                logBp({
                  systolic: Number(sys),
                  diastolic: Number(dia),
                  pulse: pulse ? Number(pulse) : undefined,
                  context: context ?? undefined,
                }),
              'Reading saved',
            ).then(() => { setSys(''); setDia(''); setPulse(''); })
          }
        >
          Save reading
        </button>
        {msg && <p className="text-xs font-bold text-acc-teal">{msg}</p>}
      </div>

      {/* History */}
      {grouped.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-2">Every reading</p>
          <div className="space-y-3">
            {grouped.map((g) => (
              <div key={g.day}>
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-app-tx3">{g.day}</p>
                <div className="divide-y divide-ink/5">
                  {g.rows.map((r) => (
                    <div key={r.id} className="flex min-h-[44px] items-center justify-between gap-2 py-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="font-round text-base font-extrabold tabular-nums text-app-tx1">
                          {r.systolic}/{r.diastolic}
                        </span>
                        {r.pulse != null && (
                          <span className="text-xs font-semibold tabular-nums text-app-tx2">{r.pulse} bpm</span>
                        )}
                        <span className="text-[11px] font-semibold text-app-tx3">
                          {new Date(r.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          {r.context ? ` · ${BP_CONTEXT_LABEL[r.context] ?? r.context}` : ''}
                          {r.imported ? ' · Health' : ''}
                        </span>
                      </div>
                      {confirmDelete === r.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            className="min-h-[44px] rounded-card border-2 border-ink bg-rpe-hard px-2.5 text-xs font-extrabold text-white"
                            onClick={() => { setConfirmDelete(null); void run(() => deleteBpReading(r.id), 'Reading removed'); }}
                          >
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-[44px] px-2 text-xs text-app-tx3">
                            keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete the ${r.systolic}/${r.diastolic} reading`}
                          onClick={() => setConfirmDelete(r.id)}
                          className="min-h-[44px] px-2 text-lg leading-none text-app-tx3"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
