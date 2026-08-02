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

// ── homeVerdict ──────────────────────────────────────────────
console.log('homeVerdict');
const sun = new Date(2026, 7, 2, 12, 0); // Sunday — Day A on the schedule
const mon = new Date(2026, 7, 3, 12, 0); // Monday — rest

const returnStatus = getTrainingStatus(realDates, day('2026-07-29T12:00:00Z'));
const vReturn = homeVerdict(returnStatus, 'B', sun);
assert(vReturn.tone === 'return', 'gym day inside the ramp → ember tone');
assert(vReturn.lead === 'TRAIN TODAY', 'gym day leads with TRAIN TODAY');
assert(
  ['Day B', '60%', 'cap Med'].every((p) => vReturn.parts.includes(p)),
  `ramp verdict reads "TRAIN TODAY · ${vReturn.parts.join(' · ')}"`,
);
assert(vReturn.parts.length <= 3 && vReturn.sub !== null, 'one line plus one sub-line, nothing more');

const vRest = homeVerdict(returnStatus, 'B', mon);
assert(vRest.tone === 'rest' && vRest.lead === 'REST', 'Monday → REST');
assert(vRest.parts.join('') === '20 min walk', `rest verdict names the activity (got "${vRest.parts.join('')}")`);
assert(vRest.day === null, 'rest days carry no day accent');

const vNormal = homeVerdict({ mode: 'normal', week: 3 }, 'A', sun);
assert(vNormal.tone === 'train' && vNormal.day === 'A', 'past the ramp → day-accent tone, no ember');
assert(vNormal.parts.includes('Wk 3 BUILD'), `normal verdict carries the phase (got "${vNormal.parts.join(' · ')}")`);

const vNoDay = homeVerdict({ mode: 'normal', week: 3 }, null, sun);
assert(vNoDay.parts.includes('Day A or B'), 'no history yet → verdict still gives an order');

// ── summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
