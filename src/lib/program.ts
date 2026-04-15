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
  focus: 'Chest \u00b7 Quads \u00b7 Shoulders',
  warmup: '5 min upright bike (easy, low resistance) + 10 arm circles + 10 seated leg lifts',
  cardioFinisher: '10 min upright bike, moderate resistance, RPM 60\u201370',
  exercises: [
    { name: 'Leg Press', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '90s', machine: 'Leg Press Machine', cues: 'Feet high & wide. Press through heels. Stop at 90\u00b0 knee bend. Don\'t lock out.' },
    { name: 'Chest Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10\u201312', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Handles at mid-chest. 2s press, 2s return. Back flat on pad.' },
    { name: 'Shoulder Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10\u201312', rest: '75s', machine: 'Hammer Strength', cues: 'Start at ear level. Press up, don\'t lock elbows. No back arching.' },
    { name: 'Leg Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '60s', machine: 'Life Fitness', cues: 'Pad above ankles. Squeeze quads 1s at top. Lower slowly (3s down).' },
    { name: 'Lateral Raise', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '45s', machine: 'Life Fitness', cues: 'Light weight. Raise to shoulder height only. Control the negative.' },
    { name: 'Pec Fly', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '45s', machine: 'Hoist ROC-IT', cues: 'Don\'t open too far back. Arc together, squeeze chest. Slight elbow bend.' },
    { name: 'Standing Calf Raise', sets: 2, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15\u201320', rest: '45s', machine: 'Hammer Strength', cues: 'Full range \u2014 stretch at bottom, squeeze at top. Slow and controlled.' },
    { name: 'Plank', sets: 3, repsMin: 20, repsMax: 30, unit: 'seconds', repsDisplay: '20\u201330s', rest: '45s', machine: 'Floor / mat', cues: 'Dead bugs if plank too hard: lie on back, alternate extending limbs.' },
  ],
};

export const DAY_B: DayTemplate = {
  id: 'B',
  focus: 'Back \u00b7 Hamstrings \u00b7 Arms',
  warmup: '5 min elliptical (easy pace) + shoulder rolls + gentle torso twists',
  cardioFinisher: '10\u201315 min swimming OR elliptical at moderate pace',
  exercises: [
    { name: 'Lat Pulldown', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10\u201312', rest: '75s', machine: 'Hammer Strength', cues: 'Wide grip, pull to upper chest. Drive elbows down. Lean back 10\u00b0.' },
    { name: 'Mid Row', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10\u201312', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Feet on footrests. Pull handles back, squeeze shoulder blades 1s. Slow return.' },
    { name: 'Leg Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '60s', machine: 'Life Fitness', cues: 'Pad above heels. Curl fully, squeeze hamstrings. 3s lowering.' },
    { name: 'Rear Delt Fly', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '45s', machine: 'Life Fitness', cues: 'Sit facing pad. Open arms outward. Light weight \u2014 small muscle group.' },
    { name: 'Bicep Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '45s', machine: 'Life Fitness / Cable', cues: 'Lock upper arms. Curl fully, squeeze at top. No swinging.' },
    { name: 'Triceps Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12\u201315', rest: '45s', machine: 'Life Fitness', cues: 'Arms on pad. Extend fully, squeeze triceps. Control return.' },
    { name: 'Cable Face Pull', sets: 3, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15\u201320', rest: '45s', machine: 'Life Fitness Dual Pulley', cues: 'Cable at face height, rope attachment. Pull apart to ears. Builds posture.' },
    { name: 'Ab Crunch', sets: 3, repsMin: 15, repsMax: 20, unit: 'reps', repsDisplay: '15\u201320', rest: '45s', machine: 'Ab Machine', cues: 'Slow and controlled. Exhale as you crunch. No jerking.' },
  ],
};

export function getDayTemplate(day: 'A' | 'B'): DayTemplate {
  return day === 'A' ? DAY_A : DAY_B;
}

export const SCHEDULE = [
  { day: 'Sun', workout: 'A', type: 'gym' as const },
  { day: 'Mon', workout: null, type: 'rest' as const },
  { day: 'Tue', workout: 'B', type: 'gym' as const },
  { day: 'Wed', workout: null, type: 'rest' as const },
  { day: 'Thu', workout: 'A/B', type: 'gym' as const },
  { day: 'Fri', workout: null, type: 'rest' as const },
  { day: 'Sat', workout: null, type: 'rest' as const },
];

export const PROGRESSION = [
  { weeks: '1\u20132', phase: 'LEARN', desc: 'Lightest weight. Learn each movement: full range, 2s up / 3s down. Chase technique, not fatigue.' },
  { weeks: '3\u20134', phase: 'BUILD', desc: 'If all reps clean \u2192 move up one weight pin. Last 2\u20133 reps should feel challenging.' },
  { weeks: '5\u20136', phase: 'PUSH', desc: 'Add 1 rep per set OR one weight pin. Extend cardio to 12\u201315 min if energy allows.' },
  { weeks: '7', phase: 'DELOAD', desc: 'Drop weights 40%. Same exercises, light effort. Focus on stretching and sleep.' },
  { weeks: '8\u201310', phase: 'REBUILD', desc: 'Return to Wk 6 weights \u2014 they\'ll feel easier. Continue adding weight/reps gradually.' },
  { weeks: '11\u201312', phase: 'EVALUATE', desc: 'Measure: weight, how clothes fit, strength gains. Reassess if plateau.' },
];

export const CARDIO = [
  { rank: 1, name: 'Swimming', badge: 'BEST', desc: 'Zero joint impact. Highest calorie burn. 20\u201330 min any stroke.' },
  { rank: 2, name: 'Upright Bike', badge: 'GREAT', desc: 'No weight on joints. Best for warm-ups and cardio finishers.' },
  { rank: 3, name: 'Elliptical', badge: 'GOOD', desc: 'Low impact \u2014 distributes load across arms and legs.' },
  { rank: 4, name: 'Treadmill', badge: 'CAUTION', desc: 'ONLY walking at 4\u20135 km/h, low incline. Never run.' },
];
