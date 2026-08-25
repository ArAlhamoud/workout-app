'use client';

// One-tap quick logs — the <10-second promise. One row of actions, each
// expanding a form small enough that the common case is: tap, tap, Save.
// Last-value defaults come from localStorage so repeat entries are two
// taps; anything longer belongs on a full screen, not here.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logBp, logSymptoms, logAfEpisode, logCpapNight, logNutrition } from '@/app/health-actions';
import { hapticSuccess } from '@/lib/native-feedback';

type Sheet = 'bp' | 'gi' | 'af' | 'cpap' | 'fuel' | null;

const SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe'];

// Vomiting and dizziness are here because the severe-symptom notice
// watches for them — a red-flag kind with no logging surface is a promise
// the app cannot keep (clinical-safety blocker).
const GI_KINDS = [
  ['bloating', 'Bloating'],
  ['gas', 'Gas'],
  ['nausea', 'Nausea'],
  ['vomiting', 'Vomiting'],
  ['reflux', 'Reflux'],
  ['constipation', 'Constipation'],
  ['diarrhea', 'Diarrhea'],
  ['abdominal-pain', 'Abd. pain'],
  ['dizziness', 'Dizziness'],
  ['fatigue', 'Fatigue'],
] as const;

const AF_FLAGS = [
  ['bloating', 'Bloating'],
  ['gas', 'Gas'],
  ['afterMeal', 'After meal'],
  ['sleepRelated', 'Sleep'],
  ['caffeine', 'Caffeine'],
  ['stress', 'Stress'],
] as const;

function dayKeyLocal(daysBack = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** CPAP nights are keyed by the morning they ended. Logging just after
 *  midnight is about the night that ended YESTERDAY morning unless he has
 *  already slept — so before 06:00 the default flips back a day, and the
 *  toggle makes the choice visible either way (adversary: a post-midnight
 *  log filed under the wrong night, then got overwritten by the real one). */
function defaultNightBack(): number {
  return new Date().getHours() < 6 ? 1 : 0;
}
const nightLabel = (daysBack: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `ended ${d.toLocaleDateString('en-US', { weekday: 'short' })} morning`;
};

const remember = (k: string, v: string) => {
  try { localStorage.setItem(`health-last-${k}`, v); } catch { /* fine */ }
};
const recall = (k: string, fallback: string) => {
  try { return localStorage.getItem(`health-last-${k}`) ?? fallback; } catch { return fallback; }
};

const inputCls =
  'w-full rounded-card border border-app-border bg-app-surface2 px-3 py-2.5 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:border-acc-cyan/60 focus:outline-none';
// min-h 44px: the app's own touch-target floor (device-tester).
const segBtn = (active: boolean) =>
  `flex-1 rounded-card border px-1 min-h-[44px] text-xs font-semibold transition-all ${
    active
      ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
      : 'border-app-border bg-app-surface2/60 text-app-tx3'
  }`;
const flagBtn = (state: boolean | undefined) =>
  `rounded-full border px-3 min-h-[44px] text-[11px] font-semibold transition-all ${
    state === true
      ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
      : state === false
      ? 'border-rpe-grind/40 bg-rpe-grind/10 text-rpe-grind line-through'
      : 'border-app-border bg-app-surface2/60 text-app-tx3'
  }`;

export default function QuickLog() {
  const router = useRouter();
  const [open, setOpen] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  // BP
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  // GI
  const [giSeverity, setGiSeverity] = useState<Record<string, number>>({});
  // AF
  const [afWhen, setAfWhen] = useState<'now' | 'earlier'>('now');
  const [afStart, setAfStart] = useState('');
  const [afDuration, setAfDuration] = useState('');
  const [afHr, setAfHr] = useState('');
  // tri-state: undefined = not asked, true/false = answered — the honest
  // denominator the correlation screen depends on.
  const [afFlags, setAfFlags] = useState<Record<string, boolean | undefined>>({});
  const [afEcg, setAfEcg] = useState(false);
  // CPAP
  const [cpapNightBack, setCpapNightBack] = useState(defaultNightBack());
  const [cpapHours, setCpapHours] = useState('');
  const [cpapAhi, setCpapAhi] = useState('');
  const [cpapLeak, setCpapLeak] = useState('');
  const [cpapP95, setCpapP95] = useState('');
  // Fuel
  const [protein, setProtein] = useState('');
  const [water, setWater] = useState('');

  const finish = (msg: string) => {
    hapticSuccess();
    setDone(msg);
    setOpen(null);
    setBusy(false);
    router.refresh();
    setTimeout(() => setDone(''), 2500);
  };

  const submit = async (fn: () => Promise<unknown>, msg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      finish(msg);
    } catch {
      setBusy(false);
      setDone('Could not save — check the values.');
      setTimeout(() => setDone(''), 3000);
    }
  };

  const toggle = (sheet: Sheet) => setOpen(open === sheet ? null : sheet);

  return (
    <div className="card-lg p-3">
      <div className="grid grid-cols-5 gap-1.5">
        {(
          [
            ['bp', 'BP'],
            ['gi', 'GI'],
            ['af', 'AF'],
            ['cpap', 'CPAP'],
            ['fuel', 'Fuel'],
          ] as const
        ).map(([sheet, label]) => (
          <button
            key={sheet}
            type="button"
            onClick={() => toggle(sheet)}
            className={`rounded-card border py-2.5 text-xs font-bold transition-all ${
              open === sheet
                ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
                : 'border-app-border bg-app-surface2/60 text-app-tx2 active:bg-ink/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {done && <p className="mt-2 text-center text-xs text-acc-teal">{done}</p>}

      {open === 'bp' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input className={inputCls} inputMode="numeric" placeholder="Sys" value={sys} onChange={(e) => setSys(e.target.value)} autoFocus />
            <input className={inputCls} inputMode="numeric" placeholder="Dia" value={dia} onChange={(e) => setDia(e.target.value)} />
            <input className={inputCls} inputMode="numeric" placeholder="Pulse" value={pulse} onChange={(e) => setPulse(e.target.value)} />
          </div>
          <button
            type="button"
            disabled={busy || !sys || !dia}
            onClick={() =>
              submit(
                () =>
                  logBp({
                    systolic: Number(sys),
                    diastolic: Number(dia),
                    pulse: pulse ? Number(pulse) : undefined,
                  }),
                `BP ${sys}/${dia} saved`,
              )
            }
            className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-sm font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Save reading
          </button>
        </div>
      )}

      {open === 'gi' && (
        <div className="mt-3 space-y-2.5">
          {GI_KINDS.map(([kind, label]) => (
            <div key={kind} className="flex items-center gap-2">
              <span className="w-20 flex-none text-xs font-semibold text-app-tx2">{label}</span>
              <div className="flex flex-1 gap-1">
                {SEVERITIES.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setGiSeverity((cur) => ({ ...cur, [kind]: i }))}
                    className={segBtn((giSeverity[kind] ?? 0) === i)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={busy || !Object.values(giSeverity).some((v) => v > 0)}
            onClick={() =>
              submit(async () => {
                await logSymptoms(
                  Object.entries(giSeverity).map(([kind, severity]) => ({ kind, severity })),
                );
                setGiSeverity({});
              }, 'Symptoms saved')
            }
            className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-sm font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Save symptoms
          </button>
        </div>
      )}

      {open === 'af' && (
        <div className="mt-3 space-y-2.5">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setAfWhen('now')} className={segBtn(afWhen === 'now')}>
              Happening now
            </button>
            <button type="button" onClick={() => setAfWhen('earlier')} className={segBtn(afWhen === 'earlier')}>
              Earlier
            </button>
          </div>
          {afWhen === 'earlier' && (
            <input
              type="datetime-local"
              className={inputCls}
              value={afStart}
              onChange={(e) => setAfStart(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} inputMode="numeric" placeholder="Duration (min)" value={afDuration} onChange={(e) => setAfDuration(e.target.value)} />
            <input className={inputCls} inputMode="numeric" placeholder="HR (bpm)" value={afHr} onChange={(e) => setAfHr(e.target.value)} />
          </div>
          <p className="text-[10px] text-app-tx3">Tap cycles yes / no / skip.</p>
          <div className="flex flex-wrap gap-1.5">
            {AF_FLAGS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setAfFlags((cur) => ({
                    ...cur,
                    [key]: cur[key] === true ? false : cur[key] === false ? undefined : true,
                  }))
                }
                className={flagBtn(afFlags[key])}
              >
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setAfEcg((v) => !v)} className={flagBtn(afEcg || undefined)}>
              Watch ECG taken
            </button>
          </div>
          <button
            type="button"
            disabled={busy || (afWhen === 'earlier' && !afStart)}
            onClick={() =>
              submit(async () => {
                await logAfEpisode({
                  startedAt:
                    afWhen === 'now' ? new Date().toISOString() : new Date(afStart).toISOString(),
                  durationMin: afDuration ? Number(afDuration) : undefined,
                  hrBpm: afHr ? Number(afHr) : undefined,
                  ecgRecorded: afEcg,
                  ...Object.fromEntries(Object.entries(afFlags).filter(([, v]) => v !== undefined)),
                });
                setAfFlags({});
                setAfDuration('');
                setAfHr('');
                setAfEcg(false);
              }, 'Episode logged')
            }
            className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-sm font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Log episode
          </button>
        </div>
      )}

      {open === 'cpap' && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1.5">
            {[defaultNightBack(), defaultNightBack() + 1].map((back) => (
              <button key={back} type="button" onClick={() => setCpapNightBack(back)} className={segBtn(cpapNightBack === back)}>
                {back === defaultNightBack() ? 'Last night' : 'Night before'} · {nightLabel(back)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} inputMode="decimal" placeholder={`Hours (${recall('cpap-h', 'e.g. 6.5')})`} value={cpapHours} onChange={(e) => setCpapHours(e.target.value)} autoFocus />
            <input className={inputCls} inputMode="decimal" placeholder="AHI" value={cpapAhi} onChange={(e) => setCpapAhi(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder="Leak (l/min)" value={cpapLeak} onChange={(e) => setCpapLeak(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder="P95 (cmH₂O)" value={cpapP95} onChange={(e) => setCpapP95(e.target.value)} />
          </div>
          <button
            type="button"
            disabled={busy || !cpapHours}
            onClick={() =>
              submit(async () => {
                await logCpapNight({
                  night: dayKeyLocal(cpapNightBack),
                  usageHours: Number(cpapHours),
                  ahi: cpapAhi ? Number(cpapAhi) : undefined,
                  leak: cpapLeak ? Number(cpapLeak) : undefined,
                  p95Pressure: cpapP95 ? Number(cpapP95) : undefined,
                });
                remember('cpap-h', cpapHours);
                setCpapHours(''); setCpapAhi(''); setCpapLeak(''); setCpapP95('');
              }, 'Night saved')
            }
            className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-sm font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Save night
          </button>
        </div>
      )}

      {open === 'fuel' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} inputMode="numeric" placeholder="Protein (g)" value={protein} onChange={(e) => setProtein(e.target.value)} autoFocus />
            <input className={inputCls} inputMode="numeric" placeholder="Water (ml)" value={water} onChange={(e) => setWater(e.target.value)} />
          </div>
          <button
            type="button"
            disabled={busy || (!protein && !water)}
            onClick={() =>
              submit(async () => {
                await logNutrition({
                  day: dayKeyLocal(0),
                  proteinG: protein ? Number(protein) : undefined,
                  waterMl: water ? Number(water) : undefined,
                });
                setProtein(''); setWater('');
              }, "Today's fuel saved")
            }
            className="w-full rounded-card bg-acc-cyan/15 py-2.5 text-sm font-bold text-acc-cyan disabled:text-app-tx3"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
