'use client';

// The daily check-in — a conversation, not a form. The app asks two
// questions (body → heart), one screen each, big targets, and
// writes through the same bounded actions the old quick-log used. Fifteen
// seconds on a good day; a bad day branches into one follow-up, never a
// table. Data-domain buttons (BP! GI! CPAP!) are tracker thinking — a
// companion asks "how are you?" (the owner's re-orientation, Aug 25).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logSymptoms, logAfEpisode, logBp, logCheckInNutrition } from '@/app/health-actions';
import { saveEach } from '@/lib/health-entry';
import { activityDayStr } from '@/lib/health-insights';
import { hapticSuccess } from '@/lib/native-feedback';

// The night questions are gone: the prisma report PDF owns CPAP truth
// (device-measured, weekly, PATCH-overwrites) — a morning guess added
// taps without adding data. The breath sheet on the body remains as the
// manual override.
type Step = 'body' | 'body-which' | 'heart' | 'heart-episode' | 'extras' | 'done';

const GI_PICK = [
  ['nausea', 'Nausea'],
  ['bloating', 'Bloating'],
  ['gas', 'Gas'],
  ['reflux', 'Reflux'],
  ['constipation', 'Constipation'],
  ['diarrhea', 'Diarrhea'],
  ['vomiting', 'Vomiting'],
  ['abdominal-pain', 'Belly pain'],
  ['headache', 'Headache'],
  ['dizziness', 'Dizziness'],
  ['fatigue', 'Fatigue'],
] as const;

const big =
  'w-full min-h-[52px] rounded-card border-2 border-ink bg-app-surface text-sm font-extrabold text-app-tx1 shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f]';
const bigTeal =
  'w-full min-h-[52px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f]';
const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';

export default function CheckIn() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('body');
  const [whichKind, setWhichKind] = useState<string | null>(null);
  const [severity, setSeverity] = useState(2);
  const [afMin, setAfMin] = useState('');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [protein, setProtein] = useState('');
  const [water, setWater] = useState('');
  const [busy, setBusy] = useState(false);
  // What did not save, in one short line — and, on the last step, what the
  // day already held. Never "noted" over a write that failed (2026-10-02).
  const [err, setErr] = useState('');
  const [doneNote, setDoneNote] = useState('');

  const go = (s: Step) => {
    setErr('');
    setStep(s);
  };
  const finish = () => {
    hapticSuccess();
    setStep('done');
    router.refresh();
  };
  // A failed save stays on its step with what he entered and says so; the
  // catch here used to walk on to the next question and the screen ended on
  // "That's today noted." over a write that never happened (2026-10-02).
  // Tapping the button again is the retry; "Skip" still lets him out.
  const act = async (fn: () => Promise<unknown>, next: Step) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await fn();
      go(next);
    } catch {
      setErr('Not saved. Try again.');
    } finally {
      setBusy(false);
    }
  };
  // BP and protein/water are separate answers: each is saved on its own
  // (saveEach), what saved is cleared, what failed stays in its fields.
  const saveExtras = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    let kept: Array<{ field: string; existing: number }> = [];
    const { failed } = await saveEach([
      ...(sys && dia
        ? [{ key: 'bp' as const, run: () => logBp({ systolic: Number(sys), diastolic: Number(dia) }) }]
        : []),
      ...(protein || water
        ? [{
            key: 'nutrition' as const,
            run: async () => {
              // The 04:00 activity day, like Diet: at 00:30 this is still
              // the evening's row, not the next date's planned one.
              const res = await logCheckInNutrition({
                day: activityDayStr(),
                proteinG: protein ? Number(protein) : undefined,
                waterMl: water ? Number(water) : undefined,
              });
              kept = res.kept;
            },
          }]
        : []),
    ]);
    setBusy(false);
    if (!failed.includes('bp')) { setSys(''); setDia(''); }
    if (!failed.includes('nutrition')) { setProtein(''); setWater(''); }
    if (failed.length) {
      setErr(`${failed.includes('bp') ? 'Blood pressure' : 'Protein / water'}${failed.length > 1 ? ' and protein / water' : ''} not saved. Check and save again.`);
      return;
    }
    setDoneNote(
      kept
        .map((k) => (k.field === 'proteinG' ? `Protein stays ${k.existing} g` : `Water stays ${k.existing} ml`))
        .join(' · '),
    );
    finish();
  };
  const errLine = err ? (
    <p role="alert" className="text-sm font-bold text-rpe-grind">{err}</p>
  ) : null;
  const skip = (next: Step) =>
    err ? (
      <button type="button" className="min-h-[44px] w-full text-xs font-bold text-app-tx3 underline" onClick={() => go(next)}>
        Skip
      </button>
    ) : null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${bigTeal} text-left px-4 flex items-center justify-between`}>
        <span>How are you today? · check in</span>
        <span aria-hidden="true">→</span>
      </button>
    );
  }

  return (
    <div className="card-lg space-y-3 p-4">
      {step === 'body' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">How does the body feel?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={big} disabled={busy} onClick={() => go('heart')}>
              Fine
            </button>
            <button type="button" className={big} onClick={() => go('body-which')}>
              Something&apos;s off
            </button>
          </div>
        </>
      )}

      {step === 'body-which' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">What is it, and how strong?</p>
          <div className="grid grid-cols-3 gap-1.5">
            {GI_PICK.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => setWhichKind(kind)}
                className={`min-h-[44px] rounded-card border-2 px-1 text-[11px] font-bold transition-all ${
                  whichKind === kind ? 'border-ink bg-acc-teal-deep text-white' : 'border-ink/25 bg-app-surface text-app-tx2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {['Mild', 'Moderate', 'Severe'].map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(i + 1)}
                className={`min-h-[44px] flex-1 rounded-card border-2 text-xs font-bold transition-all ${
                  severity === i + 1 ? 'border-ink bg-ink text-white' : 'border-ink/25 bg-app-surface text-app-tx2'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={bigTeal}
            disabled={busy || !whichKind}
            onClick={() => act(() => logSymptoms([{ kind: whichKind!, severity }]), 'heart')}
          >
            Noted
          </button>
          {errLine}
          {skip('heart')}
        </>
      )}

      {step === 'heart' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">And the heart — calm since yesterday?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={big} onClick={() => go('extras')}>
              Calm
            </button>
            <button type="button" className={big} onClick={() => go('heart-episode')}>
              There was an episode
            </button>
          </div>
        </>
      )}

      {step === 'heart-episode' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">Noted. Roughly how many minutes?</p>
          <input className={inputCls} inputMode="numeric" placeholder="Minutes (best guess)" value={afMin} onChange={(e) => setAfMin(e.target.value)} autoFocus />
          <button
            type="button"
            className={bigTeal}
            disabled={busy}
            onClick={() =>
              act(
                () =>
                  logAfEpisode({
                    startedAt: new Date().toISOString(),
                    durationMin: afMin ? Number(afMin) : undefined,
                  }),
                'extras',
              )
            }
          >
            Log it — details later if you want
          </button>
          {errLine}
          {skip('extras')}
        </>
      )}

      {step === 'extras' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">
            Anything measured today? All optional.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} inputMode="numeric" placeholder="BP sys" value={sys} onChange={(e) => setSys(e.target.value)} />
            <input className={inputCls} inputMode="numeric" placeholder="BP dia" value={dia} onChange={(e) => setDia(e.target.value)} />
            <input className={inputCls} inputMode="numeric" placeholder="Protein (g)" value={protein} onChange={(e) => setProtein(e.target.value)} />
            <input className={inputCls} inputMode="numeric" placeholder="Water (ml)" value={water} onChange={(e) => setWater(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={big} onClick={finish}>
              Nothing today
            </button>
            <button
              type="button"
              className={bigTeal}
              disabled={busy || ((!sys || !dia) && !protein && !water)}
              onClick={saveExtras}
            >
              Save
            </button>
          </div>
          {errLine}
        </>
      )}

      {step === 'done' && (
        <>
          <p className="text-sm font-bold text-acc-teal">That&apos;s today noted. See you tomorrow.</p>
          {doneNote && <p className="text-xs font-bold text-app-tx2">{doneNote} — today already has more.</p>}
        </>
      )}
    </div>
  );
}
