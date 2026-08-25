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

// Viewer-relative marker positions for the next injection site, in the
// figure's 320x360 coordinate space (his right = viewer left, facing you).
const SITE_POS: Record<string, { left: string; top: string }> = {
  'abdomen-right': { left: '42%', top: '51.7%' },
  'abdomen-left': { left: '58%', top: '51.7%' },
  'thigh-right': { left: '44%', top: '74.4%' },
  'thigh-left': { left: '56%', top: '74.4%' },
  'arm-right': { left: '31.5%', top: '32.8%' },
  'arm-left': { left: '68.5%', top: '32.8%' },
};

// Anatomy anchors and their label rails (medical-diagram style: a dot on
// the body, a thin leader line, a label in a clean column).
const ANATOMY = {
  breath: { dot: { left: '53%', top: '22.2%' }, rail: 'r' as const, top: '22.2%' },
  heart: { dot: { left: '55.5%', top: '34.4%' }, rail: 'r' as const, top: '34.4%' },
  bp: { dot: { left: '28.5%', top: '41.7%' }, rail: 'l' as const, top: '41.7%' },
  gut: { dot: { left: '50%', top: '54.4%' }, rail: 'l' as const, top: '54.4%' },
};

// The silhouette, drawn once as data so the ink pass and the white pass
// can never drift apart (outline-union: every shape twice — inflated ink,
// then exact white — so interior joins vanish and one outline remains).
const TORSO =
  'M160,78 C186,78 206,88 209,108 C212,132 215,160 211,184 C208,206 189,216 160,216 ' +
  'C131,216 112,206 109,184 C105,160 108,132 111,108 C114,88 134,78 160,78 Z';
const ARM_R = 'M118,94 C96,120 88,152 94,182';
const ARM_L = 'M202,94 C224,120 232,152 226,182';
const LEG_R = 'M142,215 L138,330';
const LEG_L = 'M178,215 L182,330';

function nightKey(): string {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';
const saveBtn =
  'w-full min-h-[48px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] disabled:opacity-40';

/** A dot ON the anatomy… */
function AnatomyDot({ pos, color }: { pos: { left: string; top: string }; color: string }) {
  return (
    <span
      className={`pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink ${color}`}
      style={pos}
    />
  );
}

/** …a thin leader line, and a label resting in a clean rail column. */
function RailLabel({
  rail, top, label, value, onTap,
}: {
  rail: 'l' | 'r'; top: string; label: string; value: string; onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${label}: ${value}`}
      className={`absolute z-10 flex min-h-[44px] -translate-y-1/2 flex-col justify-center leading-tight ${
        rail === 'l' ? 'left-0 items-start text-left' : 'right-0 items-end text-right'
      }`}
      style={{ top }}
    >
      <span className="text-[9px] font-black uppercase tracking-[0.12em] text-app-tx3">{label}</span>
      <span className="max-w-[92px] whitespace-nowrap text-[12.5px] font-extrabold text-app-tx1">
        {value}
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
      {/* The figure — a proper silhouette, labelled like the medical
          diagrams this card is quoting: dots on the anatomy, thin leader
          lines, values resting in two clean rails. */}
      <div className="relative mx-auto aspect-[8/9] w-full max-w-[320px]">
        <svg viewBox="0 0 320 360" className="h-full w-full" aria-hidden="true">
          {/* pass 1 · everything in ink, inflated ~3.5px outward */}
          <g fill="#0b0b0f" stroke="#0b0b0f">
            <circle cx="160" cy="46" r="26" strokeWidth="7" />
            <path d={TORSO} strokeWidth="7" />
            <path d={ARM_R} fill="none" strokeWidth="20" strokeLinecap="round" />
            <path d={ARM_L} fill="none" strokeWidth="20" strokeLinecap="round" />
            <path d={LEG_R} fill="none" strokeWidth="34" strokeLinecap="round" />
            <path d={LEG_L} fill="none" strokeWidth="34" strokeLinecap="round" />
          </g>
          {/* pass 2 · the same shapes in white, exact — interior joins vanish */}
          <g fill="#ffffff" stroke="#ffffff">
            <circle cx="160" cy="46" r="26" />
            <path d={TORSO} />
            <path d={ARM_R} fill="none" strokeWidth="13" strokeLinecap="round" />
            <path d={ARM_L} fill="none" strokeWidth="13" strokeLinecap="round" />
            <path d={LEG_R} fill="none" strokeWidth="27" strokeLinecap="round" />
            <path d={LEG_L} fill="none" strokeWidth="27" strokeLinecap="round" />
          </g>
          {/* the heart, beating where it lives */}
          <path
            className="heartbeat"
            fill="#d6336c"
            d="M176,134 C169,128 163,122 163,115 C163,110 167,106 171.5,106 C173.5,106 175.3,107.2 176,109 C176.7,107.2 178.5,106 180.5,106 C185,106 189,110 189,115 C189,122 183,128 176,134 Z"
          />
          {/* leader lines: anatomy → rail */}
          <g stroke="#0b0b0f" strokeOpacity="0.28" strokeWidth="1.5">
            <line x1="180" y1="80" x2="244" y2="80" />
            <line x1="192" y1="124" x2="244" y2="124" />
            <line x1="86" y1="150" x2="66" y2="150" />
            <line x1="152" y1="196" x2="66" y2="196" />
          </g>
        </svg>

        {/* dots on the anatomy… */}
        <AnatomyDot
          pos={ANATOMY.breath.dot}
          color={data.breath.lastHours != null ? 'bg-acc-teal-deep' : 'bg-app-surface2'}
        />
        <AnatomyDot pos={ANATOMY.heart.dot} color={heartColorFinal} />
        <AnatomyDot
          pos={ANATOMY.bp.dot}
          color={data.bp.latest ? 'bg-acc-teal-deep' : 'bg-app-surface2'}
        />
        <AnatomyDot
          pos={ANATOMY.gut.dot}
          color={data.gut.today.length ? 'bg-acc-ember-deep' : 'bg-acc-teal-deep'}
        />

        {/* …their values in the rails */}
        <RailLabel
          rail={ANATOMY.breath.rail} top={ANATOMY.breath.top}
          label="Breath"
          value={data.breath.lastHours != null ? `${data.breath.lastHours}h · AHI ${data.breath.ahi ?? '—'}` : 'not logged'}
          onTap={() => setSheet('breath')}
        />
        <RailLabel
          rail={ANATOMY.heart.rail} top={ANATOMY.heart.top}
          label="Heart"
          value={data.heart.daysClear === null ? 'no episodes' : `${data.heart.daysClear}d calm`}
          onTap={() => setSheet('heart')}
        />
        <RailLabel
          rail={ANATOMY.bp.rail} top={ANATOMY.bp.top}
          label="Pressure"
          value={data.bp.latest ?? 'no reading'}
          onTap={() => setSheet('bp')}
        />
        <RailLabel
          rail={ANATOMY.gut.rail} top={ANATOMY.gut.top}
          label="Gut"
          value={data.gut.today.length ? data.gut.today.slice(0, 2).join(' · ') : 'quiet today'}
          onTap={() => setSheet('gut')}
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
