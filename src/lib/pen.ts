// How much is left in the Mounjaro pen, and when to buy the next one.
// DERIVED from the injection log on every read, never stored (owner,
// 2026-10-27): every dose so far came from one pen starting at the first
// logged injection; a dose that no longer fits in what is left opens a
// new pen — he bought one — and the old pen's leftover is discarded.
// Nothing here comments on strength, dose or storage, and nothing
// suggests a dose: dosesLeft counts the LATEST logged dose, as logged.

import { ownerActivityDayUtc } from './health-insights';

/** What one pen holds in total. A constant he can change later. */
export const PEN_TOTAL_MG = 60;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// Float sums of 2.5 / 7.5 mg doses: a hair under is still "fits".
const EPS = 1e-9;

export interface PenStatus {
  /** Which pen this is: 1 = the pen opened at the first logged dose. */
  penNumber: number;
  usedMg: number;
  remainingMg: number;
  totalMg: number;
  /** The latest logged dose — what the count of doses left is measured in. */
  currentDoseMg: number;
  dosesLeft: number;
  /** Due instants the pen still covers, oldest first (dosesLeft of them). */
  coveredDueISO: string[];
  /** The last due date this pen covers; null when it covers none. */
  lastDoseFromPenISO: string | null;
  /** The owner's activity day (UTC midnight, the session-row convention)
   *  before the first due date the pen cannot cover. */
  buyByISO: string;
}

/**
 * `nextDueISO` is the injection screen's own next-due (treatmentClock:
 * last dose + 7 days); later due dates step weekly from it. Null with no
 * injections — no pen, no reminder.
 */
export function penStatus(
  injections: Array<{ at: Date | string; doseMg: number }>,
  opts: { penTotalMg?: number; nextDueISO: string | null },
): PenStatus | null {
  const total = opts.penTotalMg ?? PEN_TOTAL_MG;
  const doses = injections
    .filter((i) => Number.isFinite(i.doseMg) && i.doseMg > 0)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (!doses.length || !opts.nextDueISO) return null;

  let penNumber = 1;
  let used = 0;
  for (const d of doses) {
    if (total - used < d.doseMg - EPS) {
      penNumber += 1;
      used = 0;
    }
    used += d.doseMg;
  }
  const currentDoseMg = doses[doses.length - 1].doseMg;
  const remainingMg = Math.max(0, total - used);
  const dosesLeft = Math.floor((remainingMg + EPS) / currentDoseMg);

  const nextDue = new Date(opts.nextDueISO).getTime();
  const coveredDueISO = Array.from({ length: dosesLeft }, (_, k) =>
    new Date(nextDue + k * WEEK_MS).toISOString(),
  );
  // The first due date the pen can't cover, on his activity day (rule 12).
  const firstUncovered = new Date(nextDue + dosesLeft * WEEK_MS);
  const buyBy = new Date(ownerActivityDayUtc(firstUncovered).getTime() - DAY_MS);

  return {
    penNumber,
    usedMg: Math.round(used * 100) / 100,
    remainingMg: Math.round(remainingMg * 100) / 100,
    totalMg: total,
    currentDoseMg,
    dosesLeft,
    coveredDueISO,
    lastDoseFromPenISO: coveredDueISO.length ? coveredDueISO[coveredDueISO.length - 1] : null,
    buyByISO: buyBy.toISOString(),
  };
}

/** The dose-card line. ≤1 short line (glance rule). */
export function penLine(p: PenStatus): string {
  if (p.dosesLeft === 0) return 'Pen finished · next dose needs a new pen';
  return `Pen · ${fmt(p.remainingMg)} of ${fmt(p.totalMg)} mg left · ${p.dosesLeft} dose${p.dosesLeft === 1 ? '' : 's'}`;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** The gauge: one segment per dose of the current size, `lit` = doses
 *  left. Null when the pen doesn't split into whole doses of that size
 *  (or into more than 24) — the gauge then shows a plain fill. */
export function penSegments(p: PenStatus): { count: number; lit: number } | null {
  const count = p.totalMg / p.currentDoseMg;
  if (Math.abs(count - Math.round(count)) > 1e-9 || count > 24) return null;
  return { count: Math.round(count), lit: p.dosesLeft };
}

/** "Mon 30 Nov" for a buy day stored as UTC midnight of the owner's day. */
export function buyByLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
