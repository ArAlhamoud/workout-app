export type Priority = 1 | 2 | 3;
export type Duration = 30 | 45 | 60;

export interface ProgramExercise {
  name: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  unit: 'reps' | 'seconds';
  repsDisplay: string;
  rest: string;
  machine: string;
  cues: string;
  youtubeUrl: string;
  priority: Priority;
}

export interface DayTemplate {
  id: 'A' | 'B';
  focus: string;
  warmup: string;
  cardioFinisher: string;
  exercises: ProgramExercise[];
}

export const DAY_A: DayTemplate = {
  id: 'A',
  focus: 'Chest · Quads · Shoulders',
  warmup: '5 min upright bike (easy, low resistance) + 10 arm circles + 10 seated leg lifts + 10 cat-cows on mat + 8 bird-dogs each side',
  cardioFinisher: '10 min upright bike, moderate resistance, RPM 60–70',
  exercises: [
    { name: 'Leg Press', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '120s', machine: 'Life Fitness (Seated Leg Press)', cues: "Feet shoulder-width, upper third of the platform, toes slightly out (15–30°). Push through mid-foot — not just toes. Lower until thighs reach 90° to the platform; never let your lower back peel off the pad. Press back up and stop just before knees lock out — keep tension on the quads. Exhale on the way up. MISTAKE TO AVOID: feet too low causes knee shear; rounding your back at the bottom is a injury risk — stop the rep there.", youtubeUrl: 'https://www.youtube.com/watch?v=K5n2vg3oZa4', priority: 1 },
    { name: 'Chest Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Adjust seat so handles align with mid-chest nipple line. Before unracking, pull shoulder blades DOWN and BACK into the pad and keep them pinned there the whole set — this protects your shoulder joint. Elbows at 45–75° from your torso (not flared out to 90°). Press 2s, return 3s. Stop just before elbows lock. MISTAKE TO AVOID: arching your lower back off the pad to press more weight — if you need to arch, drop the weight.', youtubeUrl: 'https://www.youtube.com/watch?v=sqNwDkUU_Ps', priority: 1 },
    { name: 'Shoulder Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT (Shoulder Press)', cues: "Adjust the handles to shoulder height and sit with feet on the footrests. IMPORTANT — this Hoist seat is DESIGNED TO MOVE as you press: let it rock with you instead of fighting it, and keep your back in contact with the pad the whole time. Press straight up with wrists stacked directly over elbows. Stop just short of lockout to keep tension on the deltoids. Lower 3s back to ear level. MISTAKE TO AVOID: if you feel it in your upper traps or neck, the weight is too heavy — drop a pin and feel the delts working instead.", youtubeUrl: 'https://www.youtube.com/watch?v=3R14MnZbcpw', priority: 1 },
    { name: 'Hip Abduction', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness (Hip Abduction)', cues: 'Sit tall, back flat against the pad, outer thighs against the pads. Grip the handles lightly — they steady you, they do not pull. Press the knees APART by driving through the outside of the thighs; you should feel it on the side of the hip, not the lower back. Push out 2s, hold 1s at the widest point, return 3s under control without letting the stack touch down. Leaning the torso slightly forward biases the upper glute if you want more of it. MISTAKE TO AVOID: slamming the pads open with momentum and bouncing off the stack — this is a small muscle, so the weight should look light and the tempo should look slow.', youtubeUrl: 'https://www.youtube.com/watch?v=I4ApZY585nE', priority: 1 },
    { name: 'Leg Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness', cues: 'Adjust seat back so your knee joint aligns with the machine pivot point — this is critical for joint safety. Pad just above the ankle. Grip the handles to stop your hips lifting. Extend fully — flex quads hard and hold 1s at the top. Lower 3s under full control. MISTAKE TO AVOID: swinging or letting the weight drop — the slow eccentric is where you build the muscle. Toes slightly up throughout.', youtubeUrl: 'https://www.youtube.com/watch?v=2lvdnQg04PM', priority: 2 },
    { name: 'Pec Fly', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Hoist ROC-IT', cues: "Adjust seat so handles align with mid-chest. Set a slight bend in the elbows and KEEP that exact angle throughout — they are not a hinge. Open arms back only until you feel a mild chest stretch (roughly even with your body line — no further). Arc the handles together thinking 'hugging a tree', squeezing the chest hard. MISTAKE TO AVOID: opening arms too far back loads the bicep tendon and risks a shoulder tear — conservative range of motion is correct here.", youtubeUrl: 'https://www.youtube.com/watch?v=dY4LduyY8H0', priority: 2 },
    { name: 'Ab Crunch', sets: 3, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15–20', rest: '45s', machine: 'Life Fitness (Abdominal)', cues: 'Adjust pad to sit across your upper chest/sternum. Cross arms over chest or hold handles lightly — do NOT pull with your arms. Exhale as you crunch DOWN — this forces maximum ab contraction. Hold 1s at full crunch. Return 3s. MISTAKE TO AVOID: using hip flexors instead of abs — you should only feel this in your mid-section, not your hip creases. Keep chin slightly tucked and never strain your neck.', youtubeUrl: 'https://www.youtube.com/watch?v=G8937xqkxDo', priority: 2 },
    { name: 'Lateral Raise', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness', cues: 'Sit upright, back against pad. Pads contact the outside of your forearms — not your wrists. Lead with your ELBOWS, not your hands, and raise only to shoulder height — going higher shifts the load to traps. Hold 1s at shoulder height. Lower 4s — the slow negative is critical for building the lateral delt. MISTAKE TO AVOID: shrugging the shoulders or using heavy weight and momentum. This exercise only works with strict form and light weight.', youtubeUrl: 'https://www.youtube.com/watch?v=NNAs8jx_zJI', priority: 3 },
  ],
};

export const DAY_B: DayTemplate = {
  id: 'B',
  focus: 'Back · Hamstrings · Arms',
  warmup: '5 min elliptical (easy pace) + shoulder rolls + gentle torso twists + 10 cat-cows on mat + 8 bird-dogs each side',
  cardioFinisher: '25–30 min swimming (best cardio on this day) OR 15 min elliptical at moderate pace',
  exercises: [
    { name: 'Back Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '75s', machine: 'Life Fitness (seated Back Extension)', cues: 'This is the SEATED machine, not a roman chair — you sit upright, not face-down. Set the back pad so it sits across your upper back / shoulder blades, and the seat so your hips sit at the machine pivot. Cross arms on your chest or hold the handles. Press BACKWARD by driving your hips down into the seat and squeezing your glutes — the movement is a hip extension, the spine stays neutral and travels as one piece. Push back 2s, hold 1s, return 3s under control, stopping before the stack touches down. Range: only as far back as you can go without your ribs flaring or your chin lifting. MISTAKE TO AVOID: cranking backward with the lower back to chase range — a shorter, controlled rep with the glutes doing the work is the whole point, and at your bodyweight the seated version is far kinder to your spine than a roman chair.', youtubeUrl: 'https://www.youtube.com/watch?v=gLT-WLH84B4', priority: 1 },
    { name: 'Lat Pulldown', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hammer Strength', cues: 'Grip just outside shoulder width — wider is NOT better. Lock thighs under the pad. BEFORE pulling: depress your shoulder blades (pull shoulders away from ears). Then pull the bar to your upper chest by driving elbows straight DOWN and BACK toward your hips. Lean back 10–15° naturally. Hold 1s at bottom with lats squeezed. Return with arms fully extending for a full lat stretch at the top. MISTAKE TO AVOID: leaning back 45°+ turns this into a row — keep the lean minimal and feel your lats, not your biceps.', youtubeUrl: 'https://www.youtube.com/watch?v=NYQ-o3ffxOc', priority: 1 },
    { name: 'Mid Row', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Adjust seat so handles are at mid-abdomen height. Sit upright with a slight forward lean at the hips — chest up, not hunched. Neutral grip (palms facing each other). BEFORE pulling: depress and slightly retract shoulder blades. Then row by driving elbows past your torso — aim for 90° elbow angle at full contraction. Squeeze shoulder blades together hard and hold 1s. Return 3s to a full arm extension and feel the lats stretch. MISTAKE TO AVOID: shrugging shoulders up toward ears during the row — keep them down throughout.', youtubeUrl: 'https://www.youtube.com/watch?v=GZbfZ033f74', priority: 1 },
    { name: 'Plank', sets: 3, repsMin: 20, repsMax: 60, unit: 'seconds', repsDisplay: '20–60s', rest: '45s', machine: 'Floor / mat', cues: 'Forearms flat, elbows directly under shoulders, toes on the floor. Simultaneously: squeeze your quads, squeeze your glutes, draw your belly button toward your spine, and push the floor away with your forearms. Body forms a perfectly straight line — no hips up (pike) or hips sagging (banana). Breathe steadily throughout. Build from 20s → 60s over the program. MODIFICATION: if lower back hurts, drop to your knees while maintaining all the bracing cues above. Dead bugs are an excellent alternative for spinal health.', youtubeUrl: 'https://www.youtube.com/watch?v=A2b2EmIg0dA', priority: 1 },
    { name: 'Leg Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness', cues: 'Adjust seat so your knee joint aligns with the machine pivot. Lie face down, pad resting just above the heels (lower Achilles area). Grip the handles. Curl legs fully — the pad should nearly touch your glutes. Squeeze hamstrings hard and hold 1s at peak. Return 3s — CRITICAL: let the weight fully extend and stretch the hamstrings at the bottom before the next rep. MISTAKE TO AVOID: letting hips lift off the pad means the weight is too heavy — keep hips pressed down the whole set.', youtubeUrl: 'https://www.youtube.com/watch?v=S367qaHeYWU', priority: 2 },
    { name: 'Bicep Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Hammer Strength Select (or Life Fitness)', cues: 'Set the pad so your upper arms rest FLAT along it and your elbows align with the machine pivot. Palms up (supinated grip). Start from fully extended arms — feel the bicep stretch at the bottom. Curl until forearms go just past vertical, squeeze the bicep hard and hold 1s. Return 3s to FULL extension — never cut the range of motion short. MISTAKE TO AVOID: the whole point of the pad is to eliminate swinging — if your upper arms are lifting off the pad, you are cheating and the exercise is not working.', youtubeUrl: 'https://www.youtube.com/watch?v=fcziDNsUWPM', priority: 2 },
    { name: 'Triceps Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness', cues: 'Sit facing the machine, upper arms resting on the pad. Grip handles with palms down, elbows shoulder-width — do NOT let them flare out. Start with forearms vertical (90° elbow angle). Press DOWN and FORWARD to FULL lockout at the bottom — full extension is required to fully contract the tricep. Hold 1s. Return 3s — this slow eccentric is the growth stimulus. MISTAKE TO AVOID: elbows drifting wide, and not fully locking out. Upper arms stay pinned to the pad throughout — only forearms move.', youtubeUrl: 'https://www.youtube.com/watch?v=fcziDNsUWPM', priority: 2 },
    { name: 'Rear Delt Fly', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness', cues: 'Sit facing the pad, chest against it. Handles at chest height. Palms facing down or inward. Keep a slight bend in the elbows and MAINTAIN that angle — do not straighten arms like a chest fly. Raise arms outward and back, leading with elbows, stopping when arms are parallel to the floor. Squeeze rear delts and shoulder blades together for 1s. Return 3s. MISTAKE TO AVOID: using heavy weight — this is a very small muscle that fatigues fast. If you feel it in your upper traps instead of the back of your shoulders, drop the weight significantly.', youtubeUrl: 'https://www.youtube.com/watch?v=6yMdhi2DVao', priority: 2 },
    { name: 'Cable Face Pull', sets: 3, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15–20', rest: '45s', machine: 'Life Fitness Dual Adjustable Pulley (rope attachment)', cues: 'Set cable to eye height or slightly above, rope attachment. Take two steps back — arms slightly extended at start. Pull the rope ends toward your FACE, keeping elbows at or above shoulder height throughout. At full contraction, hands are beside your ears with thumbs pointing behind you — like a double bicep pose. This external rotation at the shoulder is the whole purpose of the exercise. Hold 1s. Return 3s. MISTAKE TO AVOID: leaning back to pull, or dropping the elbows below shoulder height — this is a posture-building exercise and the mechanics must be precise.', youtubeUrl: 'https://www.youtube.com/watch?v=7bLivsAhDFY', priority: 2 },
  ],
};

export function getDayTemplate(day: 'A' | 'B'): DayTemplate {
  return day === 'A' ? DAY_A : DAY_B;
}

export function getExercisesForDuration(day: 'A' | 'B', duration: Duration): ProgramExercise[] {
  const template = getDayTemplate(day);
  const maxPriority: Priority = duration === 30 ? 1 : duration === 45 ? 2 : 3;
  return template.exercises.filter((e) => e.priority <= maxPriority);
}

export function getExerciseCountForDuration(day: 'A' | 'B', duration: Duration): number {
  return getExercisesForDuration(day, duration).length;
}

export function getPlankTarget(week: number): { min: number; max: number } {
  if (week <= 2) return { min: 20, max: 30 };
  if (week <= 4) return { min: 30, max: 45 };
  if (week <= 6) return { min: 45, max: 60 };
  return { min: 60, max: 60 };
}

export const DURATION_LABELS: Record<Duration, string> = {
  30: 'Express',
  45: 'Standard',
  60: 'Full',
};

export const SCHEDULE = [
  { day: 'Sun', workout: 'A', type: 'gym' as const },
  { day: 'Mon', workout: null, type: 'rest' as const },
  { day: 'Tue', workout: 'B', type: 'gym' as const },
  { day: 'Wed', workout: null, type: 'rest' as const },
  { day: 'Thu', workout: 'A/B', type: 'gym' as const },
  { day: 'Fri', workout: null, type: 'rest' as const },
  { day: 'Sat', workout: null, type: 'rest' as const },
];

export const REST_ACTIVITIES: Record<number, string> = {
  1: '20 min walk',
  3: '30 min swim or walk',
  5: 'Full rest & stretch',
  6: '30 min walk',
};

export const PROGRESSION = [
  { weeks: '1–2', phase: 'LEARN', desc: 'Lightest weight. Learn each movement: full range, 2s up / 3s down. Chase technique, not fatigue.' },
  { weeks: '3–4', phase: 'BUILD', desc: 'If all reps clean → move up one weight pin. Last 2–3 reps should feel challenging.' },
  { weeks: '5–6', phase: 'PUSH', desc: 'Add 1 rep per set OR one weight pin. Extend cardio to 12–15 min if energy allows.' },
  { weeks: '7', phase: 'DELOAD', desc: 'Drop weights 40%. Same exercises, light effort. Focus on stretching and sleep.' },
  { weeks: '8–10', phase: 'REBUILD', desc: "Return to Wk 6 weights — they'll feel easier. Continue adding weight/reps gradually." },
  { weeks: '11–12', phase: 'EVALUATE', desc: 'Measure: weight, how clothes fit, strength gains. Reassess if plateau.' },
];

// ── Return-to-training protocol ──────────────────────────────
// A break of this many days or more resets the program into the
// 4-week return ramp below instead of continuing where it left off.
export const BREAK_THRESHOLD_DAYS = 21;

// After the ramp, rejoin the main program at BUILD (week 3) — the
// LEARN weeks are redundant for someone who already knows the machines.
export const REJOIN_AT_WEEK = 3;

export interface ReturnWeek {
  week: number;
  phase: string;
  loadPct: number;   // % of pre-break working weight
  sessions: string;  // target sessions for the week
  rpeCap: number;    // hardest RPE allowed
  desc: string;
}

export const RETURN_PROGRAM: ReturnWeek[] = [
  { week: 1, phase: 'REBOOT',  loadPct: 60,  sessions: '2',   rpeCap: 2,
    desc: 'Re-teach the movements. Every set should feel easy — you are waking the muscles up, not training them hard.' },
  { week: 2, phase: 'REBUILD', loadPct: 70,  sessions: '2–3', rpeCap: 2,
    desc: 'Add a third session if recovery felt fine. Weights stay deliberately conservative.' },
  { week: 3, phase: 'RELOAD',  loadPct: 85,  sessions: '3',   rpeCap: 3,
    desc: 'Approaching pre-break numbers. Form first — only take the next pin if the last set was clean.' },
  { week: 4, phase: 'RESTORE', loadPct: 100, sessions: '3',   rpeCap: 3,
    desc: 'Back to pre-break weights. Normal progression resumes next week.' },
];

export type TrainingStatus =
  | { mode: 'fresh';  week: number }
  | { mode: 'return'; week: number; returnWeek: ReturnWeek; daysOff: number }
  | { mode: 'normal'; week: number };

/**
 * Works out where the lifter actually is: starting out, ramping back
 * after a layoff, or mid-program. Counting weeks from the very first
 * workout would put someone who took two months off in week 12.
 */
export function getTrainingStatus(dates: Date[], now: Date = new Date()): TrainingStatus {
  if (!dates.length) return { mode: 'fresh', week: 1 };

  const desc = dates.map((d) => new Date(d)).sort((a, b) => b.getTime() - a.getTime());
  const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);

  // Still inside the layoff — today is day 1 of the return block.
  const daysSinceLast = daysBetween(now, desc[0]);
  if (daysSinceLast >= BREAK_THRESHOLD_DAYS) {
    return { mode: 'return', week: 1, returnWeek: RETURN_PROGRAM[0], daysOff: daysSinceLast };
  }

  // Walk back to the start of the current unbroken training block,
  // counting the sessions inside it as we go.
  let blockStart = desc[0];
  let sessionsInBlock = 1;
  let daysOff = 0;
  for (let i = 0; i < desc.length - 1; i++) {
    const gap = daysBetween(desc[i], desc[i + 1]);
    if (gap >= BREAK_THRESHOLD_DAYS) { daysOff = gap; break; }
    blockStart = desc[i + 1];
    sessionsInBlock++;
  }

  const weeksElapsed = Math.floor(daysBetween(now, blockStart) / 7);

  if (daysOff > 0) {
    // Session-based ramp pacing: every 2 completed sessions advance a ramp
    // week, but never faster than the calendar — a triple session day
    // doesn't skip ahead, and a slow week doesn't skip either.
    const rampSessionsComplete = sessionsInBlock >= 2 * RETURN_PROGRAM.length;
    if (!(rampSessionsComplete && weeksElapsed >= RETURN_PROGRAM.length)) {
      const week =
        Math.min(Math.floor(sessionsInBlock / 2), weeksElapsed, RETURN_PROGRAM.length - 1) + 1;
      return { mode: 'return', week, returnWeek: RETURN_PROGRAM[week - 1], daysOff };
    }
    // Ramp sessions done AND 4+ calendar weeks back — rejoin the main
    // program at BUILD and progress weekly from there.
    const week = weeksElapsed - RETURN_PROGRAM.length + REJOIN_AT_WEEK;
    return { mode: 'normal', week: Math.min(12, Math.max(1, week)) };
  }

  return { mode: 'normal', week: Math.min(12, Math.max(1, weeksElapsed + 1)) };
}

/**
 * Scales a pre-break weight down for the return ramp, floored to the
 * nearest 2.5 kg so it lands on a real pin rather than a decimal.
 */
export function scaleReturnWeight(weight: number, loadPct: number): number {
  if (weight <= 0) return 0;
  if (loadPct >= 100) return weight; // full load returns the exact pre-break weight
  return Math.max(2.5, Math.floor((weight * loadPct) / 100 / 2.5) * 2.5);
}

// ── Gyms ─────────────────────────────────────────────────────
// Weights are not comparable across gyms: the same exercise sits on a
// different machine with a different stack in each building. Tagging the
// session is what lets progression stay honest per machine later.
export interface Gym {
  id: string;
  name: string;
  note: string;
}

export const GYMS: Gym[] = [
  { id: 'bfit', name: 'B_Fit', note: 'Main gym · Life Fitness · Hoist · Hammer Strength' },
  { id: 'work', name: 'Work',  note: 'Workplace gym' },
];

export const DEFAULT_GYM_ID = 'bfit';

export function getGym(id: string | null | undefined): Gym | null {
  if (!id) return null;
  return GYMS.find((g) => g.id === id) ?? null;
}

export function gymLabel(id: string | null | undefined): string | null {
  return getGym(id)?.name ?? null;
}

export const CARDIO = [
  { rank: 1, name: 'Swimming', badge: 'BEST', desc: 'Zero joint impact. Highest calorie burn. 20–30 min any stroke.' },
  { rank: 2, name: 'Upright Bike', badge: 'GREAT', desc: 'No weight on joints. Best for warm-ups and cardio finishers.' },
  { rank: 3, name: 'Elliptical', badge: 'GOOD', desc: 'Low impact — distributes load across arms and legs.' },
  { rank: 4, name: 'Treadmill', badge: 'CAUTION', desc: 'ONLY walking at 4–5 km/h, low incline. Never run.' },
];
