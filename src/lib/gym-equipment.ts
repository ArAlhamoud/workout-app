// ── Per-gym equipment ────────────────────────────────────────
// The program is written against B_Fit's floor (Life Fitness · Hoist ·
// Hammer Strength). Alrajhi Tower is an entirely different floor: a Precor
// VSL selectorized line, one Cybex VR1, and one Hoist dual-pulley crossover.
//
// Twelve of the seventeen program movements have a direct Precor machine.
// The remaining five have no machine at all — they are all rebuilt on the
// crossover, which is why that one station is the most important piece of
// equipment in the room.
//
// A swap keeps the SAME exerciseId. The movement pattern and the muscle are
// unchanged, so the trend line stays continuous; only the machine, the cues
// and the video change. What must NOT carry across is the *number* — see
// getLastSessionForExercises, which is keyed by gym for exactly this reason.

import { DEFAULT_GYM_ID } from './program';

export interface GymSwap {
  /** Machine to use at this gym. Replaces the program's machine string. */
  machine: string;
  /** Full replacement cues when the movement is rebuilt on different hardware. */
  cues?: string;
  youtubeUrl?: string;
}

interface GymEquipment {
  /**
   * Program exercise names with no equivalent machine, rebuilt elsewhere.
   * Keyed by the program's exercise name.
   */
  swaps: Record<string, GymSwap>;
  /** Machines present that the program does not use. Reference only. */
  extras: string[];
  /** Anything that changes how a logged number should be read. */
  weightNote?: string;
}

// Cable work shares a setup preamble — stated once so each cue block can get
// straight to the movement instead of re-teaching the station.
const CROSSOVER = 'Hoist dual-pulley crossover';

const ALRAJHI: GymEquipment = {
  swaps: {
    'Pec Fly': {
      machine: `${CROSSOVER} (cable fly)`,
      cues: "Both pulleys set at shoulder height, one handle in each hand. Step forward into a split stance so the cables are under tension before you start — no slack. Set a slight bend in the elbows and KEEP that exact angle throughout; they are not a hinge. Bring the handles together in front of your sternum, thinking 'hugging a tree', and squeeze the chest hard for 1s. Open back 3s only until you feel a mild stretch — roughly even with your body line, no further. MISTAKE TO AVOID: letting the elbows straighten turns this into a press. The cable version gives a longer stretch than the Hoist machine at B_Fit, so start lighter than you think.",
      youtubeUrl: 'https://www.youtube.com/watch?v=taI4XduLpTk',
    },
    'Lateral Raise': {
      machine: `${CROSSOVER} (single-arm cable raise)`,
      cues: 'One pulley at the LOWEST setting. Stand side-on to the machine, take the handle in the hand furthest from it so the cable crosses in front of your body — this keeps tension at the bottom, which a dumbbell cannot. Free hand on the frame to stay steady. Lead with your ELBOW and raise only to shoulder height; higher shifts the load to traps. Hold 1s. Lower 4s — the slow negative is the whole exercise. Do all reps one side, then swap. MISTAKE TO AVOID: leaning away from the machine to help the weight up. Very light weight, strict form.',
      youtubeUrl: 'https://www.youtube.com/watch?v=lq7eLC30b9w',
    },
    'Rear Delt Fly': {
      machine: `${CROSSOVER} (high cable reverse fly)`,
      cues: 'Both pulleys at the HIGHEST setting. Cross the cables — take the left handle in your right hand and the right handle in your left. Step back until the cables are tight, feet staggered, slight forward lean at the hips. Keep a slight bend in the elbows and MAINTAIN it. Pull your arms outward and back until they are level with your shoulders, squeezing the shoulder blades together for 1s. Return 3s. MISTAKE TO AVOID: if you feel it in your upper traps instead of the back of your shoulders, drop the weight — this is a small muscle and it fatigues fast.',
      youtubeUrl: 'https://www.youtube.com/watch?v=5Uk4jS4Ldxo',
    },
    'Back Extension': {
      machine: `${CROSSOVER} (rope pull-through)`,
      cues: "There is no back extension machine here, so this becomes a pull-through — which trains the same thing the seated machine does: HIP extension with a neutral spine. Rope on the LOWEST pulley. Face away from the machine, straddle the cable, rope between your legs, hands gripping it behind you. Walk forward two steps. Hinge at the hips, pushing your butt back and letting the rope travel between your legs until you feel a strong hamstring stretch — knees only slightly bent, back flat the whole way. Then drive your hips FORWARD and squeeze your glutes hard to stand tall. Hold 1s. MISTAKE TO AVOID: turning it into a squat, or leaning back at the top. The spine never bends — the hips do all the moving.",
      youtubeUrl: 'https://www.youtube.com/watch?v=Uxo1cnpLE0I',
    },
    'Hip Abduction': {
      machine: `${CROSSOVER} (standing cable abduction)`,
      cues: 'Ankle strap on the LOWEST pulley, fastened to the leg furthest from the machine. Stand side-on, hold the frame with the near hand for balance, stand tall on the supporting leg. Sweep the strapped leg out and away from your midline — you should feel it on the side of the hip, not the lower back. Keep the working leg straight and the toes pointing forward, not turned out. Out 2s, hold 1s at the widest point, return 3s without letting the stack touch down. Do all reps one side, then swap. MISTAKE TO AVOID: swinging the leg with momentum or twisting the torso to gain range — small range, slow tempo, light weight.',
      youtubeUrl: 'https://www.youtube.com/watch?v=Nu6WVsyC9pk',
    },
  },
  extras: [
    'Precor Rotary Torso',
    'Cybex VR1 Arm Extension (second triceps option)',
  ],
  weightNote:
    'The Hoist crossover and the Cybex are labelled in POUNDS. Log the number printed on the pin — weights here are compared only against other sessions at this gym, never against B_Fit.',
};

// Machines that exist at Alrajhi but under a different name/geometry than the
// program's. Nothing is rebuilt — only the label and the setup detail change,
// because a converging press does not track the same path as a Hoist ROC-IT.
const ALRAJHI_RENAMES: Record<string, GymSwap> = {
  'Chest Press': { machine: 'Precor Converging Chest Press' },
  'Shoulder Press': { machine: 'Precor Converging Shoulder Press' },
  'Leg Press': { machine: 'Precor Leg Press' },
  'Leg Extension': { machine: 'Precor Leg Extension' },
  'Leg Curl': { machine: 'Precor Seated Leg Curl' },
  'Ab Crunch': { machine: 'Precor Abdominal' },
  'Lat Pulldown': { machine: 'Precor Lat Pulldown' },
  'Mid Row': { machine: 'Precor Seated Row' },
  'Bicep Curl': { machine: 'Precor Biceps Curl' },
  'Triceps Extension': { machine: 'Precor Triceps Extension' },
  'Cable Face Pull': { machine: `${CROSSOVER} (rope attachment)` },
};

for (const [name, swap] of Object.entries(ALRAJHI_RENAMES)) {
  ALRAJHI.swaps[name] = swap;
}

export const GYM_EQUIPMENT: Record<string, GymEquipment> = {
  work: ALRAJHI,
};

/**
 * Machine, cues and video for one program exercise at one gym.
 * Returns null at the home gym — the program's own values already apply.
 */
export function gymSwap(exerciseName: string, gymId: string | null | undefined): GymSwap | null {
  if (!gymId || gymId === DEFAULT_GYM_ID) return null;
  return GYM_EQUIPMENT[gymId]?.swaps[exerciseName] ?? null;
}

export function gymWeightNote(gymId: string | null | undefined): string | null {
  if (!gymId || gymId === DEFAULT_GYM_ID) return null;
  return GYM_EQUIPMENT[gymId]?.weightNote ?? null;
}
