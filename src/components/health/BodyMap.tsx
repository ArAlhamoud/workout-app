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
// Abdomen spots sit on the flanks so the marker never hides the gut coil.
const SITE_POS: Record<string, { left: string; top: string }> = {
  'abdomen-right': { left: '40.5%', top: '51.7%' },
  'abdomen-left': { left: '59.5%', top: '51.7%' },
  'thigh-right': { left: '43.5%', top: '75%' },
  'thigh-left': { left: '56.5%', top: '75%' },
  'arm-right': { left: '31.5%', top: '33.3%' },
  'arm-left': { left: '68.5%', top: '33.3%' },
};

// Label rails (medical-diagram style): each system's organ is the anchor;
// a thin leader line runs from it to a label resting in a clean column.
const ANATOMY = {
  breath: { rail: 'r' as const, top: '27.8%' },
  heart: { rail: 'r' as const, top: '37.2%' },
  bp: { rail: 'l' as const, top: '41.7%' },
  gut: { rail: 'l' as const, top: '52.2%' },
};

// The body, one continuous closed contour (owner's pick — option D "Organs"
// on the four-way canvas): head, neck, shoulders, hands, legs, feet — an
// honest heavyset figure, drawn once as data.
const BODY =
  'M160,10 C146,10 137,21 137,36 C137,46 141,55 148,61 C148,66 147,70 145,73 ' +
  'C130,77 115,82 107,93 C99,102 96,114 94,128 C92,146 90,166 88,184 ' +
  'C84,196 88,208 98,209 C106,210 110,202 109,193 C111,176 112,158 110,142 ' +
  'C109,130 112,122 120,114 C118,128 116,152 116,172 C116,190 118,204 120,214 ' +
  'C118,238 122,262 124,278 C126,298 126,314 132,332 C124,336 120,342 122,348 ' +
  'C124,352 148,352 152,348 C154,344 153,338 152,332 C150,310 152,290 154,272 ' +
  'C156,258 157,246 160,236 C163,246 164,258 166,272 C168,290 170,310 168,332 ' +
  'C167,338 166,344 168,348 C172,352 196,352 198,348 C200,342 196,336 188,332 ' +
  'C194,314 194,298 196,278 C198,262 202,238 200,214 C202,204 204,190 204,172 ' +
  'C204,152 202,128 200,114 C208,122 211,130 210,142 C208,158 209,176 211,193 ' +
  'C210,202 214,210 222,209 C232,208 236,196 232,184 C230,166 228,146 226,128 ' +
  'C224,114 221,102 213,93 C205,82 190,77 175,73 C173,70 172,66 172,61 ' +
  'C179,55 183,46 183,36 C183,21 174,10 160,10 Z';

// The organs, where they live.
const LUNG_R =
  'M154,96 C142,96 132,106 130,120 C128,134 132,146 142,148 C150,150 154,142 154,130 Z';
const LUNG_L =
  'M166,96 C178,96 188,106 190,120 C192,134 188,146 178,148 C170,150 166,142 166,130 Z';
const HEART =
  'M162,140 C154,134 148,128 148,120.5 C148,115 152.5,110.5 157.5,110.5 ' +
  'C159.5,110.5 161.2,111.5 162,113.4 C162.8,111.5 164.5,110.5 166.5,110.5 ' +
  'C171.5,110.5 176,115 176,120.5 C176,128 170,134 162,140 Z';
const GUT =
  'M138,166 C132,176 132,198 140,206 C150,214 172,214 180,206 ' +
  'C188,198 188,176 182,166 C172,158 148,158 138,166 Z';
const GUT_COILS =
  'M138,176 C152,172 168,172 182,176 M136,188 C152,184 168,184 184,188 ' +
  'M140,200 C152,196 168,196 180,200';
const CUFF = 'M90,140 L114,138 L115,160 L90,162 Z';

function nightKey(): string {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inputCls =
  'w-full rounded-card border-2 border-ink bg-app-surface px-3 py-3 text-base text-app-tx1 tabular-nums placeholder-app-tx3 focus:outline-none';
const saveBtn =
  'w-full min-h-[48px] rounded-card border-2 border-ink bg-acc-teal-deep text-sm font-extrabold text-white shadow-[3px_3px_0_#0b0b0f] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_#0b0b0f] disabled:opacity-40';

/** The organ anchors a thin leader line; the label rests in a rail column. */
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
  // Organ tints carry state: teal when logged and calm, ember when today
  // flagged something, faint grey before any data.
  const breathOn = data.breath.lastHours != null;
  const bpOn = data.bp.latest != null;
  const gutFlagged = data.gut.today.length > 0;
  const heartAlarm = data.heart.daysClear !== null && data.heart.daysClear <= 2;
  const quiet = { fill: 'rgba(11,11,15,.05)', stroke: 'rgba(11,11,15,.30)' };

  return (
    <div className="card-lg relative overflow-hidden p-4">
      {/* The figure — his body as an anatomy poster (owner's pick, option D):
          flat organs drawn where they live, tinted by today's state, thin
          leader lines out to values resting in two clean rails. */}
      <div className="relative mx-auto aspect-[8/9] w-full max-w-[320px]">
        <svg viewBox="0 0 320 360" className="h-full w-full" aria-hidden="true">
          <path d={BODY} fill="#ffffff" stroke="#0b0b0f" strokeWidth="2.5" strokeLinejoin="round" />
          {/* trachea + lungs */}
          <line
            x1="160" y1="70" x2="160" y2="94"
            stroke={breathOn ? '#0f766e' : quiet.stroke} strokeWidth="4" strokeLinecap="round"
          />
          <path d={LUNG_R} fill={breathOn ? 'rgba(20,184,166,.30)' : quiet.fill} stroke={breathOn ? '#0f766e' : quiet.stroke} strokeWidth="2" />
          <path d={LUNG_L} fill={breathOn ? 'rgba(20,184,166,.30)' : quiet.fill} stroke={breathOn ? '#0f766e' : quiet.stroke} strokeWidth="2" />
          {/* the heart, beating between them */}
          <path
            className="heartbeat"
            d={HEART}
            fill={heartAlarm ? '#f59e0b' : '#d6336c'}
            stroke="#0b0b0f" strokeWidth="2"
          />
          {/* the gut coil */}
          <path
            d={GUT}
            fill={gutFlagged ? 'rgba(245,158,11,.28)' : 'rgba(20,184,166,.22)'}
            stroke={gutFlagged ? '#b45309' : '#0f766e'} strokeWidth="2" strokeLinecap="round"
          />
          <path d={GUT_COILS} fill="none" stroke={gutFlagged ? '#b45309' : '#0f766e'} strokeWidth="2" strokeLinecap="round" />
          {/* the cuff on his right arm */}
          <path d={CUFF} fill={bpOn ? 'rgba(34,211,238,.40)' : quiet.fill} stroke={bpOn ? '#0e7490' : quiet.stroke} strokeWidth="2" />
          <line x1="94" y1="147" x2="111" y2="146" stroke={bpOn ? '#0e7490' : quiet.stroke} strokeWidth="1.25" />
          <line x1="94" y1="153" x2="111" y2="152" stroke={bpOn ? '#0e7490' : quiet.stroke} strokeWidth="1.25" />
          {/* leader lines: organ → rail */}
          <g stroke="#0b0b0f" strokeOpacity="0.28" strokeWidth="1.5">
            <line x1="192" y1="108" x2="246" y2="100" />
            <line x1="180" y1="128" x2="246" y2="134" />
            <line x1="86" y1="150" x2="66" y2="150" />
            <line x1="144" y1="188" x2="66" y2="188" />
          </g>
        </svg>

        {/* the values in the rails */}
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
