'use client';

// The injection log: dose (prefilled from the plan), site (prefilled from
// the rotation assistant), optional details behind a disclosure, then an
// immediate after-dose symptom pass. Fast path is three taps: Save.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logInjection, logSymptoms } from '@/app/health-actions';
import { SITES, siteLabel } from '@/lib/health-insights';
import { hapticSuccess } from '@/lib/native-feedback';

const AFTER_KINDS = [
  ['nausea', 'Nausea'],
  ['appetite-suppression', 'Low appetite'],
  ['fullness', 'Early fullness'],
  ['bloating', 'Bloating'],
  ['fatigue', 'Fatigue'],
  ['headache', 'Headache'],
  ['dizziness', 'Dizziness'],
] as const;

const SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe'];

const inputCls =
  'w-full rounded-card border border-app-border bg-app-surface2 px-3 py-2.5 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:border-acc-cyan/60 focus:outline-none';

export default function InjectionForm({
  recommendedSite,
  plannedDoseMg,
  lastDoseMg,
  isFirst,
}: {
  recommendedSite: string;
  plannedDoseMg: number | null;
  lastDoseMg: number | null;
  isFirst: boolean;
}) {
  const router = useRouter();
  const [dose, setDose] = useState(String(plannedDoseMg ?? lastDoseMg ?? 2.5));
  const [site, setSite] = useState(recommendedSite);
  const [details, setDetails] = useState(false);
  const [clicks, setClicks] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [after, setAfter] = useState<Record<string, number>>({});
  const [afterSaved, setAfterSaved] = useState(false);

  const offPlan = plannedDoseMg != null && Number(dose) !== plannedDoseMg;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logInjection({
        doseMg: Number(dose),
        site,
        clicks: clicks ? Number(clicks) : undefined,
        onSchedule: !offPlan,
        notes: notes || undefined,
      });
      hapticSuccess();
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveAfter = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logSymptoms(
        Object.entries(after).map(([kind, severity]) => ({ kind, severity })),
      );
      hapticSuccess();
      setAfterSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="card-lg border-acc-cyan/40 p-4">
        <p className="glow-cyan font-round text-lg font-bold">
          {isFirst ? 'Week 1 starts now.' : 'Dose logged.'}
        </p>
        <p className="mt-1 text-sm text-app-tx2">
          {isFirst
            ? 'The treatment clock is running — everything you log from here plots against this timeline.'
            : 'Site rotation updated for next week.'}
        </p>
        {!afterSaved ? (
          <div className="mt-3 space-y-2.5 border-t border-white/10 pt-3">
            <p className="text-xs font-semibold text-app-tx2">
              How do you feel right now? (optional — you can also log tomorrow)
            </p>
            {AFTER_KINDS.map(([kind, label]) => (
              <div key={kind} className="flex items-center gap-2">
                <span className="w-24 flex-none text-xs font-semibold text-app-tx2">{label}</span>
                <div className="flex flex-1 gap-1">
                  {SEVERITIES.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAfter((cur) => ({ ...cur, [kind]: i }))}
                      className={`flex-1 rounded-card border px-1 py-1.5 text-[10px] font-semibold transition-all ${
                        (after[kind] ?? 0) === i
                          ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
                          : 'border-app-border bg-app-surface2/60 text-app-tx3'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              disabled={busy || !Object.values(after).some((v) => v > 0)}
              onClick={saveAfter}
              className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-sm font-bold text-acc-cyan disabled:text-app-tx3"
            >
              Save symptoms
            </button>
          </div>
        ) : (
          <p className="mt-3 border-t border-white/10 pt-3 text-sm text-acc-teal">
            Symptoms saved. See you tomorrow for the day-1 check-in.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card-lg space-y-3 p-4">
      <p className="section-label">Log the injection</p>
      <div>
        <p className="mb-1.5 text-xs text-app-tx3">Dose (mg)</p>
        <div className="flex gap-1.5">
          {[2.5, 5, 7.5, 10].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDose(String(d))}
              className={`flex-1 rounded-card border py-2.5 text-sm font-bold tabular-nums transition-all ${
                Number(dose) === d
                  ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
                  : 'border-app-border bg-app-surface2/60 text-app-tx2'
              }`}
            >
              {d}
            </button>
          ))}
          <input
            className={`${inputCls} flex-1`}
            inputMode="decimal"
            placeholder="…"
            value={[2.5, 5, 7.5, 10].includes(Number(dose)) ? '' : dose}
            onChange={(e) => setDose(e.target.value)}
          />
        </div>
        {offPlan && (
          <p className="mt-1.5 text-[11px] text-acc-ember">
            Off-plan dose (plan says {plannedDoseMg} mg) — it will be marked as such, which is
            fine when it&apos;s what you and your doctor chose.
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs text-app-tx3">Site</p>
        <div className="grid grid-cols-2 gap-1.5">
          {SITES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSite(s)}
              className={`rounded-card border px-2 py-2.5 text-xs font-semibold transition-all ${
                site === s
                  ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
                  : 'border-app-border bg-app-surface2/60 text-app-tx2'
              }`}
            >
              {siteLabel(s)}
              {s === recommendedSite ? ' ·  next in rotation' : ''}
            </button>
          ))}
        </div>
      </div>

      {!details ? (
        <button type="button" onClick={() => setDetails(true)} className="text-xs font-semibold text-app-tx3">
          + pen clicks / notes
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} inputMode="numeric" placeholder="Pen clicks" value={clicks} onChange={(e) => setClicks(e.target.value)} />
          <input className={inputCls} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}

      <button
        type="button"
        disabled={busy || !Number(dose)}
        onClick={save}
        className="w-full rounded-card-lg bg-gradient-to-r from-acc-cyan to-acc-teal py-3.5 text-sm font-bold text-[#04222a] shadow-glow-teal transition-all active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? 'Saving…' : `Save injection · ${dose || '—'} mg · ${siteLabel(site)}`}
      </button>
    </div>
  );
}
