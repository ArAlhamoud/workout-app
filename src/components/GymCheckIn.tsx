'use client';

import { useEffect, useState, useTransition } from 'react';
import { checkIn, checkOut, closeForgotten, deleteVisit, nudgeVisit } from '@/app/gym-visit-actions';
import { fmtVisit, visitMinutes, type VisitLite } from '@/lib/gym-visits';
import { hapticSuccess } from '@/lib/native-feedback';

/**
 * Check in on arrival, check out on leaving (owner, 2026-10-01). Door to
 * door — changing, shower and swim count. Both times move in 5-minute
 * steps afterwards, so a late tap never becomes the record (the injection
 * form taught that). Volt structure: a kicker, one card, two lines.
 */

const GYM_NAME: Record<string, string> = { bfit: 'B_Fit', work: 'Alrajhi' };
const hhmm = (d: Date | string) =>
  new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
const dayLabel = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' });

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  disabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3">{label}</span>
      <div className="flex items-center font-mono text-sm font-bold text-app-tx1">
        <button type="button" disabled={disabled} onClick={onMinus} className="h-11 w-11" aria-label={`${label} 5 minutes earlier`}>
          −
        </button>
        <span key={value} className="w-14 text-center tabular-nums">{value}</span>
        <button type="button" disabled={disabled} onClick={onPlus} className="h-11 w-11" aria-label={`${label} 5 minutes later`}>
          +
        </button>
      </div>
    </div>
  );
}

export default function GymCheckIn({
  initialOpen,
  initialForgotten,
  initialLast,
}: {
  initialOpen: VisitLite | null;
  initialForgotten: VisitLite | null;
  initialLast: VisitLite | null;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [forgotten, setForgotten] = useState(initialForgotten);
  const [last, setLast] = useState(initialLast);
  const [stayed, setStayed] = useState(75);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  // The running clock, refreshed every 30 s while a visit is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        setMsg(null);
        await fn();
      } catch {
        setMsg('Could not save — try again');
      }
    });

  const doCheckIn = (gym: string) =>
    run(async () => {
      const v = await checkIn(gym);
      setOpen(v);
      setNow(Date.now());
      hapticSuccess();
    });

  const doCheckOut = () =>
    run(async () => {
      if (!open) return;
      const v = await checkOut(open.id);
      setOpen(null);
      // Refused because the visit is past 6 h: ask how long, never guess.
      if (v && !v.checkOutAt) {
        setForgotten(v);
        return;
      }
      if (v) setLast(v);
      hapticSuccess();
    });

  const nudge = (v: VisitLite, field: 'checkInAt' | 'checkOutAt', dir: 1 | -1, set: (v: VisitLite) => void) =>
    run(async () => {
      const next = await nudgeVisit(v.id, field, dir);
      if (next) set(next);
    });

  // ── A visit left open for 6+ hours: he says how long, the app never guesses.
  if (forgotten) {
    return (
      <div>
        <p className="section-label mb-3">Gym visit · check-out missing</p>
        <div className="card space-y-2 px-3 py-3">
          <p className="text-sm text-app-tx2">
            {GYM_NAME[forgotten.gym] ?? forgotten.gym} · {dayLabel(forgotten.checkInAt)} from {hhmm(forgotten.checkInAt)}. How long were you there?
          </p>
          <Stepper
            label="Stayed"
            value={fmtVisit(stayed)}
            disabled={pending}
            onMinus={() => setStayed((m) => Math.max(5, m - 5))}
            onPlus={() => setStayed((m) => Math.min(300, m + 5))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const v = await closeForgotten(forgotten.id, stayed);
                  setForgotten(null);
                  if (v) setLast(v);
                })
              }
              className="btn-primary min-h-[44px] flex-1 text-sm font-bold"
            >
              Save
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await deleteVisit(forgotten.id);
                  setForgotten(null);
                })
              }
              className="min-h-[44px] flex-1 border border-app-border text-sm font-bold text-app-tx2"
            >
              Discard
            </button>
          </div>
        </div>
        {msg && <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-rpe-hard">{msg}</p>}
      </div>
    );
  }

  // ── At the gym now.
  if (open) {
    const mins = Math.max(0, Math.floor((now - new Date(open.checkInAt).getTime()) / 60_000));
    return (
      <div>
        <p className="section-label mb-3">At {GYM_NAME[open.gym] ?? open.gym}</p>
        <div className="card space-y-2 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span key={mins} className="font-mono text-2xl font-bold tabular-nums text-app-tx1">
              {fmtVisit(mins)}
            </span>
            <button type="button" disabled={pending} onClick={doCheckOut} className="btn-primary min-h-[44px] px-5 text-sm font-bold">
              Check out
            </button>
          </div>
          <Stepper
            label="Checked in"
            value={hhmm(open.checkInAt)}
            disabled={pending}
            onMinus={() => nudge(open, 'checkInAt', -1, setOpen)}
            onPlus={() => nudge(open, 'checkInAt', 1, setOpen)}
          />
        </div>
        {msg && <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-rpe-hard">{msg}</p>}
      </div>
    );
  }

  // ── Not at the gym: check in, and the last visit with its times.
  const lastMin = last ? visitMinutes(last) : null;
  return (
    <div>
      <p className="section-label mb-3">Gym visit</p>
      <div className="card px-3 py-3">
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => doCheckIn('bfit')} className="btn-primary min-h-[44px] flex-[2] text-sm font-bold">
            Check in · B_Fit
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => doCheckIn('work')}
            className="min-h-[44px] flex-1 border border-app-border text-sm font-bold text-app-tx2"
          >
            Alrajhi
          </button>
        </div>
        {last && lastMin != null && (
          <details className="mt-2.5">
            <summary className="flex cursor-pointer select-none list-none items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-app-tx3 [&::-webkit-details-marker]:hidden">
              <span>
                Last · {dayLabel(last.checkInAt)} · {fmtVisit(lastMin)}
              </span>
              <span>Fix times ▾</span>
            </summary>
            <div className="mt-2 space-y-1">
              <Stepper
                label="In"
                value={hhmm(last.checkInAt)}
                disabled={pending}
                onMinus={() => nudge(last, 'checkInAt', -1, setLast)}
                onPlus={() => nudge(last, 'checkInAt', 1, setLast)}
              />
              <Stepper
                label="Out"
                value={hhmm(last.checkOutAt!)}
                disabled={pending}
                onMinus={() => nudge(last, 'checkOutAt', -1, setLast)}
                onPlus={() => nudge(last, 'checkOutAt', 1, setLast)}
              />
            </div>
          </details>
        )}
      </div>
      {msg && <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-rpe-hard">{msg}</p>}
    </div>
  );
}
