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
  bodyweightMilestones,
  deloadTarget,
  momentumBank,
  sleepDebtHours,
  type CoachBodyStat,
  type CoachExercise,
  type CoachWorkout,
  type ReadinessSignal,
  strengthHold,
} from '../src/lib/coach';
import {
  alternateDay,
  getDynamicPlan,
  CARDIO,
  cardioForGym,
  getDayTemplate,
  getTrainingStatus,
  pickRampMemory,
  rampBaseBefore,
  rampPrefillWeight,
  cleanRampSessionDates,
  rampContract,
  parseDayLetter,
  projectPlan,
  queuedDay,
  recoveryActivity,
  type DynamicPlan,
  type LoggedSession,
} from '../src/lib/program';
import { gymSwap, gymWeightNote } from '../src/lib/gym-equipment';
import { BODY, bodyPathAt, slimProgress } from '../src/lib/body-figure';
import { computeGapLadder } from '../src/lib/gap-guard';
import { assessSickSignal, computeReadiness } from '../src/lib/health-metrics';
import { routeForDeepLink } from '../src/lib/deep-links';
import { binHeartRate } from '../src/lib/hr-capture';
import { holdWeekKeys, lifetimeStats, weekStreak } from '../src/lib/streak';
import { lastMonthRecap, yearRecap } from '../src/lib/recap';
import { buildCoachContext, parseCoachBrief, COACH_SYSTEM } from '../src/lib/coach-ai';
import { buildLadderFacts, validateLadderCopy } from '../src/lib/coach-ladder';
import {
  afCorrelates,
  afStats,
  bpAverage,
  cpapStats,
  dayRelativeSymptoms,
  nextSite,
  severeSymptomFlag,
  severityByDose,
  treatmentClock,
  weightProjections,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  DEFAULT_ROTATION,
  bpContextAverages,
  bpWeeklyAverages,
  fuelTargets,
  fuelWeek,
  FUEL_DEFAULTS,
  weightPace,
  milestoneEta,
  fastLossLowProtein,
  learnedMaintenance,
  deliveryDayPattern,
  afRecord,
  cpapCompliance,
  bpWeightStory,
  recentMilestoneCross,
  doseLedger,
  bpSplitAroundAnchor,
} from '../src/lib/health-insights';
import { normalizeSampleType, pairBpSamples } from '../src/lib/health';

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

// The ramp's weight base: day 1 has no block yet; once a block exists its
// first session is the cut-off memory must be read BEFORE. Reading the
// previous ramp session instead compounded 60% on 60% (owner, 2026-09-01).
assert(s1.mode === 'return' && s1.blockStartISO === null, 'return day 1 → no block start yet');
assert(
  s2.mode === 'return' && s2.blockStartISO === '2026-07-27T00:00:00.000Z',
  `block start = first session after the layoff (got ${s2.mode === 'return' ? s2.blockStartISO : s2.mode})`,
);
{
  const pre = { weight: 28, reps: 10, rpe: null as number | null };
  const ramp1 = { weight: 17.5, reps: 10, rpe: 1 };
  const picked = pickRampMemory(pre, ramp1);
  assert(picked?.weight === 28 && !picked?.rampHold, 'ramp memory = pre-break weight when one exists');
  assert(rampPrefillWeight(picked!, 60) === 15, `60% of pre-break 28 → 15, not 60% of 17.5 (got ${rampPrefillWeight(picked!, 60)})`);
  assert(rampPrefillWeight(picked!, 100) === 28, 'RESTORE week returns the exact pre-break weight');
  // Pin-floored, same on wrist and phone: Lat Pulldown's learned 7 kg pin.
  const lat = { weight: 40, reps: 10, rpe: null as number | null };
  assert(rampPrefillWeight(lat, 60, 7) === 21 && rampPrefillWeight(lat, 85, 7) === 28, `pin 7: 60%→21, 85%→28 (got ${rampPrefillWeight(lat, 60, 7)}, ${rampPrefillWeight(lat, 85, 7)})`);
  assert(rampPrefillWeight({ weight: 2.5 }, 60, 2.5) === 2.5, 'never below one pin');
  assert(rampPrefillWeight({ weight: 27.5 }, 60) === 15, `27.5 × 60% floors to 15 at 2.5 (got ${rampPrefillWeight({ weight: 27.5 }, 60)})`);

  // The base walks back past an ABANDONED ramp. Owner's real shape: a
  // full block to Jun 16, one 60% session on Jul 29 after 43 days off,
  // then Sep 1 after 34 more. "Last session before this block" was Jul 29
  // — already 60% — so Day A would have opened at 60% of 60%.
  const named = (iso: string, name: string) => ({ date: day(iso), name });
  const shape = [
    ...preBreak.map((d) => ({ date: d, name: 'Day A' })),
    named('2026-07-29T00:00:00Z', 'Day A — Return'),
    named('2026-09-01T16:00:00Z', 'Day B — Watch · Sep 1'),
  ];
  const base = rampBaseBefore(shape, [], day('2026-09-03T12:00:00Z'));
  assert(base === '2026-07-29T00:00:00.000Z', `ramp base stops before the July ramp session (got ${base})`);
  // Day 1 of the July return: the latest session (Jun 16) was full-load → no cut-off.
  assert(rampBaseBefore(shape.slice(0, preBreak.length), [], day('2026-07-29T12:00:00Z')) === null, 'day 1 of a return → plain memory');
  // A rescue session is never a base, even inside a normal block.
  const withRescue = [...preBreak.map((d) => ({ date: d, name: 'Day B' })), named('2026-06-18T00:00:00Z', 'Rescue 15m — Jun 18')];
  assert(rampBaseBefore(withRescue, [], day('2026-07-29T12:00:00Z')) === '2026-06-18T00:00:00.000Z', 'rescue session is skipped as a base');
  // Nothing before the first-ever session is scaled: a brand-new lifter has no cut-off at all.
  assert(rampBaseBefore([], [], day('2026-07-29T12:00:00Z')) === null, 'no history → no cut-off');
  const held = pickRampMemory(undefined, { weight: 12.5, reps: 12, rpe: 1 });
  assert(held?.rampHold === true && rampPrefillWeight(held!, 70) === 12.5, 'no pre-break record → in-block weight held, never rescaled');
  assert(pickRampMemory(undefined, undefined) === undefined, 'no memory at all → none');
}

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

// ── Earned Ramp: clean rated sessions substitute for calendar weeks ─────────
// Clean = ≥2 rated working sets, none above Med. Unrated sessions keep the
// calendar clamp exactly as before (s4 above must keep passing untouched).
const rampSession = (iso: string, rpes: Array<number | null>) => ({
  date: day(iso),
  sets: rpes.map((rpe) => ({ rpe, isWarmup: false })),
});
const fourCleanSessions = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'].map((d) =>
  rampSession(`${d}T00:00:00Z`, [1, 1, 2]),
);
// TIME stays in the earned ramp (trainer blocker): a counted clean session
// needs a rest day since the last counted one, and each phase has a ~4-day
// floor — consecutive-day training earns NOTHING extra, because muscular
// "Easy" at 60% cannot see tendon readiness at 133 kg bodyweight.
const e1 = getTrainingStatus(fourFast, day('2026-07-31T12:00:00Z'), cleanRampSessionDates(fourCleanSessions));
assert(e1.mode === 'return' && e1.week === 2,
  `4 clean sessions on CONSECUTIVE days → only 2 count as spaced → week 2, not 3 (got ${e1.mode} w${e1.week})`);

// Properly spaced clean sessions on the program's own cadence: earned
// advancement caps at one phase per ~4 days even when the count allows more.
const spacedDates = ['2026-07-27', '2026-07-29', '2026-07-31', '2026-08-02'].map((d) => day(`${d}T00:00:00Z`));
const spacedClean = ['2026-07-27', '2026-07-29', '2026-07-31', '2026-08-02'].map((d) =>
  rampSession(`${d}T00:00:00Z`, [1, 1, 2]),
);
const e2 = getTrainingStatus([...preBreak, ...spacedDates], day('2026-08-03T12:00:00Z'),
  cleanRampSessionDates(spacedClean));
assert(e2.mode === 'return' && e2.week === 2,
  `4 spaced clean sessions in 7 days → week 2 (day floor holds phase 3 back) (got ${e2.mode} w${e2.week})`);

// A Grind anywhere disqualifies the session — no acceleration earned.
const grindy = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'].map((d) =>
  rampSession(`${d}T00:00:00Z`, [1, 1, 4]),
);
assert(cleanRampSessionDates(grindy).length === 0, 'a Grind set disqualifies a session from earning');

// One rated set is an accidental tap, not evidence.
assert(cleanRampSessionDates([rampSession('2026-07-27T00:00:00Z', [1])]).length === 0,
  'a single rated set earns nothing');
assert(cleanRampSessionDates([rampSession('2026-07-27T00:00:00Z', [null, null, null])]).length === 0,
  'unrated sessions earn nothing');

// 8 clean sessions finish the whole ramp early — full exit to normal mode.
const eightFast = [
  ...preBreak,
  ...['2026-07-27', '2026-07-28', '2026-07-30', '2026-07-31', '2026-08-02', '2026-08-04', '2026-08-06', '2026-08-08'].map(
    (d) => day(`${d}T00:00:00Z`),
  ),
];
const eightClean = ['2026-07-27', '2026-07-28', '2026-07-30', '2026-07-31', '2026-08-02', '2026-08-04', '2026-08-06', '2026-08-08'].map(
  (d) => rampSession(`${d}T00:00:00Z`, [1, 2, 1]),
);
const e3 = getTrainingStatus(eightFast, day('2026-08-09T12:00:00Z'), cleanRampSessionDates(eightClean));
assert(e3.mode === 'return' && e3.week === 4,
  `8 clean sessions in 13 days → RESTORE (week 4, cap alive), NOT early exit — 100% needs ~16 spaced days (got ${e3.mode} w${'week' in e3 ? e3.week : '?'})`);

// The fastest legitimate comeback: clean sessions every other day exit the
// ramp at ~day 17 — roughly 2.5 weeks, the trainer's floor — vs 4 calendar
// weeks for an unrated one.
const everyOther = ['2026-07-27','2026-07-29','2026-07-31','2026-08-02','2026-08-04','2026-08-06','2026-08-08','2026-08-10','2026-08-12'];
const eoDates = everyOther.map((d) => day(`${d}T00:00:00Z`));
const eoClean = everyOther.map((d) => rampSession(`${d}T00:00:00Z`, [1, 2, 1]));
const e4 = getTrainingStatus([...preBreak, ...eoDates], day('2026-08-13T12:00:00Z'),
  cleanRampSessionDates(eoClean));
assert(e4.mode === 'normal' && e4.week === 3,
  `9 spaced clean sessions across 17 days → ramp complete at BUILD week 3, not LEARN week 1 (got ${e4.mode} w${'week' in e4 ? e4.week : '?'})`);

// ── rampContract: promises only what the gates will pay ─────────────────────
// The trainer's broken-promise scenario: session 1 contained an honest Hard,
// so clean=0. The old inline math said "1 clean session unlocks 70%" — a lie
// the logger exposed 48 hours later. The helper must offer the two-session
// truth instead.
{
  const dirtyFirst = getTrainingStatus(
    [...preBreak, day('2026-07-27T00:00:00Z')],
    day('2026-07-29T12:00:00Z'),
    cleanRampSessionDates([rampSession('2026-07-27T00:00:00Z', [1, 3, 1])]),
  );
  const line = dirtyFirst.mode === 'return' ? rampContract(dirtyFirst, day('2026-07-29T12:00:00Z')) : 'wrong-mode';
  assert(line === '2 clean sessions unlock 70%',
    `a dirty session 1 must NOT yield a 1-session promise (got "${line}")`);

  // One spaced clean session banked, gap satisfied → the 1-session promise
  // is real: spaced becomes 2, day floor (4 days in block) is met.
  const oneClean = getTrainingStatus(
    [...preBreak, day('2026-07-27T00:00:00Z')],
    day('2026-07-31T12:00:00Z'),
    cleanRampSessionDates([rampSession('2026-07-27T00:00:00Z', [1, 1, 2])]),
  );
  const line2 = oneClean.mode === 'return' ? rampContract(oneClean, day('2026-07-31T12:00:00Z')) : 'wrong-mode';
  assert(line2 === '1 clean session unlocks 70%',
    `one banked clean session + gap → the 1-session promise is keepable (got "${line2}")`);

  // Trained clean YESTERDAY: tonight's session wouldn't count as spaced —
  // no promise at all beats a promise that can't be kept.
  const justTrained = getTrainingStatus(
    [...preBreak, day('2026-07-27T00:00:00Z'), day('2026-07-29T00:00:00Z')],
    day('2026-07-30T12:00:00Z'),
    cleanRampSessionDates([
      rampSession('2026-07-27T00:00:00Z', [1, 1]),
      rampSession('2026-07-29T00:00:00Z', [1, 1]),
    ]),
  );
  const line3 = justTrained.mode === 'return' ? rampContract(justTrained, day('2026-07-30T12:00:00Z')) : 'wrong-mode';
  assert(line3 === null,
    `a session tonight would violate spacing → silence, not a false promise (got "${line3}")`);

  assert(rampContract({ mode: 'normal', week: 5 }, day('2026-07-30T12:00:00Z')) === null,
    'no ramp, no contract');
}

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
const reportTrend = weightTrend(data.bodyStats, { returning: status.mode === 'return' });
assert(
  [...report.wins, ...report.focus].includes(reportTrend.message),
  `the live weight trend surfaces (${reportTrend.classification})`,
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
assert((gymWeightNote('work') ?? '').includes('kg column'), 'Alrajhi says which column to read');

// ── cardio availability ──────────────────────────────────────
// Swimming is ranked BEST and there is no pool at Alrajhi. If the ranking
// ever shows it there, he walks to a pool that does not exist.
assert(CARDIO.length === 5, `five ranked cardio options (got ${CARDIO.length})`);
assert(
  CARDIO.map((c) => c.rank).join() === '1,2,3,4,5',
  'cardio ranks are contiguous and in order',
);
const bfitCardio = cardioForGym('bfit').map((c) => c.name);
const workCardio = cardioForGym('work').map((c) => c.name);
assert(bfitCardio.includes('Swimming'), 'B_Fit keeps swimming');
assert(!workCardio.includes('Swimming'), 'Alrajhi has no pool, so no swimming');
assert(workCardio.includes('Rowing'), 'Alrajhi offers rowing');
assert(workCardio.length === 4, `Alrajhi shows its four real options (got ${workCardio.length})`);
assert(
  cardioForGym(null).length === CARDIO.length,
  'an untagged context shows every option rather than hiding any',
);
// Everything above the treadmill must be non-impact — that is the ordering rule.
assert(
  CARDIO[CARDIO.length - 1].name === 'Treadmill',
  'the treadmill stays ranked last',
);


// ── Gap Guard ladder ─────────────────────────────────────────
// The ladder is the anti-gap weapon; its arithmetic must be exact. Both
// collapses started as "one session, then silence past day 7", and rung 4
// exists because BREAK_THRESHOLD_DAYS = 21 resets the program at day 21.
console.log('computeGapLadder');
{
  const lastSession = '2026-08-01T10:00:00.000Z';
  const dayAfter = new Date('2026-08-02T10:00:00.000Z');
  const full = computeGapLadder(lastSession, 'B', dayAfter);
  assert(full.length === 4, `all four rungs from day 1 (got ${full.length})`);
  assert(
    full.map((r) => r.day).join() === '3,5,7,19',
    `rungs at days 3/5/7/19 (got ${full.map((r) => r.day).join()})`,
  );
  assert(full.every((r) => r.at.getTime() > dayAfter.getTime()), 'every rung is in the future');
  assert(full[0].title.includes('Day B'), `rung 1 names the queued day (got "${full[0].title}")`);
  assert(full[3].body.includes('return ramp'), 'day-19 rung warns about the 21-day reset');
  assert(full.every((r) => r.at.getHours() === 17), 'rungs fire at 17:00 local — evening, when training is still possible');

  // Six days in (his position today): days 3 and 5 are past, 7 and 19 remain.
  const sixDaysIn = new Date('2026-08-07T10:00:00.000Z');
  const late = computeGapLadder(lastSession, 'A', sixDaysIn);
  assert(
    late.map((r) => r.day).join() === '7,19',
    `past rungs are dropped, not fired late (got ${late.map((r) => r.day).join()})`,
  );

  // 20+ days in: nothing left — the return ramp takes over from here.
  const past21 = computeGapLadder(lastSession, 'A', new Date('2026-08-21T10:00:00.000Z'));
  assert(past21.length === 0, 'after day 19 the ladder is silent');

  assert(computeGapLadder('not-a-date', 'A', dayAfter).length === 0, 'garbage date → empty ladder, no throw');

  // Comeback Contract: during a ramp the verdict supplies a payoff line and
  // the ladder gains a day-2 rung that carries it verbatim — fired inside
  // the 48-hour window where both real collapses began. No contract, no
  // rung: outside a ramp the ladder is byte-for-byte what it always was.
  const contracted = computeGapLadder(lastSession, 'B', dayAfter, { contract: '1 clean session unlocks 70%' });
  assert(
    contracted.map((r) => r.day).join() === '2,5,7,19',
    `contract rung REPLACES day 3 — near-identical pings must not stack (got ${contracted.map((r) => r.day).join()})`,
  );
  assert(contracted[0].body.includes('1 clean session unlocks 70%'),
    'the day-2 rung carries the contract words verbatim');
  assert(contracted[0].at.getHours() === 17, 'the contract rung keeps the 17:00 fire time');
  const uncontracted = computeGapLadder(lastSession, 'B', dayAfter, { contract: null });
  assert(uncontracted.map((r) => r.day).join() === '3,5,7,19',
    'a null contract adds nothing — the ladder stays as it was');

  // Workout dates are stored as bare UTC days. The anchor must be that
  // calendar day LOCALLY — read as an instant it is 03:00 in Riyadh, and in
  // a negative-offset zone it lands the previous evening, shifting every
  // rung a day early (review finding).
  const bareDay = computeGapLadder('2026-08-01T00:00:00.000Z', 'A', new Date(2026, 7, 1, 12));
  assert(bareDay.length === 4, 'bare-day date yields the full ladder');
  assert(
    bareDay[0].at.getDate() === 4 && bareDay[0].at.getMonth() === 7 && bareDay[0].at.getHours() === 17,
    `bare-day rung 1 lands on local Aug 4 17:00 (got ${bareDay[0].at.toString()})`,
  );
  const noDay = computeGapLadder(lastSession, null, dayAfter);
  assert(noDay[0].title.includes('next session'), 'null day still reads naturally');
}

// ── Sick signal ──────────────────────────────────────────────
console.log('assessSickSignal');
{
  const base = [52, 53, 52, 51, 53, 52, 54, 52, 53, 52]; // median 52
  assert(assessSickSignal([...base, 59, 60]) === 'sick', 'two days at +7 bpm → sick');
  assert(assessSickSignal([...base, 52, 53]) === 'clear', 'two days at baseline → clear');
  assert(assessSickSignal([...base, 59, 53]) === 'unknown', 'one high day is a bad sensor night, not illness');
  assert(assessSickSignal([...base, 56, 56]) === 'unknown', 'the +2..+5 gray zone stays unknown');
  assert(assessSickSignal([...base, null, 60]) === 'unknown', 'a missing day cannot vote');
  assert(assessSickSignal([52, 53, 60, 61]) === 'unknown', 'short baseline → no verdict');
  assert(assessSickSignal([]) === 'unknown', 'empty input → unknown, no throw');
}

// ── HRV readiness clause ─────────────────────────────────────
console.log('computeReadiness + HRV');
{
  const rested = { rhrDeltaBpm: -1, sleepHours: 7.5, hoursSinceLastSession: 48 };
  const green = computeReadiness({ ...rested, hrvRatio: 1.05 });
  assert(green?.verdict === 'push', 'good HRV leaves a green day green');
  const crashed = computeReadiness({ ...rested, hrvRatio: 0.6 });
  assert(crashed?.verdict === 'hold', 'HRV at 60% of baseline holds even a rested day');
  assert(!!crashed && crashed.note.includes('HRV'), `the hold names HRV (got "${crashed?.note}")`);
  const noOpinion = computeReadiness({ ...rested, hrvRatio: null });
  assert(noOpinion?.verdict === 'push', 'null HRV is no opinion, never a red flag');
  const hrvOnly = computeReadiness({ rhrDeltaBpm: null, sleepHours: null, hoursSinceLastSession: null, hrvRatio: 0.5 });
  assert(hrvOnly?.verdict === 'hold', 'HRV alone can hold a day');
  assert(
    computeReadiness({ rhrDeltaBpm: null, sleepHours: null, hoursSinceLastSession: null }) === null,
    'no inputs at all still returns null (pre-HRV contract intact)',
  );
}

// ── HR binning ───────────────────────────────────────────────
console.log('binHeartRate');
{
  const start = '2026-08-04T10:00:00.000Z';
  const at = (sec: number) => new Date(new Date(start).getTime() + sec * 1000).toISOString();
  const bins = binHeartRate(
    [
      { value: 100, dateISO: at(0) },
      { value: 110, dateISO: at(5) },   // same 15 s bin → averaged
      { value: 140, dateISO: at(20) },
      { value: 150, dateISO: at(65) },
    ],
    start,
  );
  assert(
    JSON.stringify(bins) === JSON.stringify([[0, 105], [15, 140], [60, 150]]),
    `bins average within, sort across (got ${JSON.stringify(bins)})`,
  );
  const dirty = binHeartRate(
    [
      { value: 0, dateISO: at(0) },      // dead-sensor zero
      { value: 300, dateISO: at(10) },   // impossible spike
      { value: 120, dateISO: at(-30) },  // before the workout
      { value: 130, dateISO: at(30) },
    ],
    start,
  );
  assert(
    JSON.stringify(dirty) === JSON.stringify([[30, 130]]),
    `garbage samples are dropped, not stored (got ${JSON.stringify(dirty)})`,
  );
  assert(binHeartRate([], start).length === 0, 'no samples → no bins');
  assert(binHeartRate([{ value: 100, dateISO: at(0) }], 'garbage').length === 0, 'bad start date → empty, no throw');
}

// ── Import vocabulary ordering ───────────────────────────────
// "resting_heart_rate" contains "heart_rate"; if the specific check does not
// run first, daily resting HR gets classified as workout heart rate and
// enrichWorkouts writes it onto whatever workout shares the day.
console.log('normalizeSampleType');
{
  assert(normalizeSampleType('resting_heart_rate') === 'resting_hr', 'resting HR beats the liberal heart_rate match');
  assert(normalizeSampleType('heart_rate_variability_sdnn') === 'hrv_sdnn', 'HRV beats the liberal heart_rate match');
  assert(normalizeSampleType('heart_rate') === 'heart_rate', 'plain heart rate still works');
  assert(normalizeSampleType('sleep_analysis') === 'sleep_asleep_h', 'sleep maps');
  assert(normalizeSampleType('vo2_max') === 'vo2max', 'vo2max maps');
  assert(normalizeSampleType('apple_sleeping_wrist_temperature') === 'wrist_temp_c', 'wrist temp maps');
  assert(normalizeSampleType('respiratory_rate') === 'respiratory_rate', 'respiratory rate maps');
  assert(normalizeSampleType('step_count') === 'steps', 'steps map');
  assert(normalizeSampleType('body_mass') === 'weight', 'weight unchanged');
  assert(normalizeSampleType('active_energy_burned') === 'active_energy', 'energy unchanged');
  assert(normalizeSampleType('mystery_metric') === null, 'unknown stays unknown');
}

// ── weekStreak ───────────────────────────────────────────────
// The forgiving streak. Monday weeks; one session keeps a week; bank 1 per
// 4 trained weeks; holds excused; mendable for one week; never renders zero.
console.log('weekStreak');
{
  // now = Wed 2026-08-05. Weeks are Mon-anchored.
  const now = new Date(2026, 7, 5, 12);
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 18);

  // Trained every week for 5 weeks incl this one.
  const five = weekStreak({
    sessionDates: [d(2026,7,7), d(2026,7,14), d(2026,7,21), d(2026,7,28), d(2026,8,4)],
    now,
  });
  assert(five.status === 'alive' && five.weeks === 5, `five straight weeks read 5 (got ${five.weeks}, ${five.status})`);
  assert(five.bank === 1, `four completed past weeks bank one protection (got ${five.bank})`);

  // Same but LAST week empty: the bank spends itself silently.
  const banked = weekStreak({
    sessionDates: [d(2026,6,30), d(2026,7,7), d(2026,7,14), d(2026,7,21), d(2026,8,4)],
    now,
  });
  assert(banked.status === 'alive', `a banked week absorbs one empty week (got ${banked.status})`);

  // Short streak, last week empty, no bank: mendable, not dead.
  const broke = weekStreak({ sessionDates: [d(2026,7,21), d(2026,7,14)], now });
  assert(broke.status === 'mendable', `a fresh break is mendable (got ${broke.status})`);
  assert(broke.mendNeeds === 2, `mending needs 2 sessions (got ${broke.mendNeeds})`);

  // One session this week: one more mends it.
  const half = weekStreak({ sessionDates: [d(2026,7,21), d(2026,7,14), d(2026,8,4)], now });
  assert(half.status === 'mendable' && half.mendNeeds === 1, `one logged, one to go (got ${half.mendNeeds})`);

  // Two sessions this week: mended, streak restored and labelled so.
  const mended = weekStreak({ sessionDates: [d(2026,7,21), d(2026,7,14), d(2026,8,3), d(2026,8,4)], now });
  assert(mended.status === 'alive' && mended.weeks >= 3, `two sessions mend the break (got ${mended.weeks}, ${mended.status})`);
  assert(mended.label.includes('mended'), `the mend is named (got "${mended.label}")`);

  // ADVERSARY REGRESSION: the mend must survive into later weeks. Friday it
  // said "mended"; Monday's recompute must not hand back "1 wk streak".
  const nextWeekView = weekStreak({
    sessionDates: [d(2026,6,30), d(2026,7,7), d(2026,7,14), d(2026,7,28), d(2026,7,30), d(2026,8,4)],
    now: new Date(2026, 7, 5, 12), // the week AFTER the two repair sessions
  });
  assert(
    nextWeekView.status === 'alive' && nextWeekView.weeks >= 5,
    `a mended week stays mended on later recomputes (got ${nextWeekView.weeks}, ${nextWeekView.status})`,
  );

  // A break under a declared hold: parked, not "on the line" — and mendable
  // with two sessions in the first post-hold week.
  const heldBreak = weekStreak({
    sessionDates: [d(2026,7,7), d(2026,7,14)],
    excusedWeeks: new Set(['2026-07-27', '2026-08-03']),
    now: new Date(2026, 7, 5, 12), // mid-hold; week of Jul 20 broke first
  });
  assert(heldBreak.status !== 'mendable', `mid-hold never demands training (got ${heldBreak.status})`);

  // A hold excuses its weeks outright.
  const held = weekStreak({
    sessionDates: [d(2026,7,14), d(2026,7,7)],
    excusedWeeks: new Set(['2026-07-20', '2026-07-27', '2026-08-03']),
    now,
  });
  assert(held.status === 'alive', `hold weeks are excused (got ${held.status})`);

  // A true long break: rebuilding, never zero.
  const rebuilt = weekStreak({ sessionDates: [d(2026,5,10)], now });
  assert(rebuilt.status === 'rebuilding', `an old break rebuilds (got ${rebuilt.status})`);
  assert(rebuilt.weeks >= 1 && !rebuilt.label.includes('0'), `never renders zero (got "${rebuilt.label}")`);

  // Bare-UTC-day dates (the storage format) count in the right local week.
  const bare = weekStreak({ sessionDates: ['2026-08-03T00:00:00.000Z'], now });
  assert(bare.thisWeekSessions === 1, `bare UTC day lands in its local week (got ${bare.thisWeekSessions})`);

  // Empty history.
  const empty = weekStreak({ sessionDates: [], now });
  assert(empty.status === 'rebuilding' && empty.label.length > 0, 'no history → rebuilding, labelled');
}

// ── momentumBank ─────────────────────────────────────────────
console.log('momentumBank');
{
  const ex = { id: 'x', name: 'X', category: 'LEGS' } as CoachExercise;
  const w = (daysAgo: number, now: Date): CoachWorkout => ({
    date: new Date(now.getTime() - daysAgo * 86_400_000),
    sets: [{ exerciseId: 'x', reps: 10, weight: 50, rpe: 2, exercise: ex }],
  });
  const now = new Date(2026, 7, 5);
  const active = momentumBank([w(1, now), w(3, now), w(6, now), w(9, now)], now);
  assert(active !== null && active.pct > 60, `recent training holds a high bank (got ${active?.pct})`);
  const idle = momentumBank([w(20, now), w(23, now), w(26, now)], now);
  assert(idle !== null && active !== null && idle.pct < active.pct, 'idle weeks drain the bank');
  assert(idle !== null && idle.direction === 'draining', `three idle weeks read draining (got ${idle?.direction})`);
  assert(momentumBank([], now) === null, 'no history → no gauge, no fake number');
  // Warm-ups add nothing.
  const withWarm = momentumBank([{
    date: now,
    sets: [
      { exerciseId: 'x', reps: 10, weight: 50, rpe: 2, exercise: ex },
      { exerciseId: 'x', reps: 10, weight: 500, rpe: 4, exercise: ex, isWarmup: true },
    ],
  }], now);
  const withoutWarm = momentumBank([{
    date: now,
    sets: [{ exerciseId: 'x', reps: 10, weight: 50, rpe: 2, exercise: ex }],
  }], now);
  assert(withWarm?.pct === withoutWarm?.pct, 'warm-up sets add no momentum');
}

// ── time-decayed EMA + re-entry explainer ────────────────────
console.log('weightTrend v2');
{
  // Dense then a 43-day gap: the post-gap reading must move the EMA gently.
  const dense: CoachBodyStat[] = [
    { date: '2026-05-01T00:00:00Z', weight: 132 },
    { date: '2026-05-08T00:00:00Z', weight: 131.4 },
    { date: '2026-05-15T00:00:00Z', weight: 130.8 },
  ];
  const afterGap = weightTrend([...dense, { date: '2026-06-27T00:00:00Z', weight: 133 }]);
  assert(afterGap.ema !== null && afterGap.ema < 133, `one post-gap weigh-in does not own the EMA (got ${afterGap.ema})`);

  // Fixed-lane assertions still hold under the new smoothing.
  const lane = weightTrend([
    { date: '2026-05-01T00:00:00.000Z', weight: 132 },
    { date: '2026-05-14T00:00:00.000Z', weight: 131 },
    { date: '2026-05-28T00:00:00.000Z', weight: 130 },
  ]);
  assert(lane.classification === 'on_track', `the fat-loss lane still classifies (got ${lane.classification})`);

  const gaining: CoachBodyStat[] = [
    { date: '2026-08-01T00:00:00Z', weight: 131 },
    { date: '2026-08-08T00:00:00Z', weight: 132.5 },
  ];
  const plain = weightTrend(gaining);
  const returning = weightTrend(gaining, { returning: true });
  assert(plain.message.includes('review intake'), 'normal gaining still warns');
  assert(returning.message.includes('after a break'), `returning reframes the spike (got "${returning.message}")`);
  assert(!returning.message.includes('review intake'), 'the return ramp never scolds intake');
}

// ── bodyweightMilestones ─────────────────────────────────────
console.log('bodyweightMilestones');
{
  const stats: CoachBodyStat[] = [
    { date: '2026-06-01T00:00:00Z', weight: 135 },
    { date: '2026-07-01T00:00:00Z', weight: 133.5 },
    { date: '2026-08-01T00:00:00Z', weight: 133 },
  ];
  const m = bodyweightMilestones(stats, 135);
  assert(m !== null && m.nextDecade === 130, `next decade from ~133 is under-130 (got ${m?.nextDecade})`);
  assert(m !== null && m.kgToDecade > 0 && m.kgToDecade < 5, `kg-to-go is sane (got ${m?.kgToDecade})`);
  assert(bodyweightMilestones([], 135) === null, 'no weigh-ins → no ladder');
}

// ── deloadTarget ─────────────────────────────────────────────
console.log('deloadTarget');
{
  const small = deloadTarget(50, 2.5);
  assert(small.weight === 45, `-10% at 2.5 kg pins lands on a real pin (got ${small.weight})`);
  assert(!small.note.includes('tempo'), 'small pins need no tempo escape');
  const big = deloadTarget(27.5, 5);
  // 5s + pause, NOT 3s: the program's default cue is already a 3s eccentric,
  // so 3s was an alternative to nothing (trainer's catch).
  assert(big.note.includes('5s') && big.note.includes('pause'), `big pin jumps offer a real tempo step (got "${big.note}")`);
  const zero = deloadTarget(50, 0);
  assert(zero.weight > 0 && zero.weight < 50, 'a zero increment falls back safely');
}

// ── sleepDebtHours ───────────────────────────────────────────
console.log('sleepDebtHours');
{
  const goodWeek = [7.2, 7.0, 7.4, 7.1, 7.3, 7.2, 7.0];
  assert(sleepDebtHours(goodWeek) === 0, 'sleeping at your median owes nothing');
  const roughWeek = [7.0, 7.0, 7.0, 7.0, 5.0, 5.5, 7.0, 6.0];
  const debt = sleepDebtHours(roughWeek);
  assert(debt !== null && debt > 3 && debt < 6, `short nights accumulate (got ${debt})`);
  assert(sleepDebtHours([7, 7]) === null, 'under a week of nights → no verdict');
  assert(sleepDebtHours([]) === null, 'no data → null, never zero-as-fact');
}

// ── lifetimeStats + recap ────────────────────────────────────
console.log('lifetime + recap');
{
  const ex = { id: 'x', name: 'Leg Press', category: 'LEGS' } as CoachExercise;
  const mk = (iso: string, weight: number): CoachWorkout & { name: string } => ({
    date: iso,
    name: 'Day A',
    sets: [
      { exerciseId: 'x', reps: 10, weight, rpe: 2, exercise: ex },
      { exerciseId: 'x', reps: 10, weight: 20, rpe: null, exercise: ex, isWarmup: true },
    ],
  });
  const life = lifetimeStats([mk('2026-07-05T00:00:00Z', 50), mk('2026-07-20T00:00:00Z', 55)]);
  assert(life.sessions === 2, 'sessions count');
  assert(life.tonnageKg === 1050, `warm-ups excluded from tonnage (got ${life.tonnageKg})`);

  const recap = lastMonthRecap(
    [mk('2026-06-20T00:00:00Z', 50), mk('2026-07-05T00:00:00Z', 52.5), mk('2026-07-20T00:00:00Z', 55)],
    [{ date: '2026-06-25T00:00:00Z', weight: 134 }, { date: '2026-07-28T00:00:00Z', weight: 132.8 }],
    new Date(2026, 7, 3),
  );
  assert(recap !== null && recap.sessions === 2, `July recap counts July only (got ${recap?.sessions})`);
  assert(recap !== null && recap.liftsProgressed.length === 1 && recap.liftsProgressed[0].toKg === 55,
    'a lift that moved inside the month is named');
  assert(lastMonthRecap([], [], new Date(2026, 7, 3)) === null, 'an empty month renders nothing');
  assert(yearRecap([mk('2026-03-01T00:00:00Z', 50)], [], new Date(2026, 5, 15)) === null,
    'the year recap only exists in December/January');
}

// ── holdWeekKeys ─────────────────────────────────────────────
console.log('holdWeekKeys');
{
  const keys = holdWeekKeys([{ startsAt: new Date(2026, 7, 4), endsAt: new Date(2026, 7, 18) }]);
  assert(keys.has('2026-08-03') && keys.has('2026-08-10') && keys.has('2026-08-17'),
    `a two-week hold excuses all three touched weeks (got ${[...keys].join()})`);
  assert(holdWeekKeys([]).size === 0, 'no holds, no excuses');
}

// ── coach-ai pure functions ──────────────────────────────────
console.log('coach-ai');
{
  const ctx = buildCoachContext({
    profile: { weightKg: 133, startWeightKg: 135, goal: 'fat loss' },
    status: { mode: 'normal', week: 3, returnWeek: null },
    plan: { mode: 'train', day: 'B', daysSinceLast: 2 },
    streak: { weeks: 4, status: 'alive', label: '4 wk streak' },
    workouts: [
      {
        date: '2026-08-01T00:00:00.000Z',
        name: 'Day A 45m',
        gym: null,
        sets: [
          { exercise: 'Leg Press', weight: 40, reps: 12, rpe: 2 },
          { exercise: 'Leg Press', weight: 22.5, reps: 12, rpe: null, isWarmup: true },
        ],
      },
    ],
    bodyStats: [{ date: '2026-08-01T00:00:00.000Z', weight: 133, waist: null }],
    recovery: [{ type: 'sleep_asleep_h', date: '2026-08-01T00:00:00.000Z', value: 7.2, unit: 'h' }],
    holds: [],
    rescueWalks30d: 2,
  });
  assert(ctx.includes('Leg Press:40x12@2'), 'sets serialize compactly');
  assert(!ctx.includes('22.5x12'), 'warm-ups never reach the coach as working sets');
  assert(!ctx.includes('T00:00:00'), 'dates are bare days — no timestamps to bust the prompt cache');
  const parsed = JSON.parse(ctx);
  assert(parsed.workouts[0].gym === 'bfit', 'untagged history reads as the home gym');

  // Context stays bounded no matter the history size.
  const big = buildCoachContext({
    profile: { weightKg: 133, startWeightKg: 135, goal: 'x' },
    status: { mode: 'normal', week: 1, returnWeek: null },
    plan: { mode: 'train', day: 'A', daysSinceLast: 1 },
    streak: { weeks: 1, status: 'alive', label: '1' },
    workouts: Array.from({ length: 200 }, (_, i) => ({
      date: '2026-01-01T00:00:00.000Z', name: `W${i}`, gym: null, sets: [],
    })),
    bodyStats: Array.from({ length: 500 }, () => ({ date: '2026-01-01T00:00:00.000Z', weight: 130, waist: null })),
    recovery: Array.from({ length: 900 }, () => ({ type: 'steps', date: '2026-01-01T00:00:00.000Z', value: 1, unit: 'count' })),
    holds: [],
    rescueWalks30d: 0,
  });
  const bigParsed = JSON.parse(big);
  assert(bigParsed.workouts.length === 40, `workout history caps at 40 (got ${bigParsed.workouts.length})`);
  assert(bigParsed.bodyStats.length === 60, `body stats cap at 60 (got ${bigParsed.bodyStats.length})`);
  assert(bigParsed.recoveryDaily.length === 120, `recovery caps at 120 (got ${bigParsed.recoveryDaily.length})`);

  // parseCoachBrief: bounds and garbage tolerance.
  const ok = parseCoachBrief({ brief: 'Train Day B tonight.', directives: [{ type: 'session', label: 'Day B · 45m' }] });
  assert(ok !== null && ok.directives.length === 1, 'a valid brief parses');
  const flood = parseCoachBrief({
    brief: 'x'.repeat(5000),
    directives: Array.from({ length: 10 }, () => ({ type: 'flag', label: 'y'.repeat(100) })),
  });
  assert(flood !== null && flood.brief.length <= 600, 'a verbose brief is hard-capped for the glance rule');
  assert(flood !== null && flood.directives.length <= 3 && flood.directives[0].label.length <= 40,
    'directives are bounded in count and label length');
  assert(parseCoachBrief(null) === null, 'null → null');
  assert(parseCoachBrief({ directives: [] }) === null, 'missing brief → null');
  assert(parseCoachBrief({ brief: '   ' }) === null, 'blank brief → null');

  // The constitution carries the load-bearing rules.
  assert(COACH_SYSTEM.includes('never suggest exceeding'), 'ramp caps are in the constitution');
  assert(COACH_SYSTEM.includes('drop one pin and rebuild'), 'the Grind rule matches nextTarget — drop, not hold (trainer catch)');
  assert(COACH_SYSTEM.includes('Ab Crunch machine IS prescribed'), 'the flexion rule carves out the prescribed machine (trainer catch)');
  assert(COACH_SYSTEM.includes('DELOAD'), 'deload week is in the constitution');
  assert(COACH_SYSTEM.includes('NO pool'), 'per-gym facilities are in the constitution');
  assert(COACH_SYSTEM.includes('NEVER comparable across gyms'), 'the cross-gym rule is in the constitution');
  assert(COACH_SYSTEM.includes('Rescue walk'), 'walks-are-not-training is in the constitution');
  assert(COACH_SYSTEM.includes('2-4 short sentences'), 'the glance rule bounds the brief');

  // Wave 4: descent ladder + bounded proposals + work-gym guidance.
  assert(
    COACH_SYSTEM.includes('full session → 30-minute compressed session') &&
      COACH_SYSTEM.includes('15-minute rescue session') &&
      COACH_SYSTEM.includes("'session-30'"),
    'the descent ladder is spelled out rung by rung, each with its one-tap chip type');
  assert(COACH_SYSTEM.includes('Stop negotiating after two declines'), 'the ladder ends with grace, not pressure');
  assert(COACH_SYSTEM.includes('holds are for circumstances, not moods'), 'hold proposals are fenced to real obstacles');
  assert(COACH_SYSTEM.includes('start one pin light and expect Easy'), 'work-gym starting guidance is conservative by rule');

  // whyGap: his own words reach the coach; nothing else invents gap causes.
  const gapCtx = buildCoachContext({
    profile: { weightKg: 133, startWeightKg: 135, goal: 'x' },
    status: { mode: 'normal', week: 3, returnWeek: null },
    plan: { mode: 'train', day: 'B', daysSinceLast: 2 },
    streak: { weeks: 1, status: 'alive', label: '1' },
    workouts: [
      { date: '2026-07-29T00:00:00.000Z', name: 'Day A 45m', gym: null, gapReason: 'work travel, two weeks in Jeddah', sets: [] },
      { date: '2026-06-16T00:00:00.000Z', name: 'Day A 30m', gym: null, gapReason: null, sets: [] },
    ],
    bodyStats: [],
    recovery: [],
    holds: [{ startsAt: '2026-05-01T00:00:00.000Z', endsAt: '2026-05-08T00:00:00.000Z', reason: 'sick' }],
    rescueWalks30d: 0,
  });
  const gapParsed = JSON.parse(gapCtx);
  assert(gapParsed.workouts[0].whyGap === 'work travel, two weeks in Jeddah', 'gapReason reaches the coach as whyGap');
  assert(!('whyGap' in gapParsed.workouts[1]), 'workouts without a reason carry no whyGap key');
  assert(gapParsed.holds[0].reason === 'sick', 'hold reasons reach the coach');

  // Proposals: parsed only inside hard bounds, degrade to null otherwise.
  const withHold = parseCoachBrief({
    brief: 'Travel week — hold it.',
    directives: [],
    proposal: { action: 'declare-hold', days: 5, reason: 'Jeddah trip' },
  });
  assert(withHold !== null && withHold.proposal?.action === 'declare-hold' && withHold.proposal.days === 5,
    'a bounded declare-hold proposal parses');
  const tooLong = parseCoachBrief({ brief: 'x', directives: [], proposal: { action: 'declare-hold', days: 10 } });
  assert(tooLong !== null && tooLong.proposal === null,
    'a 10-day hold proposal is rejected — coach holds cap at 7 (trainer)');
  const badAction = parseCoachBrief({ brief: 'x', directives: [], proposal: { action: 'delete-history' } });
  assert(badAction !== null && badAction.proposal === null, 'an unknown action degrades to no proposal');
  const endHoldP = parseCoachBrief({ brief: 'x', directives: [], proposal: { action: 'end-hold' } });
  assert(endHoldP !== null && endHoldP.proposal?.action === 'end-hold', 'end-hold parses without params');
  const noProposal = parseCoachBrief({ brief: 'Ordinary day.', directives: [] });
  assert(noProposal !== null && noProposal.proposal === null, 'no proposal on ordinary days');
}

// ── coach-ladder: the Voice Through the Door ─────────────────
console.log('coach-ladder');
{
  // Jul 29 2026 is a Wednesday: the day-7 rung fires on a Wednesday, 5 days
  // left in the Monday week → the mend offer is feasible.
  const facts = buildLadderFacts({
    lastSessionDate: '2026-07-29',
    lastSessionName: 'Day A 45m — Jul 29',
    topSet: 'Lat Pulldown 22.5 kg × 12 at B_Fit',
    queuedDay: 'B',
    longestGapDays: 43,
  });
  assert(facts.sheet.includes('22.5 kg × 12'), 'the fact sheet carries the top set');
  assert(facts.sheet.includes('43 days'), 'the fact sheet carries the computed longest gap');
  assert(facts.sheet.includes('day-21') && facts.sheet.includes('4-week'), 'the reset facts are stated, not assumed');
  assert(facts.mendOffer && facts.sheet.includes('rest day between'), 'the mend fact carries the rest-day condition');
  assert(!facts.allowed.has('29') && !facts.allowed.has('45') && !facts.allowed.has('2026'),
    'date and session-name fragments are NOT whitelisted numbers (trainer probe)');

  // The gate: numbers must come from fact VALUES, and weights must be real.
  const good7 = { day: 7, title: 'Day B is still queued', body: 'A missed week is mendable — 2 sessions before Sunday night repair it, rest day between. Your Lat Pulldown 22.5 kg × 12 is right where you left it. 15 minutes counts.' };
  assert(validateLadderCopy(good7, facts, 7) === null, 'grounded day-7 copy passes the gate');

  const invented = { day: 7, title: 'Come back', body: 'You were pressing 80 kg two weeks ago.' };
  assert(validateLadderCopy(invented, facts, 7) !== null, 'an invented number is rejected');

  const dateWeight = { day: 7, title: 'Your bar is set', body: 'Your Lat Pulldown was at 29 kg. 15 minutes tonight.' };
  assert(validateLadderCopy(dateWeight, facts, 7) !== null, 'a date fragment cannot become a weight (trainer probe)');

  const legalNumberWrongUnit = { day: 7, title: 'Day B waits', body: 'Come back to your 43 kg Lat Pulldown — 15 minutes.' };
  assert(validateLadderCopy(legalNumberWrongUnit, facts, 7) !== null,
    'a legal number with an invented kg unit is rejected (43 is a day count, not a weight)');

  const backToBack = { day: 7, title: 'Save the week', body: '2 sessions before Sunday night repair the streak — tonight and tomorrow both, 15 minutes each.' };
  assert(validateLadderCopy(backToBack, facts, 7) !== null,
    'a mend offer without the rest-day cue is rejected (trainer blocker: no back-to-back days)');

  const shame = { day: 7, title: 'Still waiting', body: 'Time to move — 2 sessions or the streak dies.' };
  assert(validateLadderCopy(shame, facts, 7) !== null, 'banned lexicon is rejected mechanically');
  const quite = { day: 7, title: 'Day B is queued', body: 'Quite a week — a 15 minute rescue keeps the 2 session mend alive, rest day between.' };
  assert(validateLadderCopy(quite, facts, 7) === null, "'quite' does not trip the 'quit' ban (word boundary)");

  const tooLongBody = { day: 7, title: 'Hi', body: 'x'.repeat(300) };
  assert(validateLadderCopy(tooLongBody, facts, 7) !== null, 'an over-length body is rejected');

  const wrongDay = { day: 19, title: 'Hi', body: 'ok' };
  assert(validateLadderCopy(wrongDay, facts, 7) !== null, 'a day mismatch is rejected');

  const soft19 = { day: 19, title: 'One session this week', body: 'Day B is queued and 15 minutes counts.' };
  assert(validateLadderCopy(soft19, facts, 19) !== null, 'day-19 copy without the reset fact is rejected');

  const good19 = { day: 19, title: '2 days from a program reset', body: 'At day 21 the 4-week return ramp takes over. One session in the next 2 days keeps your normal program — Day B is queued.' };
  assert(validateLadderCopy(good19, facts, 19) === null, 'day-19 copy carrying the reset fact passes');

  // Saturday anchor → day-7 rung fires on a Saturday → 2 days left → the
  // week cannot be mended with a rest day between. The offer must vanish.
  const satFacts = buildLadderFacts({
    lastSessionDate: '2026-08-01',
    lastSessionName: 'Day B 45m — Aug 1',
    topSet: null,
    queuedDay: 'A',
    longestGapDays: 43,
  });
  assert(!satFacts.mendOffer && satFacts.sheet.includes('cannot be mended'),
    'a Saturday fire date withdraws the mend offer (matches streak.ts)');
  const mendAnyway = { day: 7, title: 'Save it', body: '2 sessions before Sunday night repair the streak, rest day between. 15 minutes.' };
  assert(validateLadderCopy(mendAnyway, satFacts, 7) !== null,
    'mend copy on an unmendable week is rejected even with the rest-day cue');

  // The static rungs must themselves pass the gate they fall back from —
  // if the fallback can't pass, the gate is wrong, not the fallback.
  const rungs = computeGapLadder('2026-07-29', 'B', new Date('2026-07-30T12:00:00'));
  const static7 = rungs.find((r) => r.day === 7);
  const static19 = rungs.find((r) => r.day === 19);
  assert(!!static7 && !!static19, 'static rungs 7 and 19 exist to fall back to');
}

// ── deep links: universal links map onto the same allowlist ──
{
  const app = 'https://workout-app-gamma-rouge.vercel.app';
  assert(routeForDeepLink(`${app}/stats`) === '/stats', 'universal link opens an app screen');
  assert(routeForDeepLink(`${app}/`) === '/', 'universal link to the root opens Home');
  assert(routeForDeepLink(`${app}/workouts/new?day=B&dur=30`) === '/workouts/new?day=B&dur=30',
    'universal link keeps the query string');
  assert(routeForDeepLink(`${app}/progress/abc123`) === '/progress/abc123',
    'universal link reaches nested screens');
  assert(routeForDeepLink(`${app}/api/export?token=x`) === null,
    'an export link is NOT swallowed into the app');
  assert(routeForDeepLink(`${app}/workouts/..%2fapi%2fexport`) === null,
    'percent-encoded traversal cannot sneak past the /api exclusion');
  assert(routeForDeepLink(`${app}/workouts/%2e%2e%2fapi/export`) === null,
    'encoded dot-dot segments are rejected, not routed verbatim');
  assert(routeForDeepLink('https://evil.example.com/stats') === null,
    'a foreign host never routes');
  assert(routeForDeepLink(`${app}/statsish`) === null,
    'prefix match is per segment, not per string');
  assert(routeForDeepLink('workout://stats') === '/stats', 'the workout:// scheme still works');
}

// ── summary ──────────────────────────────────────────────────

// ── health-insights: the Mounjaro module's deterministic brain ─
console.log('health-insights');
{
  const now = new Date('2026-09-10T12:00:00');
  const inj = (iso: string, doseMg: number, site = 'abdomen-right') => ({ at: iso, doseMg, site });

  // Treatment clock anchors at the FIRST injection.
  assert(treatmentClock([], DEFAULT_DOSE_PLAN, now) === null, 'no injections → no clock (never invent a schedule)');
  const clock = treatmentClock(
    [inj('2026-08-25T18:00:00', 2.5), inj('2026-09-01T18:00:00', 2.5), inj('2026-09-08T18:00:00', 2.5)],
    DEFAULT_DOSE_PLAN,
    now,
  );
  assert(clock !== null && clock.week === 3, `Sept 10 from an Aug 25 anchor is treatment week 3 (got ${clock?.week})`);
  assert(clock !== null && clock.daysSinceLast === 2, 'days since last injection counts from the latest dose');
  assert(clock !== null && clock.nextDue.getDate() === 15, 'next due = last + 7 days');
  assert(clock !== null && clock.nextPlanned?.mg === 2.5, 'the 4th dose still prescribes 2.5 mg');
  assert(clock !== null && !clock.overdue, 'not overdue two days after a dose');

  // BLOCKER regression (adversary probe): the plan is DOSE-indexed, not
  // wall-clock-indexed. Injecting an hour earlier in the day must never
  // shift the next dose into a different plan slot — and above all can
  // never skip the doctor-review checkpoint.
  const sixDoses = [
    inj('2026-08-25T18:00:00', 2.5), inj('2026-09-01T18:00:00', 2.5),
    inj('2026-09-08T18:00:00', 2.5), inj('2026-09-15T18:00:00', 2.5),
    inj('2026-09-22T18:00:00', 5), inj('2026-09-29T17:00:00', 5), // 6th dose ONE HOUR early
  ];
  const afterSix = treatmentClock(sixDoses, DEFAULT_DOSE_PLAN, new Date('2026-10-01T12:00:00'));
  assert(afterSix !== null && afterSix.nextPlanned !== null && afterSix.nextPlanned.mg === null,
    'after 6 doses the 7th slot is the doctor-review checkpoint — an early injection cannot bypass it');
  const fourDoses = sixDoses.slice(0, 3).concat([inj('2026-09-15T16:00:00', 2.5)]); // 4th dose 2h early
  const afterFour = treatmentClock(fourDoses, DEFAULT_DOSE_PLAN, new Date('2026-09-16T12:00:00'));
  assert(afterFour !== null && afterFour.nextPlanned?.mg === 5,
    'the 5th dose prescribes 5 mg regardless of the 4th dose being hours early');
  // Week display uses CALENDAR days — the morning of day 7 is week 2, and
  // it can never disagree with daysSinceLast's calendar arithmetic.
  const day7 = treatmentClock([inj('2026-08-25T18:00:00', 2.5)], DEFAULT_DOSE_PLAN, new Date('2026-09-01T08:00:00'));
  assert(day7 !== null && day7.week === 2 && day7.daysSinceLast === 7,
    'calendar day 7 is week 2 — week and daysSinceLast share one arithmetic');
  // The anchor override survives a truncated recent-injections window.
  const truncated = treatmentClock(
    [inj('2026-09-08T18:00:00', 2.5)],
    DEFAULT_DOSE_PLAN,
    now,
    new Date('2026-08-25T18:00:00'),
  );
  assert(truncated !== null && truncated.week === 3,
    'an explicit anchor keeps the true week when the injection window is truncated');
  // Past the end of the plan: say so, never loop the last step forever.
  const pastPlan = treatmentClock(
    Array.from({ length: 8 }, (_, i) => inj(new Date(Date.parse('2026-08-25T18:00:00') + i * 7 * 86_400_000).toISOString(), 2.5)),
    DEFAULT_DOSE_PLAN,
    new Date('2026-10-15T12:00:00'),
  );
  assert(pastPlan !== null && pastPlan.nextPlanned === null && pastPlan.planExhausted,
    'a plan with no slot for the next dose reports exhausted — the UI asks for an edit, never invents');

  // Site rotation resumes after an off-rotation one-off.
  assert(nextSite(DEFAULT_ROTATION, []) === 'abdomen-right', 'rotation starts at its first site');
  assert(
    nextSite(DEFAULT_ROTATION, [inj('2026-08-25', 2.5, 'abdomen-right')]) === 'abdomen-left',
    'rotation advances right abdomen → left abdomen',
  );
  assert(
    nextSite(DEFAULT_ROTATION, [
      inj('2026-08-25', 2.5, 'abdomen-left'),
      inj('2026-09-01', 2.5, 'arm-right'),
    ]) === 'thigh-right',
    'an off-rotation arm shot does not derail the cycle',
  );

  // Weight snapshot and % milestones.
  const snap = weightSnapshot(
    { heightCm: 169, startWeightKg: 133, goalWeightKg: 103 },
    [120, 110, 103],
    [
      { date: '2026-08-25', weight: 133 },
      { date: '2026-09-08', weight: 126.4 },
    ],
  );
  assert(snap !== null && snap.lostKg === 6.6 && snap.pctLost === 5, '133 → 126.4 is 6.6 kg and 5.0%');
  assert(snap !== null && snap.pctMilestones[0].achieved && !snap.pctMilestones[1].achieved, '5% reached, 10% not yet');
  assert(snap !== null && snap.bmi === 44.3 && snap.startBmi === 46.6, 'BMI at 169 cm: 46.6 start, 44.3 now');

  // Projections refuse to guess.
  assert(
    weightProjections([{ date: '2026-09-01', weight: 130 }], [120], now) === null,
    'fewer than 4 recent weigh-ins → no projection',
  );
  const upward = weightProjections(
    Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-0${i + 1}`, weight: 130 + i })),
    [120],
    now,
  );
  assert(upward === null, 'an upward trend projects nothing — no fantasy dates');
  const proj = weightProjections(
    Array.from({ length: 8 }, (_, i) => ({
      date: new Date(now.getTime() - (8 - i) * 7 * 86_400_000).toISOString(),
      weight: 133 - i * 0.8,
    })),
    [120, 60],
    now,
  );
  assert(proj !== null && proj[0].estimatedDate !== null, 'a real downward trend yields a date for a near target');
  assert(proj !== null && proj[1].estimatedDate === null, 'a target beyond the 18-month horizon reports no date');

  // Day-relative symptoms: only 0..7 after the nearest preceding injection,
  // in CALENDAR days — a morning-after symptom after an evening injection is
  // day 1, never day 0 (adversary probe: every morning-after row shifted one
  // column left for an evening injector).
  const rel = dayRelativeSymptoms(
    [
      { at: '2026-08-26T08:00:00', kind: 'nausea', severity: 2 }, // next MORNING = day 1
      { at: '2026-08-24T20:00:00', kind: 'nausea', severity: 3 }, // before any injection
      { at: '2026-09-06T20:00:00', kind: 'nausea', severity: 1 }, // 12 days after → excluded
    ],
    [inj('2026-08-25T18:00:00', 2.5)],
  );
  assert(rel.nausea?.length === 1 && rel.nausea[0].offset === 1 && rel.nausea[0].avgSeverity === 2,
    'the morning after an evening injection is day 1 (calendar days, not 24h blocks)');

  // Dose comparison suppresses tiny samples, and never attributes a symptom
  // logged weeks after the last dose to that dose.
  const byDoseNone = severityByDose(
    [{ at: '2026-08-26', kind: 'nausea', severity: 2 }],
    [inj('2026-08-25', 2.5)],
  );
  assert(!byDoseNone.nausea, 'fewer than 3 logs at a dose → no dose comparison');
  const stale = severityByDose(
    [
      { at: '2026-10-01', kind: 'nausea', severity: 3 },
      { at: '2026-10-02', kind: 'nausea', severity: 3 },
      { at: '2026-10-03', kind: 'nausea', severity: 3 },
    ],
    [inj('2026-08-25', 2.5)],
  );
  assert(!stale.nausea, 'symptoms weeks after the last dose never count against that dose (7-day cap)');

  // AF days-since uses calendar days, same law as everything else.
  const afCal = afStats([{ startedAt: '2026-09-08T22:00:00' }], new Date('2026-09-10T08:00:00'));
  assert(afCal.daysSinceLast === 2, 'AF days-since is calendar days (late-evening episode → 2 days on the 10th)');

  // AF correlates: unanswered flags are excluded from the denominator.
  const episodes = [
    { startedAt: '2026-08-26', bloating: true },
    { startedAt: '2026-08-28', bloating: true },
    { startedAt: '2026-09-01', bloating: false },
    { startedAt: '2026-09-03', bloating: true },
    { startedAt: '2026-09-05', bloating: null }, // not asked — proves nothing
  ];
  assert(afCorrelates(episodes, 5) === null, '4 answered of 5 episodes is under the 5-answered guard');
  const withFive = afCorrelates([...episodes, { startedAt: '2026-09-07', bloating: true }], 5);
  assert(
    withFive !== null && withFive[0].hits === 4 && withFive[0].answered === 5,
    'correlates count answered episodes only — 4 of 5, not 4 of 6',
  );

  // CPAP streak counts consecutive nights.
  const cpap = cpapStats(
    [
      { night: '2026-09-08', usageHours: 6.5, ahi: 1.2 },
      { night: '2026-09-07', usageHours: 7.1, ahi: 2.0 },
      { night: '2026-09-05', usageHours: 6.0, ahi: 1.6 }, // gap on the 6th
    ],
    now,
  );
  assert(cpap.streak === 2, 'a missed night breaks the CPAP streak');
  assert(cpap.avgAhi30d === 1.6, 'AHI averages over logged nights');

  // BP refuses a "trend" from under 3 readings.
  assert(bpAverage([{ at: '2026-09-09', systolic: 128, diastolic: 78 }], 7, now) === null,
    'one BP reading is a moment, not an average');

  // Safety flag: repeated severe red-flag symptoms only.
  assert(
    severeSymptomFlag(
      [
        { at: '2026-09-10T08:00:00', kind: 'vomiting', severity: 3 },
        { at: '2026-09-09T20:00:00', kind: 'vomiting', severity: 3 },
      ],
      now,
    ),
    'two severe vomiting logs in 48h raise the notice',
  );
  assert(
    !severeSymptomFlag([{ at: '2026-09-10T08:00:00', kind: 'vomiting', severity: 3 }], now),
    'a single severe log does not',
  );
  assert(
    !severeSymptomFlag(
      [
        { at: '2026-09-10T08:00:00', kind: 'bloating', severity: 3 },
        { at: '2026-09-09T20:00:00', kind: 'bloating', severity: 3 },
      ],
      now,
    ),
    'severe bloating is uncomfortable, not a red flag — no alarm fatigue',
  );
}


// ── blood-pressure pairing (Health-app import) ───────────────
{
  // A monitor reading is two samples sharing a timestamp — they pair.
  const pairs = pairBpSamples(
    [{ dateISO: '2026-08-25T08:00:00Z', value: 131.4 }],
    [{ dateISO: '2026-08-25T08:00:00Z', value: 82.6 }],
  );
  assert(pairs.length === 1 && pairs[0].systolic === 131 && pairs[0].diastolic === 83,
    'sys+dia at the same instant pair into one rounded reading');

  // Clock skew inside a minute still pairs; beyond it does not.
  assert(pairBpSamples(
    [{ dateISO: '2026-08-25T08:00:00Z', value: 128 }],
    [{ dateISO: '2026-08-25T08:00:45Z', value: 79 }],
  ).length === 1, '45s of skew still pairs');
  assert(pairBpSamples(
    [{ dateISO: '2026-08-25T08:00:00Z', value: 128 }],
    [{ dateISO: '2026-08-25T08:02:00Z', value: 79 }],
  ).length === 0, 'a lone half two minutes away is not a reading');

  // Each half is used once — two readings a minute apart stay two, matched
  // to their nearest partner, never crossed.
  const twoReadings = pairBpSamples(
    [
      { dateISO: '2026-08-25T08:00:00Z', value: 140 },
      { dateISO: '2026-08-25T08:01:00Z', value: 120 },
    ],
    [
      { dateISO: '2026-08-25T08:00:02Z', value: 90 },
      { dateISO: '2026-08-25T08:01:02Z', value: 70 },
    ],
  );
  assert(
    twoReadings.length === 2 &&
      twoReadings[0].systolic === 140 && twoReadings[0].diastolic === 90 &&
      twoReadings[1].systolic === 120 && twoReadings[1].diastolic === 70,
    'back-to-back readings pair with their own halves, not each other',
  );

  // Device glitches never become history: bounds + sys>dia.
  assert(pairBpSamples(
    [{ dateISO: '2026-08-25T08:00:00Z', value: 300 }],
    [{ dateISO: '2026-08-25T08:00:00Z', value: 80 }],
  ).length === 0, 'systolic 300 is a glitch, dropped');
  assert(pairBpSamples(
    [{ dateISO: '2026-08-25T08:00:00Z', value: 80 }],
    [{ dateISO: '2026-08-25T08:00:00Z', value: 120 }],
  ).length === 0, 'systolic at or below diastolic is a glitch, dropped');

  // Junk in the series (bad dates) is filtered, not fatal.
  assert(pairBpSamples(
    [{ dateISO: 'not-a-date', value: 128 }, { dateISO: '2026-08-25T08:00:00Z', value: 128 }],
    [{ dateISO: '2026-08-25T08:00:00Z', value: 79 }],
  ).length === 1, 'an unparseable timestamp drops its sample only');
}

// ── BP tracker aggregates ────────────────────────────────────
{
  const now = new Date('2026-09-10T12:00:00');
  const r = (daysAgo: number, sysV: number, diaV: number, context: string | null = null) => ({
    at: new Date(now.getTime() - daysAgo * 86_400_000),
    systolic: sysV, diastolic: diaV, context,
  });

  // Context averages: guarded per bucket; untagged rows enter nothing.
  const byCtx = bpContextAverages(
    [r(1,130,85,'morning'), r(2,126,81,'morning'), r(3,128,83,'morning'),
     r(1,140,90,'evening'), r(2,142,92,'evening'),
     r(1,120,80)],
    30, now,
  );
  assert(byCtx.length === 1 && byCtx[0].context === 'morning'
    && byCtx[0].systolic === 128 && byCtx[0].diastolic === 83 && byCtx[0].n === 3,
    'morning clears the 3-reading guard; evening (2) and untagged stay out');

  // Old readings fall outside the window.
  assert(bpContextAverages(
    [r(40,130,85,'morning'), r(41,130,85,'morning'), r(42,130,85,'morning')],
    30, now,
  ).length === 0, 'context averages respect the window');

  // Weekly averages: a thin week keeps its count but refuses an average.
  const weekly = bpWeeklyAverages(
    [r(1,130,85), r(2,128,83), r(3,126,81), r(8,140,90)],
    4, now,
  );
  const thin = weekly.find((w) => w.n === 1);
  const full = weekly.find((w) => w.n === 3);
  assert(!!thin && thin.systolic === null,
    'a 1-reading week reports its count, not a fake average');
  assert(!!full && full.systolic === 128 && full.diastolic === 83,
    'a 3-reading week averages honestly');
  assert(weekly.length === 2, 'weeks with zero readings are skipped');
}


// ── fuel (daily macros) ──────────────────────────────────────
{
  // Stored targets win; junk and absences fall back to the suggestions.
  const t = fuelTargets({ kcal: 2400, fuelProteinG: 140, carbsG: 9999 });
  assert(t.kcal === 2400 && t.proteinG === 140, 'stored fuel targets override the defaults');
  assert(t.carbsG === FUEL_DEFAULTS.carbsG && t.fatG === FUEL_DEFAULTS.fatG,
    'out-of-bounds and missing targets fall back to the suggested numbers');
  // The check-in's proteinG key (100) must NOT leak into fuel targets.
  assert(fuelTargets({ proteinG: 100 }).proteinG === FUEL_DEFAULTS.proteinG,
    'fuel protein reads fuelProteinG, never the check-in proteinG key');

  const now = new Date('2026-09-10T18:00:00');
  const d = (daysAgo: number) => {
    const x = new Date('2026-09-10T00:00:00Z');
    x.setUTCDate(x.getUTCDate() - daysAgo);
    return x;
  };
  const week = fuelWeek(
    [
      { day: d(0), kcal: 1900, proteinG: 135 },
      { day: d(1), kcal: 2100, proteinG: 120 },
      { day: d(2), kcal: 2000, proteinG: 131 },
      { day: d(9), kcal: 5000, proteinG: 10 }, // outside the window
    ],
    FUEL_DEFAULTS, 7, now,
  );
  assert(week.daysLogged === 3, 'only days inside the window count');
  assert(week.avgKcal === 2000, 'calorie average over logged days');
  assert(week.proteinHitDays === 2 && week.proteinLoggedDays === 3,
    'protein-hit counts days at or above the target');

  const thin = fuelWeek([{ day: d(0), kcal: 1900 }], FUEL_DEFAULTS, 7, now);
  assert(thin.avgKcal === null && thin.daysLogged === 1,
    'one logged day reports a count, never an average');
}


// ── the new-information wave: pace, maintenance, stories ─────
{
  const now = new Date('2026-09-10T12:00:00');
  const w = (daysAgo: number, kg: number) => ({
    date: new Date(now.getTime() - daysAgo * 86_400_000), weight: kg,
  });

  // Pace: week-average vs week-average, guarded at 2+2 readings.
  const pace = weightPace([w(1,129.0), w(3,129.4), w(6,129.8), w(8,130.2), w(10,130.4), w(13,130.6)], now);
  assert(pace !== null && pace.kgPerWeek === -1.0, 'pace compares week means, not endpoints');
  assert(weightPace([w(1,129), w(8,131)], now) === null, 'one reading per week is not a pace');

  // ETA: only when losing, never past half a year.
  const eta = milestoneEta(129.4, 126.4, pace, now);
  assert(eta !== null && Math.round((eta.getTime() - now.getTime()) / 86_400_000) === 21,
    '3 kg at 1 kg/week lands 21 days out');
  assert(milestoneEta(129.4, 103, pace, now) === null, 'a 26-week horizon caps the crystal ball');
  assert(milestoneEta(129.4, 126.4, null, now) === null, 'no pace, no promise');

  // The muscle-guard flag: fast loss + protein under (or un-)logged.
  const lowP = { daysLogged: 5, avgKcal: 1500, avgProteinG: 90, proteinHitDays: 0, proteinLoggedDays: 5 };
  const goodP = { ...lowP, avgProteinG: 140 };
  assert(fastLossLowProtein(pace, lowP, FUEL_DEFAULTS), 'fast loss + low protein trips the flag');
  assert(!fastLossLowProtein(pace, goodP, FUEL_DEFAULTS), 'fast loss with the floor held does not');
  assert(!fastLossLowProtein({ kgPerWeek: -0.6, nRecent: 3, nPrior: 3 }, lowP, FUEL_DEFAULTS),
    'target-pace loss never flags');

  // Learned maintenance: intake plus what the scale says storage paid.
  const meals = Array.from({ length: 12 }, (_, i) => ({
    day: new Date(now.getTime() - (i + 1) * 86_400_000), kcal: 2000,
  }));
  const scale = [w(1,129.0), w(4,129.5), w(9,130.0), w(13,130.2), w(12,130.4)];
  const lm = learnedMaintenance(meals, scale, now);
  assert(lm !== null && lm.maintenanceKcal > 2500 && lm.maintenanceKcal < 3100,
    'losing ~1.05 kg over 12 days on 2000 kcal implies maintenance near 2700');
  assert(learnedMaintenance(meals.slice(0, 5), scale, now) === null,
    'under 8 logged days the answer is not-enough-data');

  // Delivery vs own-cooking days (days stored at UTC midnight).
  const day = (iso: string, kcal: number) => ({ day: new Date(iso + 'T00:00:00Z'), kcal });
  const pat = deliveryDayPattern([
    day('2026-09-06', 2000), day('2026-09-07', 2100), day('2026-09-08', 2050), day('2026-09-09', 1950),
    day('2026-09-04', 2600), day('2026-09-05', 2500),
  ], now);
  assert(pat !== null && pat.deliveryAvg === 2025 && pat.ownAvg === 2550,
    'Sun–Thu and Fri–Sat bucket separately');

  // AF record: the longest calm stretch can be the current one.
  const rec = afRecord([{ startedAt: '2026-08-01' }, { startedAt: '2026-08-21' }], now);
  assert(rec !== null && rec.currentDays === 20 && rec.longestDays === 20,
    'current calm stretch counts toward the record');

  // CPAP compliance: a sub-4h night breaks the streak.
  const night = (iso: string, h: number) => ({ night: new Date(iso + 'T00:00:00Z'), usageHours: h });
  const strip = cpapCompliance([
    night('2026-09-05', 6), night('2026-09-06', 6.5), night('2026-09-07', 2), night('2026-09-08', 7), night('2026-09-09', 6),
  ], now);
  assert(strip.currentStreak === 2 && strip.bestStreak === 2 && strip.month4h === 4 && strip.monthLogged === 5,
    'streaks break on short nights; the month counts every log');

  // BP × weight story: months qualify only with 3 readings + 2 weigh-ins.
  const bpRow = (iso: string, sv: number, dv: number) => ({ at: iso, systolic: sv, diastolic: dv });
  const story = bpWeightStory(
    [bpRow('2026-08-02',138,88), bpRow('2026-08-10',136,87), bpRow('2026-08-20',134,86),
     bpRow('2026-09-01',131,84), bpRow('2026-09-05',130,84), bpRow('2026-09-08',129,83)],
    [ { date: '2026-08-05', weight: 132 }, { date: '2026-08-25', weight: 130 },
      { date: '2026-09-02', weight: 129.6 }, { date: '2026-09-08', weight: 129.0 } ],
  );
  assert(story !== null && story.length === 2 && story[0].systolic === 136 && story[1].kg === 129.3,
    'monthly BP averages pair with monthly weight averages');

  // The figure slims with him — same drawing at t=0, narrower below the
  // neck at t=1, and always the same path structure.
  assert(bodyPathAt(0) === BODY, 'no progress, no change');
  const slim = bodyPathAt(1);
  assert(slim !== BODY && slim.split(',').length === BODY.split(',').length,
    'slimming rescales coordinates, never restructures the path');
  const firstBellyX = Number(/C130,77 115,82 107,93/.test(BODY)) ? 107 : 0;
  assert(slim.includes('116.5,93') || slim.includes('116.6,93'),
    'the shoulder at x=107 moves ~9.5 units toward the centre at t=1');
  assert(slimProgress(133, 103, 129.4) !== null && Math.abs(slimProgress(133, 103, 129.4)! - 0.12) < 0.001,
    '3.6 of 30 kg is 12% of the journey');
  assert(slimProgress(133, 103, null) === null, 'no weigh-in, no figure change');
  void firstBellyX;

  // Strength scoreboard: both windows required, gyms never mix.
  const set = (daysAgo: number, name: string, gym: string, kg: number) => ({
    name, gym, weight: kg, date: new Date(now.getTime() - daysAgo * 86_400_000),
  });
  const holdRows = strengthHold([
    set(5, 'Leg press', 'bfit', 90), set(30, 'Leg press', 'bfit', 90),
    set(4, 'Chest press', 'bfit', 55), set(28, 'Chest press', 'bfit', 50),
    set(3, 'Row', 'bfit', 60), set(29, 'Row', 'bfit', 65),
    set(2, 'Leg press', 'work', 70),
  ], now);
  assert(holdRows.length === 3, 'an exercise seen in only one window stays silent');
  assert(holdRows[0].verdict === 'up' && holdRows[0].name === 'Chest press', 'ups lead the scoreboard');
  assert(holdRows.find((r) => r.name === 'Leg press')!.verdict === 'held', 'same top weight reads held');
  assert(holdRows.find((r) => r.name === 'Row')!.verdict === 'down', 'a slide is named a slide');
}

// ── milestone crossings ──────────────────────────────────────
{
  const now = new Date('2026-09-10T12:00:00');
  const w = (daysAgo: number, kg: number) => ({
    date: new Date(now.getTime() - daysAgo * 86_400_000), weight: kg,
  });
  const cross = recentMilestoneCross([126.4, 120], [w(20,128), w(10,127), w(3,126.2), w(1,126.0)], now);
  assert(cross !== null && cross.kg === 126.4, 'the 5% mark was crossed 3 days ago');
  const two = recentMilestoneCross(
    [120, 118],
    [w(10,121), w(5,119.8), w(3,118.4), w(1,117.9)],
    now,
  );
  assert(two !== null && two.kg === 118,
    'with two crossings in the window, the NEWEST is the news (adversary M2)');
  assert(recentMilestoneCross([126.4], [w(20,128), w(12,126.0), w(1,125.8)], now) === null,
    'a crossing older than the window is history, not news');
  assert(recentMilestoneCross([126.4], [w(2,126.0)], now) === null,
    'one weigh-in cannot witness a crossing');
}

// ── checkpoint pack ──────────────────────────────────────────
{
  const doses = [
    { at: '2026-08-25T19:00:00Z', doseMg: 2.5, site: 'abdomen-right' },
    { at: '2026-09-01T19:00:00Z', doseMg: 2.5, site: 'abdomen-left' },
  ];
  const ledger = doseLedger(doses, [
    { at: '2026-08-27T09:00:00Z', kind: 'nausea', severity: 2 },
    { at: '2026-08-28T09:00:00Z', kind: 'nausea', severity: 1 },
    { at: '2026-09-02T09:00:00Z', kind: 'fatigue', severity: 1 },
    { at: '2026-08-20T09:00:00Z', kind: 'reflux', severity: 3 },
  ]);
  assert(ledger.length === 2 && ledger[0].n === 1 && ledger[1].doseMg === 2.5,
    'every dose gets a numbered ledger row');
  assert(ledger[0].symptoms.length === 1 && ledger[0].symptoms[0].kind === 'nausea'
    && ledger[0].symptoms[0].maxSeverity === 2 && ledger[0].symptoms[0].count === 2,
    'symptoms attach to the dose they followed, worst-first, pre-treatment excluded');
  assert(ledger[1].symptoms[0].kind === 'fatigue',
    'a symptom after dose 2 never blames dose 1');

  const split = bpSplitAroundAnchor(
    [
      { at: '2026-08-10', systolic: 140, diastolic: 90 },
      { at: '2026-08-15', systolic: 138, diastolic: 88 },
      { at: '2026-08-20', systolic: 136, diastolic: 86 },
      { at: '2026-09-02', systolic: 131, diastolic: 84 },
      { at: '2026-09-05', systolic: 129, diastolic: 83 },
    ],
    new Date('2026-08-25T19:00:00Z'),
  );
  assert(split.before !== null && split.before.systolic === 138,
    'pre-treatment BP averages its own side');
  assert(split.since === null, 'two readings since treatment is not yet an average');
}

// ── summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
