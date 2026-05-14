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
    { name: 'Leg Press', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '90s', machine: 'Leg Press Machine', cues: "Feet high & wide. Press through heels. Stop at 90° knee bend. Don't lock out.", priority: 1 },
    { name: 'Chest Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Handles at mid-chest. 2s press, 2s return. Back flat on pad.', priority: 1 },
    { name: 'Shoulder Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hammer Strength', cues: "Start at ear level. Press up, don't lock elbows. No back arching.", priority: 1 },
    { name: 'Ab Crunch', sets: 3, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15–20', rest: '45s', machine: 'Ab Machine', cues: 'Slow and controlled. Exhale as you crunch. No jerking.', priority: 1 },
    { name: 'Leg Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness', cues: 'Pad above ankles. Squeeze quads 1s at top. Lower slowly (3s down).', priority: 2 },
    { name: 'Pec Fly', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Hoist ROC-IT', cues: "Don't open too far back. Arc together, squeeze chest. Slight elbow bend.", priority: 2 },
    { name: 'Hip Thrust Machine', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Hip Thrust Machine / Glute Bridge on mat', cues: 'Drive through heels, squeeze glutes hard at top. Hold 1s. Counteracts desk posture and protects lower back.', priority: 2 },
    { name: 'Lateral Raise', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness', cues: 'Light weight. Raise to shoulder height only. Control the negative.', priority: 3 },
  ],
};

export const DAY_B: DayTemplate = {
  id: 'B',
  focus: 'Back · Hamstrings · Arms',
  warmup: '5 min elliptical (easy pace) + shoulder rolls + gentle torso twists + 10 cat-cows on mat + 8 bird-dogs each side',
  cardioFinisher: '25–30 min swimming (best cardio on this day) OR 15 min elliptical at moderate pace',
  exercises: [
    { name: 'Romanian Deadlift', sets: 3, repsMin: 8, repsMax: 12, unit: 'reps', repsDisplay: '8–12', rest: '90s', machine: 'Smith Machine / Dumbbells', cues: 'Soft knees, push hips back. Weight slides down thighs to mid-shin. Neutral spine — chest up. Squeeze glutes hard at top. Start light, learn the hinge.', priority: 1 },
    { name: 'Lat Pulldown', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hammer Strength', cues: 'Wide grip, pull to upper chest. Drive elbows down. Lean back 10°.', priority: 1 },
    { name: 'Mid Row', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Feet on footrests. Pull handles back, squeeze shoulder blades 1s. Slow return.', priority: 1 },
    { name: 'Plank', sets: 3, repsMin: 20, repsMax: 60, unit: 'seconds', repsDisplay: '20–60s', rest: '45s', machine: 'Floor / mat', cues: 'Tight core, neutral spine, breathe. Dead bugs if plank too hard.', priority: 1 },
    { name: 'Leg Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness', cues: 'Pad above heels. Curl fully, squeeze hamstrings. 3s lowering.', priority: 2 },
    { name: 'Bicep Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness / Cable', cues: 'Lock upper arms. Curl fully, squeeze at top. No swinging.', priority: 2 },
    { name: 'Triceps Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness', cues: 'Arms on pad. Extend fully, squeeze triceps. Control return.', priority: 2 },
    { name: 'Rear Delt Fly', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Life Fitness', cues: 'Sit facing pad. Open arms outward. Light weight — small muscle group.', priority: 3 },
    { name: 'Cable Face Pull', sets: 3, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15–20', rest: '45s', machine: 'Life Fitness Dual Pulley', cues: 'Cable at face height, rope attachment. Pull apart to ears. Builds posture.', priority: 3 },
    { name: 'Standing Calf Raise', sets: 2, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15–20', rest: '45s', machine: 'Hammer Strength', cues: 'Full range — stretch at bottom, squeeze at top. Slow and controlled.', priority: 3 },
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

export const CARDIO = [
  { rank: 1, name: 'Swimming', badge: 'BEST', desc: 'Zero joint impact. Highest calorie burn. 20–30 min any stroke.' },
  { rank: 2, name: 'Upright Bike', badge: 'GREAT', desc: 'No weight on joints. Best for warm-ups and cardio finishers.' },
  { rank: 3, name: 'Elliptical', badge: 'GOOD', desc: 'Low impact — distributes load across arms and legs.' },
  { rank: 4, name: 'Treadmill', badge: 'CAUTION', desc: 'ONLY walking at 4–5 km/h, low incline. Never run.' },
];
