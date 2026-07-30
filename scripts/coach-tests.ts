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
  learnPinIncrements,
  nextTarget,
  weeklyReport,
  weightTrend,
  type CoachBodyStat,
  type CoachExercise,
  type CoachWorkout,
} from '../src/lib/coach';
import { getTrainingStatus } from '../src/lib/program';

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

// ── weightTrend on the real 4 weigh-ins ──────────────────────
console.log('weightTrend');
const trend = weightTrend(data.bodyStats);
// 132 → 130 kg across the 27 days trailing the last weigh-in ≈ -0.52 kg/week.
assert(trend.classification === 'on_track', `real weigh-ins classify on_track (got ${trend.classification})`);
assert(
  trend.kgPerWeek !== null && trend.kgPerWeek <= -0.5 && trend.kgPerWeek >= -1.3,
  `kgPerWeek in the fat-loss lane (got ${trend.kgPerWeek})`,
);
assert(trend.ema !== null && trend.ema > 128 && trend.ema < 135, `EMA is sane (got ${trend.ema})`);
assert(weightTrend([]).classification === 'no_data', 'empty stats → no_data');

// ── session-based return ramp ────────────────────────────────
console.log('getTrainingStatus (session-based ramp)');
const realDates = data.workouts.map((w) => new Date(w.date));
const day = (iso: string) => new Date(iso);

// 43 days since the last real workout → return week 1.
const s1 = getTrainingStatus(realDates, day('2026-07-29T12:00:00Z'));
assert(s1.mode === 'return' && s1.week === 1, `real history at 2026-07-29 → return week 1 (got ${s1.mode} w${s1.week})`);

// Two sessions logged this week, checked a week later → week 2.
const twoBack = [...realDates, day('2026-07-27T00:00:00Z'), day('2026-07-29T00:00:00Z')];
const s2 = getTrainingStatus(twoBack, day('2026-08-05T12:00:00Z'));
assert(s2.mode === 'return' && s2.week === 2, `2 sessions + 7 days → return week 2 (got ${s2.mode} w${s2.week})`);

// Only one session logged → calendar alone must NOT advance the ramp.
const oneBack = [...realDates, day('2026-07-29T00:00:00Z')];
const s3 = getTrainingStatus(oneBack, day('2026-08-05T12:00:00Z'));
assert(s3.mode === 'return' && s3.week === 1, `1 session + 7 days → still week 1 (got ${s3.mode} w${s3.week})`);

// Sessions can't outrun the calendar: 4 sessions in the first week is still week 1.
const fourFast = [
  ...realDates,
  day('2026-07-27T00:00:00Z'),
  day('2026-07-28T00:00:00Z'),
  day('2026-07-29T00:00:00Z'),
  day('2026-07-30T00:00:00Z'),
];
const s4 = getTrainingStatus(fourFast, day('2026-07-31T12:00:00Z'));
assert(s4.mode === 'return' && s4.week === 1, `4 sessions in 5 days → still week 1 (got ${s4.mode} w${s4.week})`);

// 8 sessions across 4+ calendar weeks → ramp complete, normal mode at REJOIN_AT_WEEK.
const rampDone = [
  ...realDates,
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
const status = getTrainingStatus(realDates, day('2026-07-29T12:00:00Z'));
const report = weeklyReport(data.workouts, data.bodyStats, status, day('2026-07-29T12:00:00Z'));
assert(report.headline.length > 0, 'headline present');
assert(report.headline.includes('Return ramp week 1'), `headline reflects return week 1 (got "${report.headline}")`);
assert(report.wins.some((w) => w.includes('on track')), 'weight trend win surfaces');
assert(report.focus.length > 0, 'focus items present (sessions behind target)');
assert(report.nextSession.some((n) => n.includes('60%')), 'return guidance carries the 60% load');

// ── summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
