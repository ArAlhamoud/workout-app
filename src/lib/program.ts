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


// ── Dynamic plan ─────────────────────────────────────────────
// The plan follows BEHAVIOUR, not the calendar. A fixed weekly grid
// (Sun A / Tue B / Thu A-or-B) lies twice: it calls a rest day after a
// session he skipped, and it calls a gym day the morning after he trained.
// The rules are simple and never block him:
//   trained today      → celebrate, don't nag
//   trained yesterday  → recover (never back-to-back)
//   2+ days ago        → train the ALTERNATE of the last day letter
//   nothing logged     → Day A

export type DayId = 'A' | 'B';

/**
 * The one Day-letter parser: "Day B 45m — Aug 2" → 'B'. Freestyle sessions
 * with no letter in the name return null and are handled by the caller.
 */
export function parseDayLetter(name: string | null | undefined): DayId | null {
  const m = name?.match(/Day ([AB])/i);
  return m ? (m[1].toUpperCase() as DayId) : null;
}

/** A/B alternation. Nothing lettered yet → Day A. */
export function alternateDay(day: DayId | null | undefined): DayId {
  return day === 'A' ? 'B' : 'A';
}

// Recovery is prescribed off the day just TRAINED, never off the weekday —
// a calendar-keyed prescription is exactly what the dynamic plan removes.
// Day A hammers quads, so its recovery stays flat and easy; Day B leaves the
// legs fresh, so the water is on the table.
export const RECOVERY_ACTIVITY: Record<DayId, string> = {
  A: '20 min walk',
  B: '30 min swim or walk',
};

/** Recovery prescription with nothing logged yet — the gentlest option. */
export const RECOVERY_DEFAULT = '20 min walk';

export function recoveryActivity(lastDay: DayId | null | undefined): string {
  return lastDay ? RECOVERY_ACTIVITY[lastDay] : RECOVERY_DEFAULT;
}

/**
 * A rescue walk keeps the STREAK alive — that is its whole job — but it is
 * not a training stimulus. It must never reset the 21-day break clock, count
 * as a ramp session, or flip tomorrow into a recovery day (trainer's veto:
 * a walk on layoff day 20 would silently hand back full pre-break weights).
 */
export function isTrainingSession(s: { name?: string | null }): boolean {
  return !(s.name ?? '').startsWith('Rescue walk');
}

/** A logged session, as little of it as the plan needs. */
export interface LoggedSession {
  date: Date | string;
  /** Workout name — the Day letter is parsed out of it. */
  name?: string | null;
  /** Explicit letter, when the caller already knows it. Wins over `name`. */
  day?: DayId | null;
}

export type PlanMode = 'train' | 'recover' | 'done-today';

export interface DynamicPlan {
  mode: PlanMode;
  /**
   * train    → the day to run now
   * recover  → the day queued for the next session (he can still train it today)
   * done-today → the day he actually logged today, or null if unlettered
   */
  day: DayId | null;
  /** Whole calendar days since the last session; null when there is none. */
  daysSinceLast: number | null;
  /** Letter of the most recent session that carries one — drives alternation. */
  lastDay: DayId | null;
  /** One short sentence of why, for a <details> or a sub-line. */
  reason: string;
}

const dayStart = (d: Date | string): number => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

/**
 * Whole CALENDAR days between two instants: a session logged at 9 pm
 * yesterday is 1 day ago at 7 am today, not 0. Elapsed-hours maths gets
 * "trained yesterday" wrong for exactly the sessions he logs at night.
 */
export function calendarDaysBetween(now: Date | string, then: Date | string): number {
  return Math.round((dayStart(now) - dayStart(then)) / 86400000);
}

function sessionLetter(s: LoggedSession): DayId | null {
  if (s.day === 'A' || s.day === 'B') return s.day;
  return parseDayLetter(s.name);
}

/**
 * What the app should tell him to do right now, derived from his own log.
 * Never returns a "blocked" state — 'recover' is advice, and both days stay
 * startable in the UI.
 */
export function getDynamicPlan(allSessions: LoggedSession[], now: Date = new Date()): DynamicPlan {
  // Walks and other non-training rows are invisible to the plan.
  const sessions = allSessions.filter(isTrainingSession);
  const desc = sessions
    .filter((s): s is LoggedSession => s != null && s.date != null)
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (!desc.length) {
    return {
      mode: 'train',
      day: 'A',
      daysSinceLast: null,
      lastDay: null,
      reason: 'Nothing logged yet — start with Day A.',
    };
  }

  const last = desc[0];
  // A future-dated log is still "today" as far as the plan is concerned.
  const daysSinceLast = Math.max(0, calendarDaysBetween(now, last.date));

  // An unlettered session (freestyle log) must not break the A/B rhythm:
  // alternate from the most recent session that DOES carry a letter.
  let lastDay: DayId | null = null;
  for (const s of desc) {
    const letter = sessionLetter(s);
    if (letter) {
      lastDay = letter;
      break;
    }
  }

  if (daysSinceLast === 0) {
    const loggedToday = sessionLetter(last);
    return {
      mode: 'done-today',
      day: loggedToday,
      daysSinceLast: 0,
      lastDay,
      reason: loggedToday ? `Day ${loggedToday} is in the book today.` : 'Session logged today.',
    };
  }

  const next = alternateDay(lastDay);

  if (daysSinceLast === 1) {
    return {
      mode: 'recover',
      day: next,
      daysSinceLast: 1,
      lastDay,
      reason: `Trained yesterday — recover today, Day ${next} next.`,
    };
  }

  return {
    mode: 'train',
    day: next,
    daysSinceLast,
    lastDay,
    reason: lastDay
      ? `${daysSinceLast} days since Day ${lastDay} — Day ${next} is up.`
      : `${daysSinceLast} days since your last session — Day ${next} is up.`,
  };
}

/**
 * The day to queue next. Same as `plan.day` except after a session logged
 * today, where the queued day is the ALTERNATE of what he just did rather
 * than a repeat of it.
 */
export function queuedDay(plan: DynamicPlan): DayId {
  if (plan.mode === 'done-today') return alternateDay(plan.day ?? plan.lastDay);
  return plan.day ?? alternateDay(plan.lastDay);
}

export interface PlanDay {
  date: Date;
  mode: PlanMode;
  /** The day letter this slot carries; null on recovery slots. */
  day: DayId | null;
  isToday: boolean;
}

/**
 * Rolling projection: today plus the following days, assuming he follows the
 * plan (train → recover → train → …). Each projected session is fed back in
 * so the alternation and the never-back-to-back rule keep applying.
 */
export function projectPlan(sessions: LoggedSession[], now: Date = new Date(), days = 5): PlanDay[] {
  const simulated: LoggedSession[] = sessions.map((s) => ({ date: s.date, name: s.name, day: s.day }));
  const out: PlanDay[] = [];

  for (let i = 0; i < days; i++) {
    const at = new Date(now);
    at.setDate(at.getDate() + i);
    if (i > 0) at.setHours(12, 0, 0, 0); // midday keeps DST off the day count
    const plan = getDynamicPlan(simulated, at);
    out.push({
      date: at,
      mode: plan.mode,
      day: plan.mode === 'recover' ? null : plan.day,
      isToday: i === 0,
    });
    if (plan.mode === 'train' && plan.day) simulated.push({ date: at, day: plan.day });
  }
  return out;
}

/** Weekly session target for the dynamic plan — unchanged by the rewrite. */
export const WEEKLY_SESSION_TARGET = 3;

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
  | {
      mode: 'return';
      week: number;
      returnWeek: ReturnWeek;
      daysOff: number;
      sessionsInBlock: number;
      /** Clean sessions that also satisfied the rest-day spacing rule. */
      cleanSpacedInBlock: number;
      daysInBlock: number;
      /** When the last SPACED clean session happened — the next one only
       *  counts once a rest day has passed after this. */
      lastCountedISO: string | null;
      /** First session of this return block, or null on day 1 (none yet).
       *  Weight memory for the ramp must be read from BEFORE this date:
       *  the ramp scales the PRE-BREAK weight, and a prefill that read the
       *  previous ramp session instead compounded 60% on 60% (owner's
       *  first wrist session, 2026-09-01). */
      blockStartISO: string | null;
    }
  | { mode: 'normal'; week: number };

/**
 * Works out where the lifter actually is: starting out, ramping back
 * after a layoff, or mid-program. Counting weeks from the very first
 * workout would put someone who took two months off in week 12.
 */
/**
 * A ramp session that EARNS acceleration: at least two rated working sets,
 * none harder than Med. One stray tap can't earn a week (the 2-set floor),
 * and a Hard or Grind anywhere means the load is not as light as the ramp
 * assumes — the calendar keeps the wheel then.
 */
export function cleanRampSessionDates(
  sessions: Array<{ date: Date; sets?: Array<{ rpe: number | null; isWarmup: boolean }> }>,
): Date[] {
  return sessions
    .filter((s) => {
      const rated = (s.sets ?? []).filter((x) => !x.isWarmup && x.rpe !== null);
      return rated.length >= 2 && rated.every((x) => (x.rpe as number) <= 2);
    })
    .map((s) => new Date(s.date));
}

export function getTrainingStatus(
  dates: Date[],
  now: Date = new Date(),
  cleanDates: Date[] = [],
): TrainingStatus {
  if (!dates.length) return { mode: 'fresh', week: 1 };

  const desc = dates.map((d) => new Date(d)).sort((a, b) => b.getTime() - a.getTime());
  const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);

  // Still inside the layoff — today is day 1 of the return block.
  const daysSinceLast = daysBetween(now, desc[0]);
  if (daysSinceLast >= BREAK_THRESHOLD_DAYS) {
    return {
      mode: 'return', week: 1, returnWeek: RETURN_PROGRAM[0], daysOff: daysSinceLast,
      sessionsInBlock: 0, cleanSpacedInBlock: 0, daysInBlock: 0, lastCountedISO: null,
      blockStartISO: null,
    };
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
    // week, but never faster than the calendar — UNLESS the sessions were
    // clean (Earned Ramp). Clean rated sessions substitute for calendar
    // weeks, so a disciplined comeback reaches full load in ~2 weeks while
    // an unrated or grindy one keeps exactly the old calendar floor. The
    // 2-sessions-per-phase pacing clamp never lifts: nothing skips a phase.
    // TIME never leaves the earned ramp (trainer blocker). Two gates on top
    // of the clean-session count:
    //   - SPACING: a clean session only counts if a rest day passed since
    //     the last counted one. Muscular "Easy" at 60% load cannot see
    //     tendon readiness at this bodyweight, and daily training is the
    //     exact pattern the program forbids — it must never be the fast lane.
    //   - DAY FLOOR: each earned phase needs ~4 days of block time, so the
    //     fastest disciplined comeback reaches 100% in ~2.5 weeks, never 8 days.
    const cleanTs = cleanDates
      .map((d) => new Date(d).getTime())
      .filter((t) => t >= blockStart.getTime() && t <= now.getTime())
      .sort((a, b) => a - b);
    let cleanSpacedInBlock = 0;
    let lastCounted = Number.NEGATIVE_INFINITY;
    for (const t of cleanTs) {
      if (daysBetween(new Date(t), new Date(lastCounted)) >= 2 || lastCounted === Number.NEGATIVE_INFINITY) {
        cleanSpacedInBlock++;
        lastCounted = t;
      }
    }
    const daysInBlock = daysBetween(now, blockStart);
    const earnedWeeks = Math.min(Math.floor(cleanSpacedInBlock / 2), Math.floor(daysInBlock / 4));
    const effectiveWeeks = Math.max(weeksElapsed, earnedWeeks);
    const lastCountedISO = Number.isFinite(lastCounted) ? new Date(lastCounted).toISOString() : null;
    const rampSessionsComplete = sessionsInBlock >= 2 * RETURN_PROGRAM.length;
    if (!(rampSessionsComplete && effectiveWeeks >= RETURN_PROGRAM.length)) {
      const week =
        Math.min(Math.floor(sessionsInBlock / 2), effectiveWeeks, RETURN_PROGRAM.length - 1) + 1;
      return {
        mode: 'return', week, returnWeek: RETURN_PROGRAM[week - 1], daysOff,
        sessionsInBlock, cleanSpacedInBlock, daysInBlock, lastCountedISO,
        blockStartISO: blockStart.toISOString(),
      };
    }
    // Ramp done — rejoin the main program at BUILD and progress from there.
    // effectiveWeeks, not weeksElapsed: an EARNED exit at ~2.5 calendar
    // weeks must not graduate into "normal week 1 — LEARN, lightest weight,
    // chase technique" while he lifts 100% pre-break loads (adversary).
    const week = effectiveWeeks - RETURN_PROGRAM.length + REJOIN_AT_WEEK;
    return { mode: 'normal', week: Math.min(12, Math.max(1, week)) };
  }

  return { mode: 'normal', week: Math.min(12, Math.max(1, weeksElapsed + 1)) };
}

/**
 * The Comeback Contract's payoff line — or null when no promise can be
 * kept. The rung this feeds fires on day 2 of silence; a promise the math
 * won't pay ("1 clean session unlocks 70%", then the logger opens at 60%)
 * is worse than no rung at all for a lifter whose collapses start with
 * discouragement (trainer). So: project tonight's clean session through
 * the same spacing + day-floor gates the real advancement uses, and speak
 * only when the unlock is real.
 */
export function rampContract(status: TrainingStatus, now: Date = new Date()): string | null {
  if (status.mode !== 'return') return null;
  const { week, cleanSpacedInBlock, daysInBlock, lastCountedISO, sessionsInBlock } = status;

  // Would a clean session tonight even count as spaced?
  const gapOk =
    !lastCountedISO ||
    Math.floor((now.getTime() - new Date(lastCountedISO).getTime()) / 86400000) >= 2;
  if (!gapOk) return null;

  const earnedAfter = (extraSessions: number, extraDays: number) =>
    Math.min(
      Math.floor((cleanSpacedInBlock + extraSessions) / 2),
      Math.floor((daysInBlock + extraDays) / 4),
    );

  if (week < RETURN_PROGRAM.length) {
    const nextPct = RETURN_PROGRAM[week].loadPct;
    if (earnedAfter(1, 0) >= week) return `1 clean session unlocks ${nextPct}%`;
    // Two sessions take at least two more days (spacing) — project both.
    if (earnedAfter(2, 2) >= week) return `2 clean sessions unlock ${nextPct}%`;
    return null;
  }

  // RESTORE: the exit needs the full session count AND the day floor.
  const sessionsLeft = Math.max(1, 2 * RETURN_PROGRAM.length - sessionsInBlock);
  if (sessionsLeft === 1 && earnedAfter(1, 0) >= RETURN_PROGRAM.length) {
    return '1 session finishes the ramp';
  }
  return null;
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

/**
 * Which memory a RAMP prefill scales. The percentage is "of pre-break
 * working weight" (RETURN_PROGRAM), so the machine's last PRE-BREAK
 * session is the base — never the previous ramp session, which is
 * already scaled and would compound (60% of 60%, then 70% of that). A
 * machine with no pre-break record at all (first met during the ramp)
 * keeps its latest in-block weight as-is, flagged `rampHold`.
 */
export function pickRampMemory<T extends { weight: number }>(
  preBreak: T | undefined,
  latest: T | undefined,
): (T & { rampHold?: boolean }) | undefined {
  if (preBreak) return preBreak;
  if (latest) return { ...latest, rampHold: true };
  return undefined;
}

/**
 * The ramp prefill for one machine: the pre-break weight scaled to the
 * week and snapped to the NEAREST pin of that machine (rule 4 — stacks
 * move in pins; a 2.5 kg floor put the phone on 27.5 while the wrist said
 * 28). Nearest, not floor: flooring a 9 kg-pin Leg Extension put 60% of
 * 29 at 9 kg (31%), and made ramp weeks 2 and 3 identical on a 7 kg
 * stack. Never below one pin. A held machine (no pre-break record) and a
 * 100% week return the weight as-is.
 */
export function rampPrefillWeight(
  memory: { weight: number; rampHold?: boolean },
  loadPct: number,
  pin = 2.5,
): number {
  if (memory.weight <= 0) return 0;
  if (memory.rampHold || loadPct >= 100) return memory.weight;
  const p = pin > 0 ? pin : 2.5;
  const steps = Math.round((memory.weight * loadPct) / 100 / p);
  return +Math.max(p, steps * p).toFixed(2);
}

/**
 * Where the ramp's weight memory stops: the instant of the EARLIEST
 * session logged below full load since the last full-load one. Memory
 * read strictly before it is the pre-break base the percentages are
 * defined against. A session counts as full-load when the status at the
 * moment it was logged was not a ramp week under 100%; rescue sessions
 * are 60% by construction and never a base. This walks back past an
 * abandoned comeback — "last session before this block" read the owner's
 * one-session July ramp as pre-break and would have opened Day A at 60%
 * of 60% (adversary + trainer, 2026-09-01). null = the latest session was
 * itself full-load (or there is no history): plain memory is right.
 */
export function rampBaseBefore(
  sessions: Array<{ date: Date | string; name?: string | null }>,
  cleanDates: Date[] = [],
  now: Date = new Date(),
): string | null {
  const asc = sessions
    .map((s) => ({ date: new Date(s.date), name: s.name ?? '' }))
    .filter((s) => s.date.getTime() <= now.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  let firstScaled: Date | null = null;
  for (let i = asc.length - 1; i >= 0; i--) {
    const s = asc[i];
    const before = asc.slice(0, i).map((x) => x.date);
    const cleanBefore = cleanDates.filter((d) => new Date(d).getTime() < s.date.getTime());
    const at = getTrainingStatus(before, s.date, cleanBefore);
    const scaled = s.name.startsWith('Rescue') || (at.mode === 'return' && at.returnWeek.loadPct < 100);
    if (!scaled) return firstScaled ? firstScaled.toISOString() : null;
    firstScaled = s.date;
  }
  return firstScaled ? firstScaled.toISOString() : null;
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
  // id stays 'work' — it is the value already stored on tagged workouts, and
  // renaming it would orphan them. Only the label changes.
  { id: 'work', name: 'Alrajhi Tower', note: 'Workplace gym' },
];

export const DEFAULT_GYM_ID = 'bfit';

export function getGym(id: string | null | undefined): Gym | null {
  if (!id) return null;
  return GYMS.find((g) => g.id === id) ?? null;
}

export function gymLabel(id: string | null | undefined): string | null {
  return getGym(id)?.name ?? null;
}

export interface CardioOption {
  rank: number;
  name: string;
  badge: string;
  desc: string;
  /** Gym ids where this exists. Omitted means every gym has it. */
  gyms?: string[];
}

// Ranked by calorie burn per minute against joint cost, at his bodyweight.
// Everything above the treadmill is non-impact — that is the whole ordering
// principle, not preference.
export const CARDIO: CardioOption[] = [
  { rank: 1, name: 'Swimming', badge: 'BEST', desc: 'Zero joint impact. Highest calorie burn. 20–30 min any stroke.', gyms: ['bfit'] },
  { rank: 2, name: 'Rowing', badge: 'GREAT', desc: 'Zero impact and the biggest burn on land — you are seated, so none of your bodyweight loads the knees or hips. FORM: legs drive first, then lean back, then pull; reverse it on the way in. Never round your lower back at the catch. 15–20 min steady, or 10 × 1 min hard / 1 min easy.' },
  { rank: 3, name: 'Upright Bike', badge: 'GREAT', desc: 'No weight on joints. Best for warm-ups and cardio finishers.' },
  { rank: 4, name: 'Elliptical', badge: 'GOOD', desc: 'Low impact — distributes load across arms and legs.' },
  { rank: 5, name: 'Treadmill', badge: 'CAUTION', desc: 'ONLY walking at 4–5 km/h, low incline. Never run.' },
];

/** Cardio actually available in one building. */
export function cardioForGym(gymId: string | null | undefined): CardioOption[] {
  if (!gymId) return CARDIO;
  return CARDIO.filter((c) => !c.gyms || c.gyms.includes(gymId));
}
