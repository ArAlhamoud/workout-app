'use client';

// The daily check-in — a conversation, not a form. The app asks three
// questions (night → body → heart), one screen each, big targets, and
// writes through the same bounded actions the old quick-log used. Fifteen
// seconds on a good day; a bad day branches into one follow-up, never a
// table. Data-domain buttons (BP! GI! CPAP!) are tracker thinking — a
// companion asks "how are you?" (the owner's re-orientation, Aug 25).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logCpapNight, logSymptoms, logAfEpisode, logBp, logNutrition } from '@/app/health-actions';
import { hapticSuccess } from '@/lib/native-feedback';
import { lastNightSleepHours } from '@/lib/health-metrics';

type Step = 'night' | 'night-hours' | 'body' | 'body-which' | 'heart' | 'heart-episode' | 'extras' | 'done';

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

function nightKey(): string {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const big =
  'w-full min-h-[52px] rounded-card border-2 border-ink bg-app-surface text-sm font-extrabold text-app-tx1 shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f]';
const bigTeal =
  'w-full min-h-[52px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f]';
const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';

export default function CheckIn({ cpapLoggedToday }: { cpapLoggedToday: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(cpapLoggedToday ? 'body' : 'night');
  const [hours, setHours] = useState('');
  const [ahi, setAhi] = useState('');
  const [whichKind, setWhichKind] = useState<string | null>(null);
  const [severity, setSeverity] = useState(2);
  const [afMin, setAfMin] = useState('');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [protein, setProtein] = useState('');
  const [water, setWater] = useState('');
  const [busy, setBusy] = useState(false);
  // The prisma APP keeps CPAP data to itself (no Health export), so mask
  // hours stay a manual answer — but the Watch's sleep count anchors it.
  // Native-only; null on the web and the hint simply doesn't render.
  const [watchSleep, setWatchSleep] = useState<number | null>(null);

  useEffect(() => {
    if (!open || cpapLoggedToday) return;
    let alive = true;
    lastNightSleepHours()
      .then((h) => { if (alive) setWatchSleep(h); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, cpapLoggedToday]);

  const go = (s: Step) => setStep(s);
  const finish = () => {
    hapticSuccess();
    setStep('done');
    router.refresh();
  };
  const act = async (fn: () => Promise<unknown>, next: Step) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      go(next);
    } catch {
      go(next); // the check-in never traps him on an error — details can be re-logged later
    } finally {
      setBusy(false);
    }
  };

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
      {step === 'night' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">Did the mask stay on last night?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={big} onClick={() => go('night-hours')}>Yes</button>
            <button
              type="button"
              className={big}
              disabled={busy}
              onClick={() => act(() => logCpapNight({ night: nightKey(), usageHours: 0 }), 'body')}
            >
              No / barely
            </button>
          </div>
          <button type="button" className="text-xs font-semibold text-app-tx3" onClick={() => go('body')}>
            skip
          </button>
        </>
      )}

      {step === 'night-hours' && (
        <>
          <p className="text-base font-extrabold text-app-tx1">Roughly how long, and the AHI if the app shows it?</p>
          {watchSleep !== null && (
            <p className="text-xs font-semibold text-app-tx2">
              Your Watch counted {watchSleep} h asleep.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} autoFocus />
            <input className={inputCls} inputMode="decimal" placeholder="AHI (optional)" value={ahi} onChange={(e) => setAhi(e.target.value)} />
          </div>
          <button
            type="button"
            className={bigTeal}
            disabled={busy || !hours}
            onClick={() =>
              act(
                () => logCpapNight({ night: nightKey(), usageHours: Number(hours), ahi: ahi ? Number(ahi) : undefined }),
                'body',
              )
            }
          >
            Noted
          </button>
        </>
      )}

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
              onClick={() =>
                act(async () => {
                  if (sys && dia) await logBp({ systolic: Number(sys), diastolic: Number(dia) });
                  if (protein || water) {
                    const d = new Date();
                    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    await logNutrition({
                      day,
                      proteinG: protein ? Number(protein) : undefined,
                      waterMl: water ? Number(water) : undefined,
                    });
                  }
                }, 'done')
              }
            >
              Save
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <p className="text-sm font-bold text-acc-teal">That&apos;s today noted. See you tomorrow.</p>
      )}
    </div>
  );
}
