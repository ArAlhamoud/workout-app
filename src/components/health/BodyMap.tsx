'use client';

// The dashboard IS the body (owner's fourth push: an overall health
// dashboard that isn't a stack of table-cards). A bold pictogram of him,
// each system living where it lives — heart, breath, gut, pressure, the
// next injection site glowing on the actual spot — every region showing
// its number and opening a sheet to see more and log in place. Anatomy as
// navigation.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logBp, logCpapNight, logSymptoms, logAfEpisode } from '@/app/health-actions';
import { hapticSuccess } from '@/lib/native-feedback';

export interface BodyData {
  heart: { daysClear: number | null; thisMonth: number };
  breath: { lastHours: number | null; ahi: number | null; streak: number };
  gut: { today: string[] };
  bp: { latest: string | null; avg7: string | null };
  nextSite: string; // slug like 'thigh-left'
  nextSiteLabel: string;
  ldl: { value: number; when: string } | null;
}

type Sheet = 'heart' | 'breath' | 'gut' | 'bp' | null;

const GUT_KINDS = [
  ['nausea', 'Nausea'], ['bloating', 'Bloating'], ['gas', 'Gas'],
  ['reflux', 'Reflux'], ['vomiting', 'Vomiting'], ['abdominal-pain', 'Belly pain'],
  ['constipation', 'Constip.'], ['diarrhea', 'Diarrhea'], ['dizziness', 'Dizziness'],
] as const;

// Viewer-relative marker positions for the next injection site (percent of
// the figure container).
const SITE_POS: Record<string, { left: string; top: string }> = {
  'abdomen-right': { left: '40%', top: '46%' },
  'abdomen-left': { left: '60%', top: '46%' },
  'thigh-right': { left: '41%', top: '70%' },
  'thigh-left': { left: '59%', top: '70%' },
  'arm-right': { left: '16%', top: '30%' },
  'arm-left': { left: '84%', top: '30%' },
};

function nightKey(): string {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';
const saveBtn =
  'w-full min-h-[48px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] disabled:opacity-40';

function Callout({
  left, top, side, color, label, value, onTap,
}: {
  left: string; top: string; side: 'l' | 'r';
  color: string; label: string; value: string;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${label}: ${value}`}
      className={`absolute z-10 flex min-h-[44px] items-center gap-1.5 ${side === 'l' ? '-translate-x-full flex-row-reverse text-right' : ''}`}
      style={{ left, top }}
    >
      <span className={`h-3.5 w-3.5 flex-none rounded-full border-2 border-ink ${color}`} />
      <span className={`flex flex-col rounded-md bg-[#f2f0ea]/90 px-1 leading-tight ${side === 'l' ? 'items-end' : 'items-start'}`}>
        <span className="text-[9px] font-black uppercase tracking-[0.1em] text-app-tx3">{label}</span>
        <span className="whitespace-nowrap text-[12px] font-extrabold text-app-tx1">{value}</span>
      </span>
    </button>
  );
}

export default function BodyMap({ data }: { data: BodyData }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // sheet form state
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [hours, setHours] = useState('');
  const [ahi, setAhi] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [sev, setSev] = useState(2);
  const [afMin, setAfMin] = useState('');

  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      hapticSuccess();
      setMsg(done);
      router.refresh();
      setTimeout(() => { setMsg(''); setSheet(null); }, 900);
    } catch {
      setMsg('Could not save.');
      setTimeout(() => setMsg(''), 2000);
    } finally {
      setBusy(false);
    }
  };

  const sitePos = SITE_POS[data.nextSite] ?? SITE_POS['abdomen-right'];
  const heartColor =
    data.heart.daysClear === null ? 'bg-app-surface2'
    : data.heart.daysClear <= 2 ? 'bg-acc-ember-deep'
    : 'bg-rpe-grind/90';
  const heartColorFinal = data.heart.daysClear !== null && data.heart.daysClear > 2 ? 'bg-acc-teal-deep' : heartColor;

  return (
    <div className="card-lg relative overflow-hidden p-4">
      {/* The figure */}
      <div className="relative mx-auto h-[340px] w-[230px]">
        <svg viewBox="0 0 200 380" className="h-full w-full" aria-hidden="true">
          {/* head */}
          <circle cx="100" cy="36" r="21" fill="#ffffff" stroke="#0b0b0f" strokeWidth="3" />
          {/* torso */}
          <rect x="63" y="66" width="74" height="142" rx="34" fill="#ffffff" stroke="#0b0b0f" strokeWidth="3" />
          {/* arms */}
          <path d="M66 88 C38 102 32 134 40 164" fill="none" stroke="#0b0b0f" strokeWidth="15" strokeLinecap="round" />
          <path d="M66 88 C40 101 35 132 42 161" fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" />
          <path d="M134 88 C162 102 168 134 160 164" fill="none" stroke="#0b0b0f" strokeWidth="15" strokeLinecap="round" />
          <path d="M134 88 C160 101 165 132 158 161" fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" />
          {/* legs */}
          <path d="M84 206 L79 336" fill="none" stroke="#0b0b0f" strokeWidth="17" strokeLinecap="round" />
          <path d="M84 208 L79.5 333" fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" />
          <path d="M116 206 L121 336" fill="none" stroke="#0b0b0f" strokeWidth="17" strokeLinecap="round" />
          <path d="M116 208 L120.5 333" fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" />
          {/* heart mark inside chest */}
          <path d="M93 96c0-4 3.2-6.4 6.3-6.4 2.3 0 4.3 1.2 5.5 3.1 1.2-1.9 3.2-3.1 5.5-3.1 3.1 0 6.3 2.4 6.3 6.4 0 6.7-11.8 15-11.8 15S93 102.7 93 96z" fill="#d6336c" opacity="0.9" />
        </svg>

        {/* live callouts anchored on the body */}
        <Callout
          left="40%" top="20%" side="l"
          color={heartColorFinal}
          label="Heart"
          value={data.heart.daysClear === null ? 'no episodes' : `${data.heart.daysClear}d calm`}
          onTap={() => setSheet('heart')}
        />
        <Callout
          left="62%" top="12%" side="r"
          color={data.breath.lastHours != null ? 'bg-acc-teal-deep' : 'bg-app-surface2'}
          label="Breath"
          value={data.breath.lastHours != null ? `${data.breath.lastHours}h · AHI ${data.breath.ahi ?? '—'}` : 'not logged'}
          onTap={() => setSheet('breath')}
        />
        <Callout
          left="61%" top="38%" side="r"
          color={data.gut.today.length ? 'bg-acc-ember-deep' : 'bg-acc-teal-deep'}
          label="Gut"
          value={data.gut.today.length ? data.gut.today.slice(0, 2).join(' · ') : 'quiet today'}
          onTap={() => setSheet('gut')}
        />
        <Callout
          left="19%" top="42%" side="l"
          color={data.bp.latest ? 'bg-acc-teal-deep' : 'bg-app-surface2'}
          label="Pressure"
          value={data.bp.latest ?? 'no reading'}
          onTap={() => setSheet('bp')}
        />

        {/* the next injection site, glowing on the actual spot */}
        <Link
          href="/health/injection"
          aria-label={`Next injection: ${data.nextSiteLabel}`}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={sitePos}
        >
          <span className="relative flex h-7 w-7 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acc-cyan/40 motion-reduce:hidden" />
            <span className="relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-white">
              <span className="h-2 w-2 rounded-full bg-acc-teal-deep" />
            </span>
          </span>
        </Link>
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-ink/10 pt-2.5">
        <p className="text-[11px] font-bold text-app-tx3">
          Next injection · <span className="text-app-tx1">{data.nextSiteLabel}</span> — the marked spot
        </p>
        {data.ldl && (
          <Link href="/health/plan" className="text-[11px] font-bold text-app-tx2">
            Blood · LDL {data.ldl.value} →
          </Link>
        )}
      </div>

      {/* domain sheet */}
      {sheet && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-ink/20 p-2" onClick={() => setSheet(null)}>
          <div className="sheet-surface rounded-card-lg border-2 border-ink p-4 shadow-[5px_5px_0_#0b0b0f]" onClick={(e) => e.stopPropagation()}>
            {msg && <p className="mb-2 text-xs font-bold text-acc-teal">{msg}</p>}

            {sheet === 'heart' && (
              <div className="space-y-2.5">
                <p className="text-base font-extrabold text-app-tx1">
                  Heart — {data.heart.daysClear === null ? 'no episodes logged yet' : `${data.heart.daysClear} days calm · ${data.heart.thisMonth} this month`}
                </p>
                <input className={inputCls} inputMode="numeric" placeholder="Episode now? Minutes (guess)" value={afMin} onChange={(e) => setAfMin(e.target.value)} />
                <button
                  type="button" className={saveBtn} disabled={busy}
                  onClick={() => act(() => logAfEpisode({ startedAt: new Date().toISOString(), durationMin: afMin ? Number(afMin) : undefined }), 'Episode logged')}
                >
                  Log an episode
                </button>
                <Link href="/health/analytics" className="block text-center text-xs font-bold text-app-tx3">rhythm patterns →</Link>
              </div>
            )}

            {sheet === 'breath' && (
              <div className="space-y-2.5">
                <p className="text-base font-extrabold text-app-tx1">
                  Breath — {data.breath.streak > 1 ? `${data.breath.streak} nights running on the mask` : 'last night'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputCls} inputMode="decimal" placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
                  <input className={inputCls} inputMode="decimal" placeholder="AHI (optional)" value={ahi} onChange={(e) => setAhi(e.target.value)} />
                </div>
                <button
                  type="button" className={saveBtn} disabled={busy || !hours}
                  onClick={() => act(() => logCpapNight({ night: nightKey(), usageHours: Number(hours), ahi: ahi ? Number(ahi) : undefined }), 'Night saved')}
                >
                  Save last night
                </button>
              </div>
            )}

            {sheet === 'gut' && (
              <div className="space-y-2.5">
                <p className="text-base font-extrabold text-app-tx1">Gut — what and how strong?</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {GUT_KINDS.map(([k, label]) => (
                    <button
                      key={k} type="button" onClick={() => setKind(k)}
                      className={`min-h-[44px] rounded-card border-2 px-1 text-[11px] font-bold ${kind === k ? 'border-ink bg-acc-teal-deep text-white' : 'border-ink/20 bg-app-surface text-app-tx2'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {['Mild', 'Moderate', 'Severe'].map((s, i) => (
                    <button
                      key={s} type="button" onClick={() => setSev(i + 1)}
                      className={`min-h-[44px] flex-1 rounded-card border-2 text-xs font-bold ${sev === i + 1 ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-app-surface text-app-tx2'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  type="button" className={saveBtn} disabled={busy || !kind}
                  onClick={() => act(() => logSymptoms([{ kind: kind!, severity: sev }]), 'Noted')}
                >
                  Save
                </button>
              </div>
            )}

            {sheet === 'bp' && (
              <div className="space-y-2.5">
                <p className="text-base font-extrabold text-app-tx1">
                  Pressure{data.bp.avg7 ? ` — 7-day ${data.bp.avg7}` : ''}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputCls} inputMode="numeric" placeholder="Sys" value={sys} onChange={(e) => setSys(e.target.value)} />
                  <input className={inputCls} inputMode="numeric" placeholder="Dia" value={dia} onChange={(e) => setDia(e.target.value)} />
                </div>
                <button
                  type="button" className={saveBtn} disabled={busy || !sys || !dia}
                  onClick={() => act(() => logBp({ systolic: Number(sys), diastolic: Number(dia) }), 'Reading saved')}
                >
                  Save reading
                </button>
              </div>
            )}

            <button type="button" onClick={() => setSheet(null)} className="mt-2 w-full py-2 text-center text-xs font-bold text-app-tx3">
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
