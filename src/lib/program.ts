export type Priority = 1 | 2 | 3;
export type Duration = 30 | 45 | 60;
/**
 * The session length a bare Start opens, in the ramp and after it (trainer
 * ruling 3, 2026-09-24). Every session he has logged was 30 or 45 minutes;
 * 60 only adds Lateral Raise to Day A, which he has never logged, and adding
 * a new movement the week loads reach 100% is two increases at once. 60
 * stays one tap away.
 */
export const DEFAULT_SESSION_MIN: Duration = 45;

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
  /** Warms up wherever it lands in the session, not only as one of the first
   *  two machines started (trainer ruling 5). */
  alwaysWarm?: true;
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
    { name: 'Leg Press', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '120s', machine: 'Life Fitness (Seated Leg Press)', cues: "Feet shoulder-width, upper third of the platform, toes slightly out (15–30°). Push through mid-foot — not just toes. Lower until thighs reach 90° to the platform; never let your lower back peel off the pad. Press back up and stop just before knees lock out — keep tension on the quads. Exhale on the way up. MISTAKE TO AVOID: feet too low causes knee shear; rounding your back at the bottom is an injury risk — stop the rep there.", youtubeUrl: 'https://www.youtube.com/watch?v=K5n2vg3oZa4', priority: 1 },
    { name: 'Chest Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Adjust seat so handles align with mid-chest nipple line. Before unracking, pull shoulder blades DOWN and BACK into the pad and keep them pinned there the whole set — this protects your shoulder joint. Elbows at 45–75° from your torso (not flared out to 90°). Press 2s, return 3s. Stop just before elbows lock. IMPORTANT — this Hoist seat is DESIGNED TO MOVE as you press: let it rock with you instead of fighting it, and keep your back on the pad. MISTAKE TO AVOID: arching your lower back off the pad to press more weight — if you need to arch, drop the weight.', youtubeUrl: 'https://www.youtube.com/watch?v=sqNwDkUU_Ps', priority: 1 },
    { name: 'Shoulder Press', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT (Shoulder Press)', cues: "Adjust the handles to shoulder height and sit with feet on the footrests. IMPORTANT — this Hoist seat is DESIGNED TO MOVE as you press: let it rock with you instead of fighting it, and keep your back in contact with the pad the whole time. Press straight up with wrists stacked directly over elbows. Stop just short of lockout to keep tension on the deltoids. Lower 3s back to ear level. MISTAKE TO AVOID: if you feel it in your upper traps or neck, the weight is too heavy — drop a pin and feel the delts working instead.", youtubeUrl: 'https://www.youtube.com/watch?v=3R14MnZbcpw', priority: 1 },
    { name: 'Hip Abduction', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness (Hip Abduction)', cues: 'Sit tall, back flat against the pad, outer thighs against the pads. Grip the handles lightly — they steady you, they do not pull. Press the knees APART by driving through the outside of the thighs; you should feel it on the side of the hip, not the lower back. Push out 2s, hold 1s at the widest point, return 3s under control without letting the stack touch down. Leaning the torso slightly forward biases the upper glute if you want more of it. MISTAKE TO AVOID: slamming the pads open with momentum and bouncing off the stack — this is a small muscle, so the weight should look light and the tempo should look slow.', youtubeUrl: 'https://www.youtube.com/watch?v=I4ApZY585nE', priority: 1 },
    // The same Life Fitness combo machine, pads flipped: 2 sets out, 2 sets in.
    // Adductors stabilise the knee and matter at this bodyweight; the pair
    // replaces 3 sets of abduction alone (owner logged 2+2 on 2026-09-06).
    // Priority 1 with abduction: joint protection at this bodyweight belongs
    // in the 30-minute session too — same station, two extra minutes (trainer).
    { name: 'Hip Adduction', sets: 2, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness (Hip Adduction — pads in)', cues: 'Flip the pads to the INSIDE of the thighs and start with the legs open. Sit tall, back on the pad, hands light on the handles. Squeeze the knees TOGETHER by driving through the inner thighs — feel it along the inside of the leg, not the knee joint. In 2s, hold 1s with the pads touching, open 3s under control and stop just before the stack touches down. It normally sits above your abduction weight — the inner thigh is the stronger side, so a heavier pin is not a form error. MISTAKE TO AVOID: setting the start position too wide — if the inner thigh pulls sharply at the start, close the range one notch.', youtubeUrl: 'https://www.youtube.com/watch?v=CjAVezAggkI', priority: 1 },
    { name: 'Leg Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness', cues: 'Adjust seat back so your knee joint aligns with the machine pivot point — this is critical for joint safety. Pad just above the ankle. Grip the handles to stop your hips lifting. Extend fully — flex quads hard and hold 1s at the top. Lower 3s under full control. MISTAKE TO AVOID: swinging or letting the weight drop — the slow eccentric is where you build the muscle. Toes slightly up throughout.', youtubeUrl: 'https://www.youtube.com/watch?v=2lvdnQg04PM', priority: 2 },
    { name: 'Pec Fly', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '45s', machine: 'Hoist ROC-IT', cues: "Adjust seat so handles align with mid-chest. Set a slight bend in the elbows and KEEP that exact angle throughout — they are not a hinge. Open arms back only until you feel a mild chest stretch (roughly even with your body line — no further). Arc the handles together thinking 'hugging a tree', squeezing the chest hard. IMPORTANT — this Hoist seat is DESIGNED TO MOVE as you close: let it rock with you instead of fighting it, and keep your back on the pad. MISTAKE TO AVOID: opening arms too far back loads the bicep tendon and risks a shoulder tear — conservative range of motion is correct here.", youtubeUrl: 'https://www.youtube.com/watch?v=dY4LduyY8H0', priority: 2 },
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
    { name: 'Back Extension', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '75s', machine: 'Life Fitness (seated Back Extension)', cues: 'This is the SEATED machine, not a roman chair — you sit upright, not face-down. Set the back pad so it sits across your upper back / shoulder blades, and the seat so your hips sit at the machine pivot. Cross arms on your chest or hold the handles. Press BACKWARD by driving your hips down into the seat and squeezing your glutes — the movement is a hip extension, the spine stays neutral and travels as one piece. Push back 2s, hold 1s, return 3s under control, stopping before the stack touches down. Range: only as far back as you can go without your ribs flaring or your chin lifting. MISTAKE TO AVOID: cranking backward with the lower back to chase range — a shorter, controlled rep with the glutes doing the work is the whole point, and at your bodyweight the seated version is far kinder to your spine than a roman chair.', youtubeUrl: 'https://www.youtube.com/watch?v=gLT-WLH84B4', priority: 1, alwaysWarm: true },
    { name: 'Lat Pulldown', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hammer Strength', cues: 'Grip just outside shoulder width — wider is NOT better. Lock thighs under the pad. BEFORE pulling: depress your shoulder blades (pull shoulders away from ears). Then pull the bar to your upper chest by driving elbows straight DOWN and BACK toward your hips. Lean back 10–15° naturally. Hold 1s at bottom with lats squeezed. Return with arms fully extending for a full lat stretch at the top. MISTAKE TO AVOID: leaning back 45°+ turns this into a row — keep the lean minimal and feel your lats, not your biceps.', youtubeUrl: 'https://www.youtube.com/watch?v=NYQ-o3ffxOc', priority: 1 },
    { name: 'Mid Row', sets: 3, repsMin: 10, repsMax: 12, unit: 'reps', repsDisplay: '10–12', rest: '75s', machine: 'Hoist ROC-IT', cues: 'Adjust seat so handles are at mid-abdomen height. Sit upright with a slight forward lean at the hips — chest up, not hunched. Neutral grip (palms facing each other). BEFORE pulling: depress and slightly retract shoulder blades. Then row by driving elbows past your torso — aim for 90° elbow angle at full contraction. Squeeze shoulder blades together hard and hold 1s. Return 3s to a full arm extension and feel the lats stretch. IMPORTANT — this Hoist seat is DESIGNED TO MOVE as you row: keep your chest against the pad as it rocks and do not let it push you into a shrug. MISTAKE TO AVOID: shrugging shoulders up toward ears during the row — keep them down throughout.', youtubeUrl: 'https://www.youtube.com/watch?v=GZbfZ033f74', priority: 1 },
    { name: 'Plank', sets: 3, repsMin: 20, repsMax: 30, unit: 'seconds', repsDisplay: '20–30s', rest: '45s', machine: 'Floor / mat', cues: "KNEE PLANK is the default at your bodyweight — or dead bugs, which are as good for the spine. Knees and forearms on the mat, elbows directly under shoulders, a straight line from knees to head. KEEP BREATHING — slow, steady breaths in and out for the whole hold, 4–6 breaths per 30 s. Never hold your breath: a held breath under load spikes blood pressure. Squeeze glutes, draw the belly button toward the spine, push the floor away with the forearms. Hold 20–30 s; to progress, add a SET, not seconds. MISTAKE TO AVOID: hips piked up, or hips sagging — the moment the hips drop, the set is over. And no toes-down plank yet: at this bodyweight it drags the pelvis into a tilt and loads the lumbar spine.", youtubeUrl: 'https://www.youtube.com/watch?v=A2b2EmIg0dA', priority: 2 },
    { name: 'Leg Curl', sets: 3, repsMin: 12, repsMax: 15, unit: 'reps', repsDisplay: '12–15', rest: '60s', machine: 'Life Fitness (Seated Leg Curl)', cues: 'SEATED machine: sit tall, back on the pad, knee joint in line with the machine pivot, thigh pad locked DOWN across the lower thighs, ankle pad just above the heels. HOLD THE HANDLES — they are what keep your hips down. Curl under the seat until the pad nearly touches the seat frame, squeeze the hamstrings and hold 1s, return 3s — CRITICAL: let the legs fully extend and feel the hamstring stretch before the next rep. If the seated machine is taken, do the next exercise and come back — no face-down curls at this bodyweight (a compressed belly and an arched back is a blood-pressure spike). MISTAKE TO AVOID: hips rising off the seat means the weight is too heavy — drop a pin.', youtubeUrl: 'https://www.youtube.com/watch?v=S367qaHeYWU', priority: 1 },
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

// ── Warm-up sets ─────────────────────────────────────────────
// The first two machines he starts get a ramp-in set at ~55% of the
// working weight, floored to the machine's pin (warmupDue). Only two: by
// the third the body is warm and an extra set is just fatigue.
//
// This lived only in WorkoutForm, so the Watch — which builds its slots
// from /api/watch/plan — never offered one. Training from the wrist
// silently skipped the warm-ups, and resuming on the phone then showed
// "4 sets" where the wrist had shown 3 (owner, 2026-09-18). One rule,
// one home, same lesson as rule 7.

/** How many machines of a session open with a warm-up set (plus alwaysWarm ones). */
export const WARMUP_BLOCKS = 2;


/**
 * ~55% of the working weight, floored to a whole pin, never below one
 * pin — and null when that floor lands ON or above the working weight.
 * Back Extension learned a 15 kg pin, so at REBOOT (60% of 27.5 → 15)
 * the "ramp-in" came out at exactly the prescribed working weight: a
 * fourth full-load set under a week-1 RPE cap, on both devices
 * (adversary, 2026-09-18). A warm-up that is not lighter is not a
 * warm-up; on a coarse stack the honest answer is no warm-up set.
 */
export function warmupWeight(workingKg: number, pin: number, anchored = false): number | null {
  const step = pin > 0 ? pin : 2.5;
  if (anchored) {
    // On HIS stack the rungs run through the working weight, not from zero:
    // Chest Press at 27.5 on a 4.5 step warms up on 14, the real plate, not
    // 13.5 (trainer + adversary, 2026-09-24). ~55%, floored to a rung.
    let warm = workingKg - Math.ceil((workingKg * 0.45) / step - 1e-9) * step;
    if (warm <= 1e-9) warm = lowestRung(workingKg, step);
    warm = Math.round(warm * 100) / 100;
    return warm < workingKg - 1e-9 ? warm : null;
  }
  const warm = Math.max(step, Math.floor((workingKg * 0.55) / step) * step);
  return warm < workingKg ? warm : null;
}

/**
 * The bottom rung of a stack `step` apart that runs through `weightKg` — a
 * weight he really lifted. A machine's plates need not be multiples of its
 * step counted from zero: 5, 12.5, 20, 27.5 is a 7.5 kg stack, and so is
 * his Chest Press 23 / 27.5 on 4.5 (CLAUDE.md rule 4's own example).
 */
export function lowestRung(weightKg: number, step: number): number {
  const r = weightKg - Math.floor((weightKg - 1e-9) / step) * step;
  return Math.round(r * 100) / 100;
}

/**
 * Does the machine he is about to START get a warm-up set? The first two
 * weighted machines he actually starts warm up — whatever they are — and a
 * machine marked alwaysWarm warms up wherever it lands (trainer ruling 5,
 * 2026-09-24). The warm-up is for cold joints meeting load, which is about
 * what he does first, not where a machine sits on paper: an occupied Leg
 * Press sent him to Chest Press cold, then warmed Leg Press up third. The
 * server sends each machine's warm-up weight; the device counts the starts.
 */
export function warmupDue(
  startedWeighted: number,
  unit: 'reps' | 'seconds',
  workingKg: number | null | undefined,
  alwaysWarm?: boolean,
): boolean {
  return unit !== 'seconds' && !!workingKg && (alwaysWarm === true || startedWeighted < WARMUP_BLOCKS);
}

/** The prescription for one named movement, wherever it sits in the week. */
export function programSpec(name: string | null | undefined): { sets: number; repsMin: number; repsMax: number } | undefined {
  if (!name) return undefined;
  const e = [...DAY_A.exercises, ...DAY_B.exercises].find((x) => x.name === name);
  return e ? { sets: e.sets, repsMin: e.repsMin, repsMax: e.repsMax } : undefined;
}

/** One logged working set, as the progression rules read it. */
export interface EvidenceSet {
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number | null;
}

const isRated = (rpe: number | null | undefined): rpe is number => rpe != null && rpe > 0;

/**
 * Did this session prove the weight light? (trainer ruling 1, 2026-09-24)
 *
 * The Watch rates ONE set per machine — the last, most fatigued one — so the
 * old "two or more rated sets, all Easy" rule meant a wrist-only session
 * could never earn a pin. An Easy on the last set at full reps says the
 * earlier sets were Easy too, so it now counts, under guards that matter
 * because he rates nearly everything Easy (Sep 12: 29 of 29 sets):
 *   - every prescribed working set logged (an off-plan machine: two);
 *   - all at one weight — no drop sets;
 *   - every set at or above repsMin — a short set anywhere disqualifies;
 *   - the highest-numbered set rated Easy;
 *   - no other rated set above Easy.
 * Unrated (a spoken "done", a skipped strip) never qualifies. Two such
 * sessions in a row at the same top weight still gate the pin.
 */
export function earnsOverload(sets: EvidenceSet[], spec: { sets: number; repsMin: number } | undefined): boolean {
  const work = sets.filter((x) => x.weight > 0);
  if (work.length < (spec?.sets ?? 2)) return false;
  const top = Math.max(...work.map((x) => x.weight));
  if (work.some((x) => Math.abs(x.weight - top) > 1e-6)) return false;
  if (spec && work.some((x) => x.reps < spec.repsMin)) return false;
  const last = work.reduce((a, b) => (b.setNumber > a.setNumber ? b : a));
  if (last.rpe !== 1) return false;
  return work.every((x) => !isRated(x.rpe) || x.rpe === 1);
}

export type ShortSetVerdict = 'full' | 'short-easy' | 'short-hard' | 'short-unrated';

/**
 * What a short set means for next time (trainer ruling 6). A set under
 * repsMin is a real event — fatigue, a symptom stop on flecainide and
 * nebivolol, or a copied prefill — so it stays in the log and is never
 * read as "ready for more". The rating that counts is the short set's own;
 * an unrated short set takes the last set's rating, because the Watch only
 * rates the last. Only 'short-hard' twice at one weight changes the load.
 */
export function shortSetVerdict(sets: EvidenceSet[], spec: { sets: number; repsMin: number } | undefined): ShortSetVerdict {
  if (!spec) return 'full';
  const work = sets.filter((x) => x.weight > 0);
  const short = work.filter((x) => x.reps < spec.repsMin);
  if (!short.length) return 'full';
  const ratings = short.map((x) => x.rpe).filter(isRated);
  let rating: number | null = ratings.length ? Math.max(...ratings) : null;
  if (rating == null) {
    const last = work.reduce((a, b) => (b.setNumber > a.setNumber ? b : a));
    if (isRated(last.rpe)) rating = last.rpe;
  }
  if (rating == null) return 'short-unrated';
  return rating >= 3 ? 'short-hard' : 'short-easy';
}

// Capped at 30 s (trainer, 2026-09-18): at 126 kg a longer isometric is a
// breath-held BP spike and a lumbar test. Progress by adding a set.
export function getPlankTarget(_week: number): { min: number; max: number } {
  // Same every week: he has never held past 21 s, and "progress by sets"
  // means the seconds do not climb (trainer, 2026-09-18).
  return { min: 20, max: 30 };
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
export function isTrainingSession(s: {
  name?: string | null;
  /** Seconds. When known, a sub-10-minute save with nothing rated is a mis-tap, not a session. */
  duration?: number | null;
  sets?: Array<{ rpe?: number | null; isWarmup?: boolean | null }> | null;
}): boolean {
  const n = s.name ?? '';
  // A 6-second accidental Save advanced the ramp half a week and raised
  // prescribed loads (adversary, 2026-09-18). Judged only when the row
  // carries a duration; a 15-minute rescue clears the bar on time alone.
  // Three 700-second Watch replay stubs (3 sets, 1 rated) did the same
  // (adversary, 2026-09-18). A row is a session when it has the EVIDENCE
  // of one: two rated sets, or six working sets (a rescue is eight; a
  // session typed in from memory has them), or ten minutes with at least
  // four sets. A bare name is not judged; duration alone is judged on time.
  if (Array.isArray(s.sets)) {
    const working = s.sets.filter((x) => !x.isWarmup);
    const rated = working.filter((x) => x.rpe != null).length;
    const d = typeof s.duration === 'number' ? s.duration : null;
    if (rated >= 2 || working.length >= 6) return true;
    if (d != null && d >= 600 && working.length >= 4) return true;
    if (d == null && working.length >= 4) return true;
    return false;
  }
  if (typeof s.duration === 'number' && s.duration < 600) return false;
  // Cardio — a rescue walk, a logged walk, a swim (manual or imported from
  // HealthKit) — keeps the streak alive and nothing else: it must never
  // count as a ramp session or flip tomorrow into a recovery day.
  return !(n.startsWith('Rescue walk') || n.startsWith('Walk ') || n.startsWith('Swim '));
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
export interface OverRamp {
  exerciseId: string;
  lifted: number;
  /** The most the ramp allowed on that machine that day (recorded at save time). */
  allowed: number;
}

/**
 * The most a ramp set may weigh: the SAME prescription the logger showed
 * (same memory, same learned pin) plus one pin — and never past the
 * pre-break base before RESTORE. Computed by createWorkout the moment a
 * session is saved and stored on the set as allowedKg; nothing ever
 * reconstructs it later (adversary passes 1–3, 2026-09-18: memory RPE,
 * pin map and block cut all drift after the fact).
 */
export function allowedRampKg(
  memory: { weight: number; rampHold?: boolean; rpe?: number | null; holdAtKg?: number },
  loadPct: number,
  pin: number,
  anchored = false,
): number | null {
  if (loadPct >= 100 || memory.weight <= 0) return null;
  const p = pin > 0 ? pin : 2.5;
  // A held machine (no pre-break record) is the one place the logger
  // applies Overload DURING a ramp so it does not sit frozen for four
  // weeks: its allowance is that prefill, one pin above its weight
  // (adversary pass 4).
  if (memory.rampHold) return +(memory.weight + p).toFixed(2);
  // A short set rated Hard in this block HOLDS the prescription (ruling 6),
  // so the allowance is judged from the held weight: after a short Hard 30,
  // loading the week's full 35 is over-ramp (review round 3).
  const scaled = rampPrefillWeight(memory, loadPct, p, anchored);
  const prescribed = memory.holdAtKg != null ? Math.min(scaled, memory.holdAtKg) : scaled;
  return +Math.min(prescribed + p, Math.max(prescribed, memory.weight)).toFixed(2);
}

/**
 * A ramp session lifted ABOVE what it was allowed is "over-ramp": it
 * still counts as a session for calendar pacing; it does not EARN a
 * phase. Thursday 17 Sep was prescribed 70% and lifted 96–117% of base,
 * rated Easy — and that advanced the ramp (trainer B1). Judged only from
 * the allowedKg recorded on the sets; a set with none (historical, held
 * machine, outside a ramp) cannot be over-ramp.
 */
export function isOverRamp(
  sets: Array<{ exerciseId?: string; weight?: number; isWarmup?: boolean | null; allowedKg?: number | null }>,
): OverRamp | null {
  let worst: OverRamp | null = null;
  for (const x of sets) {
    if (x.isWarmup || !x.exerciseId || typeof x.weight !== 'number' || x.allowedKg == null) continue;
    if (x.weight > x.allowedKg && (!worst || x.weight - x.allowedKg > worst.lifted - worst.allowed)) {
      worst = { exerciseId: x.exerciseId, lifted: x.weight, allowed: x.allowedKg };
    }
  }
  return worst;
}

type RampSession = {
  date: Date | string;
  name?: string | null;
  gym?: string | null;
  sets?: Array<{ rpe?: number | null; isWarmup?: boolean | null; exerciseId?: string; weight?: number; allowedKg?: number | null }> | null;
};

export interface RampVerdict {
  date: Date;
  /** Earns ramp progress: ≥2 rated working sets, none above Med, not over-ramp. */
  clean: boolean;
  overRamp: OverRamp | null;
}

/**
 * The day a row belongs to, as a key. A row stored as bare UTC midnight
 * IS its day (every writer stamps the owner's activity day that way); a
 * row carrying a real instant rolls over at 04:00 Riyadh like any
 * activity. Without the first rule a bare-midnight Watch half and a
 * timestamped phone half of one session landed on different days
 * (adversary pass 3).
 */
function sessionDayKey(d: Date): string {
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return d.toISOString().slice(0, 10);
  const hour = Number(d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }));
  const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const day = new Date(`${key}T00:00:00.000Z`);
  if (hour < 4) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Every session's verdict. Rows on one day in one building are ONE
 * session (a save in two halves must not earn through its clean half —
 * the heavy half decides). Pure and O(n): no status is recomputed, no
 * base is rebuilt — the allowed weight is on the set.
 */
export function rampSessionVerdicts(sessions: RampSession[]): RampVerdict[] {
  const rows = sessions
    .map((s) => ({ at: new Date(s.date), gym: s.gym ?? DEFAULT_GYM_ID, sets: s.sets ?? [] }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  // Keyed, not adjacency-based: a bare-midnight row sorts before a
  // timestamped row of the previous activity day, so neighbours are not
  // enough to find a day's rows (adversary pass 4).
  const byKey = new Map<string, { at: Date; gym: string; sets: NonNullable<RampSession['sets']> }>();
  for (const r of rows) {
    const k = `${sessionDayKey(r.at)}|${r.gym}`;
    const g = byKey.get(k);
    if (g) g.sets = [...g.sets, ...r.sets];
    else byKey.set(k, { at: r.at, gym: r.gym, sets: [...r.sets] });
  }
  const grouped = [...byKey.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  return grouped.map((s) => {
    const rated = s.sets.filter((x) => !x.isWarmup && x.rpe != null);
    const effortClean = rated.length >= 2 && rated.every((x) => (x.rpe as number) <= 2);
    const overRamp = effortClean ? isOverRamp(s.sets) : null;
    return { date: s.at, clean: effortClean && !overRamp, overRamp };
  });
}

/** The dates that EARN ramp progress. */
export function cleanRampSessionDates(sessions: RampSession[]): Date[] {
  return rampSessionVerdicts(sessions).filter((v) => v.clean).map((v) => v.date);
}

export function getTrainingStatus(
  dates: Date[],
  now: Date = new Date(),
  cleanDates: Date[] = [],
): TrainingStatus {
  if (!dates.length) return { mode: 'fresh', week: 1 };

  // ONE session per activity day (trainer F3, 2026-09-24). Training rows sit
  // at UTC midnight of their activity day, so two rows on one day — a split
  // save, or a Watch finish plus a phone replay under another id — are one
  // session. Counting rows let a same-day duplicate advance the ramp a whole
  // session early (85% -> 100%). Training twice in a day is the pattern the
  // program forbids anyway, so nothing real is lost.
  const byDay = new Map<string, Date>();
  for (const d of dates) {
    const at = new Date(d);
    const key = at.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, at);
  }
  const desc = [...byDay.values()].sort((a, b) => b.getTime() - a.getTime());
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
  memory: { weight: number; rampHold?: boolean; rpe?: number | null },
  loadPct: number,
  pin = 2.5,
  anchored = false,
): number {
  if (memory.weight <= 0) return 0;
  if (memory.rampHold || loadPct >= 100) return memory.weight;
  const p = pin > 0 ? pin : 2.5;
  const w = memory.weight;
  const rpe = memory.rpe ?? null;
  // Hold on HOW the base was rated, not where it sits on the stack: his
  // whole pre-break history is learn-phase weights rated Easy, and 60% of
  // one is a set with nothing in it — which is why he overrode the prefill
  // twice. An Easy base holds; a Hard/Grind base is never held (a REBOOT
  // week under a Med cap must not open at a Grind weight); a Med or unrated
  // base scales, floored at three pins so the bottom of the stack is never
  // the prescription. The floor is monotonic — a heavier base never opens
  // lighter than a lighter one (trainer + adversary, 2026-09-18).
  if (rpe === 1) return w;
  // `anchored`: the step is HIS (set on the machine's page), so the stack's
  // rungs run through the weight he lifted — base − k × step, nearest — and
  // its bottom is the lowest of those rungs. Counted from zero, his real
  // 4.5 kg Chest Press ladder through 23 prescribed 18, which is not a
  // plate; through 23 it is 18.5 (review B1/F4, 2026-09-24). A learned or
  // fallback step keeps the zero-based grid: its offset is not known.
  const bottom = anchored ? lowestRung(w, p) : p;
  const target = (w * loadPct) / 100;
  const nearest = anchored ? w - Math.round((w - target) / p) * p : Math.round(target / p) * p;
  const scaled = Math.max(bottom, nearest);
  const floor = rpe != null && rpe >= 3 ? bottom : Math.min(w, bottom + 2 * p);
  return +Math.max(scaled, floor).toFixed(2);
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
    // A RESTORE-week (100%) session is full-load for the machines it
    // touched, but it must not end the walk: the other day's machines are
    // still on their 85% rows, and a null cut would hand them that row as
    // memory — the Day B logger at week 4 opening at week-3 weights
    // (adversary, 2026-09-18). Keep walking until a session logged OUTSIDE
    // the ramp block.
    const inBlock = at.mode === 'return' && at.returnWeek.loadPct >= 100;
    if (!scaled && !inBlock) return firstScaled ? firstScaled.toISOString() : null;
    if (scaled) firstScaled = s.date;
  }
  return firstScaled ? firstScaled.toISOString() : null;
}

/**
 * The row a progress figure compares to: the last session strictly before
 * the ramp cut (rampBaseBefore), or the latest row when there is no cut.
 * During a ramp the latest session is scaled by design, so "Improvement"
 * against it read as a loss on every machine (review 3.6). undefined =
 * every row is in-ramp; there is nothing full-load to compare.
 */
export function lastFullLoad<T extends { date: Date }>(history: T[], cut: string | null | undefined): T | undefined {
  if (!cut) return history[history.length - 1];
  const cutMs = new Date(cut).getTime();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date.getTime() < cutMs) return history[i];
  }
  return undefined;
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
  { rank: 1, name: 'Swimming', badge: 'BEST', desc: 'Zero joint impact. Highest calorie burn. 20–30 min any stroke. Not alone, no breath-hold lengths, no cold pool or cold plunge — cold water is a known AF trigger — until the cardiologist clears it.', gyms: ['bfit'] },
  { rank: 2, name: 'Rowing', badge: 'GREAT', desc: 'Zero impact and the biggest burn on land — you are seated, so none of your bodyweight loads the knees or hips. FORM: legs drive first, then lean back, then pull; reverse it on the way in. Never round your lower back at the catch. 15–20 min steady.' },
  { rank: 3, name: 'Upright Bike', badge: 'GREAT', desc: 'No weight on joints. Best for warm-ups and cardio finishers.' },
  { rank: 4, name: 'Elliptical', badge: 'GOOD', desc: 'Low impact — distributes load across arms and legs.' },
  { rank: 5, name: 'Treadmill', badge: 'CAUTION', desc: 'ONLY walking at 4–5 km/h, low incline. Never run.' },
];

/**
 * The standing rule for ALL cardio while his chart says AF on flecainide
 * (trainer, 2026-09-18): flecainide's block is use-dependent — strongest
 * at high heart rates — and the beta-blocker hides how hard he is going,
 * so nothing here may ask for peak exertion until the cardiologist does.
 */
export const CARDIO_RULE =
  'Conversational pace only — you should be able to talk in full sentences — while AF or an antiarrhythmic is on your chart.';

/**
 * What the chart says, read from the profile's own conditions list and the
 * ACTIVE medications (adversary + trainer, 2026-09-18: "AFib" / "A-fib"
 * missed the first regex, "no hypertension" matched it, and flecainide
 * lives in Medication, not in conditions). Free text he edits himself, so:
 *   - a negated or historical entry is skipped ("no …", "resolved",
 *     "stopped", "ex-", "family history of", "pre…");
 *   - anything that is not a list is treated as a list of one string.
 * Nothing here diagnoses; it reads what he wrote.
 */
const NEGATED = /\b(no|not|never|resolved|stopped|ex|former|prior|history of|family|pre|prehypertens\w*)\b|\bex-|\bpre-|\bprehypertens/i;
const AF_RX = /atrial|\ba-?fib\b|afib|fibrillat|flutter/i;
const ARRHYTHMIA_RX = /arrhythm|tachycard|\bsvt\b|\bwpw\b/i;
const HYPERTENSION_RX = /hypertens|high blood pressure|\bhigh bp\b|\bbp\b.*\bhigh\b|\bhbp\b/i;
const CARDIAC_DRUG_RX = /flecainide|propafenone|amiodarone|sotalol|dronedarone|nebivolol|bisoprolol|metoprolol|atenolol|carvedilol|propranolol|beta.?blocker|\bnebilet\b|\bconcor\b/i;

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];
const live = (entries: unknown): string[] => asList(entries).filter((c) => !NEGATED.test(c));

/** AF on his chart — what silences the HRV readiness clause. */
export function afOnChart(conditions: unknown): boolean {
  return live(conditions).some((c) => AF_RX.test(c));
}

/**
 * The effort ceiling the CHART sets, independent of the ramp. AF, an
 * arrhythmia, treated hypertension, or an active antiarrhythmic /
 * beta-blocker → Hard (3): a Grind set on a machine is a breath-held
 * Valsalva, exactly the pressure spike that patient must not produce. The
 * ramp's own cap already sits at or below this; the point is that it does
 * not LIFT to 4 the week the ramp exits — which was the week of his
 * cardiology review (trainer, 2026-09-18). `medications` are the names of
 * ACTIVE rows (stoppedOn null). Pass `'unknown'` when the chart could not
 * be read: a medical cap fails closed.
 */
export function effortCeiling(
  conditions: unknown,
  medications: unknown = [],
): 3 | 4 {
  if (conditions === 'unknown' || medications === 'unknown') return 3;
  const flagged =
    live(conditions).some((c) => AF_RX.test(c) || ARRHYTHMIA_RX.test(c) || HYPERTENSION_RX.test(c)) ||
    live(medications).some((m) => CARDIAC_DRUG_RX.test(m));
  return flagged ? 3 : 4;
}

/**
 * The "Try N kg" chip. One learned pin, and only after the same two
 * all-Easy sessions the overload seed waits for — the chip used to add a
 * hard-coded 5 kg after ONE Easy session (Face Pull 8.75 → "Try 13.75",
 * +57%, on a machine whose own cue says light and strict; trainer A6,
 * 2026-09-18). Null = nothing to suggest.
 */
export function nextTryWeight(
  last: { weight: number; reps?: number; rpe: number | null; overload?: boolean; repsFloor?: number } | null | undefined,
  pin: number,
  minReps = 0,
  maxReps = Number.POSITIVE_INFINITY,
): number | null {
  if (!last || last.weight <= 0 || !last.overload) return null;
  if (last.rpe != null && last.rpe >= 3) return null;
  // Reps first, then the pin — the seed declines under the minimum reps and
  // the chip must not offer what the seed declined (trainer).
  if (typeof last.reps === 'number' && last.reps < minReps) return null;
  const p = pin > 0 ? pin : 2.5;
  // A coarse step (more than 15% of the weight) waits until every set
  // reached the top of the range — the same gate as the seed
  // (prescription.ts COARSE_PIN_SHARE; review F5: 29 → 38 at 12 reps).
  if (p > last.weight * 0.15 && (last.repsFloor ?? last.reps ?? 0) < maxReps) return null;
  return +(last.weight + p).toFixed(2);
}

/** One all-Easy session at a weight: repeat it and earn the pin — not "try more". */
export function repeatToEarn(last: { weight?: number; rpe: number | null; allEasy?: boolean; overload?: boolean } | null | undefined): boolean {
  return !!last && last.allEasy === true && !last.overload;
}

/** A timed hold never prefills past its ceiling — the 30 s plank cap is a
 *  number, not a sentence (adversary, 2026-09-18). */
export function clampTimedReps(reps: number, repsMin: number, repsMax: number): number {
  return Math.min(Math.max(repsMin, reps), repsMax);
}

/**
 * The reps a set opens at: last session's, clamped into the prescribed range
 * for EVERY unit (trainer ruling 6, 2026-09-24). A short set is a real event
 * and stays in the log, but it must never become the next prefill: Triceps
 * carried 10 reps against a 12 minimum on May 30, Sep 1 and Sep 12 because
 * the raw carry kept copying it forward, and the short set then blocked
 * progress for good. The phone logger and the Watch plan both call this.
 */
export function prefillReps(lastReps: number | null | undefined, repsMin: number, repsMax: number): number {
  return clampTimedReps(lastReps ?? repsMin, repsMin, repsMax);
}

/** Cardio actually available in one building. */
export function cardioForGym(gymId: string | null | undefined): CardioOption[] {
  if (!gymId) return CARDIO;
  return CARDIO.filter((c) => !c.gyms || c.gyms.includes(gymId));
}
