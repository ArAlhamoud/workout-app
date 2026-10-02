// The decisions behind every health WRITE, as pure functions — no database,
// no clock — so the suite can prove them (scripts/coach-tests.ts). The server
// actions, the fuel pipe and the Apple Health import only fetch the rows and
// apply what these return. Six bugs that stored or lost health data lived in
// the un-testable halves of those files (audit, 2026-10-02).

// ── Macros: adding a meal ────────────────────────────────────

export const MACRO_CAPS = { kcal: 8000, proteinG: 400, carbsG: 900, fatG: 400, waterMl: 10_000 } as const;
export type MacroKey = keyof typeof MACRO_CAPS;
const MACRO_KEYS = Object.keys(MACRO_CAPS) as MacroKey[];

/**
 * A meal stacked onto a day: ONLY the fields he typed are summed, and a field
 * left blank is absent from the result, so it stays null in the row. The
 * action used to carry all four as (existing ?? 0) + inc, so "protein 30" on
 * an empty day stored kcal 0 — Diet read "0 kcal · 1800 left" and the weekly
 * numbers took a 0-kcal day as logged (2026-10-02). The pipe
 * (/api/health/fuel {add:true}) already summed only what was sent; this is
 * the ONE sum both use. An increment that is zero, negative or above the
 * field's bound adds nothing; a total is capped at the bound.
 */
export function stackMacros(
  existing: Partial<Record<MacroKey, number | null>> | null,
  inc: Partial<Record<MacroKey, number | null | undefined>>,
): Partial<Record<MacroKey, number>> {
  const out: Partial<Record<MacroKey, number>> = {};
  for (const k of MACRO_KEYS) {
    const v = inc[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MACRO_CAPS[k]) continue;
    const add = Math.round(v);
    if (add <= 0) continue;
    out[k] = Math.min((existing?.[k] ?? 0) + add, MACRO_CAPS[k]);
  }
  return out;
}

// ── The Home check-in's protein / water ──────────────────────

export type CheckInField = 'proteinG' | 'waterMl';

/**
 * The check-in asks "Anything measured today?" — a figure for the DAY, not a
 * meal, so it is a day total and never summed onto the row (typing the day's
 * 130 onto a planned 133 must not make 263). But the day's row is normally
 * the pre-logged delivery plan, and a plain set let a 67 typed at 00:30
 * replace a planned 133 (2026-10-02). So PROTEIN only ever raises what the
 * day holds: lower than the row → the row stands and `kept` names it, and
 * the screen offers "Use 67 g instead" (`replace`), because the larger
 * figure may be his own typo. WATER has no plan behind it and is a plain
 * set — with "only raises" a 5000 typed for 500 could not be corrected from
 * anywhere in the app (adversary, 2026-10-02). Stacking a meal is Diet's
 * "Add a meal" (stackMacros).
 */
export function checkInDayTotals(
  existing: Partial<Record<CheckInField, number | null>> | null,
  entered: Partial<Record<CheckInField, number | null | undefined>>,
  opts: { replace?: boolean } = {},
): {
  patch: Partial<Record<CheckInField, number>>;
  kept: Array<{ field: CheckInField; existing: number }>;
  /** Typed but unusable (not a number, zero, beyond the bound): the caller
   *  must refuse the save out loud, not drop it and say "noted". */
  rejected: CheckInField[];
} {
  const patch: Partial<Record<CheckInField, number>> = {};
  const kept: Array<{ field: CheckInField; existing: number }> = [];
  const rejected: CheckInField[] = [];
  for (const k of ['proteinG', 'waterMl'] as CheckInField[]) {
    const v = entered[k];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.round(v) <= 0 || v > MACRO_CAPS[k]) {
      rejected.push(k);
      continue;
    }
    const next = Math.round(v);
    const have = existing?.[k] ?? null;
    if (next === have) continue;
    if (have == null || next > have || k === 'waterMl' || opts.replace) patch[k] = next;
    else kept.push({ field: k, existing: have });
  }
  return { patch, kept, rejected };
}

// ── Saving several answers at once ───────────────────────────

/**
 * Run every save, whatever the one before it did, and say which landed. The
 * check-in awaited BP then protein in one try: a mistyped diastolic made
 * logBp throw, the protein write was never reached, and the catch moved on
 * to "That's today noted." (2026-10-02). Never throws.
 */
export async function saveEach<K extends string>(
  tasks: Array<{ key: K; run: () => Promise<unknown> }>,
): Promise<{ saved: K[]; failed: K[] }> {
  const saved: K[] = [];
  const failed: K[] = [];
  for (const t of tasks) {
    try {
      await t.run();
      saved.push(t.key);
    } catch {
      failed.push(t.key);
    }
  }
  return { saved, failed };
}

// ── Weight: one store, manual wins ───────────────────────────

export interface DayWeightRow {
  id: string;
  date: Date | string;
  source: string;
  weight: number | null;
}

export type WeightImportPlan = { kind: 'skip' } | { kind: 'update'; id: string } | { kind: 'create' };

const isManualWeight = (r: DayWeightRow) => r.source === 'manual' && r.weight != null;
const ms = (d: Date | string) => new Date(d).getTime();

/**
 * What a scale weigh-in from Apple Health does to a day, given ALL of that
 * day's rows. Only a manual WEIGHT blocks it: the old check looked at the
 * day's first row's source alone, so a waist-only manual entry shut the
 * scale out of that day for good (2026-10-02). Otherwise the day's imported
 * row is corrected in place (a re-sync), never a manual row beside it; with
 * neither, the reading becomes its own row.
 */
export function weightImportPlan(dayRows: DayWeightRow[]): WeightImportPlan {
  if (dayRows.some(isManualWeight)) return { kind: 'skip' };
  const imported = dayRows.find((r) => r.source !== 'manual');
  return imported ? { kind: 'update', id: imported.id } : { kind: 'create' };
}

export type ManualWeightPlan = { kind: 'create' } | { kind: 'takeOver'; id: string } | { kind: 'update'; id: string };

/**
 * What a weight typed by hand does to a day the scale already synced.
 * "Manual wins" held only when the manual row came FIRST; typed after the
 * sync, both rows stood and every reader took the later timestamp — the
 * scale's (2026-10-02). Weight is ONE store, so the fix is one row, not a
 * rule taught to each reader: his number takes over the day's imported row
 * (the latest, should a day ever hold two), which becomes manual and from
 * then on blocks the import. The scale's own figure stays in HealthSample.
 * A later manual weight for the day corrects that same row ('update').
 * A waist/arms-only entry takes nothing over.
 */
export function manualWeightPlan(dayRows: DayWeightRow[], entry: { weight?: number | null }): ManualWeightPlan {
  if (entry.weight == null) return { kind: 'create' };
  const latest = (rows: DayWeightRow[]) => rows.sort((a, b) => ms(b.date) - ms(a.date))[0];
  // A manual weight already owns the day: correct THAT row. The taken-over
  // row keeps the scale's time, so a correction typed later used to become a
  // bare-date (00:00Z) row sorting BEFORE it — and lost to his first figure
  // (data-steward, 2026-10-02). Also makes a double submit one row.
  const mine = latest(dayRows.filter(isManualWeight));
  if (mine) return { kind: 'update', id: mine.id };
  const imported = latest(dayRows.filter((r) => r.source !== 'manual'));
  return imported ? { kind: 'takeOver', id: imported.id } : { kind: 'create' };
}

// ── Blood pressure: one measurement, one row ─────────────────

export const BP_IMPORT_NOTE = 'Apple Health';
export const BP_SAME_MOMENT_MS = 60_000;
export const BP_SAME_READING_MS = 5 * 60_000;

export interface BpRowLite {
  id: string;
  at: number;
  systolic: number;
  diastolic: number;
  notes: string | null;
}

/**
 * The existing row a cuff reading from Apple Health is a copy of, or null
 * when it is a new measurement.
 *  1. An IMPORTED row within a minute — the rolling re-sync of a pair already
 *     stored. Time alone, as before.
 *  2. A row he TYPED (no import note) with the same systolic/diastolic within
 *     five minutes — logBp stamps the typing moment, so measured 08:00, typed
 *     08:02, synced later used to make two rows and inflate every count and
 *     average (2026-10-02). The same rule logBp applies the other way round.
 *     A typed row is NEVER matched on time alone (a cuff 150/95 landing 50 s
 *     from a typed 126/80 was dropped), and it answers for ONE cuff reading
 *     per batch (`claimed`) however close the second is: cuff 08:00 and 08:04
 *     with one row typed at 08:03:30 swallowed both, on every re-sync
 *     (adversary, 2026-10-02). Two imported rows are never merged by values.
 */
export function bpImportTwin(
  pair: { at: number; systolic: number; diastolic: number },
  existing: BpRowLite[],
  claimed: ReadonlySet<string>,
): string | null {
  const resync = existing.find((e) => e.notes === BP_IMPORT_NOTE && Math.abs(e.at - pair.at) <= BP_SAME_MOMENT_MS);
  if (resync) return resync.id;
  let best: BpRowLite | null = null;
  for (const e of existing) {
    if (e.notes === BP_IMPORT_NOTE || claimed.has(e.id)) continue;
    if (e.systolic !== Math.round(pair.systolic) || e.diastolic !== Math.round(pair.diastolic)) continue;
    const gap = Math.abs(e.at - pair.at);
    if (gap <= BP_SAME_READING_MS && (!best || gap < Math.abs(best.at - pair.at))) best = e;
  }
  return best ? best.id : null;
}

/**
 * The instants of one of HIS calendar days (ownerDayKey — Riyadh, UTC+3, no
 * DST), for looking up that day's body-stat rows. Both the scale import and
 * the manual entry keyed a weigh-in by the UTC day: a 01:00 weigh-in on the
 * 3rd is 22:00Z on the 2nd, so a manual weight backfilled for the 2nd took
 * over what he sees as the 3rd's weigh-in and blocked the import there
 * (data-steward, 2026-10-02). A bare date from the form ("2026-10-02" →
 * 00:00Z = 03:00 Riyadh) falls inside its own day.
 */
export function ownerDayWindow(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
