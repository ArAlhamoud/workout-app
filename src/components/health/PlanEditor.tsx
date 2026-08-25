'use client';

// The editor the review demanded: without it the dose plan fossilizes at
// the week-7 checkpoint forever, labs stay at the pre-app baseline, and a
// fat-fingered injection is permanent. Everything here calls the bounded
// server actions — the model never touches these, only he does.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateHealthProfile,
  addLabResult,
  deleteLabResult,
  deleteInjection,
} from '@/app/health-actions';
import { siteLabel, type DosePlanStep } from '@/lib/health-insights';
import { hapticSuccess } from '@/lib/native-feedback';

const inputCls =
  'w-full rounded-card border border-app-border bg-app-surface2 px-3 py-2.5 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:border-acc-cyan/60 focus:outline-none';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function PlanEditor({
  profile,
  injections,
  labs,
}: {
  profile: {
    heightCm: number;
    startWeightKg: number;
    goalWeightKg: number;
    milestonesKg: number[];
    dosePlan: DosePlanStep[];
    reminders: Record<string, boolean>;
  };
  injections: Array<{ id: string; at: string; doseMg: number; site: string }>;
  labs: Array<{ id: string; date: string; test: string; value: number; unit: string }>;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<DosePlanStep[]>(profile.dosePlan);
  const [reminders, setReminders] = useState(profile.reminders);
  const [goal, setGoal] = useState(String(profile.goalWeightKg));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [labTest, setLabTest] = useState('');
  const [labValue, setLabValue] = useState('');
  const [labUnit, setLabUnit] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const flash = (m: string) => {
    hapticSuccess();
    setMsg(m);
    router.refresh();
    setTimeout(() => setMsg(''), 2500);
  };
  const run = async (fn: () => Promise<unknown>, m: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      flash(m);
    } catch {
      setMsg('Could not save — check the values.');
      setTimeout(() => setMsg(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  const setStepMg = (week: number, raw: string) => {
    setPlan((cur) =>
      cur.map((s) =>
        s.week === week
          ? raw.trim() === ''
            ? { week: s.week, mg: null, label: s.label ?? 'Doctor review' }
            : { week: s.week, mg: Number(raw) }
          : s,
      ),
    );
  };

  return (
    <div className="space-y-4">
      {msg && <p className="text-center text-xs text-acc-teal">{msg}</p>}

      {/* Dose plan — one row per dose slot */}
      <div className="card-lg space-y-2 p-4">
        <div className="flex items-baseline justify-between">
          <p className="section-label">Dose plan</p>
          <p className="text-[10px] text-app-tx3">empty mg = doctor-review checkpoint</p>
        </div>
        <div className="space-y-1.5">
          {plan.map((s) => (
            <div key={s.week} className="flex items-center gap-2">
              <span className="w-16 flex-none text-xs font-semibold text-app-tx2">Dose {s.week}</span>
              <input
                className={`${inputCls} flex-1`}
                inputMode="decimal"
                placeholder="checkpoint"
                defaultValue={s.mg ?? ''}
                onChange={(e) => setStepMg(s.week, e.target.value)}
              />
              <span className="w-14 flex-none text-[11px] text-app-tx3">
                {s.mg == null ? s.label ?? 'review' : 'mg'}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() =>
              setPlan((cur) => [
                ...cur,
                { week: (cur[cur.length - 1]?.week ?? 0) + 1, mg: cur.findLast?.((s) => s.mg != null)?.mg ?? 2.5 },
              ])
            }
            className="flex-1 rounded-card border border-app-border bg-app-surface2/60 py-2.5 text-xs font-bold text-app-tx2"
          >
            + Add dose slot
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => updateHealthProfile({ dosePlan: plan }), 'Plan saved')}
            className="flex-1 rounded-card bg-acc-cyan/15 py-2.5 text-xs font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Save plan
          </button>
        </div>
      </div>

      {/* Reminders */}
      <div className="card-lg space-y-2 p-4">
        <p className="section-label">Reminders</p>
        {(
          [
            ['injection', 'Injection day (18:00)'],
            ['missed', 'Missed dose (next morning)'],
            ['daySymptoms', 'Day-1 symptom check (20:00)'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              const next = { ...reminders, [key]: reminders[key] === false };
              setReminders(next);
              void run(() => updateHealthProfile({ reminders: next }), 'Reminders saved');
            }}
            className="flex min-h-[44px] w-full items-center justify-between rounded-card border border-app-border bg-app-surface2/60 px-3 text-sm text-app-tx1"
          >
            <span>{label}</span>
            <span className={`text-xs font-bold ${reminders[key] === false ? 'text-app-tx3' : 'text-acc-teal'}`}>
              {reminders[key] === false ? 'off' : 'on'}
            </span>
          </button>
        ))}
      </div>

      {/* Goal */}
      <div className="card-lg space-y-2 p-4">
        <p className="section-label">Goal weight</p>
        <div className="flex gap-2">
          <input className={`${inputCls} flex-1`} inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <button
            type="button"
            disabled={busy || !Number(goal)}
            onClick={() => run(() => updateHealthProfile({ goalWeightKg: Number(goal) }), 'Goal saved')}
            className="flex-none rounded-card bg-acc-cyan/15 px-4 text-xs font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Save
          </button>
        </div>
      </div>

      {/* Labs */}
      <div className="card-lg space-y-2 p-4">
        <p className="section-label">Labs</p>
        <div className="grid grid-cols-3 gap-2">
          <input className={inputCls} placeholder="Test (ldl…)" value={labTest} onChange={(e) => setLabTest(e.target.value)} />
          <input className={inputCls} inputMode="decimal" placeholder="Value" value={labValue} onChange={(e) => setLabValue(e.target.value)} />
          <input className={inputCls} placeholder="Unit" value={labUnit} onChange={(e) => setLabUnit(e.target.value)} />
        </div>
        <button
          type="button"
          disabled={busy || !labTest.trim() || !Number(labValue) || !labUnit.trim()}
          onClick={() =>
            run(async () => {
              await addLabResult({
                date: new Date().toISOString(),
                test: labTest,
                value: Number(labValue),
                unit: labUnit,
              });
              setLabTest(''); setLabValue(''); setLabUnit('');
            }, 'Lab saved')
          }
          className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-xs font-bold text-acc-cyan disabled:text-app-tx3"
        >
          Add result (dated today)
        </button>
        <div className="space-y-1 pt-1">
          {labs.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-app-tx1">
                {l.test.toUpperCase()} {l.value} {l.unit}
                <span className="text-app-tx3"> · {fmtDay(l.date)}</span>
              </span>
              <button
                type="button"
                aria-label={`Delete ${l.test} result`}
                onClick={() => run(() => deleteLabResult(l.id), 'Lab removed')}
                className="min-h-[44px] px-2 text-app-tx3 hover:text-rpe-grind"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Recent injections — the undo for a fat-fingered log */}
      {injections.length > 0 && (
        <div className="card-lg space-y-1 p-4">
          <p className="section-label mb-1">Recent injections</p>
          {injections.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-app-tx1">
                {fmtDay(i.at)} · {i.doseMg} mg · {siteLabel(i.site)}
              </span>
              {confirmDelete === i.id ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(null); void run(() => deleteInjection(i.id), 'Injection removed'); }}
                    className="min-h-[44px] rounded-card border border-rpe-grind/40 bg-rpe-grind/10 px-3 text-xs font-bold text-rpe-grind"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-[44px] px-2 text-xs text-app-tx3">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label="Delete this injection"
                  onClick={() => setConfirmDelete(i.id)}
                  className="min-h-[44px] px-2 text-app-tx3 hover:text-rpe-grind"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <p className="pt-1 text-[10px] text-app-tx3">
            Deleting an injection rewinds the treatment clock and rotation — for wrong entries
            only.
          </p>
        </div>
      )}
    </div>
  );
}
