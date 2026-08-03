// Assertions for the coach intelligence layer, run against the REAL
// exported history in data/workout-history.json plus synthetic cases.
//
// Run: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/coach-tests.ts
//
// Exits non-zero on any failure.

import * as fs from 'fs';
import * as path from 'path';
import {
  combineIncrement,
  detectPlateau,
  effortDistribution,
  homeVerdict,
  learnPinIncrements,
  nextTarget,
  phaseForWeek,
  weeklyReport,
  weightTrend,
  type CoachBodyStat,
  type CoachExercise,
  type CoachWorkout,
  type ReadinessSignal,
} from '../src/lib/coach';
import {
  alternateDay,
  getDynamicPlan,
  getDayTemplate,
  getTrainingStatus,
  parseDayLetter,
  projectPlan,
  queuedDay,
  recoveryActivity,
  type DynamicPlan,
  type LoggedSession,
} from '../src/lib/program';
import { gymSwap, gymWeightNote } from '../src/lib/gym-equipment';

interface HistoryFile {
  exercises: { id: string; name: string; category: string }[];
  workouts: (CoachWorkout & { name: string })[];
  bodyStats: CoachBodyStat[];
}

const historyPath = path.join(__dirname, '..', 'data', 'workout-history.json');
const data = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as HistoryFile;

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

// ── learnPinIncrements on real history ───────────────────────
console.log('learnPinIncrements');
const learned = learnPinIncrements(data.workouts);
const chestPress = data.exercises.find((e) => e.name === 'Chest Press');
assert(chestPress !== undefined, 'Chest Press exists in exported history');
const chestInc = chestPress ? learned[chestPress.id] : undefined;
// Chest Press session maxes ran 20 → 29 → 27.5 → 23; the tightest
// consecutive step (1.5) is the learned pin spacing.
assert(chestInc !== undefined && chestInc > 0, `Chest Press learned increment > 0 (got ${chestInc})`);
assert(chestInc !== undefined && chestInc <= 5, `Chest Press increment is a plausible pin step (got ${chestInc})`);
assert(Object.values(learned).every((v) => v > 0), 'every learned increment is positive');
assert(Object.keys(learned).length > 0, 'at least one exercise has a learned increment');

// ── combineIncrement precedence ──────────────────────────────
console.log('combineIncrement');
assert(combineIncrement(1.5, 5) === 5, 'exercise override wins over learned');
assert(combineIncrement(1.5, null) === 1.5, 'learned used when no override');
assert(combineIncrement(undefined, undefined) === 2.5, 'falls back to 2.5 kg');

// ── detectPlateau on synthetic series ────────────────────────
console.log('detectPlateau');
const testEx: CoachExercise = { id: 'ex-test', name: 'Test Press', category: 'CHEST' };
const session = (date: string, weight: number, rpe: number | null): CoachWorkout => ({
  date,
  sets: [{ exerciseId: testEx.id, reps: 10, weight, rpe, exercise: testEx }],
});

const stuck3 = [session('2026-07-01', 30, 2), session('2026-07-08', 30, 2), session('2026-07-15', 30, 3)];
const p3 = detectPlateau(stuck3, testEx.id);
assert(p3.plateaued, '3 same-weight sessions with a top-set RPE 3 → plateaued');
assert(p3.sessions === 3 && p3.weight === 30, `streak metadata correct (${p3.sessions} @ ${p3.weight} kg)`);
assert(p3.suggestion !== null && p3.suggestion.includes('rep'), 'first suggestion is add-a-rep');

const stuck4 = [...stuck3, session('2026-07-22', 30, 3)];
const p4 = detectPlateau(stuck4, testEx.id);
assert(p4.plateaued && p4.suggestion !== null && p4.suggestion.includes('pin'), 'persistent stall cycles to drop-a-pin');

const easyStreak = [session('2026-07-01', 30, 1), session('2026-07-08', 30, 2), session('2026-07-15', 30, 2)];
assert(!detectPlateau(easyStreak, testEx.id).plateaued, 'same weight at easy RPE is not a plateau');

const progressing = [session('2026-07-01', 30, 2), session('2026-07-08', 32.5, 3), session('2026-07-15', 35, 3)];
assert(!detectPlateau(progressing, testEx.id).plateaued, 'rising weights are not a plateau');

// ── effortDistribution on real history ───────────────────────
console.log('effortDistribution');
const effort = effortDistribution(data.workouts);
assert(effort.total > 0, `rated sets found in trailing 28 trained days (${effort.total})`);
const shareSum = effort.share[1] + effort.share[2] + effort.share[3] + effort.share[4];
assert(Math.abs(shareSum - 1) < 1e-9, 'shares sum to 1');
assert(effort.hardShare >= 0 && effort.hardShare <= 1, 'hardShare within [0,1]');

// ── weightTrend ──────────────────────────────────────────────
// Lane classification is asserted on FIXED series. data/workout-history.json
// is re-exported by the morning sync bot, so a new weigh-in can legitimately
// flip the real trend (it did: the 2026-07-29 weigh-in at 133 kg turned the
// real series from losing to gaining). Pinning a lane to live data tests the
// bot, not the coach.
console.log('weightTrend');
const losingStats: CoachBodyStat[] = [
  { date: '2026-05-01T00:00:00.000Z', weight: 132 },
  { date: '2026-05-14T00:00:00.000Z', weight: 131 },
  { date: '2026-05-28T00:00:00.000Z', weight: 130 },
];
// 132 → 130 kg across 27 days ≈ -0.52 kg/week.
const losingTrend = weightTrend(losingStats);
assert(losingTrend.classification === 'on_track', `132 → 130 over 27 days classifies on_track (got ${losingTrend.classification})`);
assert(
  losingTrend.kgPerWeek !== null && losingTrend.kgPerWeek <= -0.5 && losingTrend.kgPerWeek >= -1.3,
  `kgPerWeek in the fat-loss lane (got ${losingTrend.kgPerWeek})`,
);

const gainingTrend = weightTrend([
  { date: '2026-05-01T00:00:00.000Z', weight: 132 },
  { date: '2026-05-15T00:00:00.000Z', weight: 134 },
]);
assert(gainingTrend.classification === 'gaining', `weight going up classifies gaining (got ${gainingTrend.classification})`);

// Live export: only drift-proof invariants.
const trend = weightTrend(data.bodyStats);
assert(trend.ema !== null && trend.ema > 100 && trend.ema < 160, `EMA is a plausible bodyweight (got ${trend.ema})`);
assert(
  trend.classification !== 'no_data' && trend.kgPerWeek !== null && Number.isFinite(trend.kgPerWeek),
  `real weigh-ins produce a trend (got ${trend.classification} @ ${trend.kgPerWeek} kg/wk)`,
);
assert(weightTrend([]).classification === 'no_data', 'empty stats → no_data');
assert(weightTrend([data.bodyStats[0]]).classification === 'no_data', 'a single weigh-in → no_data');

// ── session-based return ramp ────────────────────────────────
console.log('getTrainingStatus (session-based ramp)');
const realDates = data.workouts.map((w) => new Date(w.date));
const day = (iso: string) => new Date(iso);

// Ramp arithmetic runs against a FIXED pre-break block, never the live export.
// The morning sync bot appends sessions to data/workout-history.json, so a
// case built as "real history + one more session" silently becomes "+ two"
// the day that session lands upstream — which is exactly how the 2026-07-29
// session broke these. Real data still gets a drift-proof smoke check below.
const preBreak = ['2026-05-10', '2026-05-13', '2026-05-17', '2026-05-19', '2026-05-23', '2026-05-30', '2026-06-16'].map(
  (d) => day(`${d}T00:00:00Z`),
);

// Whatever the export holds, a layoff past the threshold resets to week 1.
const lastReal = new Date(Math.max(...realDates.map((d) => d.getTime())));
const s0 = getTrainingStatus(realDates, new Date(lastReal.getTime() + 43 * 86400000));
assert(s0.mode === 'return' && s0.week === 1, `real history + 43 days off → return week 1 (got ${s0.mode} w${s0.week})`);

// 43 days since the last pre-break workout → return week 1.
const s1 = getTrainingStatus(preBreak, day('2026-07-29T12:00:00Z'));
assert(s1.mode === 'return' && s1.week === 1, `43 days off at 2026-07-29 → return week 1 (got ${s1.mode} w${s1.week})`);

// Two sessions logged this week, checked a week later → week 2.
const twoBack = [...preBreak, day('2026-07-27T00:00:00Z'), day('2026-07-29T00:00:00Z')];
const s2 = getTrainingStatus(twoBack, day('2026-08-05T12:00:00Z'));
assert(s2.mode === 'return' && s2.week === 2, `2 sessions + 7 days → return week 2 (got ${s2.mode} w${s2.week})`);

// Only one session logged → calendar alone must NOT advance the ramp.
const oneBack = [...preBreak, day('2026-07-29T00:00:00Z')];
const s3 = getTrainingStatus(oneBack, day('2026-08-05T12:00:00Z'));
assert(s3.mode === 'return' && s3.week === 1, `1 session + 7 days → still week 1 (got ${s3.mode} w${s3.week})`);

// Sessions can't outrun the calendar: 4 sessions in the first week is still week 1.
const fourFast = [
  ...preBreak,
  day('2026-07-27T00:00:00Z'),
  day('2026-07-28T00:00:00Z'),
  day('2026-07-29T00:00:00Z'),
  day('2026-07-30T00:00:00Z'),
];
const s4 = getTrainingStatus(fourFast, day('2026-07-31T12:00:00Z'));
assert(s4.mode === 'return' && s4.week === 1, `4 sessions in 5 days → still week 1 (got ${s4.mode} w${s4.week})`);

// 8 sessions across 4+ calendar weeks → ramp complete, normal mode at REJOIN_AT_WEEK.
const rampDone = [
  ...preBreak,
  ...['2026-08-02', '2026-08-05', '2026-08-09', '2026-08-12', '2026-08-16', '2026-08-19', '2026-08-23', '2026-08-26'].map(
    (d) => day(`${d}T00:00:00Z`),
  ),
];
const s5 = getTrainingStatus(rampDone, day('2026-08-31T12:00:00Z'));
assert(s5.mode === 'normal' && s5.week === 3, `8 sessions + 4 weeks → normal at week 3 (got ${s5.mode} w${s5.week})`);

// Same calendar span with only 7 sessions → ramp not complete, week 4.
const s6 = getTrainingStatus(rampDone.slice(0, -1), day('2026-08-31T12:00:00Z'));
assert(s6.mode === 'return' && s6.week === 4, `7 sessions + 4 weeks → still return week 4 (got ${s6.mode} w${s6.week})`);

// ── nextTarget ───────────────────────────────────────────────
console.log('nextTarget');
assert(nextTarget(29, 1, 1.5).weight === 30.5, 'Easy → add one learned pin (29 + 1.5)');
assert(nextTarget(29, null, 2.5).weight === 31.5, 'unrated → add one pin');
assert(nextTarget(29, 3, 1.5).weight === 29 && nextTarget(29, 3, 1.5).action === 'hold', 'Hard → hold, add reps');
assert(nextTarget(29, 4, 1.5).weight === 27.5 && nextTarget(29, 4, 1.5).action === 'back_off', 'Grind → back off a pin');

// ── weeklyReport smoke test on real data ─────────────────────
console.log('weeklyReport');
const status = getTrainingStatus(preBreak, day('2026-07-29T12:00:00Z'));
const report = weeklyReport(data.workouts, data.bodyStats, status, day('2026-07-29T12:00:00Z'));
assert(report.headline.length > 0, 'headline present');
assert(report.headline.includes('Return ramp week 1'), `headline reflects return week 1 (got "${report.headline}")`);
// Whatever lane the live weigh-ins are in, the trend has to reach the report.
assert(
  [...report.wins, ...report.focus].includes(trend.message),
  `the live weight trend surfaces (${trend.classification})`,
);
// …and the fat-loss lane specifically lands in wins, on a fixed series.
const losingReport = weeklyReport(data.workouts, losingStats, status, day('2026-07-29T12:00:00Z'));
assert(losingReport.wins.some((w) => w.includes('on track')), 'weight trend win surfaces');
assert(report.focus.length > 0, 'focus items present (sessions behind target)');
assert(report.nextSession.some((n) => n.includes('60%')), 'return guidance carries the 60% load');
// Report discipline: the default surface is ONE instruction + ≤3 numbers.
assert(report.instruction.length > 0, 'instruction present on the glance layer');
assert(report.instruction === report.nextSession[0], 'instruction is the top next-session directive');
assert(report.numbers.length > 0 && report.numbers.length <= 3, `glance numbers capped at 3 (got ${report.numbers.length})`);
assert(
  report.numbers.every((n) => n.label.length > 0 && n.value.length > 0),
  'every glance number carries a label and a value',
);

// ── phaseForWeek ─────────────────────────────────────────────
console.log('phaseForWeek');
assert(phaseForWeek(1).phase === 'LEARN', 'week 1 → LEARN');
assert(phaseForWeek(3).phase === 'BUILD', 'week 3 → BUILD (ramp rejoin point)');
assert(phaseForWeek(7).phase === 'DELOAD', 'week 7 → DELOAD');
assert(phaseForWeek(12).phase === 'EVALUATE', 'week 12 → EVALUATE');

// ── parseDayLetter / alternateDay ────────────────────────────
console.log('parseDayLetter');
assert(parseDayLetter('Day B 45m — Aug 2') === 'B', 'letter parsed out of a logged name');
assert(parseDayLetter('day a 60m — jul 9') === 'A', 'parsing is case-insensitive');
assert(parseDayLetter('Swim + walk') === null, 'a name with no Day letter → null');
assert(parseDayLetter(null) === null, 'null name → null');
assert(alternateDay('A') === 'B' && alternateDay('B') === 'A', 'A/B alternate');
assert(alternateDay(null) === 'A', 'nothing lettered yet → Day A');

// ── getDynamicPlan ───────────────────────────────────────────
// The schedule follows his LOG, not the calendar: train, recover the next
// day, alternate A/B. Every rule below is a rule he asked for by name.
console.log('getDynamicPlan');

// Local-time constructors on purpose: "yesterday" is a calendar question,
// and a UTC-midnight fixture would answer it differently west of Greenwich.
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const now = local(2026, 8, 3, 9); // Monday 09:00
const log = (date: Date, name: string): LoggedSession => ({ date, name });

const pEmpty = getDynamicPlan([], now);
assert(pEmpty.mode === 'train' && pEmpty.day === 'A', 'no history at all → TRAIN Day A');
assert(pEmpty.daysSinceLast === null && pEmpty.lastDay === null, 'no history carries no day counts');

const pToday = getDynamicPlan([log(local(2026, 8, 3, 7), 'Day A 45m — Aug 3')], now);
assert(pToday.mode === 'done-today', 'trained today → done-today (celebrate, do not nag)');
assert(pToday.day === 'A' && pToday.daysSinceLast === 0, 'done-today names the day he logged');

// 21:00 yesterday vs 09:00 today is 12 hours — but it is still YESTERDAY.
const pYesterday = getDynamicPlan([log(local(2026, 8, 2, 21), 'Day B 45m — Aug 2')], now);
assert(pYesterday.mode === 'recover', 'trained yesterday → recover, never back-to-back');
assert(pYesterday.daysSinceLast === 1, 'an evening session yesterday counts as 1 calendar day');
assert(pYesterday.day === 'A' && pYesterday.lastDay === 'B', 'recovery still queues the alternate day');

const pTwoDays = getDynamicPlan([log(local(2026, 8, 1), 'Day A 45m — Aug 1')], now);
assert(pTwoDays.mode === 'train' && pTwoDays.day === 'B', '2 days since Day A → TRAIN Day B');
assert(pTwoDays.daysSinceLast === 2, 'daysSinceLast counts calendar days (2)');

const pFiveDays = getDynamicPlan([log(local(2026, 7, 29), 'Day B 60m — Jul 29')], now);
assert(pFiveDays.mode === 'train' && pFiveDays.day === 'A', '5 days since Day B → TRAIN Day A');
assert(pFiveDays.daysSinceLast === 5, 'daysSinceLast counts calendar days (5)');

// Alternation survives a session logged without a Day letter.
const pUnlettered = getDynamicPlan(
  [log(local(2026, 7, 30), 'Day A 45m — Jul 30'), log(local(2026, 8, 1), 'Swim + walk')],
  now,
);
assert(pUnlettered.mode === 'train', 'unlettered last session, 2 days ago → still a train day');
assert(pUnlettered.lastDay === 'A', 'unlettered session falls back to the last lettered one');
assert(pUnlettered.day === 'B', 'alternation continues from the last LETTERED session');

const pNoLetters = getDynamicPlan([log(local(2026, 7, 30), 'Freestyle'), log(local(2026, 8, 1), 'Swim')], now);
assert(pNoLetters.lastDay === null && pNoLetters.day === 'A', 'no lettered session ever → Day A');

const pUnletteredToday = getDynamicPlan([log(local(2026, 8, 3, 8), 'Swim')], now);
assert(
  pUnletteredToday.mode === 'done-today' && pUnletteredToday.day === null,
  'an unlettered session today is still done-today, with no letter to show',
);

// The rule that matters most: two sessions in a row is never the suggestion.
for (const letter of ['A', 'B'] as const) {
  const p = getDynamicPlan([log(local(2026, 8, 2, 18), `Day ${letter} 45m`)], now);
  assert(p.mode === 'recover', `trained Day ${letter} yesterday → recover, whatever the weekday`);
}

// queuedDay: after a session logged today the queued day is the ALTERNATE.
assert(queuedDay(pToday) === 'B', 'Day A logged today → Day B is queued next');
assert(queuedDay(pYesterday) === 'A', 'recovering after Day B → Day A queued');
assert(queuedDay(pTwoDays) === 'B', 'train days queue the day they suggest');
assert(queuedDay(pEmpty) === 'A', 'empty history queues Day A');

// Recovery prescription is keyed off the day TRAINED, never the weekday.
assert(recoveryActivity('A') === '20 min walk', 'after Day A (quads) → walk');
assert(recoveryActivity('B') === '30 min swim or walk', 'after Day B → swim or walk');
assert(recoveryActivity(null) === '20 min walk', 'nothing logged → the gentlest default');

// TRAINING ON A RECOVER DAY IS STILL POSSIBLE. 'recover' is advice, never a
// lock — the plan suggests, the UI never blocks. Three things have to hold for
// that to be true: the recover plan still names a startable day, the Start row
// targets that same day, and a session logged on a recover day is accepted and
// picked up as the new anchor rather than ignored.
const pRecoverDay = getDynamicPlan([log(local(2026, 8, 2, 19), 'Day A 45m — Aug 2')], now);
assert(pRecoverDay.mode === 'recover', 'baseline: an evening session yesterday → recover');
assert(pRecoverDay.day === 'B', 'a recover day still names a day he can start right now');
assert(queuedDay(pRecoverDay) === 'B', 'the Start row on a recover day targets that same day');

const pTrainedAnyway = getDynamicPlan(
  [log(local(2026, 8, 2, 19), 'Day A 45m — Aug 2'), log(local(2026, 8, 3, 8), 'Day B 45m — Aug 3')],
  now,
);
assert(
  pTrainedAnyway.mode === 'done-today' && pTrainedAnyway.day === 'B',
  'training through a recover day is logged, not refused',
);
assert(queuedDay(pTrainedAnyway) === 'A', 'after training through a recover day the alternate is queued');
assert(
  projectPlan(
    [log(local(2026, 8, 2, 19), 'Day A 45m — Aug 2'), log(local(2026, 8, 3, 8), 'Day B 45m — Aug 3')],
    now,
    3,
  )[1].mode === 'recover',
  'the never-back-to-back rule re-anchors on the session he actually did',
);

// A 43-day layoff still hits the return protocol AND still says train.
const layoff = [log(local(2026, 6, 21), 'Day A 45m — Jun 21')];
const pLayoff = getDynamicPlan(layoff, now);
assert(pLayoff.mode === 'train' && pLayoff.day === 'B', '43 days off → TRAIN, alternating from Day A');
assert(pLayoff.daysSinceLast === 43, `43-day gap counted exactly (got ${pLayoff.daysSinceLast})`);
const sLayoff = getTrainingStatus([local(2026, 6, 21)], now);
assert(
  sLayoff.mode === 'return' && sLayoff.week === 1,
  `43 days off still triggers the return protocol (got ${sLayoff.mode} w${sLayoff.week})`,
);

// ── projectPlan ──────────────────────────────────────────────
console.log('projectPlan');
const proj = projectPlan([log(local(2026, 8, 1), 'Day A 45m — Aug 1')], now, 5);
assert(proj.length === 5, 'projection covers today plus the next 4 days');
assert(proj[0].isToday && proj[0].mode === 'train' && proj[0].day === 'B', 'today: train Day B');
assert(proj[1].mode === 'recover' && proj[1].day === null, 'the day after a session is recovery');
assert(proj[2].mode === 'train' && proj[2].day === 'A', 'then train, alternating back to Day A');
assert(proj[3].mode === 'recover' && proj[4].mode === 'train' && proj[4].day === 'B', 'the rhythm keeps alternating');
assert(
  proj.every((p, i) => i === 0 || p.mode !== 'train' || proj[i - 1].mode !== 'train'),
  'the projection never puts two training days back to back',
);

const projDone = projectPlan([log(local(2026, 8, 3, 7), 'Day A 45m — Aug 3')], now, 5);
assert(projDone[0].mode === 'done-today' && projDone[0].day === 'A', 'a session logged today opens the projection');
assert(projDone[1].mode === 'recover', 'tomorrow recovers after a session logged today');
assert(projDone[2].mode === 'train' && projDone[2].day === 'B', 'the day after that trains Day B');

// ── homeVerdict ──────────────────────────────────────────────
console.log('homeVerdict');
const planTrainB: DynamicPlan = getDynamicPlan([log(local(2026, 8, 1), 'Day A 45m — Aug 1')], now);
const planRecover: DynamicPlan = getDynamicPlan([log(local(2026, 8, 2, 19), 'Day A 45m — Aug 2')], now);
const planDone: DynamicPlan = getDynamicPlan([log(local(2026, 8, 3, 7), 'Day A 45m — Aug 3')], now);

const returnStatus = getTrainingStatus(preBreak, day('2026-07-29T12:00:00Z'));
const vReturn = homeVerdict(returnStatus, planTrainB, now);
assert(vReturn.tone === 'return', 'train day inside the ramp → ember tone');
assert(vReturn.lead === 'TRAIN TODAY', 'train day leads with TRAIN TODAY');
assert(
  ['Day B', '60%', 'cap Med'].every((p) => vReturn.parts.includes(p)),
  `ramp verdict reads "TRAIN TODAY · ${vReturn.parts.join(' · ')}"`,
);
assert(vReturn.parts.length <= 3 && vReturn.sub !== null, 'one line plus one sub-line, nothing more');

const vRecover = homeVerdict(returnStatus, planRecover, now);
assert(vRecover.tone === 'rest' && vRecover.lead === 'RECOVER', 'trained yesterday → RECOVER');
assert(
  vRecover.parts.join('') === '20 min walk',
  `recover verdict names the activity (got "${vRecover.parts.join('')}")`,
);
assert(vRecover.day === null, 'recovery days carry no day accent');
assert(vRecover.sub === 'Day B next', `recovery still says what is queued (got "${vRecover.sub}")`);

const vDone = homeVerdict(returnStatus, planDone, now);
assert(vDone.tone === 'done' && vDone.lead === 'DONE TODAY', 'already trained today → DONE TODAY');
assert(vDone.parts.join('') === 'Day A logged', `done verdict names the day (got "${vDone.parts.join('')}")`);

const vNormal = homeVerdict({ mode: 'normal', week: 3 }, getDynamicPlan([log(local(2026, 8, 1), 'Day B 45m')], now), now);
assert(vNormal.tone === 'train' && vNormal.day === 'A', 'past the ramp → day-accent tone, no ember');
assert(vNormal.parts.includes('Wk 3 BUILD'), `normal verdict carries the phase (got "${vNormal.parts.join(' · ')}")`);

const vNoDay = homeVerdict(
  { mode: 'normal', week: 3 },
  { mode: 'train', day: null, daysSinceLast: null, lastDay: null, reason: '' },
  now,
);
assert(vNoDay.parts.includes('Day A or B'), 'a plan with no day still gives an order');

// ── readiness wiring (the signal itself is computed elsewhere) ─
console.log('homeVerdict + readiness');
const hold: ReadinessSignal = { verdict: 'hold', note: '5.2 h sleep · resting HR +6 bpm' };
const proceed: ReadinessSignal = { verdict: 'proceed', note: '7.4 h sleep' };

assert(
  JSON.stringify(homeVerdict(returnStatus, planTrainB, now, undefined)) === JSON.stringify(vReturn),
  'no readiness → the verdict is exactly what it was',
);

const vHold = homeVerdict(returnStatus, planTrainB, now, hold);
assert(vHold.lead === 'RECOVER' && vHold.tone === 'rest', "a 'hold' downgrades TRAIN to recovery wording");
assert(vHold.sub === hold.note, 'the hold note becomes the sub-line');
assert(vHold.day === null, 'a held day carries no day accent');

const vProceed = homeVerdict(returnStatus, planTrainB, now, proceed);
assert(vProceed.lead === 'TRAIN TODAY' && vProceed.tone === 'return', "'proceed' leaves the order alone");
assert(vProceed.sub === proceed.note, 'the readiness note takes the sub-line');
assert(
  vProceed.parts.join(' · ') === vReturn.parts.join(' · '),
  'readiness never rewrites the numbers on the order line',
);

const vHoldOnDone = homeVerdict(returnStatus, planDone, now, hold);
assert(vHoldOnDone.lead === 'DONE TODAY', 'a hold cannot un-log a session he already did');

// A hold softens the WORDING; it never removes the day from the plan, and the
// day cards read the plan, not the verdict. Health advice must not be able to
// lock him out of the gym.
assert(
  planTrainB.mode === 'train' && planTrainB.day === 'B' && queuedDay(planTrainB) === 'B',
  'a held day is still startable — the plan keeps its day',
);

// The contract <HomeVerdict> relies on: it hands homeVerdict the readiness
// VERDICT with an empty note, because the ReadinessBanner directly above is
// already showing that note. An empty note must therefore leave the verdict's
// own sub-line intact instead of blanking it.
const holdQuiet: ReadinessSignal = { verdict: 'hold', note: '' };
const vHoldQuiet = homeVerdict(returnStatus, planTrainB, now, holdQuiet);
assert(vHoldQuiet.lead === 'RECOVER' && vHoldQuiet.tone === 'rest', 'a note-less hold still downgrades the order');
assert(vHoldQuiet.sub === 'Day B next', `a blank note falls back to the verdict's own sub-line (got "${vHoldQuiet.sub}")`);
assert(
  JSON.stringify(homeVerdict(returnStatus, planDone, now, { verdict: 'proceed', note: '' })) ===
    JSON.stringify(vDone),
  'a note-less proceed changes nothing at all',
);


// ── per-gym equipment ────────────────────────────────────────
// Every program movement must resolve to something real at Alrajhi Tower.
// A silent gap here means standing in front of a machine that isn't there.
const allProgramExercises = [
  ...getDayTemplate('A').exercises,
  ...getDayTemplate('B').exercises,
];

assert(allProgramExercises.length === 17, `the program still has 17 movements (got ${allProgramExercises.length})`);

for (const ex of allProgramExercises) {
  // Plank is floor work — it needs no machine at either gym.
  if (ex.name === 'Plank') continue;
  const swap = gymSwap(ex.name, 'work');
  assert(swap !== null, `${ex.name} resolves to equipment at Alrajhi Tower`);
  assert(!!swap && swap.machine.length > 0, `${ex.name} names its Alrajhi machine`);
}

// The five with no machine at all are rebuilt, so they must carry replacement
// cues — the B_Fit cues describe hardware that does not exist there.
for (const name of ['Pec Fly', 'Lateral Raise', 'Rear Delt Fly', 'Back Extension', 'Hip Abduction']) {
  const swap = gymSwap(name, 'work');
  assert(!!swap?.cues, `${name} is rebuilt at Alrajhi and carries its own cues`);
  assert(!!swap?.youtubeUrl, `${name} carries its own video for the rebuilt version`);
  assert(
    swap!.machine.includes('crossover'),
    `${name} is rebuilt on the crossover (got "${swap!.machine}")`,
  );
}

// The home gym must never be rewritten — the program IS B_Fit.
for (const ex of allProgramExercises) {
  assert(gymSwap(ex.name, 'bfit') === null, `${ex.name} is untouched at B_Fit`);
}
assert(gymSwap('Chest Press', null) === null, 'an untagged session gets no swap');
assert(gymSwap('Nordic Curl', 'work') === null, 'an off-program exercise has no swap to offer');

assert(gymWeightNote('bfit') === null, 'the home gym needs no weight caveat');
assert((gymWeightNote('work') ?? '').includes('POUNDS'), 'Alrajhi warns that its stacks are in pounds');

// ── summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
