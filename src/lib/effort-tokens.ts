// Effort spectrum — Easy teal-green, Med amber, Hard orange, Grind magenta.
// Each lit pill carries its own soft glow (light IS the information system).
// Shared by the logger's per-set effort row and the rest capsule's pills so
// the two can never drift apart in color or wording.

export const rpeOptions = [
  { v: 1, l: 'Easy',  c: 'bg-rpe-easy/15 border-rpe-easy/60 text-rpe-easy shadow-[0_0_14px_-2px_rgba(52,211,153,0.55)]' },
  { v: 2, l: 'Med',   c: 'bg-rpe-med/15 border-rpe-med/60 text-rpe-med shadow-[0_0_14px_-2px_rgba(251,191,36,0.55)]' },
  { v: 3, l: 'Hard',  c: 'bg-rpe-hard/15 border-rpe-hard/60 text-rpe-hard shadow-[0_0_14px_-2px_rgba(251,146,60,0.55)]' },
  { v: 4, l: 'Grind', c: 'bg-rpe-grind/15 border-rpe-grind/60 text-rpe-grind shadow-[0_0_14px_-2px_rgba(244,63,94,0.55)]' },
] as const;
