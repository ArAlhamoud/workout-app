// The BodyMap figure as data, plus the transform that lets it slim with
// him. Pure and testable: no DOM, no React — the component only renders
// what this file computes.

// One continuous closed contour (option D "Organs"): head, neck,
// shoulders, hands, legs, feet — an honest heavyset figure at 133 kg.
export const BODY =
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

const CENTER_X = 160;
/** Below this y the figure narrows; the head keeps its size. */
const NECK_Y = 66;
/** Maximum narrowing at t=1 — the 103 kg figure is ~18% slimmer. */
const MAX_TRIM = 0.18;

/**
 * The figure at progress t (0 = start weight, 1 = goal): every x-coordinate
 * below the neck moves toward the centerline by up to MAX_TRIM. Limbs slide
 * inward with the torso, height and head stay — which is how a person
 * actually slims. Pure string→string; t is clamped to [0, 1].
 */
export function bodyPathAt(t: number): string {
  const k = Math.min(1, Math.max(0, t)) * MAX_TRIM;
  if (k === 0) return BODY;
  let index = 0; // even = x, odd = y within the stream of numbers
  let lastY = 0;
  return BODY.replace(/-?\d+(?:\.\d+)?/g, (raw) => {
    const value = Number(raw);
    const isX = index % 2 === 0;
    index += 1;
    if (!isX) {
      lastY = value;
      return raw;
    }
    // Look ahead: the pair's y decides whether this x narrows. The stream
    // is strictly x,y pairs (M/C commands only), so the PREVIOUS y is the
    // right guard for everything after the first pair — and the first pair
    // is the crown, which never narrows anyway.
    if (lastY < NECK_Y) return raw;
    const trimmed = CENTER_X + (value - CENTER_X) * (1 - k);
    return String(Math.round(trimmed * 10) / 10);
  });
}

/**
 * Progress toward the goal from logged weights: 0 at the start weight,
 * 1 at goal. Null when there is no weigh-in yet.
 */
export function slimProgress(
  startKg: number,
  goalKg: number,
  currentKg: number | null,
): number | null {
  if (currentKg == null || startKg <= goalKg) return null;
  return Math.min(1, Math.max(0, (startKg - currentKg) / (startKg - goalKg)));
}
