// A machine's real step, as the owner types it — "each machine different"
// (2026-09-24). The learner cannot recover coarse stacks from his log
// (CLAUDE.md rule 4), so the step he reads off the plates is the source of
// truth; everything here is pure so it is testable without a database.

export const MIN_PIN_KG = 0.5;
export const MAX_PIN_KG = 25;

export type PinParse = { ok: true; kg: number | null } | { ok: false; error: string };

/**
 * What he typed into the step field. Blank clears his step (back to the
 * learned value, else 2.5). A comma decimal is a decimal. Real stacks step in
 * quarter kilos or coarser, between 0.5 and 25 kg; anything else is refused
 * with a reason rather than stored.
 */
export function parsePinKg(raw: string | number | null | undefined): PinParse {
  if (raw == null) return { ok: true, kg: null };
  const text = String(raw).trim().replace(',', '.');
  if (text === '') return { ok: true, kg: null };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: 'Type the step in kg, like 2.5 or 4.5' };
  const kg = Number(text);
  if (kg < MIN_PIN_KG || kg > MAX_PIN_KG) return { ok: false, error: `A step is ${MIN_PIN_KG}–${MAX_PIN_KG} kg` };
  if (Math.abs(kg * 4 - Math.round(kg * 4)) > 1e-9) return { ok: false, error: 'Steps come in quarter kilos, like 1.25 or 4.5' };
  return { ok: true, kg: Math.round(kg * 4) / 4 };
}

/**
 * Weights in his own log that a step cannot reach, counted on the ladder
 * through his most recent weight (the last item — pass them oldest first).
 * A warning shown after saving, never a block: 27 and 29 on one machine mean
 * either the step is not 9 kg, or one of those was logged by eye.
 */
export function offGridWeights(weights: number[], pinKg: number): number[] {
  if (!weights.length || !(pinKg > 0)) return [];
  const anchor = weights[weights.length - 1];
  const off = weights.filter((w) => {
    const steps = (anchor - w) / pinKg;
    return Math.abs(steps - Math.round(steps)) > 0.02;
  });
  return [...new Set(off)];
}

/**
 * The Watch crown's step for a machine: his step once he has set it, else
 * fine enough to land on any weight he really lifted (trainer ruling 4). A
 * 2.5 grid cannot reach 29 or 30 from 27, and a wrong record becomes the
 * next prefill.
 */
export const UNCONFIRMED_CROWN_STEP_KG = 0.5;
export function crownStepFor(manualPinKg?: number | null): number {
  return manualPinKg != null && manualPinKg > 0 ? manualPinKg : UNCONFIRMED_CROWN_STEP_KG;
}

/**
 * A step bigger than half the weight he last lifted on the machine is almost
 * certainly a slipped decimal — 25 typed for 2.5 would put +25 kg on the next
 * overload seed (Rear Delt Fly 20 → 45; review F2, 2026-09-24). The setter
 * refuses it with the decimal it probably meant, and lets him insist: a real
 * stack that coarse is possible, and his eyes on the plates win.
 */
export const MAX_STEP_SHARE = 0.5;
export function stepPlausible(kg: number, latestTopKg: number | null | undefined): string | null {
  if (!(latestTopKg != null && latestTopKg > 0) || kg <= latestTopKg * MAX_STEP_SHARE) return null;
  const tenth = kg / 10;
  const guess = tenth >= MIN_PIN_KG && Math.abs(tenth * 4 - Math.round(tenth * 4)) < 1e-9 ? ` — ${+tenth.toFixed(2)}?` : '';
  return `${+kg.toFixed(2)} kg is over half your last ${+latestTopKg.toFixed(2)} kg${guess}`;
}
