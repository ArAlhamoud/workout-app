'use client';

// The coach's morning brief on the home screen. Renders NOTHING until a
// note exists — no placeholder, no spinner, no empty state. The
// deterministic HomeVerdict above it always carries the glance; this card
// is the voice underneath it.
//
// Wave 4: directives grew hands, split by mechanism (adversary rule):
// - session/rescue chips are plain DEEP LINKS into routes that already
//   exist — navigation needs no approval machinery.
// - a proposal (declare-hold / end-hold) renders as one explicit Approve
//   button; the server action re-clamps every bound no matter what the
//   model wrote, and nothing executes without the tap.

import { useState } from 'react';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { approveCoachHold, approveCoachEndHold } from '@/app/actions';
import { holdDeclaredFollowThrough, holdEndedFollowThrough } from '@/lib/hold-client';

interface Directive {
  type: string;
  label: string;
}

interface Proposal {
  action: 'declare-hold' | 'end-hold';
  days?: number;
  reason?: string;
}

const CHIP_STYLE: Record<string, string> = {
  session: 'border-acc-teal/40 bg-acc-teal/10 text-acc-teal',
  rescue: 'border-acc-ember/40 bg-acc-ember/10 text-acc-ember',
  rest: 'border-acc-cyan/40 bg-acc-cyan/10 text-acc-cyan',
  'hold-weights': 'border-rpe-med/40 bg-rpe-med/10 text-rpe-med',
  'weigh-in': 'border-app-border bg-app-surface2 text-app-tx2',
  flag: 'border-rpe-hard/40 bg-rpe-hard/10 text-rpe-hard',
};

/** Where an actionable chip lands — the descent ladder's one-tap rungs. */
const CHIP_ROUTE: Record<string, string> = {
  session: '/workouts/new',
  rescue: '/workouts/new?rescue=1',
};

export default function CoachCard() {
  const router = useRouter();
  const [note, setNote] = useState<{
    brief: string;
    directives: Directive[];
    proposal: Proposal | null;
  } | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/brief')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.note?.brief) {
          setNote({
            brief: data.note.brief,
            directives: data.note.directives ?? [],
            proposal: data.note.proposal ?? null,
          });
        }
      })
      .catch(() => { /* the deterministic layer stands alone */ });
    return () => { cancelled = true; };
  }, []);

  if (!note) return null;

  const approve = async (proposal: Proposal) => {
    setApproving(true);
    try {
      if (proposal.action === 'declare-hold') {
        const hold = await approveCoachHold(proposal.days ?? 7, proposal.reason);
        if (hold) {
          holdDeclaredFollowThrough(hold.endsAt);
          setApproved(
            `On hold until ${new Date(hold.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          );
        } else {
          setApproved('Too close to the ramp threshold — no hold to give.');
        }
      } else {
        const ended = await approveCoachEndHold();
        if (ended) holdEndedFollowThrough();
        setApproved(ended ? 'Hold ended — clock restarts today.' : 'No active hold.');
      }
      router.refresh();
    } catch {
      setApproved(null);
    } finally {
      setApproving(false);
    }
  };

  const proposalLabel = (p: Proposal) =>
    p.action === 'declare-hold'
      ? `Hold ${p.days ?? 7} days${p.reason ? ` — ${p.reason}` : ''}`
      : 'End the hold now';

  return (
    <div className="card-lg px-4 py-3.5">
      <Link href="/coach" className="block transition-opacity active:opacity-80">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="section-label">Coach</p>
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-app-tx3">ask →</span>
        </div>
        <p className="text-app-tx1 text-sm leading-relaxed">{note.brief}</p>
      </Link>
      {note.directives.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {note.directives.map((d, i) => {
            const route = CHIP_ROUTE[d.type];
            const cls = `chip border ${CHIP_STYLE[d.type] ?? CHIP_STYLE['weigh-in']}`;
            return route ? (
              <Link key={i} href={route} className={`${cls} pressable`}>
                {d.label} →
              </Link>
            ) : (
              <span key={i} className={cls}>
                {d.label}
              </span>
            );
          })}
        </div>
      )}
      {note.proposal && !approved && (
        <button
          type="button"
          disabled={approving}
          onClick={() => approve(note.proposal!)}
          className="mt-2.5 w-full rounded-card border border-acc-cyan/40 bg-acc-cyan/10 px-3 py-2 text-left text-xs font-semibold text-acc-cyan transition-colors active:bg-acc-cyan/20 disabled:text-app-tx3"
        >
          {approving ? 'Approving…' : `Approve: ${proposalLabel(note.proposal)}`}
        </button>
      )}
      {approved && <p className="mt-2.5 text-xs text-app-tx2">{approved}</p>}
    </div>
  );
}
