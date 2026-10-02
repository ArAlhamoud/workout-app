'use client';

// The injection log: dose (prefilled from the plan), site (prefilled from
// the rotation assistant), optional details behind a disclosure, then an
// immediate after-dose symptom pass. Fast path is three taps: Save.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logInjection, logSymptoms } from '@/app/health-actions';
import { SITES, siteLabel, initialDoseChoice } from '@/lib/health-insights';
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
  // A review slot (or a plan that has ended) preselects nothing: the dose
  // is the doctor's, and one tap must not store last week's.
  const [dose, setDose] = useState(initialDoseChoice(plannedDoseMg, lastDoseMg, isFirst));
  // When he took it. "Now" unless he says earlier: a dose taken Tuesday
  // night and logged after midnight was stored as Wednesday's, moved the
  // next-due day and was hand-patched two weeks running.
  const [earlier, setEarlier] = useState(false);
  const [takenAt, setTakenAt] = useState('');
  // Separate state for the free-form field: deriving it from `dose` wiped
  // the field mid-typing whenever a keystroke momentarily equalled a preset
  // ("7" on the way to "7.5") — device-tester.
  const [customDose, setCustomDose] = useState('');
  const [site, setSite] = useState(recommendedSite);
  const [details, setDetails] = useState(false);
  const [clicks, setClicks] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [after, setAfter] = useState<Record<string, number>>({});
  const [afterSaved, setAfterSaved] = useState(false);

  const effectiveDose = customDose !== '' ? Number(customDose) : dose !== '' ? Number(dose) : NaN;
  const takenISO = earlier && takenAt ? new Date(takenAt).toISOString() : undefined;
  const timeMissing = earlier && !takenAt;
  // At a checkpoint (planned mg null) every dose is doctor-directed:
  // nothing is "on schedule" because nothing was scheduled.
  const offPlan = plannedDoseMg == null || effectiveDose !== plannedDoseMg;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await logInjection({
        doseMg: effectiveDose,
        site,
        clicks: clicks ? Number(clicks) : undefined,
        onSchedule: !offPlan,
        notes: notes || undefined,
        at: takenISO,
      });
      hapticSuccess();
      setSaved(true);
      router.refresh();
    } catch {
      setError('Could not save — check the dose (0.5–20 mg), the time and your connection.');
    } finally {
      setBusy(false);
    }
  };

  const saveAfter = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await logSymptoms(
        Object.entries(after).map(([kind, severity]) => ({ kind, severity })),
      );
      hapticSuccess();
      setAfterSaved(true);
      router.refresh();
    } catch {
      setError('Could not save the symptoms — try again.');
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
        {!afterSaved ? (
          <div className="mt-3 space-y-2.5 border-t border-ink/10 pt-3">
            <p className="text-xs font-semibold text-app-tx2">
              How do you feel? (optional)
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
            {error && <p className="text-xs text-rpe-hard">{error}</p>}
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
          <p className="mt-3 border-t border-ink/10 pt-3 text-sm text-acc-teal">
            Saved.
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
              onClick={() => { setDose(String(d)); setCustomDose(''); }}
              className={`flex-1 rounded-card border py-2.5 text-sm font-bold tabular-nums transition-all ${
                customDose === '' && dose !== '' && Number(dose) === d
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
            value={customDose}
            onChange={(e) => setCustomDose(e.target.value)}
          />
        </div>
        {plannedDoseMg != null && offPlan && (
          <p className="mt-1.5 text-[11px] text-acc-ember">
            Off-plan · plan says {plannedDoseMg} mg
          </p>
        )}
        {plannedDoseMg == null && (
          <p className="mt-1.5 text-[11px] text-acc-ember">
            No dose is scheduled for this slot — choose the dose your doctor set.
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs text-app-tx3">Taken</p>
        <div className="flex gap-1.5">
          {([['Now', false], ['Earlier', true]] as const).map(([label, v]) => (
            <button
              key={label}
              type="button"
              onClick={() => setEarlier(v)}
              className={`flex-1 rounded-card border py-2.5 text-xs font-semibold transition-all ${
                earlier === v
                  ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
                  : 'border-app-border bg-app-surface2/60 text-app-tx2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {earlier && (
          <input
            type="datetime-local"
            aria-label="When the injection was taken"
            className={`${inputCls} mt-1.5 w-full`}
            value={takenAt}
            onChange={(e) => setTakenAt(e.target.value)}
          />
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

      {error && <p className="text-xs text-rpe-hard">{error}</p>}
      <button
        type="button"
        disabled={busy || !Number.isFinite(effectiveDose) || effectiveDose <= 0 || timeMissing}
        onClick={save}
        className="w-full rounded-card-lg bg-gradient-to-r from-acc-cyan to-acc-teal py-3.5 text-sm font-bold text-white shadow-glow-teal transition-all active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? 'Saving…' : Number.isFinite(effectiveDose) && effectiveDose > 0 ? `Save injection · ${effectiveDose} mg · ${siteLabel(site)}` : 'Choose a dose'}
      </button>
    </div>
  );
}
