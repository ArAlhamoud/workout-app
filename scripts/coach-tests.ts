// Assertions for the coach intelligence layer, run against the REAL
// exported history in data/workout-history.json plus synthetic cases.
//
// Run: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/coach-tests.ts
//
// Exits non-zero on any failure.

import * as fs from 'fs';
import * as path from 'path';
import { nextDoseCaption, initialDoseChoice, injectionTimeOk, journeyStations } from '../src/lib/health-insights';
import { pushWorkoutsToHealth } from '../src/lib/health-push';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cpapAdherence, ownerMonthKey } from '../src/lib/health-insights';
import { cpapAdherenceLabel, monthLabel, pdfSafe, reportAge, signedKg, weighInLabel, weightChangeAr, weightChangeLabel, wrapLines } from '../src/lib/health-format';
import { bpChart, cpapAhiChart, cpapHoursChart, doseChart, layoutChart, weightChart, yScale } from '../src/lib/report-charts';
import { canvasDensity, MAX_CANVAS_PIXELS, ZOOMS } from '../src/lib/pdf-view';
import { adjustedTime, classifyVisit, fmtVisit, gymTimeStats, isStale } from '../src/lib/gym-visits';
import { parsePinKg, offGridWeights, crownStepFor, UNCONFIRMED_CROWN_STEP_KG, stepPlausible } from '../src/lib/pins';
import { foldExerciseMemory, prescribeWorking, prescribeWarmup, prescriptionInputs, planExercises, extraSetAllowed, warmupRowsToDrop, warmupStillDue, untickedWarmupsKept, rampTargetKg, startableUntilFor, settledSet, type ExerciseMemory, type MemorySetRow } from '../src/lib/prescription';
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
  pinMapFor,
  MANUAL_PIN_GYM,
} from '../src/lib/coach';
import {
  alternateDay,
  getDynamicPlan,
  CARDIO,
  cardioForGym,
  getDayTemplate,
  DEFAULT_SESSION_MIN,
  prefillReps,
  getTrainingStatus,
  isTrainingSession,
  pickRampMemory,
  rampBaseBefore,
  lastFullLoad,
  rampPrefillWeight,
  cleanRampSessionDates,
  rampContract,
  parseDayLetter,
  projectPlan,
  rampScaledDayKeys,
  queuedDay,
  recoveryActivity,
  warmupWeight,
  WARMUP_BLOCKS,
  type DynamicPlan,
  type LoggedSession,
  DEFAULT_GYM_ID,
  earnsOverload,
  shortSetVerdict,
  warmupDue,
} from '../src/lib/program';
import {
  isLiveFresh,
  liveKey,
  mergeLiveSets,
  overlayLiveSets,
  sanitizeLiveUpdate,
  setsMissingFrom,
  unionForFinish,
  visibleSets,
  dropRemovedSets,
  mergeCandidates,
  type OverlaySet,
  sanitizeWatchLogSets,
  recordedInHealth,
} from '../src/lib/live-session';
import { dedupeByKey, finishUpdates, landedSerials, liveDiff, liveSerial, liveToAdopt, ownLiveSets, resolveFinishSets, validLiveSets, withEditStamps, type FinishSet, type LiveSet } from '../src/lib/live-session';
import { gymSwap, gymWeightNote } from '../src/lib/gym-equipment';
import { BODY, bodyPathAt, slimProgress } from '../src/lib/body-figure';
import { computeGapLadder } from '../src/lib/gap-guard';
import { assessSickSignal, computeReadiness } from '../src/lib/health-metrics';
import { CARDIO_RULE, afOnChart, clampTimedReps, effortCeiling, getExercisesForDuration, getPlankTarget, nextTryWeight, repeatToEarn, isOverRamp, rampSessionVerdicts, allowedRampKg } from '../src/lib/program';
import { routeForDeepLink } from '../src/lib/deep-links';
import { binHeartRate } from '../src/lib/hr-capture';
import { holdWeekKeys, lifetimeStats, weekStreak } from '../src/lib/streak';
import { lastMonthRecap, yearRecap } from '../src/lib/recap';
import { buildCoachContext, parseCoachBrief, COACH_SYSTEM } from '../src/lib/coach-ai';
import { buildLadderFacts, validateLadderCopy } from '../src/lib/coach-ladder';
import {
  activityDayStr,
  afCorrelates,
  afStats,
  bpAverage,
  ownerActivityDayUtc,
  ownerTodayUtc,
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
  labRefLabel,
  reportLabs,
  ledgerByDose,
  ongoingSymptoms,
  sideEffectRows,
} from '../src/lib/health-insights';
import {
  normalizeSampleType,
  pairBpSamples,
  workoutWindow,
  healthPushWindow,
  planHealthPush,
  healthSourceKind,
  OWN_BUNDLE_ID,
  coveredByExisting,
  parseHealthPayload,
} from '../src/lib/health';

interface HistoryFile {
  exercises: { id: string; name: string; category: string }[];
  workouts: (CoachWorkout & { name: string })[];
  bodyStats: CoachBodyStat[];
}

const historyPath = path.join(__dirname, '..', 'data', 'workout-history.json');
const data = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as HistoryFile;

const pendingAsync: Promise<void>[] = [];
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

/** New assertions read the export as it stood here; the sync bot appends daily. */
const FROZEN_AT = '2026-09-23T09:47:51.194Z'; // that export's exportedAt — end-of-day let rows created after it in (third review)

/** A synthetic history (one machine plus filler) folded the way the server folds it. */
function foldFromRows(ws: Array<{ id: string; date: string; sets: Array<[number, number, number, number | null]> }>, name: string) {
  const rows: MemorySetRow[] = [];
  const evidence = new Map<string, Array<{ rpe: number | null; isWarmup: boolean }>>();
  for (const w of ws) {
    const all = [...w.sets.map(([setNumber, weight, reps, rpe]) => ({ exerciseId: 'm', exerciseName: name, setNumber, weight, reps, rpe })),
      ...[1, 2, 3].map((setNumber) => ({ exerciseId: 'filler', exerciseName: 'Leg Curl', setNumber, weight: 20, reps: 12, rpe: null }))];
    for (const x of all) rows.push({ ...x, workout: { id: w.id, date: new Date(w.date), duration: 2400 } });
    evidence.set(w.id, all.map((x) => ({ rpe: x.rpe, isWarmup: false })));
  }
  rows.sort((a, b) => b.workout.date.getTime() - a.workout.date.getTime() || b.setNumber - a.setNumber);
  return foldExerciseMemory(rows, evidence).m;
}

// ── learnPinIncrements on real history ───────────────────────
console.log('learnPinIncrements');
const learned = learnPinIncrements(data.workouts);
const chestPress = data.exercises.find((e) => e.name === 'Chest Press');
assert(chestPress !== undefined, 'Chest Press exists in exported history');
const chestInc = chestPress ? learned[chestPress.id] : undefined;
// Chest Press rated tops run 29, 27.5, 23, 12.5, 27. No step of 1.25 kg or
// more puts all of them on one ladder, so NOTHING is learned and the pin
// falls back to 2.5 until the owner sets the real one (2026-09-24: "each
// machine different"). The old rule taught 4.5 here from a single jump.
assert(chestInc === undefined, `Chest Press: a log that fits no ladder teaches no pin (got ${chestInc})`);
assert(Object.values(learned).every((v) => v >= 1.25 && v <= 5), 'every learned increment is a real pin step, 1.25–5 kg');

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
console.log('cardio is not training (swim / walk keep the streak only)');
{
  assert(isTrainingSession({ name: 'Day A 45m — Sep 1' }), 'a lettered day is training');
  assert(!isTrainingSession({ name: 'Rescue walk 15m — Sep 1' }), 'a rescue walk is not');
  assert(!isTrainingSession({ name: 'Swim 15m — Sep 2' }), 'a logged swim is not');
  assert(!isTrainingSession({ name: 'Swim 22m' }), 'an imported swim is not');
  assert(!isTrainingSession({ name: 'Walk 20m — Sep 2' }), 'a logged walk is not');
  // A swim yesterday must not turn today into a recovery day.
  const p = getDynamicPlan(
    [{ date: new Date('2026-08-30T00:00:00Z'), name: 'Day A 45m — Aug 30' }, { date: new Date('2026-09-01T00:00:00Z'), name: 'Swim 15m — Sep 1' }],
    new Date('2026-09-02T12:00:00+03:00'),
  );
  assert(p.mode === 'train' && p.day === 'B', `swim yesterday → still train Day B today (got ${p.mode} ${p.day})`);
}

console.log('live session (phone ↔ watch handoff)');
{
  const at = (min: number) => new Date(Date.UTC(2026, 8, 1, 16, min)).toISOString();
  const ls = (ex: string, n: number, w: number, min: number, source: 'phone' | 'watch' = 'phone') => ({
    exerciseId: ex, setNumber: n, reps: 10, weight: w, completedAt: at(min), source,
  });
  // A device owns what it logs; keys the update never mentions survive.
  const m1 = mergeLiveSets([ls('lat', 1, 28, 1)], [ls('lat', 2, 28, 3, 'watch')]);
  assert(m1.length === 2 && m1[1].source === 'watch', 'merge keeps the phone set and adds the watch set');
  // Later completion wins on the same key, whichever device sent it.
  const m2 = mergeLiveSets([ls('lat', 1, 28, 5)], [ls('lat', 1, 21, 2, 'watch')]);
  assert(m2.length === 1 && m2[0].weight === 28, 'an older tick never overwrites a newer one');
  const m3 = mergeLiveSets([ls('lat', 1, 28, 1)], [ls('lat', 1, 21, 4, 'watch')]);
  assert(m3[0].weight === 21 && m3[0].source === 'watch', 'a newer tick replaces the stored set');
  // Un-tick on the phone removes the key.
  const m4 = mergeLiveSets([ls('lat', 1, 28, 1), ls('lat', 2, 28, 2)], [{ exerciseId: 'lat', setNumber: 1, remove: true }]);
  assert(m4.length === 2 && m4.some((x) => x.setNumber === 1 && x.removed) && visibleSets(m4).length === 1 && visibleSets(m4)[0].setNumber === 2, 'remove tombstones exactly that key; clients see one set');
  // Output ordered by completion, not by arrival.
  const m5 = mergeLiveSets([ls('row', 1, 20, 9)], [ls('lat', 1, 28, 2)]);
  assert(m5[0].exerciseId === 'lat' && m5[1].exerciseId === 'row', 'merged sets are ordered by completion');

  // Finishing: the poster's own copy wins, the other device's extras ride along.
  const posted = [{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 28 }];
  const u = unionForFinish(posted, [ls('lat', 1, 21, 1, 'watch'), ls('row', 1, 20, 2, 'watch')]);
  assert(u.length === 2 && u[0].weight === 28 && u[1].exerciseId === 'row', 'finish union: poster wins ties, extras added');

  // Freshness: closed, older than 4 h, or idle 2 h → not live.
  const now = new Date('2026-09-01T18:00:00Z');
  const fresh = { startedAt: '2026-09-01T17:00:00Z', updatedAt: '2026-09-01T17:40:00Z', closedAt: null };
  assert(isLiveFresh(fresh, now), 'an hour-old session touched 20 min ago is live');
  assert(!isLiveFresh({ ...fresh, closedAt: '2026-09-01T17:50:00Z' }, now), 'a closed session is not live');
  assert(!isLiveFresh({ ...fresh, startedAt: '2026-09-01T13:30:00Z' }, now), 'started 4.5 h ago → leftover');
  assert(!isLiveFresh({ ...fresh, updatedAt: '2026-09-01T15:30:00Z' }, now), 'idle 2.5 h → abandoned');

  // Keys: warm-ups live apart from working set 1; the save must keep the
  // template number (renumbering 1..n across a warm-up dropped the Watch's
  // set 2 and doubled the phone's — steward + adversary).
  assert(liveKey({ exerciseId: 'lp', setNumber: 0, isWarmup: true }) !== liveKey({ exerciseId: 'lp', setNumber: 1 }), 'warm-up key never collides with set 1');
  {
    const phone = [
      { exerciseId: 'lp', setNumber: 0, reps: 10, weight: 20, isWarmup: true },
      { exerciseId: 'lp', setNumber: 1, reps: 10, weight: 36 },
    ];
    const watch = [ls('lp', 2, 36, 5, 'watch'), ls('lp', 3, 36, 7, 'watch')];
    const u1 = unionForFinish(phone, watch, 'phone');
    assert(u1.length === 4 && u1.filter((s) => s.setNumber === 2).length === 1, `warm-up + phone set 1 + watch 2,3 → four sets (got ${u1.length})`);
    // Second finisher: the phone posts the same four → nothing to add.
    assert(setsMissingFrom(u1, u1).length === 0, 'a second finish with the same sets adds nothing');
    // …but one the workout lacks is added exactly once.
    assert(setsMissingFrom(u1, [...u1, { exerciseId: 'lp', setNumber: 4, reps: 8, weight: 36 }]).length === 1, 'a set the workout lacks is added once');
    // The poster's own live sets are never re-added (a failed un-tick stays un-ticked).
    const u2 = unionForFinish([{ exerciseId: 'lp', setNumber: 1, reps: 10, weight: 36 }], [ls('lp', 2, 36, 5, 'phone'), ls('lp', 3, 36, 7, 'watch')], 'phone');
    assert(u2.length === 2 && u2[1].setNumber === 3, 'own-source live sets are not resurrected on finish');
  }
  // A row never grows past the cap.
  {
    const many = Array.from({ length: 250 }, (_, i) => ls(`ex${i}`, 1, 10, i));
    assert(mergeLiveSets([], many).length === 200, 'merged sets are capped at 200');
  }

  // Overlay onto logger blocks: by set NUMBER, never array index — the
  // warm-up entry (setNumber 0) at index 0 must stay a warm-up.
  const mk = (n: number, extra: Partial<OverlaySet> = {}): OverlaySet => ({
    exerciseId: 'lat', setNumber: n, reps: 10, weight: 40, done: false, notes: '', rpe: 0, completedAt: null, ...extra,
  });
  const blocks = [{ exerciseId: 'lat', sets: [mk(0, { isWarmup: true, weight: 20 }), mk(1), mk(2), mk(3)] }];
  const ov = overlayLiveSets(blocks, [ls('lat', 1, 21, 1, 'watch'), ls('lat', 2, 21, 2, 'watch')], (id) => ({ exerciseId: id, sets: [] }));
  const lat = ov.blocks[0].sets;
  assert(lat[0].isWarmup === true && !lat[0].done && lat[0].weight === 20, 'warm-up entry untouched by the overlay');
  assert(lat[1].done && lat[1].setNumber === 1 && lat[1].weight === 21 && lat[2].done && lat[2].setNumber === 2, 'sets 1 and 2 ticked by number');
  assert(!lat[3].done && ov.applied.length === 2, 'set 3 pending; two sets applied');
  const ov2 = overlayLiveSets(blocks, [ls('lat', 5, 21, 3, 'watch'), ls('row', 1, 20, 4, 'watch')], (id) => ({ exerciseId: id, sets: [] }));
  assert(ov2.blocks[0].sets.length === 6 && ov2.blocks[0].sets[5].setNumber === 5 && ov2.blocks[0].sets[5].done, 'a set past the template extends the block');
  assert(ov2.blocks[1].exerciseId === 'row' && ov2.blocks[1].sets[0].done, 'an unknown machine gets a block');
  const mine = [{ exerciseId: 'lat', sets: [mk(1, { done: true, completedAt: at(9), weight: 28 })] }];
  const ov3 = overlayLiveSets(mine, [ls('lat', 1, 21, 2, 'watch')], (id) => ({ exerciseId: id, sets: [] }));
  assert(ov3.blocks[0].sets[0].weight === 28 && ov3.applied.length === 0, 'a later local tick beats the live copy');

  // Sanitizer: junk dropped, rpe bounded, remove honoured, source stamped.
  const r9 = sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 28, rpe: 9 }, 'watch');
  assert(r9 !== null && !('remove' in r9) && r9.rpe === undefined, 'rpe 9 is dropped, set kept');
  assert(sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 1, reps: 0, weight: 28 }, 'watch') === null, 'zero reps is junk');
  assert(sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 2, remove: true }, 'phone')?.exerciseId === 'lat', 'remove passes through');
  const st = sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 0 }, 'watch');
  assert(st !== null && !('remove' in st) && st.source === 'watch' && st.weight === 0, 'bodyweight 0 kg is a valid live set');

  // ── A warm-up has to survive the round trip ──────────────────────────
  // The sanitizer's floor was 1, so a warm-up posted to /api/live was
  // dropped and the resuming device showed it unticked — reproducing the
  // "4 sets where the watch showed 3" the warm-up work set out to fix.
  // Both docs claimed warm-ups were already keyed apart end to end; only
  // liveKey was (adversary, 2026-09-18).
  const warm = sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 0, reps: 10, weight: 15, isWarmup: true }, 'watch');
  assert(warm !== null && !('remove' in warm) && warm.isWarmup === true && warm.setNumber === 0, 'a warm-up posts at set 0');
  assert(sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 0, reps: 10, weight: 15 }, 'watch') === null, 'set 0 is still junk when it is NOT a warm-up');
  const wAny = sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 3, reps: 10, weight: 15, isWarmup: true }, 'watch');
  assert(wAny !== null && !('remove' in wAny) && wAny.setNumber === 0, 'a warm-up is pinned to 0 whatever number it arrives with');
  assert(liveKey({ exerciseId: 'lat', setNumber: 0, isWarmup: true }) !== liveKey({ exerciseId: 'lat', setNumber: 1 }), 'warm-up and set 1 are different keys');

  // Overlay: a warm-up ticks the WARM-UP row. Matching it by number would
  // overwrite working set 1 with the 15 kg ramp-in and then save that
  // half-load row to history as real work.
  const wBlocks = [{ exerciseId: 'lat', sets: [mk(0, { isWarmup: true, weight: 15 }), mk(1), mk(2), mk(3)] }];
  const ovW = overlayLiveSets(wBlocks, [{ ...ls('lat', 0, 15, 1, 'watch'), isWarmup: true }], (id) => ({ exerciseId: id, sets: [] }));
  const wl = ovW.blocks[0].sets;
  assert(wl[0].isWarmup === true && wl[0].done && wl[0].weight === 15, 'the warm-up row is the one that ticks');
  assert(!wl[1].done && wl[1].weight === 40, 'working set 1 keeps its own weight and stays untouched');
  assert(ovW.blocks[0].sets.length === 4, 'no phantom row is appended');

  // The other device warmed up on a movement this one has no warm-up row
  // for: keep it rather than drop it, and keep it a warm-up.
  const noWarm = [{ exerciseId: 'lat', sets: [mk(1), mk(2)] }];
  const ovN = overlayLiveSets(noWarm, [{ ...ls('lat', 0, 15, 1, 'watch'), isWarmup: true }], (id) => ({ exerciseId: id, sets: [] }));
  assert(ovN.blocks[0].sets.length === 3 && ovN.blocks[0].sets[0].isWarmup === true && ovN.blocks[0].sets[0].done, 'a warm-up with no row gets one, at the front');
  assert(ovN.blocks[0].sets[1].setNumber === 1 && !ovN.blocks[0].sets[1].done, 'the working sets are not disturbed by it');
}

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
  assert(rampPrefillWeight(picked!, 60) === 17.5, `60% of pre-break 28 → 17.5 (nearest 2.5), not 60% of 17.5 (got ${rampPrefillWeight(picked!, 60)})`);
  assert(rampPrefillWeight(picked!, 100) === 28, 'RESTORE week returns the exact pre-break weight');
  // Pin-floored, same on wrist and phone: Lat Pulldown's learned 7 kg pin.
  const lat = { weight: 40, reps: 10, rpe: null as number | null };
  assert(rampPrefillWeight(lat, 60, 7) === 21 && rampPrefillWeight(lat, 70, 7) === 28 && rampPrefillWeight(lat, 85, 7) === 35, `pin 7: 60→21, 70→28, 85→35 — four distinct steps (got ${rampPrefillWeight(lat, 60, 7)}, ${rampPrefillWeight(lat, 70, 7)}, ${rampPrefillWeight(lat, 85, 7)})`);
  // Since 2026-09-18 an unrated 29 kg base on 9 kg pins holds at three pins (27) — see Tier 1b.
  assert(rampPrefillWeight({ weight: 29 }, 60, 9) === 27, `9 kg pin: 60% of 29 = 18 but the three-pin floor holds 27 (got ${rampPrefillWeight({ weight: 29 }, 60, 9)})`);
  assert(rampPrefillWeight({ weight: 29, rpe: 3 }, 60, 9) === 18, '…unless the base was Hard: then it scales to 18');
  assert(rampPrefillWeight({ weight: 2.5 }, 60, 2.5) === 2.5, 'never below one pin');
  assert(rampPrefillWeight({ weight: 27.5 }, 60) === 17.5, `27.5 × 60% = 16.5 → nearest 2.5 = 17.5 (got ${rampPrefillWeight({ weight: 27.5 }, 60)})`);

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
// Only history up to the pinned 'now': the morning sync appends sessions,
// and a September session leaking into a July report emptied its focus list.
const workoutsToJul29 = data.workouts.filter((w) => new Date(w.date).getTime() <= day('2026-07-29T12:00:00Z').getTime());
const report = weeklyReport(workoutsToJul29, data.bodyStats, status, day('2026-07-29T12:00:00Z'));
assert(report.headline.length > 0, 'headline present');
assert(report.headline.includes('Return ramp week 1'), `headline reflects return week 1 (got "${report.headline}")`);
// Whatever lane the live weigh-ins are in, the trend has to reach the report.
const reportTrend = weightTrend(data.bodyStats, { returning: status.mode === 'return' });
assert(
  [...report.wins, ...report.focus].includes(reportTrend.message),
  `the live weight trend surfaces (${reportTrend.classification})`,
);
// …and the fat-loss lane specifically lands in wins, on a fixed series.
const losingReport = weeklyReport(workoutsToJul29, losingStats, status, day('2026-07-29T12:00:00Z'));
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

// The plan's "today" is HIS activity day (04:00 Riyadh rollover), on any
// server. On 2026-10-02 at 01:30 Riyadh the Train header said Friday while
// the card said "done today" for Thursday's session and the Program strip
// read "Today B ✓ · Fri": Vercel's UTC day rolled over at 03:00 Riyadh, a
// third clock nobody chose. Instants are written with their offset so the
// assertions mean the same thing on the Mac (Riyadh) and in CI (UTC).
{
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const thuWatch = { date: new Date('2026-10-01T00:00:00.000Z'), name: 'Day B — Watch · Oct 1' };
  const at = (hhmm: string) => new Date(`2026-10-02T${hhmm}:00+03:00`);
  const p0130 = getDynamicPlan([thuWatch], at('01:30'));
  assert(p0130.mode === 'done-today' && p0130.daysSinceLast === 0, 'Fri 01:30 Riyadh is still Thursday\'s activity day → done-today');
  const p0330 = getDynamicPlan([thuWatch], at('03:30'));
  assert(p0330.mode === 'done-today' && p0330.daysSinceLast === 0, 'Fri 03:30 Riyadh is STILL Thursday (the day rolls at 04:00, not at UTC midnight)');
  const p0430 = getDynamicPlan([thuWatch], at('04:30'));
  assert(p0430.mode === 'recover' && p0430.daysSinceLast === 1, 'Fri 04:30 Riyadh → a new day: recover');
  const wed = { date: new Date('2026-09-30T00:00:00.000Z'), name: 'Day A 45m' };
  assert(getDynamicPlan([wed], at('01:30')).daysSinceLast === 1, 'a Wednesday session is 1 day ago at Fri 01:30 (activity day Thursday), on any server');
  const strip = projectPlan([thuWatch], at('01:30'), 3);
  const wd = (d: Date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
  assert(strip[0].mode === 'done-today' && wd(strip[1].date) === 'Fri' && wd(strip[2].date) === 'Sat', `the strip after "Today" at Fri 01:30 reads Fri, Sat (got ${wd(strip[1].date)}, ${wd(strip[2].date)})`);
  assert(read('src/app/program/page.tsx').includes("weekday: 'short', timeZone: 'UTC'"), 'the Program strip prints the projected day keys in UTC, the zone they are built in');
  assert(/ownerActivityDayUtc\(\)\.toLocaleDateString\('en-US', \{ weekday: 'long'/.test(read('src/app/train/page.tsx')), 'the Train header names the activity day the plan is judged by');
  // The treatment clock counts HIS calendar days: a Tuesday-evening dose is
  // 3 days ago in the small hours of Friday, not 2 (UTC had not turned yet).
  const dose = [{ at: new Date('2026-09-29T20:00:00+03:00'), doseMg: 5, site: 'abdomen-right' }];
  const tc = treatmentClock(dose as never, DEFAULT_DOSE_PLAN, at('01:30'));
  assert(tc?.daysSinceLast === 3, `a Tue-evening dose is 3 days ago at Fri 01:30 Riyadh (got ${tc?.daysSinceLast})`);
  const home = read('src/app/page.tsx');
  assert(!/todayStart\.setHours/.test(home) && home.includes('ownerActivityDayUtc('), 'Home asks the owner\'s activity day what "today" is, never the server\'s midnight');
  // Status and plan share one clock: at 03:30 Riyadh the status floored a
  // raw instant and said "21 days off → REBOOT" while the plan said 20.
  const seam = new Date('2026-10-01T03:30:00+03:00');
  const lastRow = new Date('2026-09-10T00:00:00.000Z');
  const seamPlan = getDynamicPlan([{ date: lastRow, name: 'Day A 45m' }], seam);
  const seamStatus = getTrainingStatus([lastRow], seam);
  assert(seamPlan.daysSinceLast === 20 && seamStatus.mode !== 'return', `03:30 Riyadh on day 20: the plan says 20 and the status has not called a break (got ${seamPlan.daysSinceLast}, ${seamStatus.mode})`);
  assert(getTrainingStatus([lastRow], new Date('2026-10-01T04:30:00+03:00')).mode === 'return', 'at 04:30 it is day 21: the return block opens');
  for (const f of ['src/app/stats/page.tsx', 'src/app/program/page.tsx']) {
    assert(read(f).includes('getMondayOfWeek(ownerActivityDayUtc())'), `${f} starts the week on his activity day`);
  }
  assert(/now - last\.at < 10_000/.test(read('src/components/DeepLinkHandler.tsx')), 'a cold-launch link re-sent on the ladder navigates once');
  const widget = read('ios/App/WorkoutWidgets/VerdictWidget.swift');
  assert(/activityDay\(savedAt\) == activityDay\(/.test(widget) && !/ageDays/.test(widget), 'the widget serves a cached verdict only inside the activity day it was fetched, always marked');
}

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

// 18 since 2026-09-06: Hip Adduction joined Hip Abduction (same combo machine, 2+2).
assert(allProgramExercises.length === 18, `the program still has 18 movements (got ${allProgramExercises.length})`);

for (const ex of allProgramExercises) {
  // Plank is floor work — it needs no machine at either gym.
  if (ex.name === 'Plank') continue;
  const swap = gymSwap(ex.name, 'work');
  assert(swap !== null, `${ex.name} resolves to equipment at Alrajhi Tower`);
  assert(!!swap && swap.machine.length > 0, `${ex.name} names its Alrajhi machine`);
}

// The five with no machine at all are rebuilt, so they must carry replacement
// cues — the B_Fit cues describe hardware that does not exist there.
for (const name of ['Pec Fly', 'Lateral Raise', 'Rear Delt Fly', 'Back Extension', 'Hip Abduction', 'Hip Adduction']) {
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
  assert(/return ramp/i.test(full[3].title + ' ' + full[3].body), 'day-19 rung warns about the 21-day reset');
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

// ── Watch wave, phase 1: program defaults (trainer rulings 2, 3, 6) ──────
console.log('Watch wave — program defaults');
{
  // R6: a set opens at last session's reps, clamped into the prescribed
  // range for EVERY unit. Triceps prefilled 10 against a 12 minimum on
  // May 30, Sep 1 and Sep 12 because the raw carry kept copying the short
  // set forward — and the short set then blocked progress for good.
  assert(prefillReps(10, 12, 15) === 12, 'a short set never becomes the next prefill — Triceps 10 opens at 12');
  assert(prefillReps(16, 12, 15) === 15, 'reps past the range open at the top of it');
  assert(prefillReps(13, 12, 15) === 13, 'reps inside the range carry unchanged');
  assert(prefillReps(undefined, 12, 15) === 12 && prefillReps(null, 12, 15) === 12, 'no history opens at repsMin');
  // Both producers derive it the same way — the phone logger and the Watch
  // plan (rule 9: the server derives once, the wrist is told).
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert(src('src/lib/prescription.ts').includes('prefillReps(') && src('src/app/api/watch/plan/route.ts').includes('planExercises('), 'the Watch plan derives reps with prefillReps (through planExercises)');
  assert(src('src/components/WorkoutForm.tsx').includes('prefillReps('), 'the phone logger derives reps with prefillReps');

  // R3: a bare Start opens 45 minutes, in the ramp and after it. Every
  // session he has logged was 30 or 45; 60 only adds Lateral Raise to Day A,
  // which he has never logged.
  assert(DEFAULT_SESSION_MIN === 45, 'the default session is 45 minutes');
  assert(!getExercisesForDuration('A', DEFAULT_SESSION_MIN).some((e) => e.name === 'Lateral Raise'), 'the default Day A carries no Lateral Raise — never logged, it would open at 0 kg');
  for (const f of ['src/app/api/watch/plan/route.ts', 'src/app/workouts/new/page.tsx']) {
    assert(!/inRamp \? 45 : 60/.test(src(f)), `${f}: no ramp-dependent 60-minute default`);
  }
  const loggedIds = new Set(data.workouts.flatMap((w) => w.sets.map((st) => st.exerciseId)));
  for (const day of ['A', 'B'] as const) {
    for (const t of getExercisesForDuration(day, DEFAULT_SESSION_MIN)) {
      const id = data.exercises.find((e) => e.name === t.name)?.id;
      assert(id !== undefined && loggedIds.has(id), `Day ${day} default: ${t.name} has logged history`);
    }
  }

  // R2: Pec Fly is 3 sets. He did 3 in 5 of 7 sessions; a prescription he
  // routinely overrides teaches him the numbers are optional.
  assert(getDayTemplate('A').exercises.find((e) => e.name === 'Pec Fly')?.sets === 3, 'Pec Fly is prescribed 3 sets');
}

// ── Watch wave, phase 1: the watch-log sanitizer, one session per day ───
console.log('Watch wave — watch log sets and session counting');
{
  // The route validated sets inline and dropped each set's time, so every
  // Watch set reached the merge as "no stamp" and lost to any removal the
  // phone had recorded. It also let two sets with one key through, which the
  // unique index turns into a 500 on EVERY retry — a permanent wedge that
  // holds up every later session in the Watch outbox (watch-map, 2026-09-24).
  const iso = '2026-09-25T18:04:05.000Z';
  const t = sanitizeWatchLogSets([
    { exerciseId: 'a', setNumber: 1, reps: 10, weight: 30, completedAt: iso },
    { exerciseId: 'a', setNumber: 2, reps: 10, weight: 30, completedAt: 'not a date' },
  ]);
  assert(t.length === 2 && t[0].completedAt === iso, 'a set time the client sends is kept — the Watch build that sends one is phase 4; the current build sends none');
  assert(t.length === 2 && t[1].completedAt === undefined, 'a garbage set time is dropped, the set is kept');
  const w = sanitizeWatchLogSets([
    { exerciseId: 'a', setNumber: 0, reps: 10, weight: 15, isWarmup: true },
    { exerciseId: 'a', setNumber: 0, reps: 10, weight: 15 },
    { exerciseId: 'b', setNumber: 3, reps: 10, weight: 15, isWarmup: true },
  ]);
  assert(w.length === 2 && w.every((x) => x.isWarmup && x.setNumber === 0), `set 0 is a warm-up or nothing: an unflagged set 0 is dropped, a flagged warm-up is pinned to 0 (got ${JSON.stringify(w)})`);
  const d = sanitizeWatchLogSets([
    { exerciseId: 'a', setNumber: 1, reps: 10, weight: 30 },
    { exerciseId: 'a', setNumber: 1, reps: 12, weight: 30 },
  ]);
  assert(d.length === 1 && d[0].reps === 12, 'duplicate keys collapse, last wins — never a permanent 500 on the unique index');
  const n = sanitizeWatchLogSets([{ exerciseId: 'a', reps: 10, weight: 30 }, { exerciseId: 'a', reps: 10, weight: 30 }]);
  assert(n.length === 2 && n[0].setNumber === 1 && n[1].setNumber === 2, 'a set with no number still gets its position, as before');
  assert(sanitizeWatchLogSets('junk').length === 0 && sanitizeWatchLogSets([{ exerciseId: 'a', reps: 0, weight: 30 }]).length === 0, 'junk input and impossible reps are dropped, never fatal');
  const route = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/watch/log/route.ts'), 'utf8');
  assert(route.includes('sanitizeWatchLogSets('), 'the Watch log route uses the shared sanitizer');

  // F3 (trainer): the ramp counts ONE session per activity day. It counted
  // rows, so one real session plus a same-day duplicate row (a Watch finish
  // and a phone replay under another id) advanced him a phase early. Built on
  // a FIXED block — "real history plus one session" breaks the day the sync
  // bot lands the next real one (see the preBreak note; steward review).
  const block = [...preBreak, day('2026-08-10T00:00:00Z'), day('2026-08-14T00:00:00Z'), day('2026-08-22T00:00:00Z')];
  const at = day('2026-09-01T12:00:00Z');
  const once = getTrainingStatus(block, at);
  const fourth = getTrainingStatus([...block, day('2026-08-23T00:00:00Z')], at);
  const twice = getTrainingStatus([...block, day('2026-08-22T00:00:00Z')], at);
  assert(once.mode === 'return' && fourth.week === once.week + 1, `a genuine fourth session DOES advance this block (week ${once.week} -> ${fourth.week}), so it can tell a duplicate apart`);
  assert(twice.week === once.week, `a same-day duplicate row does not advance the ramp (week ${once.week}, with a duplicate: ${twice.week})`);
}

// ── Watch wave, phase 1: Apple Health write-through (A4), source kind (A5) ─
console.log('Watch wave — Apple Health write-through');
{
  // Frozen at the 2026-09-23 export: the sync bot appends rows daily, and a
  // sweep over "every row" breaks the day a back-dated entry lands (steward).
  type Row = { name: string; date: string; duration: number | null; createdAt: string; sets: Array<{ completedAt?: string | null }> };
  // Frozen by CREATION time: a session typed in later with a past date is a
  // new row, and filtering on its date let it in (second review).
  const rows = (data.workouts as unknown as Row[]).filter((w) => String(w.createdAt) <= FROZEN_AT);
  const rowOf = (name: string) => rows.find((w) => w.name === name)!;
  const stampsOf = (w: Row) => w.sets.map((st) => st.completedAt).filter((x): x is string => !!x).sort();
  const inputOf = (w: Row) => ({ date: new Date(w.date), duration: w.duration, createdAt: new Date(w.createdAt), setTimes: stampsOf(w).map((x) => new Date(x)) });
  const win = (x: { start: Date; end: Date } | null) => (x ? `${x.start.toISOString()} – ${x.end.toISOString()}` : 'null');
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

  // Stamped sets ARE the session: first set − 5 min (setup, warm-up) to the
  // last set. A late Save or an offline replay moves createdAt, and the
  // form's duration runs from open to Save, so any duration-based window
  // stretched a late save backwards into a 2-hour session (adversary).
  const p12 = healthPushWindow(inputOf(rowOf('Day B 45m — Sep 12')));
  assert(win(p12) === '2026-09-12T20:01:10.112Z – 2026-09-12T20:41:04.453Z', `Sep 12 goes to Health from its sets, 23:01–23:41 Riyadh (got ${win(p12)})`);
  const p17 = healthPushWindow(inputOf(rowOf('Day A 45m — Sep 17')));
  assert(win(p17) === '2026-09-17T20:45:45.412Z – 2026-09-17T21:35:42.313Z', `Sep 17 goes to Health from its sets (got ${win(p17)})`);
  // A sitting: a set every 4 minutes from `from` to `to`.
  const sitting = (from: string, to: string) => {
    const a = Date.parse(from), b = Date.parse(to), out: Date[] = [];
    for (let t = a; t < b; t += 4 * 60_000) out.push(new Date(t));
    out.push(new Date(b));
    return out;
  };
  const setsAt = (from: string, to: string) => ({ setTimes: sitting(from, to) });
  const day20 = new Date('2026-09-20T00:00:00.000Z');
  const late = healthPushWindow({ date: day20, duration: 7200, createdAt: new Date('2026-09-20T18:00:00.000Z'), ...setsAt('2026-09-20T16:05:00.000Z', '2026-09-20T16:45:00.000Z') });
  assert(win(late) === '2026-09-20T16:00:00.000Z – 2026-09-20T16:45:00.000Z', `a Save tapped 75 min late is not stretched into a 2-hour session (got ${win(late)})`);
  const replay = healthPushWindow({ date: day20, duration: 2460, createdAt: new Date('2026-09-20T20:00:00.000Z'), ...setsAt('2026-09-20T16:05:00.000Z', '2026-09-20T16:45:00.000Z') });
  assert(win(replay) === win(late), `an offline replay lands on the same real window (got ${win(replay)})`);
  // Unstamped (the logger before set times existed): it ended at the Save.
  const may13 = healthPushWindow(inputOf(rowOf('Day A 45m — May 13')));
  assert(win(may13) === '2026-05-13T19:24:49.483Z – 2026-05-13T20:08:35.483Z', `an unstamped row ends at its Save (got ${win(may13)})`);
  // Never invent a clock time.
  assert(healthPushWindow({ date: new Date('2026-09-10T00:00:00.000Z'), duration: 2400, createdAt: new Date('2026-09-13T20:00:00.000Z'), setTimes: [] }) === null, 'a back-dated entry gets no invented time — it is not pushed');
  assert(healthPushWindow({ date: new Date('2026-09-10T00:00:00.000Z'), duration: 2400, createdAt: new Date('2026-09-13T20:10:00.000Z'), ...setsAt('2026-09-13T20:00:00.000Z', '2026-09-13T20:09:00.000Z') }) === null, 'sets ticked while typing a past session in are not its clock time either');
  // A window is bounded (second review: one stray tick made a 13- to 25-hour
  // "workout" in Health). Ticks split into sittings at 30-minute gaps; the
  // session is the sitting with the most sets; nothing runs past 3 h.
  const d22 = new Date('2026-09-22T00:00:00.000Z');
  const stray = healthPushWindow({ date: d22, duration: 10800, createdAt: new Date('2026-09-22T16:46:00.000Z'), setTimes: [new Date('2026-09-22T04:00:00.000Z'), ...sitting('2026-09-22T16:00:00.000Z', '2026-09-22T16:45:00.000Z')] });
  assert(win(stray) === '2026-09-22T15:55:00.000Z – 2026-09-22T16:45:00.000Z', `a stray morning tick does not stretch the evening session to 13 hours (got ${win(stray)})`);
  const loneLate = healthPushWindow({ date: d22, duration: 10800, createdAt: new Date('2026-09-22T19:01:00.000Z'), setTimes: [...sitting('2026-09-22T15:00:00.000Z', '2026-09-22T15:45:00.000Z'), new Date('2026-09-22T19:00:00.000Z')] });
  assert(win(loneLate) === '2026-09-22T14:55:00.000Z – 2026-09-22T15:45:00.000Z', `a set ticked late at Save does not extend the session (got ${win(loneLate)})`);
  const twoDays = [...sitting('2026-09-20T15:00:00.000Z', '2026-09-20T15:20:00.000Z'), ...sitting('2026-09-21T15:00:00.000Z', '2026-09-21T15:30:00.000Z')];
  assert(healthPushWindow({ date: day20, duration: 10800, createdAt: new Date('2026-09-21T15:31:00.000Z'), setTimes: twoDays }) === null, 'a draft finished the next day but dated the first: the sets contradict the date — nothing is invented');
  const redated = healthPushWindow({ date: new Date('2026-09-21T00:00:00.000Z'), duration: 10800, createdAt: new Date('2026-09-21T15:31:00.000Z'), setTimes: twoDays });
  assert(win(redated) === '2026-09-21T14:55:00.000Z – 2026-09-21T15:30:00.000Z', `dated the day he finished it, it goes in at the real sitting (got ${win(redated)})`);
  const marathon = healthPushWindow({ date: d22, duration: 10800, createdAt: new Date('2026-09-22T16:01:00.000Z'), setTimes: sitting('2026-09-22T12:00:00.000Z', '2026-09-22T16:00:00.000Z') });
  assert(marathon !== null && marathon.end.getTime() - marathon.start.getTime() <= 3 * 3_600_000, `no pushed session runs past 3 hours (got ${win(marathon)})`);
  const early = healthPushWindow({ date: d22, duration: 3000, createdAt: new Date('2026-09-22T01:50:00.000Z'), setTimes: sitting('2026-09-22T01:02:00.000Z', '2026-09-22T01:45:00.000Z') });
  assert(win(early) === '2026-09-22T01:00:00.000Z – 2026-09-22T01:45:00.000Z', `a first set at 04:02 Riyadh is still pushed — the lead-in is clamped at the 04:00 rollover (got ${win(early)})`);

  for (const w of rows.filter((r) => r.sets.length)) {
    const p = healthPushWindow(inputOf(w));
    const d0 = new Date(w.date).getTime();
    assert(
      p !== null && !p.start.toISOString().endsWith('T00:00:00.000Z') && p.start.getTime() >= d0 + 3_600_000 && p.start.getTime() < d0 + 25 * 3_600_000,
      `${w.name}: pushed at a real clock time inside its activity day (got ${win(p)})`,
    );
  }

  // The heart-rate match uses the SAME window as the push, so what the push
  // reads and what the match accepts never disagree (adversary: a replayed
  // session's HR fell outside the match window and a cuff pulse filled it).
  const sep17 = rowOf('Day A 45m — Sep 17');
  assert(win(workoutWindow(inputOf(sep17))) === win(p17), 'the heart-rate match window is the push window');
  const bare17 = workoutWindow({ date: new Date(sep17.date), duration: sep17.duration, createdAt: new Date(sep17.createdAt) });
  assert(bare17.start.toISOString() === '2026-09-17T20:44:38.971Z', `without set times the window ENDS at the Save (got ${bare17.start.toISOString()})`);
  const past = workoutWindow({ date: new Date('2026-09-10T00:00:00.000Z'), duration: 2400, createdAt: new Date('2026-09-13T20:00:00.000Z') });
  assert(past.start.getTime() === past.end.getTime(), 'a back-dated row matches no samples at all (zero-length window)');

  // What gets pushed: strength sessions only, at their real time.
  const plan = planHealthPush(rows.map((w, i) => ({ id: String(i), name: w.name, ...inputOf(w), setCount: w.sets.length })), new Date('2026-09-24T12:00:00.000Z'));
  // A session is written only once it is 12 h old. Finished on the phone
  // while the Watch is still recording, the Watch saves its own copy on the
  // next wrist raise; writing at once duplicated it (second review). Waiting
  // lets that copy land, and the push then finds it and writes nothing.
  const fresh = { id: 'f', name: 'Day B', date: d22, duration: 2700, createdAt: new Date('2026-09-22T16:46:00.000Z'), setTimes: sitting('2026-09-22T16:00:00.000Z', '2026-09-22T16:45:00.000Z'), setCount: 12 };
  assert(planHealthPush([fresh], new Date('2026-09-22T18:46:00.000Z')).length === 0, 'a session saved 2 h ago is not written yet');
  assert(planHealthPush([fresh], new Date('2026-09-23T05:00:00.000Z')).length === 1, 'the same session is written once it is 12 h old');
  assert(plan.every((x) => !/^(Swim|Walk)\b/.test(x.name)), 'cardio quick-logs (no sets) are never written to Health as strength training');
  assert(plan.length === rows.filter((r) => r.sets.length).length, `every frozen strength session has an honest push window (${plan.length})`);
  const ah = src('src/app/health-actions.ts');
  assert(/orderBy:\s*\{\s*date:\s*'desc'\s*\}/.test(ah) && /take:\s*\w+/.test(ah) && ah.includes('planHealthPush(') && /createdAt:\s*\{\s*lte:/.test(ah), 'the push query is newest-first, capped, waits out the delay, and goes through planHealthPush');

  // Never write a workout Health already holds — from ANY source: Apple's
  // Workout app, the Watch app (it saves on its own, even when it posted
  // nothing), or an earlier push whose mark failed (adversary).
  const w45 = { start: Date.parse('2026-09-20T16:00:00Z'), end: Date.parse('2026-09-20T16:45:00Z') };
  const hk = (a: string, b: string, activityType = 'traditionalStrengthTraining') => ({ startISO: a, endISO: b, activityType });
  assert(coveredByExisting(w45, [hk('2026-09-20T15:58:00Z', '2026-09-20T16:47:00Z')]), 'an Apple Workout session over the same time → already in Health');
  assert(coveredByExisting(w45, [hk('2026-09-20T16:10:00Z', '2026-09-20T16:40:00Z')]), 'a Watch-app session covering most of it → already in Health');
  assert(!coveredByExisting(w45, [hk('2026-09-20T15:30:00Z', '2026-09-20T16:10:00Z')]), 'a walk that only brushes the start is a different workout');
  assert(!coveredByExisting(w45, []), 'nothing in Health over that time → write it');
  assert(!coveredByExisting(w45, [hk('2026-09-20T15:40:00Z', '2026-09-20T17:30:00Z', 'walking')]), 'a walk left running over the session is not the session — only a strength workout counts (second review)');
  assert(coveredByExisting(w45, [hk('2026-09-20T16:00:00Z', '2026-09-20T16:45:00Z', 'functionalStrengthTraining')]), 'functional strength counts as strength');
  // ONE definition of "a gym session in Health": the detector already hid
  // HIIT and Core Training as the session he logged; the push ignored them
  // and wrote a second copy on top (third review).
  assert(coveredByExisting(w45, [hk('2026-09-20T15:58:00Z', '2026-09-20T16:47:00Z', 'highIntensityIntervalTraining')]) && coveredByExisting(w45, [hk('2026-09-20T15:58:00Z', '2026-09-20T16:47:00Z', 'coreTraining')]), 'HIIT and Core Training recordings are the session too');
  const detect = src('src/lib/health-detect.ts');
  assert(!/const STRENGTH_TYPES/.test(detect) && detect.includes('isStrengthActivity('), 'the session detector uses the one shared strength rule');
  for (const f of ['src/components/HealthAutoPilot.tsx', 'src/components/NativeHealthCard.tsx']) {
    const c = src(f);
    assert(c.includes('pushWorkoutsToHealth(') && !c.includes('saveWorkout('), `${f}: writes to Health only through the one guarded helper`);
  }
  // The push sends the window's REAL max. A lone averaged sample filled
  // Workout.maxHr with the average, for good (steward).
  const parsed = parseHealthPayload([{ type: 'heart_rate', value: 118, max: 151, unit: 'count/min', date: '2026-09-20T16:00:00Z' }]);
  assert(parsed.samples[0]?.max === 151, 'an imported heart-rate sample keeps its max');
  assert(/max:\s*stats\.maxHr/.test(src('src/lib/health-push.ts')), 'the push enrichment carries the window max, not the average');

  // "Already in Health" is stamped only on PROOF an HKWorkout was saved: its
  // uuid came back. Who opened the row, or which device finished it, proves
  // nothing — the Watch may have discarded its recording or saved nothing,
  // and a stamp then hid the session from Health for good. Everything else
  // waits out the delay, then is written only if Health holds nothing there.
  assert(recordedInHealth({ healthWorkoutUuid: 'abc' }), 'an HKWorkout uuid → already in Health');
  assert(!recordedInHealth({ healthWorkoutUuid: null }), 'no uuid — the Watch may have saved nothing (sharing off, end() timed out) — so the push checks Health after its delay instead of trusting it (second review)');
  assert((src('src/app/actions.ts').match(/recordedInHealth\(/g) ?? []).length >= 2, 'createWorkout stamps the Health fact on both the create and the merge path');

  // A5: one source rule. The Stats card matched the bundle id EXACTLY and
  // the Home banner by PREFIX, so the Watch app's own workouts were offered
  // as "trained without the app" on one screen and hidden on the other.
  assert(healthSourceKind(OWN_BUNDLE_ID) === 'phone', 'the app itself is phone');
  assert(healthSourceKind(`${OWN_BUNDLE_ID}.watchkitapp`) === 'watch', 'the Watch app is watch');
  assert(healthSourceKind(`${OWN_BUNDLE_ID}s`) === 'foreign' && healthSourceKind('com.apple.health.X') === 'foreign' && healthSourceKind(undefined) === 'foreign', 'anything else — including a lookalike prefix — is foreign');
  for (const f of ['src/components/NativeHealthCard.tsx', 'src/components/health/DetectedSessionBanner.tsx']) {
    const c = src(f);
    assert(!/const OWN_BUNDLE_ID/.test(c) && c.includes('healthSourceKind('), `${f}: uses the shared source rule, no private bundle id`);
  }
  const banner = src('src/components/health/DetectedSessionBanner.tsx');
  assert(!/function localDayOf/.test(banner) && banner.includes('activityDayStr('), 'the banner dates a session by the activity day (a 00:30 start belongs to the day before), like the Stats card');
}

// ── Watch wave, phase 1: the weigh-in import stays one day (third review) ───
console.log('Watch wave — weigh-in import');
{
  // A heart-rate fix meant for enrichWorkouts landed in the weigh-in import:
  // the day lookup widened a day back, so each sync overwrote YESTERDAY's
  // weigh-in with today's and dragged rows forward — the one weight store the
  // Mounjaro trend reads. No test touched it. These guard both ends.
  const hi = fs.readFileSync(path.join(__dirname, '..', 'src/lib/health-import.ts'), 'utf8');
  const bodyImport = hi.slice(hi.indexOf('async function upsertBodyStats'), hi.indexOf('async function enrichWorkouts'));
  const enrich = hi.slice(hi.indexOf('async function enrichWorkouts'));
  assert(bodyImport.length > 0 && /where:\s*\{\s*date:\s*\{\s*gte:\s*start,\s*lt:\s*end\s*\}\s*\}/.test(bodyImport) && !bodyImport.includes('86_400_000'), 'the weigh-in import matches exactly one day — never yesterday\'s row');
  assert(enrich.includes('86_400_000'), 'the heart-rate match looks one day back (a 03:00–04:00 Riyadh session belongs to the previous activity day)');
}

// ── Watch wave, phase 2: the owner sets each machine's real step ──────────
console.log('Watch wave — machine steps (the setter)');
{
  // What he types on the phone. His words: "each machine different" — the
  // learner cannot recover coarse stacks from his log, so he says.
  const ok = (raw: string | number | null) => { const r = parsePinKg(raw); return r.ok ? r.kg : 'ERR'; };
  assert(ok('9') === 9 && ok('4.5') === 4.5 && ok('1.25') === 1.25 && ok(' 5 ') === 5, 'real steps are accepted as typed');
  assert(ok('2,5') === 2.5, 'a comma decimal is a decimal');
  assert(ok('') === null && ok(null) === null, 'blank clears his step (back to learned / 2.5)');
  assert(ok('0.25') === 'ERR' && ok('30') === 'ERR' && ok('2.3') === 'ERR' && ok('abc') === 'ERR' && ok('-5') === 'ERR', 'impossible steps are refused: under 0.5, over 25, not a quarter-kilo, not a number');
  // A warning, never a block: his own log can contradict the step he types.
  assert(JSON.stringify(offGridWeights([20, 27, 29], 9)) === '[27]', `27 and 29 cannot both be on a 9 kg stack — 27 is flagged (got ${JSON.stringify(offGridWeights([20, 27, 29], 9))})`);
  assert(offGridWeights([20, 25, 30, 35], 5).length === 0, 'a log that fits the step raises nothing');
  assert(offGridWeights([], 5).length === 0, 'no history, no warning');

  // Rule 2: his step describes the B_Fit stack. At Alrajhi it must not apply.
  assert(MANUAL_PIN_GYM === DEFAULT_GYM_ID, 'the manual step belongs to the home gym');
  const setEx = { id: 'set-ex', name: 'Set Test', category: 'LEGS' } as CoachExercise;
  assert(pinMapFor([], [{ id: setEx.id, pinIncrement: 9 }], MANUAL_PIN_GYM)(setEx.id) === 9, 'at B_Fit his step wins');
  assert(pinMapFor([], [{ id: setEx.id, pinIncrement: 9 }], 'work')(setEx.id) === 2.5, 'at Alrajhi his B_Fit step does not leak (rule 2)');
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  // Every pin map is built in ONE place (prescriptionInputs) and told its gym.
  assert(/pinMapFor\([\s\S]*?exercises,\s*gym\)/.test(src('src/lib/prescription.ts')), 'prescriptionInputs builds the pin map for the gym it was asked about');
  for (const f of ['src/app/actions.ts', 'src/app/workouts/new/page.tsx', 'src/app/train/page.tsx', 'src/app/api/watch/plan/route.ts']) {
    assert(!src(f).includes('pinMapFor('), `${f}: no pin map of its own — it reads prescriptionInputs`);
    assert(/prescriptionInputs\([^)]*,\s*(gym|DEFAULT_GYM_ID)\)/.test(src(f)), `${f}: prescription inputs are told which gym they are for`);
  }

  // The Watch crown steps by HIS step once he has set it; until then 0.5 kg,
  // so it can land on any weight he really lifted (trainer ruling 4) — 29 and
  // 30 are unreachable from 27 on any 2.5 grid.
  assert(crownStepFor(9) === 9 && crownStepFor(null) === UNCONFIRMED_CROWN_STEP_KG && crownStepFor(0) === UNCONFIRMED_CROWN_STEP_KG, 'crown step: his step, else fine');
  assert(UNCONFIRMED_CROWN_STEP_KG === 0.5, 'an unconfirmed machine steps 0.5 kg on the crown');
  const route = src('src/app/api/watch/plan/route.ts');
  assert(route.includes('crownStepKg') && route.includes('crownStepFor('), 'the Watch plan sends the crown step');
  const act = src('src/app/actions.ts');
  assert(/export async function setMachinePin\(/.test(act) && act.includes('parsePinKg('), 'the phone can set a machine\'s step, validated');
}

// ── Watch wave, phase 2 review fixes ──────────────────────────────────────
console.log('Watch wave — phase 2 review fixes');
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

  // A1 / F1 / DS-1 (blocker): his B_Fit step reached the phone logger at
  // Alrajhi — the page built one home-gym map and the gym switch kept it, so
  // the phone prescribed with his 9 kg while the save-time judge (and the
  // Watch) used Alrajhi's 2.5: a session done exactly as prescribed was
  // judged over-ramp, for good. The switch now brings THAT gym's pins.
  const gm = src('src/app/actions.ts');
  const gmBody = gm.slice(gm.indexOf('export async function getGymMemory('), gm.indexOf('export async function getRecentExerciseSessions('));
  assert(/rampSnapshot\(gym\)/.test(gmBody) && /pins\[/.test(gmBody) && /return \{[^}]*pins/.test(gmBody), 'getGymMemory returns the tagged gym\'s own pin map');
  const form = src('src/components/WorkoutForm.tsx');
  const body = form.slice(form.indexOf('export default function WorkoutForm'));
  assert(!/pinIncrements\[/.test(body), 'inside the logger no read of the home-gym pin prop — every step reads the tagged gym\'s pins');
  assert(/setPins\(gymPins\)/.test(body), 'the gym switch installs the new building\'s pins');
  const hx = { id: 'hx', name: 'Leg Extension', category: 'LEGS' } as CoachExercise;
  const workIn = prescriptionInputs([], [{ id: hx.id, pinIncrement: 9 }], 'work');
  const homeIn = prescriptionInputs([], [{ id: hx.id, pinIncrement: 9 }], DEFAULT_GYM_ID);
  assert(workIn.pinFor(hx.id) === 2.5 && homeIn.pinFor(hx.id) === 9, 'his 9 kg step prescribes at B_Fit only');
  assert(workIn.stepIsHis(hx.id) === false && homeIn.stepIsHis(hx.id) === true, 'and his ladder is anchored only where the step is his');

  // B1 / F4: once the step is his, ramp and warm-up weights snapped to
  // multiples of the step counted from ZERO — off every plate on a stack
  // that starts at an offset (Chest Press 23 / 27.5 on 4.5; plates 5, 12.5,
  // 20, 27.5, 35 on 7.5). The ladder now runs through a weight he lifted.
  assert(rampPrefillWeight({ weight: 23, rpe: null }, 85, 4.5, true) === 18.5, `Chest Press 23 on his 4.5 ladder at 85% opens at 18.5, a real plate (got ${rampPrefillWeight({ weight: 23, rpe: null }, 85, 4.5, true)})`);
  assert(rampPrefillWeight({ weight: 23, rpe: null }, 85, 4.5) === 18, 'without his step the zero-based grid is unchanged (18)');
  assert(rampPrefillWeight({ weight: 35, rpe: 2 }, 60, 7.5, true) === 20 && rampPrefillWeight({ weight: 35, rpe: 2 }, 85, 7.5, true) === 27.5, `35 on a 7.5 ladder: 20 at 60%, 27.5 at 85% (got ${rampPrefillWeight({ weight: 35, rpe: 2 }, 60, 7.5, true)} / ${rampPrefillWeight({ weight: 35, rpe: 2 }, 85, 7.5, true)})`);
  assert(warmupWeight(27.5, 4.5, true) === 14 && warmupWeight(35, 7.5, true) === 12.5, `warm-ups land on his plates too (got ${warmupWeight(27.5, 4.5, true)} / ${warmupWeight(35, 7.5, true)})`);
  assert(warmupWeight(5, 7.5, true) === null, 'a working weight on the bottom plate has no lighter warm-up');
  let rungs = 0;
  for (const p of [2, 4.5, 5, 7.5, 9, 10]) for (let w = p; w <= 90; w += 0.5) for (const pct of [60, 70, 85]) for (const rpe of [null, 2, 3]) {
    const got = rampPrefillWeight({ weight: w, rpe }, pct, p, true);
    const steps = (w - got) / p;
    rungs++;
    assert(Math.abs(steps - Math.round(steps)) < 1e-6 && got > 0 && got <= w, `ramp ${w}@${pct}% on a ${p} ladder lands on a rung (${got})`);
    const allowed = allowedRampKg({ weight: w, rpe }, pct, p, true);
    assert(allowed != null && got <= allowed + 1e-9, `the anchored prescription is inside its own anchored allowance (${got} ≤ ${allowed})`);
    const warm = warmupWeight(got, p, true);
    assert(warm == null || (warm < got && Math.abs((got - warm) / p - Math.round((got - warm) / p)) < 1e-6), `the anchored warm-up is a lighter rung (${warm} under ${got})`);
  }
  assert(rungs > 1000, `the ladder sweep covered ${rungs} cases`);
  const chest = { weight: 23, reps: 10, rpe: null };
  const pAnch = prescribeWorking({ unit: 'reps', sets: 3, repsMin: 10, repsMax: 12 }, chest, 4.5, null, { rampPct: 85, rescue: false, anchored: true });
  assert(pAnch.workingKg === 18.5 && prescribeWarmup(pAnch, 'reps', 4.5, false, true) === 9.5, `the one prescription carries the anchor (got ${pAnch.workingKg} / ${prescribeWarmup(pAnch, 'reps', 4.5, false, true)})`);
  assert(/allowedRampKg\(m, status\.returnWeek\.loadPct, pinFor\(id\), (inputs|snap)\.stepIsHis\(id\)\)/.test(gm), 'the save-time judge uses the same anchored ladder');

  // F2: a missed decimal (25 for 2.5) was accepted.
  assert(stepPlausible(25, 20) !== null && /2\.5/.test(stepPlausible(25, 20)!), `25 on a machine he lifts 20 on is refused, with the decimal it probably meant (got ${stepPlausible(25, 20)})`);
  assert(stepPlausible(12.5, 8.75) !== null && /1\.25/.test(stepPlausible(12.5, 8.75)!), '12.5 for 1.25 on Face Pull is refused too');
  assert(stepPlausible(9, 29) === null && stepPlausible(4.5, 23) === null, 'real steps pass');
  assert(stepPlausible(15, null) === null && stepPlausible(15, 0) === null, 'no history on the machine, nothing to check against');
  assert(/export async function setMachinePin\([^)]*force/.test(gm) && gm.includes('stepPlausible('), 'the setter checks plausibility, and he can still insist');

  // F5: on a coarse stack, +1 pin waited for nothing but repsMin — the step
  // he typed set the size of the jump (29 → 38 at 12 reps). The Try chip
  // must agree with the seed: reps to the top of the range first.
  assert(nextTryWeight({ weight: 29, reps: 12, rpe: 1, overload: true, repsFloor: 12 }, 9, 12, 15) === null, 'a 9 kg step on 29 (31%) offers nothing until every set reached 15');
  assert(nextTryWeight({ weight: 29, reps: 15, rpe: 1, overload: true, repsFloor: 15 }, 9, 12, 15) === 38, 'at 15 on every set it offers the step');

  // E1 / DT1 / DT2 — the step card.
  const card = src('src/components/MachinePinCard.tsx');
  assert(!card.includes('The watch crown and the +1 pin move by it.'), 'the ⓘ no longer promises a crown stride the Watch does not use on an unset machine');
  assert(/try \{[\s\S]*?await setMachinePin\([\s\S]*?\} catch/.test(card), 'a failed save stays on the card as an error, never the root error screen');
  assert(/min-h-\[44px\]/.test(card) && /Tap again to clear|clear\?/i.test(card), 'card controls are 44 pt and Clear asks twice');
}

// ── Watch wave, phase 4: the Watch build, checked on the SOURCE in CI ─────
// Ubuntu CI cannot compile the watch target; the pure core runs under
// `npm run test:watch` on the Mac. These guards hold the lines that were
// bugs on the wrist, in plain text.
console.log('Watch wave — the Watch build (source guards)');
{
  const dir = path.join(__dirname, '..', 'ios', 'App', 'WatchApp');
  const swift = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  const views = swift('Views.swift');
  // The crown counts detents; kilograms never enter the modifier (B7).
  const crowns = views.match(/\.digitalCrownRotation\([\s\S]*?\)/g) ?? [];
  assert(crowns.length >= 2, `found the crown modifiers (${crowns.length})`);
  assert(crowns.every((c) => /detent:\s*\$detent/.test(c) && /by:\s*1\b/.test(c)), 'every crown counts detents one at a time');
  assert(crowns.every((c) => !/pinKg|weightKg|reps/.test(c)), 'no crown modifier holds a weight or a rep count — no grid counted from 0 to snap back to');
  assert(!/crownWeight|onChange\(of: slot\.id\)/.test(views), 'no Double copy of the weight in the card to fight the store');
  assert(/restRange\(now: Date\(\), until: until\)/.test(views) && !/timerInterval: Date\(\)\.\.\.until/.test(views), 'the rest countdown never builds an inverted range');
  assert(/confirmationDialog\("Discard this session\?"/.test(views), 'Discard asks first');
  // Every field after build 13 is optional, or an upgrade mid-session loses it.
  const models = swift('Models.swift');
  for (const f of ['crownStepKg', 'warmupKg', 'alwaysWarm', 'reason', 'extraSetAllowed', 'warmupFirstN', 'completedAt', 'loadPct', 'unsentLive', 'restUntil']) {
    assert(new RegExp(`(let|var) ${f}: [A-Za-z\\[\\]]+\\?`).test(models), `Models.swift: ${f} is optional`);
  }
  const api = swift('API.swift');
  assert(!/\(400\.\.\.499\)\.contains\(code\)\) \{ return true \}/.test(api) && /case rejected/.test(api), 'a 4xx is never counted as delivered');
  assert(/actor Outbox/.test(api), 'one writer for the outbox');
  const store = swift('SessionStore.swift');
  assert(/init\(\) \{[\s\S]*?Store\.loadSession\(\)/.test(store), 'the session loads at init, before any start can run');
  assert(/fetchPlan\(day: row\.day, dur: row\.durationMin, gym: row\.gym\)/.test(store), 'continuing the phone\'s session asks for the phone\'s gym');
  assert(/startFromButton/.test(swift('StartTrainingIntent.swift')), 'the Action Button continues a phone session instead of splitting it');
  assert(fs.existsSync(path.join(__dirname, 'watch-core-tests', 'main.swift')), 'the Watch core harness exists');
}

// ── Watch wave, phase 3: one prescription for the phone and the wrist ─────
// Rule 9: the server works the number out and the Watch is told. The phone
// seeded +1 pin and deloaded plateaus; the Watch plan did neither, so the
// two devices opened the same machine at different weights (Rear Delt Fly
// 22.5 on the phone, 20 on the wrist, the week the ramp ends).
console.log('Watch wave — one prescription (A3, trainer rulings 1, 5, 6)');
{
  type JsonSet = { exerciseId: string; setNumber: number; weight: number; reps: number; rpe: number | null; isWarmup?: boolean; exercise: { name: string } };
  type JsonWorkout = { id: string; name: string; date: string; gym?: string | null; duration?: number | null; createdAt?: string; sets: JsonSet[] };
  const frozenRows = (data.workouts as unknown as JsonWorkout[]).filter((w) => String(w.createdAt ?? '9999') <= FROZEN_AT);
  // The same query getLastSessionForExercises runs, over the export: working
  // sets, B_Fit (untagged counts), before the cut and never a rescue.
  const foldFrom = (ws: JsonWorkout[], before?: string | null) => {
    const rows: MemorySetRow[] = [];
    for (const w of ws) {
      if ((w.gym ?? DEFAULT_GYM_ID) !== DEFAULT_GYM_ID) continue;
      if (before && !(new Date(w.date) < new Date(before) && !w.name.startsWith('Rescue'))) continue;
      for (const st of w.sets) {
        if (st.isWarmup) continue;
        rows.push({ exerciseId: st.exerciseId, exerciseName: st.exercise.name, setNumber: st.setNumber, weight: st.weight, reps: st.reps, rpe: st.rpe, workout: { id: w.id, date: new Date(w.date), duration: w.duration ?? null } });
      }
    }
    rows.sort((a, b) => b.workout.date.getTime() - a.workout.date.getTime() || b.setNumber - a.setNumber);
    const evidence = new Map<string, Array<{ rpe: number | null; isWarmup: boolean }>>();
    for (const w of ws) evidence.set(w.id, w.sets.filter((st) => !st.isWarmup).map((st) => ({ rpe: st.rpe, isWarmup: false })));
    return foldExerciseMemory(rows, evidence);
  };
  const memoryFrom = (ws: JsonWorkout[], cut: string | null | undefined) => {
    const latest = foldFrom(ws);
    if (!cut) return latest;
    const pre = foldFrom(ws, cut);
    const out: Record<string, ExerciseMemory> = {};
    for (const id of new Set([...Object.keys(pre), ...Object.keys(latest)])) {
      const m = pickRampMemory(pre[id], latest[id]);
      if (m) out[id] = m;
    }
    return out;
  };
  const idOf = (name: string) => data.exercises.find((e) => e.name === name)!.id;
  const spec = (name: string) => getDayTemplate('A').exercises.concat(getDayTemplate('B').exercises).find((e) => e.name === name)!;

  // R1: one deliberate Easy on the LAST set can earn the pin. The Watch
  // rates one set per machine — the last, most fatigued one — so under the
  // old "two rated sets" rule a wrist-only lifter could never progress.
  const s = (setNumber: number, weight: number, reps: number, rpe: number | null) => ({ setNumber, weight, reps, rpe });
  assert(earnsOverload([s(1, 27.5, 12, null), s(2, 27.5, 12, null), s(3, 27.5, 12, 1)], { sets: 3, repsMin: 12 }), 'a single Easy on the last set qualifies when every prescribed set was done in full at one weight');
  assert(!earnsOverload([s(1, 27.5, 12, null), s(2, 27.5, 12, 1), s(3, 27.5, 12, null)], { sets: 3, repsMin: 12 }), 'an Easy on set 2 of 3 does not — the most fatigued set was not rated');
  assert(!earnsOverload([s(1, 27.5, 12, null), s(2, 27.5, 12, null), s(3, 27.5, 12, null)], { sets: 3, repsMin: 12 }), 'nothing rated earns nothing (a spoken "done" leaves it unrated)');
  assert(!earnsOverload([s(1, 27.5, 12, 1), s(2, 27.5, 9, 1), s(3, 27.5, 12, 1)], { sets: 3, repsMin: 12 }), 'a short set anywhere disqualifies — Easy or not');
  assert(!earnsOverload([s(1, 30, 12, 1), s(2, 27.5, 12, 1), s(3, 27.5, 12, 1)], { sets: 3, repsMin: 12 }), 'a drop set is not one weight done in full');
  assert(!earnsOverload([s(1, 27.5, 12, 2), s(2, 27.5, 12, null), s(3, 27.5, 12, 1)], { sets: 3, repsMin: 12 }), 'any rated set above Easy disqualifies');
  assert(!earnsOverload([s(1, 27.5, 12, 1), s(2, 27.5, 12, 1)], { sets: 3, repsMin: 12 }), 'two of three prescribed sets is not the prescription');
  assert(earnsOverload([s(1, 20, 10, 1), s(2, 20, 10, 1)], undefined) && !earnsOverload([s(1, 20, 10, 1)], undefined), 'an off-plan machine needs two sets, the last one Easy');

  // A real session around the machine under test: without the other
  // machines' sets a three-set row is a mis-tap stub, not memory (rule 1.9).
  const synth = (id: string, name: string, date: string, sets: Array<[number, number, number, number | null]>): JsonWorkout => ({
    id, name: 'Day B 45m', date, gym: 'bfit', duration: 2400,
    sets: [
      ...sets.map(([setNumber, weight, reps, rpe]) => ({ exerciseId: 'syn', setNumber, weight, reps, rpe, exercise: { name } })),
      ...[1, 2, 3].map((setNumber) => ({ exerciseId: 'filler', setNumber, weight: 20, reps: 12, rpe: null, exercise: { name: 'Leg Curl' } })),
    ],
  });
  const midShort = foldFrom([
    synth('m1', 'Rear Delt Fly', '2026-10-01', [[1, 20, 12, 1], [2, 20, 9, 1], [3, 20, 12, 1]]),
    synth('m2', 'Rear Delt Fly', '2026-10-03', [[1, 20, 12, 1], [2, 20, 9, 1], [3, 20, 12, 1]]),
  ]).syn;
  assert(midShort?.overload === false, `a short set in the middle blocks the pin even when the LAST set reached the reps (got overload ${midShort?.overload})`);
  const wristOnly = foldFrom([
    synth('w1', 'Rear Delt Fly', '2026-10-01', [[1, 20, 12, null], [2, 20, 12, null], [3, 20, 12, 1]]),
    synth('w2', 'Rear Delt Fly', '2026-10-03', [[1, 20, 12, null], [2, 20, 12, null], [3, 20, 12, 1]]),
  ]).syn;
  assert(wristOnly?.overload === true && wristOnly.repsFloor === 12, `two Watch sessions, each rated once on the last set, earn the pin (got ${JSON.stringify(wristOnly)})`);
  const hardShort = foldFrom([
    synth('h1', 'Rear Delt Fly', '2026-10-01', [[1, 20, 12, null], [2, 20, 12, null], [3, 20, 8, 3]]),
    synth('h2', 'Rear Delt Fly', '2026-10-03', [[1, 20, 12, null], [2, 20, 10, null], [3, 20, 9, 4]]),
  ]).syn;
  assert(hardShort?.shortHard === true && !hardShort.overload, `short and Hard twice at one weight is flagged for one pin lighter (got ${JSON.stringify(hardShort)})`);

  // R6: what a short set means next time.
  assert(shortSetVerdict([s(1, 20, 12, 1), s(2, 20, 12, 1)], { sets: 2, repsMin: 12 }) === 'full', 'full reps: nothing to say');
  assert(shortSetVerdict([s(1, 25, 10, 1), s(2, 25, 10, 1)], { sets: 2, repsMin: 12 }) === 'short-easy', 'Triceps 25 × 10 rated Easy: short, not hard — same weight, reps back to 12');
  assert(shortSetVerdict([s(1, 20, 12, 2), s(2, 20, 9, 3)], { sets: 2, repsMin: 12 }) === 'short-hard', 'Leg Curl May 19 (9 reps @Hard) is short and hard');
  assert(shortSetVerdict([s(1, 20, 12, null), s(2, 20, 9, null)], { sets: 2, repsMin: 12 }) === 'short-unrated', 'short and unrated holds — it could be a symptom stop, it could be a copied prefill');
  assert(shortSetVerdict([s(1, 20, 9, null), s(2, 20, 12, 3)], { sets: 2, repsMin: 12 }) === 'short-hard', 'an unrated short set takes the last set\'s rating (the Watch rates only the last)');

  // Real history under the new rule.
  const latest = foldFrom(frozenRows);
  assert(latest[idOf('Rear Delt Fly')]?.overload === true && latest[idOf('Rear Delt Fly')].weight === 20, 'Rear Delt Fly: May 30 and Sep 12 were both 3 × 12 at 20, all Easy — it has earned the pin');
  for (const name of ['Hip Abduction', 'Hip Adduction', 'Back Extension', 'Leg Press', 'Leg Extension', 'Triceps Extension']) {
    assert(latest[idOf(name)]?.overload !== true, `${name}: no pin earned yet on real history`);
  }
  assert(latest[idOf('Leg Press')]?.allEasy === true, 'Sep 17 Leg Press (3 × 12 at 37.5, one Easy on the last set) counts as an Easy session under R1');
  assert(latest[idOf('Hip Adduction')]?.allEasy === false, 'Sep 17 Hip Adduction left its last set unrated — not an Easy session');
  assert(latest[idOf('Triceps Extension')]?.shortHard !== true, 'Triceps 10 reps rated Easy is short-easy: no deload');

  // prescribeWorking: the ONE function.
  const tplRdf = spec('Rear Delt Fly');
  const pRdf = prescribeWorking(tplRdf, latest[idOf('Rear Delt Fly')], 2.5, null, { rampPct: null, rescue: false });
  assert(pRdf.workingKg === 22.5 && pRdf.reason === 'overload' && pRdf.fromKg === 20, `Rear Delt Fly after the ramp opens at 22.5 on BOTH devices (got ${JSON.stringify(pRdf)})`);
  const pRestore = prescribeWorking(tplRdf, latest[idOf('Rear Delt Fly')], 2.5, null, { rampPct: 100, rescue: false });
  assert(pRestore.workingKg === 20 && pRestore.reason === 'ramp', `RESTORE (100%) is still the ramp — no seed on a scaled machine (got ${JSON.stringify(pRestore)})`);
  const held = { weight: 35, reps: 15, rpe: 1, overload: true, rampHold: true, repsFloor: 15 };
  const pHeld = prescribeWorking(spec('Hip Abduction'), held, 2.5, null, { rampPct: 85, rescue: false });
  assert(pHeld.workingKg === 37.5 && pHeld.reason === 'overload', `a held machine seeds under the ramp exactly as the phone does (got ${JSON.stringify(pHeld)})`);
  const plateau = { weight: 40, reps: 10, rpe: 1, overload: true, repsFloor: 10 };
  const pDeload = prescribeWorking(spec('Lat Pulldown'), plateau, 2, 40, { rampPct: null, rescue: false });
  assert(pDeload.workingKg === 36 && pDeload.sets === 2 && pDeload.reason === 'deload' && pDeload.note === 'Deload: 36 kg × half sets, then build back', `a plateau deloads, and the deload beats the seed (got ${JSON.stringify(pDeload)})`);
  const pLpDeload = prescribeWorking(spec('Leg Press'), { weight: 40, reps: 12, rpe: 3 }, 2.5, 40, { rampPct: null, rescue: false });
  assert(pLpDeload.workingKg === 35 && prescribeWarmup(pLpDeload, 'reps', 2.5, false) === 17.5, `a deload day's warm-up follows the DELOAD weight — 17.5 from 35, not 20 from 40 (got ${pLpDeload.workingKg} / ${prescribeWarmup(pLpDeload, 'reps', 2.5, false)})`);
  const quarter = { weight: 26, reps: 10, rpe: 1, overload: true, rampHold: true, repsFloor: 10 };
  const pQuarter = prescribeWorking({ unit: 'reps', sets: 3, repsMin: 10, repsMax: 12 }, quarter, 1.25, null, { rampPct: 85, rescue: false });
  assert(pQuarter.workingKg === 27.25 && pQuarter.workingKg <= allowedRampKg(quarter, 85, 1.25)!, `a 1.25 pin rounds to the quarter kilo (27.25), never over its own allowance (got ${pQuarter.workingKg})`);
  const pRescue = prescribeWorking(tplRdf, latest[idOf('Rear Delt Fly')], 2.5, null, { rampPct: 60, rescue: true });
  assert(pRescue.reason === 'ramp' && pRescue.workingKg! <= 20, `a rescue day never seeds (got ${JSON.stringify(pRescue)})`);
  assert(prescribeWarmup(pRescue, 'reps', 2.5, true) === null, 'a rescue day opens no warm-ups');
  const pPlank = prescribeWorking(spec('Plank'), latest[idOf('Plank')], 2.5, null, { rampPct: null, rescue: false });
  assert(pPlank.workingKg === null && pPlank.reason === 'timed', 'a timed hold has no weight to prescribe');
  const pShort = prescribeWorking(spec('Leg Curl'), { weight: 30, reps: 8, rpe: 3, shortHard: true }, 2.5, null, { rampPct: null, rescue: false });
  assert(pShort.workingKg === 27.5 && pShort.reason === 'short' && pShort.sets === 3 && !!pShort.note, `short and Hard twice: one pin lighter, full sets (got ${JSON.stringify(pShort)})`);
  const pShortRamp = prescribeWorking(spec('Leg Curl'), { weight: 30, reps: 8, rpe: 3, shortHard: true }, 2.5, null, { rampPct: 85, rescue: false });
  assert(pShortRamp.reason === 'ramp', 'during the ramp a short set only holds — the ramp is already light');
  // Trainer ruling 4: on a coarse stack, reps before the pin.
  const coarse = { weight: 27.5, reps: 12, rpe: 1, overload: true, repsFloor: 12 };
  const coarseP = prescribeWorking(spec('Back Extension'), coarse, 5, null, { rampPct: null, rescue: false });
  assert(coarseP.reason === 'reps' && coarseP.workingKg === 27.5 && coarseP.reps === 13, `a 5 kg step on 27.5 (18%) waits for 15 on every set — and asks for one more rep meanwhile (got ${JSON.stringify(coarseP)})`);
  assert(prescribeWorking(spec('Back Extension'), { ...coarse, repsFloor: 15 }, 5, null, { rampPct: null, rescue: false }).workingKg === 32.5, 'at 15 reps on every set the coarse step is taken');

  // R5: warm up the first two weighted machines he STARTS, not the first two
  // on paper. Back Extension warms up wherever it lands.
  assert(warmupDue(0, 'reps', 30) && warmupDue(1, 'reps', 30), 'the first and second machines started warm up');
  assert(!warmupDue(2, 'reps', 30), 'the third machine started does not — he is warm by then');
  assert(warmupDue(4, 'reps', 27.5, true), 'Back Extension warms up even fifth (seated forward lean under load)');
  assert(!warmupDue(0, 'seconds', 30) && !warmupDue(0, 'reps', null), 'no warm-up for a hold, or with no weight to scale');
  assert(getDayTemplate('B').exercises.find((e) => e.name === 'Back Extension')?.alwaysWarm === true, 'Back Extension carries alwaysWarm');
  assert(extraSetAllowed(2) === false && extraSetAllowed(3) === true && extraSetAllowed(null) === true, '+1 set is never offered in REBOOT or REBUILD (cap Med)');

  // Today's plan (2026-09-24, RELOAD 85%) is unchanged by A3 — the ramp
  // only lets held machines seed, and none has earned it.
  const exercisesWithPins = data.exercises.map((e) => ({ id: e.id, pinIncrement: (e as { pinIncrement?: number | null }).pinIncrement ?? null }));
  const today = new Date('2026-09-24T09:00:00Z');
  const inputs = prescriptionInputs(frozenRows as never, exercisesWithPins, DEFAULT_GYM_ID, today);
  assert(inputs.rampPct === 85, `today is RELOAD 85% (got ${inputs.rampPct})`);
  const memToday = memoryFrom(frozenRows, inputs.cut);
  const byName = new Map(data.exercises.map((e) => [e.name, { id: e.id }]));
  for (const day of ['A', 'B'] as const) {
    const plan = planExercises(getExercisesForDuration(day, 45), byName, memToday, inputs);
    for (const e of plan) {
      const last = memToday[e.exerciseId];
      const before = e.template.unit === 'seconds' || !last || last.weight <= 0 ? null : rampPrefillWeight(last, 85, e.pinKg);
      assert(e.prescription.workingKg === before, `Day ${day} ${e.name}: today's weight is unchanged (${before} → ${e.prescription.workingKg})`);
      const warm = e.prescription.workingKg ? warmupWeight(e.prescription.workingKg, e.pinKg) : null;
      assert(e.warmupKg === warm, `Day ${day} ${e.name}: the plan carries its warm-up weight wherever it sits (${warm}, got ${e.warmupKg})`);
    }
  }

  // Rule 10: following either device's prescription is never over-ramp.
  let judged = 0;
  for (const [id, m] of Object.entries(latest)) {
    if (m.weight <= 0) continue;
    const name = data.exercises.find((e) => e.id === id)?.name;
    const tpl = name ? getDayTemplate('A').exercises.concat(getDayTemplate('B').exercises).find((e) => e.name === name) : undefined;
    if (!tpl || tpl.unit === 'seconds') continue;
    const pin = inputs.pinFor(id);
    for (const pct of [60, 70, 85]) for (const rampHold of [true, false]) for (const overload of [true, false]) {
      const mem = { ...m, rampHold, overload, repsFloor: tpl.repsMax };
      const allowed = allowedRampKg(mem, pct, pin);
      if (allowed == null) continue;
      judged++;
      const got = prescribeWorking(tpl, mem, pin, null, { rampPct: pct, rescue: false }).workingKg!;
      assert(got <= allowed + 1e-9, `${name} at ${pct}% (held ${rampHold}, overload ${overload}): prescribed ${got} ≤ allowed ${allowed}`);
    }
  }
  assert(judged > 50, `the rule-10 sweep covered ${judged} cases`);

  // Rule 9 on the SOURCE: the producers call the one function and re-derive
  // nothing. A copy of the rules is how the two devices drifted.
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['src/app/api/watch/plan/route.ts', 'src/app/workouts/new/page.tsx', 'src/app/train/page.tsx']) {
    const text = src(f);
    for (const banned of ['rampPrefillWeight(', 'deloadTarget(', 'detectPlateau(', 'hasWarmupSet(', '.overload']) {
      assert(!text.includes(banned), `${f}: no ${banned} — the prescription comes from prescription.ts`);
    }
    assert(text.includes('prescriptionInputs('), `${f}: reads its inputs through prescriptionInputs`);
  }
  for (const f of ['src/app/api/watch/plan/route.ts', 'src/app/train/page.tsx']) assert(src(f).includes('planExercises('), `${f}: builds its list with planExercises`);
  const form = src('src/components/WorkoutForm.tsx');
  const buildBody = form.slice(form.indexOf('function buildBlocks('), form.indexOf('export default function WorkoutForm'));
  assert(buildBody.includes('prescribeWorking(') && !buildBody.includes('rampPrefillWeight('), 'the phone\'s buildBlocks calls prescribeWorking and re-derives nothing');
  assert(!/warmupWeight\([^)]*\)\s*\?\?/.test(form), 'no "warm-up ?? working weight" fallback anywhere in the logger — a warm-up that is not lighter is no warm-up');
  assert(/rampSnapshot[\s\S]{0,1400}prescriptionInputs\(/.test(src('src/app/actions.ts')), 'the ramp allowance reads the same inputs as the prescription');
  const route = src('src/app/api/watch/plan/route.ts');
  for (const key of ['reason:', 'fromKg:', 'note:', 'extraSetAllowed', 'warmupFirstN', 'alwaysWarm']) assert(route.includes(key), `the Watch plan sends ${key.replace(':', '')}`);
}

// ── Watch wave, phase 3 review fixes (round 2) ────────────────────────────
console.log('Watch wave — phase 3 review fixes');
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const tpl = (name: string) => getDayTemplate('A').exercises.concat(getDayTemplate('B').exercises).find((e) => e.name === name)!;

  // T1 / F6: on a readiness-hold morning the phone takes back every +1 pin
  // seed; the Watch and /train must hold too — the server is TOLD the
  // verdict (a readiness_hold sample the phone reports), never guesses it.
  const earned = { weight: 30, reps: 12, rpe: 1, overload: true, repsFloor: 12 };
  const pHold = prescribeWorking(tpl('Mid Row'), earned, 2.5, null, { rampPct: null, rescue: false, readinessHold: true });
  assert(pHold.workingKg === 30 && pHold.reason === 'last', `a hold morning opens at the proven weight, no seed (got ${JSON.stringify(pHold)})`);
  const pHeldHold = prescribeWorking(tpl('Hip Abduction'), { ...earned, rampHold: true }, 2.5, null, { rampPct: 85, rescue: false, readinessHold: true });
  assert(pHeldHold.workingKg === 30 && pHeldHold.reason === 'held', 'a held machine in the ramp does not seed on a hold morning either');
  for (const f of ['src/app/api/watch/plan/route.ts', 'src/app/train/page.tsx']) {
    assert(/readinessHoldToday\(/.test(src(f)) && /readinessHold/.test(src(f)), `${f}: reads today's readiness verdict and passes it to the prescription`);
  }
  assert(/reportReadiness\(/.test(src('src/components/HealthAutoPilot.tsx')), 'the phone reports its readiness verdict when it opens');
  assert(/computeReadiness\(/.test(src('src/app/actions.ts')) && /readiness_hold/.test(src('src/app/actions.ts')), 'the verdict is worked out by the ONE computeReadiness, with the chart, and stored for the day');

  // T2: ruling 6's ramp clause — a short set rated Hard HOLDS. A scaled
  // machine read only its pre-break memory, so after a short Hard 35 at
  // RELOAD it opened at 40 in RESTORE.
  const lpShort = foldFromRows([
    { id: 'r1', date: '2026-09-20', sets: [[1, 35, 10, null], [2, 35, 10, null], [3, 35, 8, 3]] },
  ], 'Lat Pulldown');
  assert(lpShort?.lastShortHard === true, `the fold marks a latest session with a short Hard set (got ${JSON.stringify(lpShort)})`);
  const pRampHold = prescribeWorking(tpl('Lat Pulldown'), { weight: 40, reps: 10, rpe: 2, holdAtKg: 35 }, 2.5, null, { rampPct: 100, rescue: false });
  assert(pRampHold.workingKg === 35, `in the ramp a short Hard set holds its weight — 35, not 40 (got ${pRampHold.workingKg})`);
  assert(pRampHold.workingKg! <= allowedRampKg({ weight: 40, rpe: 2 }, 85, 2.5)!, 'a hold never exceeds the allowance');
  assert(/holdAtKg/.test(src('src/app/actions.ts')), 'getLoggerMemory hands the in-block short Hard weight to the ramp prescription');

  // T4: on a coarse step the pin waits for repsMax — so the prescription
  // must ASK for the reps, one more per session, or the machine stalls.
  const fp = prescribeWorking(tpl('Cable Face Pull'), { weight: 7.5, reps: 15, rpe: 1, overload: true, repsFloor: 15 }, 1.25, null, { rampPct: null, rescue: false });
  assert(fp.reason === 'reps' && fp.workingKg === 7.5 && fp.reps === 16, `Face Pull 7.5 on a 1.25 step asks for 16 reps (got ${JSON.stringify(fp)})`);
  const at20 = prescribeWorking(tpl('Cable Face Pull'), { weight: 7.5, reps: 20, rpe: 1, overload: true, repsFloor: 20 }, 1.25, null, { rampPct: null, rescue: false });
  assert(at20.reason === 'overload' && at20.workingKg === 8.75, 'at the top of the range the pin is taken');
  const byName = new Map([['Cable Face Pull', { id: 'fp' }]]);
  const planFp = planExercises([tpl('Cable Face Pull')], byName, { fp: { weight: 7.5, reps: 15, rpe: 1, overload: true, repsFloor: 15 } },
    { pinFor: () => 1.25, plateauKgFor: () => null, rampPct: null, stepIsHis: () => false });
  assert(planFp[0].prefillReps === 16, `the Watch plan opens the asked-for reps (got ${planFp[0].prefillReps})`);
  assert(/p\.reps \?\?/.test(src('src/components/WorkoutForm.tsx')), 'the phone opens the asked-for reps too');

  // Phone logger (source): the restore keeps the gym's context; the switch
  // applies the gym's set count and never re-seeds on a hold; a swap takes
  // the new exercise's rep range; Hold never sits beside a step-down;
  // "Ready to progress" is the seed's own rule.
  const form = src('src/components/WorkoutForm.tsx');
  assert(/loadGymContext\(draft\.gym/.test(form), 'a restored draft at Alrajhi reloads Alrajhi\'s pins, steps, memory and records');
  assert(/resizeWorking\(/.test(form), 'a gym switch applies that gym\'s set count to a machine not yet started');
  assert(/const hold = readinessRef\.current\?\.verdict === 'hold';[\s\S]{0,120}!hold/.test(form), 'a gym switch never re-seeds on a hold morning');
  assert(/programSpec\(/.test(form), 'a swap takes the new exercise\'s rep range and set count');
  assert(/const shouldHold =\s*!deload &&/.test(form), '"Hold" never shows beside a deload or a step-down');
  const page = src('src/app/workouts/new/page.tsx');
  assert(!/last2ByExercise/.test(page), 'no max-RPE scan reads short sets as ready (the badge itself went in round 3)');
  // Ruling 5 on the phone: rows on every weighted machine until two are
  // started, then untouched ones on unstarted machines go (never on a
  // started block — the rest capsule rates by index).
  assert(warmupRowsToDrop([
    { uid: 'a', started: true, weighted: true, alwaysWarm: false, hasUntouchedWarmup: false },
    { uid: 'b', started: true, weighted: true, alwaysWarm: false, hasUntouchedWarmup: false },
    { uid: 'c', started: false, weighted: true, alwaysWarm: false, hasUntouchedWarmup: true },
    { uid: 'd', started: false, weighted: true, alwaysWarm: true, hasUntouchedWarmup: true },
    { uid: 'e', started: true, weighted: true, alwaysWarm: false, hasUntouchedWarmup: true },
  ]).join() === 'c', 'after two starts: the unstarted machine loses its warm-up; Back Extension and a started block keep theirs');
  assert(warmupRowsToDrop([
    { uid: 'a', started: true, weighted: true, alwaysWarm: false, hasUntouchedWarmup: false },
    { uid: 'c', started: false, weighted: true, alwaysWarm: false, hasUntouchedWarmup: true },
  ]).length === 0, 'with one machine started every other machine keeps its warm-up');
  const card = src('src/components/MachinePinCard.tsx');
  assert(!/crown moves 0\.5 kg/.test(card), 'the ⓘ promises nothing about the crown the installed Watch build does not do');
}

// ── Watch wave, phase 3 review fixes (round 3) ────────────────────────────
console.log('Watch wave — phase 3 review fixes, round 3');
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const tpl = (name: string) => getDayTemplate('A').exercises.concat(getDayTemplate('B').exercises).find((e) => e.name === name)!;
  // C: the save-time allowance follows the hold — lifting the week's full
  // target after a short Hard set is over-ramp, not allowed.
  const heldMem = { weight: 40, rpe: 2, holdAtKg: 30 };
  assert(allowedRampKg(heldMem, 85, 2.5) === 32.5, `the allowance after a short Hard 30 is 32.5, not 37.5 (got ${allowedRampKg(heldMem, 85, 2.5)})`);
  // B: one ramp target for the chip, the swap and step-from-zero.
  assert(rampTargetKg(heldMem, 85, 2.5, false) === 30 && rampTargetKg({ weight: 40, rpe: 2 }, 85, 2.5, false) === 35, 'the ramp target honours the hold, and is the scaler otherwise');
  const form = src('src/components/WorkoutForm.tsx');
  const body = form.slice(form.indexOf('export default function WorkoutForm'));
  assert(!/rampPrefillWeight\(/.test(body) && (body.match(/rampTargetKg\(/g) ?? []).length >= 3, 'inside the logger every ramp number (chip, swap, step-from-zero) comes from rampTargetKg');
  // I: after a coarse pin the reps start again at the bottom of the range.
  const pin = prescribeWorking(tpl('Back Extension'), { weight: 27.5, reps: 15, rpe: 1, overload: true, repsFloor: 15 }, 5, null, { rampPct: null, rescue: false });
  assert(pin.reason === 'overload' && pin.workingKg === 32.5 && pin.reps === 12, `a coarse pin opens at repsMin, so the reps-first wait starts again (got ${JSON.stringify(pin)})`);
  // F: a warm-up comes back only where it is still due.
  const lite = (uid: string, started: boolean, alwaysWarm = false) => ({ uid, started, weighted: true, alwaysWarm, hasUntouchedWarmup: false });
  assert(!warmupStillDue([lite('a', true), lite('b', true), lite('c', false)], 'c') && warmupStillDue([lite('a', true), lite('c', false)], 'c') && warmupStillDue([lite('a', true), lite('b', true), lite('d', false, true)], 'd'), 'after two starts only Back Extension may regain a warm-up');
  // K: nothing ticked — only the first two weighted machines' warm-ups (and Back Extension's) are saved.
  assert(untickedWarmupsKept([{ uid: 'a', weighted: true, alwaysWarm: false }, { uid: 'p', weighted: false, alwaysWarm: false }, { uid: 'b', weighted: true, alwaysWarm: false }, { uid: 'c', weighted: true, alwaysWarm: false }, { uid: 'd', weighted: true, alwaysWarm: true }]).join() === 'a,b,d', 'a save with nothing ticked keeps two warm-ups (plus Back Extension), not one per machine');
  // A, D, E, G, H, J on the source.
  assert(/restoreCancelRef\.current\?\.\(\)/.test(form) && /setGymRecords\(personalRecords\)/.test(form) && /setSessionMemory\(lastSession\)/.test(form), 'a reset cancels the restored-draft fetch and puts back B_Fit records and memory');
  assert(/swapSpec[\s\S]{0,600}prefillReps\(/.test(form) && /resizeWorking\([\s\S]{0,200}swapSpec/.test(form), 'a swap re-opens the new exercise\'s reps and set count');
  assert(/repsAsk/.test(form) && /readinessRef\.current\?\.verdict === 'hold'/.test(form), 'the +1 rep ask is taken back on a hold morning, and a switch re-derives it');
  assert(/compressedRef\.current/.test(form), 'a gym switch keeps a compressed session compressed');
  assert(!/progressionHints/.test(form) && !/progressionHints/.test(src('src/app/workouts/new/page.tsx')), '"Ready to progress" is gone — the seed chip and the Try chip say it once');
  assert(/stripDueWarmups\(/.test(form.slice(form.indexOf('function overlayLive'))), 'a Watch handoff strips the warm-ups no longer due');
  assert(/untickedWarmupsKept\(/.test(form), 'the nothing-ticked save uses the warm-up rule');
  // Phase 4 review T3, server half: the plan says until when a cached copy may start offline.
  assert(/startableUntilFor\(/.test(src('src/app/api/watch/plan/route.ts')), 'the Watch plan carries startableUntil (last session + the layoff threshold, or none in a layoff)');
}

// ── Watch wave, final review fixes (round 4) ──────────────────────────────
console.log('Watch wave — final review fixes');
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  // P5-3: a plan fetched DURING a layoff is already a REBOOT plan — more
  // days off keep it there — so it carries no startableUntil (the Watch's
  // 7-day cache window still applies). Before the threshold it is last + 21 d.
  const last = new Date('2026-09-17T00:00:00Z');
  assert(startableUntilFor(last, new Date('2026-09-24T09:00:00Z')) === '2026-10-08T00:00:00.000Z', 'a normal plan may start offline until the layoff threshold');
  assert(startableUntilFor(last, new Date('2026-10-20T09:00:00Z')) === null, 'a comeback plan fetched in the layoff is never pre-expired');
  assert(startableUntilFor(null, new Date('2026-09-24T09:00:00Z')) === null, 'no history, no threshold');
  // DT-R3-3 / P5-4: an untouched warm-up above a done working set is SKIPPED
  // — settled for Done, focus and the flag — never deleted (the rows moved
  // under his thumb and a warm-up he did could no longer be ticked).
  const w = { isWarmup: true, done: false }, s1 = { isWarmup: false, done: true }, s2 = { isWarmup: false, done: false };
  assert(settledSet([w, s1, s2], w) === true && settledSet([w, s2], w) === false, 'a warm-up counts as settled once a working set of its machine is done');
  assert(settledSet([w, s1, s2], s2) === false && settledSet([w, s1, s2], s1) === true, 'working sets settle only when done');
  const form = src('src/components/WorkoutForm.tsx');
  assert(!/ownDropped/.test(form), 'ticking a working set no longer deletes its machine\'s warm-up row');
  assert((form.match(/settledSet\(/g) ?? []).length >= 4, 'Done, the focus frame, the flag and the progress count read settledSet');
  // P5-1 / P5-2: coarse-pin reps survive a gym switch; undo and a HOLD put back the proven reps.
  assert(/seeded && p\.reps != null \? p\.reps : baseReps/.test(form), 'a gym switch keeps the coarse pin\'s reset reps');
  assert(/fromReps/.test(form) && /overloadApplied\.fromReps/.test(form), 'undo and the HOLD revert restore the reps he proved at the lighter weight');
  // P5-5 / P5-6.
  assert(/!rescueMode && !started && swapSpec/.test(form), 'a swap on a Rescue session keeps its 2 sets');
  assert(/b\.defaultReps == null \? st/.test(form), 'a gym switch leaves an off-plan block\'s reps alone');
  // F2 (Watch): a restarted HealthKit workout spans the session, not the tap.
  const wm = fs.readFileSync(path.join(__dirname, '..', 'ios', 'App', 'WatchApp', 'WorkoutManager.swift'), 'utf8');
  assert(/func recoverOrBegin\(startDate: Date/.test(wm) && /begin\(startDate: startDate\)/.test(wm), 'a HealthKit restart is backdated to the session start');
  const store = fs.readFileSync(path.join(__dirname, '..', 'ios', 'App', 'WatchApp', 'SessionStore.swift'), 'utf8');
  assert(/recoverOrBegin\(startDate: /.test(store), 'every restart passes the session start');
  // F3 (Watch): an open phone logger is continued if its row is fresh, even with nothing pushed.
  assert(/liveFreshWindow/.test(store) && /row\.updatedDate/.test(store), 'the Action Button continues a fresh phone row, not only one with sets');
  // Round-4 check: "Fill all" reads settled rows; a Rescue swap records 2 sets.
  const fill = form.slice(form.indexOf('function fillDown'), form.indexOf('function fillDown') + 600);
  assert(/settledSet\(/.test(fill), '"Fill all" starts from the first unsettled row, never a skipped warm-up');
  assert(/plannedSets: rescueMode \? b\.plannedSets : swapSpec\?\.sets/.test(form), 'a Rescue swap keeps the block\'s own set count for later reprices');
  // Rule 11: a HealthKit restart is never backdated past 3 h, and never after
  // this session's workout was already saved.
  assert(/hkWorkoutUuid/.test(store) && /healthRestartStart\(/.test(store), 'a saved workout is remembered on the session and restarts are bounded');
  const wm2 = fs.readFileSync(path.join(__dirname, '..', 'ios', 'App', 'WatchApp', 'WorkoutManager.swift'), 'utf8');
  assert(/endCollection\(withEnd: endAt\)/.test(wm2) && /healthRestartWindow/.test(wm2), 'every saved HKWorkout is capped at 3 h, and a stale recovered session is not taken over');
  const rw = store.slice(store.indexOf('private func rememberWorkoutEnd'), store.indexOf('private func rememberWorkoutEnd') + 900);
  assert(rw.indexOf('s.hkEnded = true') < rw.indexOf('await workout.end()'), 'the session is marked ended on disk before the save starts');
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
  const afCal = afStats([{ startedAt: '2026-09-08T22:00:00+03:00' }], new Date('2026-09-10T08:00:00+03:00')); // his evening, his morning
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

  // Pressure the machine had to reach: kept per night so the long game
  // (does the apnea ease as weight falls?) has an un-floored signal —
  // AHI is already treated to normal (owner's per-night screens).
  const pressNights = cpapStats(
    [
      { night: '2026-09-08', usageHours: 5, ahi: 1, p95Pressure: 12.5 },
      { night: '2026-09-07', usageHours: 4, ahi: 1, p95Pressure: 13 },
    ],
    now,
  );
  assert(pressNights.avgAhi30d === 1, 'pressure rows do not disturb the AHI average');

  // Deep sleep: a SHARE of time on the mask, never raw minutes, and never
  // from one night (owner, 2026-09-07 — "i dont see how its relevant").
  assert(cpap.deepAvgMin === null && cpap.deepNights === 0, 'no reported deep sleep → no average');
  const oneNight = cpapStats([{ night: '2026-09-08', usageHours: 5, deepSleepMin: 60 }], now);
  assert(oneNight.deepAvgMin === null, 'one estimate is not a pattern');
  const twoNights = cpapStats(
    [
      { night: '2026-09-08', usageHours: 5, deepSleepMin: 60 },
      { night: '2026-09-07', usageHours: 5, deepSleepMin: 30 },
    ],
    now,
  );
  assert(twoNights.deepAvgMin === 45 && twoNights.deepNights === 2, `60 and 30 min → 45 min a night (got ${twoNights.deepAvgMin})`);
  // A night the report never measured is absent, not a zero dragging the share.
  const withGap = cpapStats(
    [
      { night: '2026-09-08', usageHours: 5, deepSleepMin: 60 },
      { night: '2026-09-07', usageHours: 5, deepSleepMin: 30 },
      { night: '2026-09-06', usageHours: 1.1 },
    ],
    now,
  );
  assert(withGap.deepAvgMin === 45, 'an unmeasured night is absent, not a zero dragging the average down');
  // Minutes, the unit the prisma app shows — the two must never disagree.
  const shortNight = cpapStats(
    [
      { night: '2026-09-08', usageHours: 1, deepSleepMin: 12 },
      { night: '2026-09-07', usageHours: 1, deepSleepMin: 13 },
    ],
    now,
  );
  assert(shortNight.deepAvgMin === 13, `12 and 13 min → 13 (got ${shortNight.deepAvgMin})`);

  // Planned days: the meal subscription publishes a week ahead, so rows
  // dated in the future sit in the same table. Nothing that reports what
  // HAS happened may count them (owner, 2026-09-07 — next week's schedule).
  {
    const t = { kcal: 2200, proteinG: 130, carbsG: 230, fatG: 85 };
    const logs = [
      { day: '2026-09-06', kcal: 1146, proteinG: 71 },
      { day: '2026-09-07', kcal: 1102, proteinG: 69 },
      { day: '2026-09-13', kcal: 1254, proteinG: 61 }, // next week's plan
      { day: '2026-09-14', kcal: 1118, proteinG: 57 },
    ];
    const wk = fuelWeek(logs, t, 7, new Date('2026-09-07T21:00:00+03:00'));
    assert(wk.daysLogged === 2, `planned days are not "logged" (got ${wk.daysLogged})`);
    assert(wk.proteinLoggedDays === 2, 'protein days count what he ate, not what is scheduled');
    // …and the owner-today bound the DB readers use is his day, not UTC's.
    assert(
      ownerTodayUtc(new Date('2026-09-07T22:30:00Z')).toISOString().slice(0, 10) === '2026-09-08',
      'past midnight in Riyadh, "today" has already turned over',
    );
    assert(
      ownerTodayUtc(new Date('2026-09-07T09:00:00Z')).toISOString().slice(0, 10) === '2026-09-07',
      'midday UTC is the same Riyadh day',
    );
    // An ACTIVITY logged in the small hours belongs to the evening before:
    // the owner tapped a swim in at 00:30 and it filed under the next date.
    assert(
      ownerActivityDayUtc(new Date('2026-09-12T21:30:00Z')).toISOString().slice(0, 10) === '2026-09-12',
      '00:30 Riyadh belongs to the evening that just ended, not the new date',
    );
    assert(
      ownerActivityDayUtc(new Date('2026-09-12T18:00:00Z')).toISOString().slice(0, 10) === '2026-09-12',
      '21:00 Riyadh is its own day',
    );
    assert(
      ownerActivityDayUtc(new Date('2026-09-13T02:00:00Z')).toISOString().slice(0, 10) === '2026-09-13',
      '05:00 Riyadh is past the 04:00 rollover — a morning walk is today',
    );
  }

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
  // A ramp-scaled set is not testimony about strength. Mid-return the card
  // read "Back Extension 12.5 → 27.5 ▲" — the ramp itself, sold as a gain —
  // and the first ramp week after a break would read every machine as a
  // slide in ember (2026-10-02). Only full-load sets may testify.
  const rampSet = (daysAgo: number, name: string, kg: number) => ({ ...set(daysAgo, name, 'bfit', kg), ramp: true });
  const rampUp = strengthHold([rampSet(25, 'Back Extension', 12.5), rampSet(3, 'Back Extension', 27.5)], now);
  assert(rampUp.length === 0, 'two ramp sessions compared read as nothing, never as a gain');
  const rampDown = strengthHold([set(30, 'Leg press', 'bfit', 90), rampSet(4, 'Leg press', 55)], now);
  assert(rampDown.length === 0, 'a ramp week after full load is never named a slide');
  const mixed = strengthHold([set(30, 'Row', 'bfit', 60), rampSet(10, 'Row', 40), set(2, 'Row', 'bfit', 60)], now);
  assert(mixed.length === 1 && mixed[0].verdict === 'held', 'full-load sets on both sides still testify around a ramp');
  // His real September: Sep 1, 6, 12 and 17 are all return-block sessions
  // (Jul 29 → Sep 1 is a 34-day layoff), saved BEFORE the allowance column
  // existed, so every allowedKg is null. The card still read "Chest Press
  // 12.5 → 27 ▲" and two ember slides for following the protocol (trainer,
  // 2026-10-02). A session is ramp-scaled by the block it opened in.
  {
    const training = data.workouts.filter((w) => !/^(Swim|Walk|Rescue)/.test(w.name));
    const rampDays = rampScaledDayKeys(training.map((w) => ({ date: new Date(w.date), name: w.name, gym: (w as { gym?: string | null }).gym ?? null, sets: [] })));
    for (const d of ['2026-09-01', '2026-09-06', '2026-09-12']) assert(rampDays.has(d), `${d} opened inside the return ramp below full load`);
    assert(!rampDays.has('2026-05-19') && !rampDays.has('2026-05-23'), 'May sessions at full load are not ramp-scaled');
    const realSets = training.flatMap((w) => (w.sets as unknown as Array<{ weight: number; isWarmup?: boolean; exercise?: { name: string }; allowedKg?: number | null }>)
      .filter((st) => !st.isWarmup && st.weight > 0)
      .map((st) => ({ name: st.exercise?.name ?? '?', gym: (w as { gym?: string | null }).gym ?? 'bfit', date: new Date(w.date), weight: st.weight,
        ramp: st.allowedKg != null || rampDays.has(new Date(w.date).toISOString().slice(0, 10)) })));
    const oct2 = strengthHold(realSets, new Date('2026-10-02T02:00:00+03:00'));
    assert(oct2.length === 0, `on 2026-10-02 both windows are ramp: the card has no rows (got ${oct2.length})`);
  }
  const statsSrc = fs.readFileSync(path.join(__dirname, '..', 'src/app/stats/page.tsx'), 'utf8');
  assert(/ramp: st\.allowedKg != null \|\| rampDays\.has\(/.test(statsSrc), 'Stats marks a ramp set by its recorded allowance OR the block its session opened in');
  assert(statsSrc.includes('Return ramp · strength compares again at full load'), 'mid-ramp the card says why it is quiet instead of vanishing');
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

// ── rule 7, enforced on the SOURCE ───────────────────────────────────────
// rampPrefillWeight's `pin` argument defaults to 2.5, so a call site that
// forgets it still compiles, still returns a plausible number, and silently
// stops being pin-aware. That is exactly what happened to the "↓ Return N kg"
// chip: one of seven call sites omitted the pin, so the chip and the weight
// box beside it disagreed on 8 of 14 machines. The unit tests above cannot
// catch it — they test the function, and the function was never wrong.
{
  const callSites: { file: string; args: number; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) {
        const src = fs.readFileSync(p, 'utf8');
        const needle = 'rampPrefillWeight(';
        for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) {
          // Skip the declaration itself.
          if (/(function|const)\s+$/.test(src.slice(Math.max(0, i - 20), i))) continue;
          let depth = 0;
          let commas = 0;
          let j = i + needle.length - 1;
          // A TRAILING comma must not count as an argument: written
          // multi-line with a dangling comma, a two-argument call otherwise
          // scored 3 and sailed through the very check that exists to catch
          // it (data-steward). Track the last comma and drop it if nothing
          // but whitespace separates it from the closing paren.
          let lastCommaAt = -1;
          for (; j < src.length; j++) {
            const c = src[j];
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') {
              depth--;
              if (depth === 0) break;
            } else if (c === ',' && depth === 1) {
              commas++;
              lastCommaAt = j;
            }
          }
          if (lastCommaAt !== -1 && src.slice(lastCommaAt + 1, j).trim() === '') commas--;
          callSites.push({
            file: path.relative(process.cwd(), p),
            args: commas + 1,
            text: src.slice(i, Math.min(j + 1, i + 90)).replace(/\s+/g, ' '),
          });
        }
      }
    }
  };
  walk(path.join(__dirname, '..', 'src'));

  // Three since A3 folded the route, the logger page, /train and buildBlocks
  // into prescription.ts, and the logger's chip, swap and stepper into
  // rampTargetKg — fewer copies is the point.
  assert(callSites.length >= 3, `expected to find the rampPrefillWeight call sites, found ${callSites.length}`);
  const pinless = callSites.filter((c) => c.args < 3);
  // And whether the step is HIS (review B1/F4): with it the scaled weight
  // lands on the ladder through a weight he lifted; a call that leaves it
  // out silently snaps to a zero-based grid off his plates.
  const unanchored = callSites.filter((c) => c.args < 4);
  assert(unanchored.length === 0, `every rampPrefillWeight call says whether the step is his — missing: ${unanchored.map((c) => `${c.file}: ${c.text}`).join(' | ') || 'none'}`);
  assert(
    pinless.length === 0,
    `every rampPrefillWeight call must pass the machine's learned pin (rule 4/7) — ` +
      `pinless: ${pinless.map((c) => `${c.file}: ${c.text}`).join(' | ') || 'none'}`,
  );
}

// ── warm-up sets: one rule for the phone and the wrist ───────────────────
// The Watch built its slots from `sets` alone and never offered a warm-up,
// so a wrist session skipped them and the phone then showed "4 sets" where
// the wrist had shown 3 (owner, 2026-09-18).
{
  assert(WARMUP_BLOCKS === 2, 'only the first two machines started warm up');

  // Counted in machines STARTED (trainer ruling 5), not plan position.
  assert(warmupDue(0, 'reps', 40), 'first machine started, with a known weight, warms up');
  assert(warmupDue(1, 'reps', 40), 'second machine started warms up');
  assert(!warmupDue(2, 'reps', 40), 'the third does not — the body is warm by then');
  assert(!warmupDue(0, 'seconds', 40), 'a timed hold has no warm-up set');
  assert(!warmupDue(0, 'reps', null), 'no previous weight, nothing to scale a warm-up from');
  assert(!warmupDue(0, 'reps', 0), 'a zero working weight is not a warm-up either');

  // 55% floored to a whole pin, never below one pin.
  assert(warmupWeight(40, 2.5) === 20, `40kg on 2.5 pins warms at 20 (55% = 22, floored), got ${warmupWeight(40, 2.5)}`);
  assert(warmupWeight(29, 7) === 14, `29kg on 7kg pins warms at 14, got ${warmupWeight(29, 7)}`);
  assert(warmupWeight(40, 0) === 20, 'a missing pin falls back to 2.5, not a divide by zero');

  // A warm-up that is not LIGHTER is not a warm-up. On a coarse stack the
  // 55% floor can land on — or above — the working weight, which turned
  // Back Extension's REBOOT week into a fourth full-load set under an
  // RPE-2 cap (adversary, 2026-09-18). null means: no warm-up row.
  assert(warmupWeight(15, 15) === null, 'one-pin working weight has no lighter warm-up');
  assert(warmupWeight(3, 5) === null, 'a pin heavier than the work has no warm-up');
  assert(warmupWeight(27.5, 15) === 15, 'Back Extension at full load still warms up at 15');

  // Exhaustive: never heavier than, never equal to, always on a pin.
  const pins = [0.25, 0.5, 1, 2.5, 5, 7, 9, 15, 20];
  let checked = 0;
  for (const pin of pins) {
    for (let w = pin; w <= 200; w += pin) {
      const warm = warmupWeight(w, pin);
      if (warm === null) continue;
      checked++;
      assert(warm < w, `a warm-up is always lighter than the work (${warm} vs ${w} on ${pin}kg pins)`);
      assert(Math.abs(warm / pin - Math.round(warm / pin)) < 1e-6, `${warm} lands on a whole ${pin}kg pin`);
    }
  }
  assert(checked > 500, `the sweep must actually cover something, covered ${checked}`);
}

// ── a session belongs to the day it was TRAINED ──────────────────────────
// The logger stamped the save moment, so Thursday's session finished at
// 00:30 saved as Friday (owner, 2026-09-18). The Watch already dated by
// startISO, so a handed-off session had two answers. Same 04:00 rollover
// as ownerActivityDayUtc; local clock, no conversion — it runs on his
// phone in his timezone.
{
  const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
  assert(activityDayStr(at(2026, 9, 18, 0, 33)) === '2026-09-17', 'a 00:33 finish belongs to the evening before');
  assert(activityDayStr(at(2026, 9, 18, 3, 59)) === '2026-09-17', 'still the previous day at 03:59');
  assert(activityDayStr(at(2026, 9, 18, 4, 0)) === '2026-09-18', 'the day turns over at 04:00');
  assert(activityDayStr(at(2026, 9, 17, 19, 30)) === '2026-09-17', 'an evening session is its own day');
  assert(activityDayStr(at(2026, 9, 17, 12, 0)) === '2026-09-17', 'midday is unremarkable');
  // Month and year edges: setDate(0) must roll the month back, not produce a 0.
  assert(activityDayStr(at(2026, 10, 1, 1, 0)) === '2026-09-30', 'the 1st at 01:00 is the last day of the previous month');
  assert(activityDayStr(at(2027, 1, 1, 2, 0)) === '2026-12-31', 'new year at 02:00 belongs to the old one');
  assert(activityDayStr(at(2028, 3, 1, 1, 0)) === '2028-02-29', 'leap day is handled by the Date, not by us');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(activityDayStr(at(2026, 1, 5, 1, 0))), 'single-digit months and days are padded');
}

// ── Tier 1a: what the app says must be safe for THIS heart ───────────────
// Trainer review 2026-09-18: flecainide's block is use-dependent (stronger
// at high heart rates), a beta-blocker hides how hard he is going, and the
// cardiology review is 30 Sep. Nothing may prescribe peak exertion.
console.log('Tier 1a — medical');
{
  const rowing = CARDIO.find((c) => c.name === 'Rowing')!;
  assert(!/hard|interval|×/i.test(rowing.desc), `rowing prescribes no intervals (got "${rowing.desc.slice(-60)}")`);
  assert(/steady/i.test(rowing.desc), 'rowing is steady-state only');
  assert(/conversational|talk/i.test(CARDIO_RULE), 'the standing cardio rule is conversational pace');
  const swim = CARDIO.find((c) => c.name === 'Swimming')!;
  assert(/alone|breath/i.test(swim.desc) && /cold/i.test(swim.desc), 'swimming carries the not-alone / no-breath-hold / no-cold-water clause');

  // The effort ceiling comes from the chart, not from the ramp.
  assert(effortCeiling(['Obesity', 'Hypertension', 'Atrial fibrillation', 'Obstructive sleep apnea']) === 3, 'AF on the chart caps effort at Hard');
  assert(effortCeiling(['Obesity']) === 4, 'no cardiac condition — no ceiling');
  assert(effortCeiling(null) === 4 && effortCeiling(undefined) === 4 && effortCeiling([]) === 4, 'no profile — no ceiling');
  assert(effortCeiling(['Hypertension']) === 3, 'treated hypertension alone still caps at Hard (Valsalva)');
  assert(effortCeiling([], ['Flecainide acetate', 'Mounjaro (tirzepatide)']) === 3, 'an active antiarrhythmic caps effort');
  assert(effortCeiling([], ['Nebilet (nebivolol)']) === 3, 'an active beta-blocker caps effort');
  assert(effortCeiling([], ['Mounjaro (tirzepatide)']) === 4, 'a GLP-1 alone does not');
  assert(effortCeiling([], ['Flecainide — stopped 30 Sep']) === 4, 'a stopped drug does not');
  // Spellings the first regex missed, and negations it wrongly matched (adversary + trainer).
  for (const c of ['AFib', 'A-fib', 'Afib', 'Atrial flutter', 'High blood pressure', 'high BP', 'HBP']) {
    assert(effortCeiling([c]) === 3, `"${c}" caps effort`);
  }
  for (const c of ['no hypertension', 'AF — resolved 2027', 'Hypertension (resolved)', 'Flecainide stopped', 'ex-hypertension', 'family history of arrhythmia', 'prehypertension', 'half marathon']) {
    assert(effortCeiling([c]) === 4, `"${c}" does NOT cap effort`);
  }
  assert(effortCeiling('Atrial fibrillation') === 3, 'a bare string is treated as a list of one');
  assert(effortCeiling({ nope: 1 }) === 4 && effortCeiling(42) === 4, 'junk JSON is no chart, not a crash');
  assert(effortCeiling('unknown') === 3 && effortCeiling([], 'unknown') === 3, 'an unreadable chart fails CLOSED');
  assert(afOnChart(['Obesity', 'Atrial fibrillation']) && afOnChart(['AFib']) && !afOnChart(['Hypertension']) && !afOnChart(['no AF']) && !afOnChart(null), 'afOnChart reads AF and only AF');
  assert(clampTimedReps(45, 20, 30) === 30 && clampTimedReps(10, 20, 30) === 20 && clampTimedReps(25, 20, 30) === 25, 'a timed hold prefills inside its ceiling');
  for (let w = 1; w <= 12; w++) assert(getPlankTarget(w).min === 20 && getPlankTarget(w).max === 30, `plank target week ${w} is 20–30 s`);

  // Plank: knees by default, 30 s ceiling, priority 2; Leg Curl priority 1.
  const b = getDayTemplate('B').exercises;
  const plank = b.find((e) => e.name === 'Plank')!;
  const curl = b.find((e) => e.name === 'Leg Curl')!;
  assert(plank.priority === 2, 'plank is priority 2 on Day B');
  assert(curl.priority === 1, 'leg curl is priority 1 on Day B — the 30-minute day keeps hamstrings');
  assert(plank.repsMax === 30 && /30/.test(plank.repsDisplay), `plank holds cap at 30 s (got ${plank.repsMax})`);
  assert(/knee|dead bug/i.test(plank.cues.slice(0, 160)), 'the knee plank / dead bug is the DEFAULT, not the afterthought');
  assert(/keep breathing/i.test(plank.cues) && !/exhale slowly the whole hold/i.test(plank.cues), 'the plank cue says keep breathing — not exhale for 30 s');
  assert(/sag|piked/i.test(plank.cues), 'the plank cue keeps its own mistake: hip sag / pike');
  const b30 = getExercisesForDuration('B', 30).map((e) => e.name);
  assert(b30.includes('Leg Curl') && !b30.includes('Plank'), `30-minute Day B has hamstrings, not a plank (got ${b30.join(', ')})`);
  assert(getPlankTarget(10).max <= 30 && getPlankTarget(1).max <= 30, 'plank target never climbs past 30 s');

  // HRV is meaningless in AF: SDNN is inflated by irregular RR intervals.
  const rested = { rhrDeltaBpm: -1, sleepHours: 7.5, hoursSinceLastSession: 48 };
  assert(computeReadiness({ ...rested, hrvRatio: 0.6, afOnChart: true })?.verdict === 'push', 'with AF on the chart a low HRV ratio is ignored');
  assert(computeReadiness({ ...rested, hrvRatio: 0.6 })?.verdict === 'hold', 'without AF the HRV clause still holds (unchanged)');
  assert(computeReadiness({ rhrDeltaBpm: 7, sleepHours: 7.5, hoursSinceLastSession: 48, hrvRatio: 0.6, afOnChart: true })?.verdict === 'hold', 'AF only silences HRV — resting HR still holds');
}

// ── Tier 1b (i): the arithmetic meets his real loads ─────────────────────
console.log('Tier 1b — program logic');
{
  // 1.7 A base within three pins of the stack's bottom is a learn-phase
  // weight; scaling it produces sets with nothing in them. Hold instead.
  // Hold on HOW the base was rated, not where it sits on the stack (trainer):
  // his whole pre-break history is learn-phase weights rated Easy.
  assert(rampPrefillWeight({ weight: 36, rpe: 1 }, 60, 7.5) === 36, 'an Easy-rated base holds at 60% — Leg Press 36, the case the rule was written for');
  assert(rampPrefillWeight({ weight: 23, rpe: 1 }, 70, 4.5) === 23, 'Chest Press 23 @Easy holds');
  assert(rampPrefillWeight({ weight: 36, rpe: 2 }, 60, 7.5) === 22.5, 'a Med-rated base scales, floored at three pins');
  assert(rampPrefillWeight({ weight: 20, rpe: 4 }, 60, 7.5) === 15, 'a Grind-rated base is NEVER held — it scales past the floor');
  assert(rampPrefillWeight({ weight: 20, rpe: 3 }, 60, 7.5) === 15, 'a Hard-rated base is never held either');
  // The floor is monotonic: a heavier base can never open lighter than a lighter one (adversary).
  assert(rampPrefillWeight({ weight: 15 }, 60, 7.5) === 15 && rampPrefillWeight({ weight: 22.5 }, 60, 7.5) === 22.5 && rampPrefillWeight({ weight: 30 }, 60, 7.5) === 22.5 && rampPrefillWeight({ weight: 45 }, 60, 7.5) === 30, `floor is monotonic (got ${[15, 22.5, 30, 45].map((w) => rampPrefillWeight({ weight: w }, 60, 7.5)).join(',')})`);
  assert(rampPrefillWeight({ weight: 29 }, 60, 9) === 27, `9 kg pin, 29 kg base, no rating → 60% = 18 but the three-pin floor (27) holds it (got ${rampPrefillWeight({ weight: 29 }, 60, 9)})`);
  assert(rampPrefillWeight({ weight: 29, rpe: 2 }, 60, 9) === 27 && rampPrefillWeight({ weight: 45, rpe: 2 }, 60, 9) === 27, 'floor applies to Med bases too');

  // 1.8 The pin learner, rewritten 2026-09-24 (owner: "each machine
  // different"; trainer ruling 4). A jump between two sessions is NOT one
  // pin — it can be several, and mid-ramp most jumps ARE the ramp. The old
  // rule took the most frequent jump and let a single one count, so Back
  // Extension learned 15 kg from 12.5 → 27.5 and the overload seed would
  // have opened the next Day B at 42.5 kg (+55%). Now: at least three
  // DISTINCT rated weights, a step that puts EVERY one of them on one
  // ladder, that step seen twice between neighbours, nothing above 5 kg.
  // Anything else learns nothing and combineIncrement falls back to 2.5 —
  // coarse stacks come from the owner, never from a guess.
  const ex = { id: 'pin-ex', name: 'Pin Test', category: 'LEGS' } as CoachExercise;
  const sess = (date: string, w: number): CoachWorkout => ({ date, sets: [{ exerciseId: ex.id, reps: 10, weight: w, rpe: 1, exercise: ex }] });
  const ladder = (...ws: number[]) => ws.map((w, i) => sess(`2026-05-${String(1 + i * 3).padStart(2, '0')}`, w));
  const learn = (ws: CoachWorkout[]) => learnPinIncrements(ws)[ex.id];
  assert(learn(ladder(12.5, 27.5)) === undefined, `one jump teaches nothing — Back Extension 12.5 → 27.5 was the ramp, not a 15 kg pin (got ${learn(ladder(12.5, 27.5))})`);
  assert(learn(ladder(20, 20, 12.5, 20)) === undefined, `revisiting one pair is not a repeat — Leg Curl 20 ↔ 12.5 (got ${learn(ladder(20, 20, 12.5, 20))})`);
  assert(learn(ladder(29, 29, 20, 30)) === undefined, `29 and 30 on one machine contradict any 9 kg ladder — Leg Extension (got ${learn(ladder(29, 29, 20, 30))})`);
  assert(learn(ladder(20, 29, 27, 20, 29)) === undefined, `Mid Row 20/27/29 fits no ladder at all (got ${learn(ladder(20, 29, 27, 20, 29))})`);
  assert(learn(ladder(20, 35, 50)) === undefined, `even a consistent 15 kg ladder is not learned — above 5 kg only the owner can set it (got ${learn(ladder(20, 35, 50))})`);
  assert(learn(ladder(20, 25, 35)) === undefined, `the step must show up twice as a real gap, or it is only an upper bound (got ${learn(ladder(20, 25, 35))})`);
  assert(learn(ladder(20, 25, 30, 35)) === 5, `a clean 5 kg ladder is learned (got ${learn(ladder(20, 25, 30, 35))})`);
  assert(learn(ladder(7.5, 8.75, 10, 11.25)) === 1.25, `a genuine 1.25 half-plate ladder is learned (got ${learn(ladder(7.5, 8.75, 10, 11.25))})`);
  // Below 2.5 the log is an UPPER BOUND on the step: two weights 1.25 apart
  // prove the stack moves in 1.25 (or finer). Falling back to 2.5 there would
  // prescribe more than one step — Face Pull 7.5 -> 10 kg, +33% on the
  // smallest shoulder movement (trainer review). Two weights are enough to
  // bound it; the gap-twice rule is only for steps of 2.5 kg and up.
  assert(learn(ladder(7.5, 8.75)) === 1.25, `Face Pull 7.5 / 8.75 proves a 1.25 kg step — never a 2.5 jump (got ${learn(ladder(7.5, 8.75))})`);
  assert(learn(ladder(20, 21.25, 20)) === 1.25, `a revisited 1.25 gap still bounds the step at 1.25 (got ${learn(ladder(20, 21.25, 20))})`);
  assert(learn(ladder(26, 28)) === 2, `a 2 kg gap bounds the step at 2 (got ${learn(ladder(26, 28))})`);
  const noisy = ladder(20, 25, 30, 27.5, 27);
  assert(learn(noisy) === undefined, `27.5 and 27 contradict the 5 kg ladder of 20/25/30 — a contradicted log teaches nothing (was 5 under the most-frequent-jump rule; got ${learn(noisy)})`);
  assert(learn([sess('2026-07-01', 20), sess('2026-07-08', 21)]) === undefined, 'a lone sub-2 kg jump teaches nothing (combineIncrement falls back to 2.5)');
  assert(learn([sess('2026-07-01', 27.5), sess('2026-07-08', 27)]) === undefined, 'a lone 0.5 correction teaches nothing');
  // An untouched ramp prefill (no set rated) is not a jump he made (trainer).
  const unrated = (date: string, w: number): CoachWorkout => ({ date, sets: [{ exerciseId: ex.id, reps: 10, weight: w, rpe: null, exercise: ex }] });
  const prefills = [sess('2026-05-01', 27), unrated('2026-07-29', 15), unrated('2026-09-01', 20), sess('2026-09-12', 36)];
  assert(learn(prefills) === undefined, `unrated prefills are skipped, and the one rated jump left (27 → 36) teaches nothing (got ${learn(prefills)})`);

  // On his real history: every learned pin is a real step AND fits every
  // rated weight logged on that machine (the ladder property).
  // Frozen at the 2026-09-23 export: the sync bot appends sessions daily, and
  // a machine that logs a new clean ladder must not turn these red (steward).
  const frozen = data.workouts.filter((w) => String((w as { createdAt?: string }).createdAt ?? '9999') <= FROZEN_AT);
  const real = learnPinIncrements(frozen);
  for (const [id, pin] of Object.entries(real)) {
    const name = data.exercises.find((e) => e.id === id)?.name ?? id;
    assert(pin >= 1.25 && pin <= 5, `${name}: learned pin ${pin} is a step a stack can actually take`);
    const tops = frozen.flatMap((w) => {
      const own = w.sets.filter((st) => st.exerciseId === id && !st.isWarmup && st.weight > 0);
      return own.some((st) => st.rpe != null && st.rpe > 0) ? [Math.max(...own.map((st) => st.weight))] : [];
    });
    const lo = Math.min(...tops);
    assert(tops.every((t) => Math.abs((t - lo) / pin - Math.round((t - lo) / pin)) < 0.02), `${name}: every rated top weight sits on the learned ${pin} kg ladder`);
  }
  // The ten machines whose live pins came from comeback jumps all resolve to
  // the 2.5 fallback until he sets them (live 2026-09-24: 9, 9, 15, 7.5, 7.5,
  // 7.5, 4.5, 5, 2, 2).
  for (const name of ['Leg Extension', 'Mid Row', 'Back Extension', 'Hip Abduction', 'Leg Curl', 'Triceps Extension', 'Chest Press', 'Pec Fly', 'Shoulder Press', 'Lat Pulldown']) {
    const id = data.exercises.find((e) => e.name === name)?.id;
    assert(id !== undefined && combineIncrement(real[id], null) === 2.5, `${name} resolves to the 2.5 kg fallback (got ${id ? combineIncrement(real[id], null) : 'missing'})`);
  }
  const facePull = data.exercises.find((e) => e.name === 'Cable Face Pull')?.id;
  assert(facePull !== undefined && real[facePull] === 1.25, `Cable Face Pull learns the 1.25 kg step his log proves (got ${facePull ? real[facePull] : 'missing'})`);
  // F1, the live hazard: one more all-Easy Back Extension at 27.5 must NOT
  // make the overload seed jump a guessed 15 kg pin.
  const beEx = data.exercises.find((e) => e.name === 'Back Extension')!;
  const beSets = [1, 2, 3].map(() => ({ exerciseId: beEx.id, reps: 12, weight: 27.5, rpe: 1, exercise: beEx }));
  const withNextDayB = [...frozen, { date: '2026-09-25T00:00:00.000Z', sets: beSets } as CoachWorkout];
  const bePin = combineIncrement(learnPinIncrements(withNextDayB)[beEx.id], null);
  assert(27.5 + bePin <= 30, `Back Extension overload after another Easy 27.5 opens at most 30 kg, not 42.5 (pin ${bePin})`);

  // 1.9 A 6-second mis-tap is not a training session.
  const un = (n: number) => Array.from({ length: n }, () => ({ rpe: null, isWarmup: false }));
  const junk = { name: 'Day A 45m — Sep 2', duration: 6, sets: un(4) };
  assert(!isTrainingSession(junk), 'a 6-second save with nothing rated does not count');
  assert(!isTrainingSession({ name: 'Day B — Watch · Sep 1', duration: 700, sets: [{ rpe: 1, isWarmup: false }, ...un(2)] }), 'a 700-second Watch replay stub (3 sets, 1 rated) does not count either (adversary)');
  assert(isTrainingSession({ name: 'Rescue Day A', duration: 15 * 60, sets: un(8) }), 'a 15-minute rescue (4 machines × 2 sets) counts');
  assert(isTrainingSession({ name: 'Day A 45m — Sep 17', duration: 52 * 60, sets: un(25) }), 'a real session counts');
  assert(isTrainingSession({ name: 'Day A 45m', duration: 5 * 60, sets: un(20) }), 'a session typed in from memory in five minutes still counts — it has the sets');
  assert(isTrainingSession({ name: 'Day B — Watch · Sep 1', duration: 300, sets: [{ rpe: 1, isWarmup: false }, { rpe: 2, isWarmup: false }] }), 'two rated sets count whatever the clock says');
  assert(isTrainingSession({ name: 'Day A 45m' }), 'a bare name (no duration, no sets) is not judged');
  assert(isTrainingSession({ name: 'Day A 45m', duration: 40 * 60 }), 'duration alone, no sets known: judged on time');
  const realTraining = data.workouts.filter((w) => w.name.startsWith('Day'));
  assert(realTraining.every((w) => isTrainingSession(w)), 'every real training row in the export still counts');

  // 1.10 A +50% week on a deficit mid-ramp is a caution, not a win.
  const big = weeklyReport(
    [
      { date: '2026-09-07', sets: [{ exerciseId: ex.id, reps: 10, weight: 20, rpe: 1, exercise: ex }] },
      { date: '2026-09-14', sets: [{ exerciseId: ex.id, reps: 10, weight: 30, rpe: 1, exercise: ex }] },
    ],
    [],
    { mode: 'active', week: 3 } as never,
    new Date('2026-09-15T12:00:00Z'),
  );
  assert(big.focus.some((l) => /Volume per session up 50%/.test(l) && /hold/i.test(l)) && !big.wins.some((l) => /Volume/.test(l)), `a 50% volume jump reads as a caution (focus: ${big.focus.join(' | ')})`);
  const fast = weightTrend([{ date: '2026-09-01', weight: 130 }, { date: '2026-09-15', weight: 126 }]);
  assert(fast.classification === 'too_fast' && !/calorie/i.test(fast.message) && /protein/i.test(fast.message), `too-fast never names calories (got "${fast.message}")`);
  // Refilled glycogen MASKS a loss; it cannot exaggerate one — the too-fast
  // line stands during the ramp (trainer, reversing the review's own item).
  const fastRamp = weightTrend([{ date: '2026-09-01', weight: 130 }, { date: '2026-09-15', weight: 126 }], { returning: true });
  assert(fastRamp.classification === 'too_fast' && /protein/i.test(fastRamp.message), `during the ramp the too-fast call still stands (got "${fastRamp.message}")`);
  // Volume: three sessions at the same weight after one is not a 200% jump.
  const three = weeklyReport(
    [
      { date: '2026-09-07', sets: [{ exerciseId: ex.id, reps: 10, weight: 20, rpe: 1, exercise: ex }] },
      { date: '2026-09-14', sets: [{ exerciseId: ex.id, reps: 10, weight: 20, rpe: 1, exercise: ex }] },
      { date: '2026-09-16', sets: [{ exerciseId: ex.id, reps: 10, weight: 20, rpe: 1, exercise: ex }] },
      { date: '2026-09-18', sets: [{ exerciseId: ex.id, reps: 10, weight: 20, rpe: 1, exercise: ex }] },
    ],
    [],
    { mode: 'active', week: 3 } as never,
    new Date('2026-09-18T12:00:00Z'),
  );
  assert(!three.focus.some((l) => /Volume up/.test(l)), `more sessions at the same load is not a volume jump (focus: ${three.focus.join(' | ')})`);
  const rampWeek = weeklyReport(
    [
      { date: '2026-09-07', sets: [{ exerciseId: ex.id, reps: 10, weight: 20, rpe: 1, exercise: ex }] },
      { date: '2026-09-14', sets: [{ exerciseId: ex.id, reps: 10, weight: 30, rpe: 1, exercise: ex }] },
    ],
    [],
    { mode: 'return', week: 2, returnWeek: { week: 2, phase: 'REBUILD', loadPct: 70, sessions: '3', rpeCap: 2, desc: '' } } as never,
    new Date('2026-09-15T12:00:00Z'),
  );
  assert(!rampWeek.focus.some((l) => /Volume up/.test(l)) && !rampWeek.wins.some((l) => /Volume up/.test(l)), 'during the ramp the prescription moves the volume — no line either way');

  // 1.11 Cues.
  const A = getDayTemplate('A').exercises, B = getDayTemplate('B').exercises;
  const curl = B.find((e) => e.name === 'Leg Curl')!;
  assert(/seated/i.test(curl.cues.slice(0, 80)) && !/^Adjust seat so your knee joint aligns with the machine pivot\. Lie face down/.test(curl.cues), 'leg curl leads with the SEATED machine');
  assert(/no face-down|not face-down|never face-down/i.test(curl.cues) && !/hips pressed into the pad/i.test(curl.cues), 'the prone machine is refused, not coached (trainer)');
  assert(/handles/i.test(curl.cues), 'hold the handles — they keep the hips down on the seated machine');
  for (const name of ['Chest Press', 'Pec Fly', 'Shoulder Press']) {
    const e = A.find((x) => x.name === name)!;
    assert(/seat.*move|moves? as you|designed to move|let it rock/i.test(e.cues), `${name}: the Hoist moving-seat sentence is there`);
  }
  assert(/chest against the pad/i.test(B.find((x) => x.name === 'Mid Row')!.cues) && !/back on the pad/i.test(B.find((x) => x.name === 'Mid Row')!.cues), 'Mid Row: the moving-seat sentence is written for a CHEST pad (you face it)');
  for (const name of ['Chest Press', 'Pec Fly', 'Shoulder Press']) assert(!/IMPORTANT —[A-Za-z]/.test(A.find((x) => x.name === name)!.cues), `${name}: no glued "IMPORTANT —This"`);
  assert(!/a injury/.test(A.find((x) => x.name === 'Leg Press')!.cues), 'Leg Press typo fixed');
  assert(!/under the ramp/i.test(A.find((x) => x.name === 'Hip Adduction')!.cues), 'Hip Adduction cue carries no ramp instruction');
  const swap = gymSwap('Leg Curl', 'work');
  assert(!!swap?.cues && /seated/i.test(swap.cues), 'Alrajhi Precor seated leg curl carries a seated cue');
}

// ── Tier 1b (ii): the chip and the over-ramp rule ─────────────────────────
console.log('Tier 1b — chip + over-ramp');
{
  // 1.5 The "Try +5 kg" chip: learned pin, and only after the same two
  // all-Easy sessions the overload seed waits for. One Easy session at a
  // new weight reads "repeat, earn it" — Face Pull 8.75 → "Try 13.75" was
  // a +57% suggestion on a machine whose own cue says light and strict.
  assert(nextTryWeight({ weight: 8.75, reps: 15, rpe: 1, overload: true }, 1.25, 15) === 10, `one learned pin on top (got ${nextTryWeight({ weight: 8.75, reps: 15, rpe: 1, overload: true }, 1.25, 15)})`);
  assert(nextTryWeight({ weight: 8.75, reps: 15, rpe: 1, overload: false }, 1.25, 15) === null, 'one Easy session earns nothing yet');
  assert(nextTryWeight({ weight: 30, reps: 6, rpe: 1, overload: true }, 2.5, 10) === null, 'reps first, then the pin: under the minimum reps there is no number (the seed declines the same case)');
  assert(nextTryWeight({ weight: 30, reps: 10, rpe: 3, overload: true }, 2.5, 10) === null, 'a Hard last set never suggests more');
  assert(nextTryWeight({ weight: 30, reps: 10, rpe: 1, overload: true }, 0, 10) === 32.5, 'a missing pin falls back to 2.5');
  assert(repeatToEarn({ weight: 30, rpe: 1, allEasy: true, overload: false }) && !repeatToEarn({ weight: 30, rpe: 1, allEasy: true, overload: true }) && !repeatToEarn({ weight: 30, rpe: 1, allEasy: false, overload: false }), 'repeat-to-earn needs the whole last session Easy, not one stray tap');

  // 1.6 The ramp's allowance is RECORDED on the set at save time and judged
  // from there — reconstructing it later drifted on memory RPE, pin map and
  // block cut all at once (adversary passes 1–3).
  // The one formula: prescription + one pin, never past the pre-break base.
  assert(allowedRampKg({ weight: 23, rpe: 2 }, 70, 4.5) === 22.5, 'Med 23 base at 70% on 4.5 pins: prescribed 18, allowed 22.5');
  assert(allowedRampKg({ weight: 27, rpe: 1 }, 70, 9) === 27, 'an Easy-held base is allowed exactly its prefill — following the box is never over-ramp');
  assert(allowedRampKg({ weight: 36, rpe: 1 }, 85, 7.5) === 36, 'one pin past pre-break before RESTORE is never allowed');
  assert(allowedRampKg({ weight: 40, rpe: 2 }, 60, 7) === 28, 'Lat Pulldown Med 40 at 60% on 7 kg pins: prescribed 21, allowed 28');
  assert(allowedRampKg({ weight: 40, rpe: 2 }, 100, 7) === null && allowedRampKg({ weight: 0 }, 60, 7) === null, 'no allowance at 100% or with no base');
  assert(allowedRampKg({ weight: 27, rampHold: true }, 60, 9) === 36, 'a held machine is allowed the Overload prefill the logger itself gives it during a ramp — one pin up (adversary pass 4)');
  // The judge reads the set.
  const w = (exerciseId: string, weight: number, allowedKg: number | null, rpe: number | null = 1, isWarmup = false) => ({ exerciseId, weight, allowedKg, rpe, isWarmup });
  assert(isOverRamp([w('cp', 27, 22.5)])?.lifted === 27, 'lifted above the recorded allowance is over-ramp');
  assert(isOverRamp([w('cp', 22.5, 22.5)]) === null, 'at the allowance is not');
  assert(isOverRamp([w('cp', 27, null)]) === null, 'a set with no allowance (historical, held, outside a ramp) cannot be over-ramp');
  assert(isOverRamp([w('cp', 27, 22.5, 1, true)]) === null, 'warm-ups are never judged');
  const worst = isOverRamp([w('cp', 24, 22.5), w('lp', 45, 30)])!;
  assert(worst.exerciseId === 'lp' && worst.allowed === 30, 'the verdict names the machine furthest over');
  // Verdicts: pure, no status, no base rebuild.
  const v = rampSessionVerdicts([
    { date: '2026-09-01T00:00:00.000Z', sets: [w('a', 20, 25), w('a', 20, 25)] },
    { date: '2026-09-06T00:00:00.000Z', sets: [w('a', 30, 25), w('a', 30, 25)] },
    { date: '2026-09-12T00:00:00.000Z', sets: [w('a', 30, null), w('a', 30, null, 3)] },
    { date: '2026-09-15T00:00:00.000Z', sets: [w('a', 30, null), w('a', 30, null)] },
  ]);
  assert(v.map((x) => x.clean).join() === 'true,false,false,true', `earned, over-ramp, Hard, historical-clean (got ${v.map((x) => x.clean).join()})`);
  assert(v[1].overRamp?.allowed === 25, 'the over-ramp verdict carries the recorded allowance');
  // A split save is ONE session: the heavy half decides — including a bare-midnight
  // Watch half beside a timestamped phone half of the same day (adversary pass 3).
  const split = rampSessionVerdicts([
    { date: '2026-07-20T00:00:00.000Z', sets: [w('a', 12.5, 15), w('a', 12.5, 15)] },
    { date: '2026-07-20T15:30:00.000Z', sets: [w('b', 40, 30), w('b', 40, 30)] },
  ]);
  assert(split.length === 1 && !split[0].clean, `a split save is judged once, by its heavy half (got ${JSON.stringify(split.map((x) => [x.clean, !!x.overRamp]))})`);
  const twoGyms = rampSessionVerdicts([
    { date: '2026-07-21T00:00:00.000Z', gym: 'bfit', sets: [w('a', 12.5, 15), w('a', 12.5, 15)] },
    { date: '2026-07-21T00:00:00.000Z', gym: 'work', sets: [w('a', 12.5, 15), w('a', 12.5, 15)] },
  ]);
  assert(twoGyms.length === 2, 'two buildings on one day are two sessions');
  // Keyed grouping: a bare-midnight row of day D sorts BEFORE a timestamped
  // 00:59Z row of day D-1, so adjacency alone left day D's later rows
  // ungrouped (adversary pass 4).
  const keyed = rampSessionVerdicts([
    { date: '2026-09-18T00:00:00.000Z', sets: [w('a', 20, 25), w('a', 20, 25)] },
    { date: '2026-09-18T00:59:59.000Z', sets: [w('b', 40, 45), w('b', 40, 45)] },
    { date: '2026-09-18T01:00:00.000Z', sets: [w('c', 60, 30), w('c', 60, 30)] },
  ]);
  assert(keyed.length === 2 && keyed.some((x) => x.overRamp?.exerciseId === 'c'), `rows of one day group by key, not adjacency (got ${keyed.length} groups)`);
  // Thursday, as it would be saved today: the server records what each set was allowed.
  const byName = new Map(data.exercises.map((e) => [e.name, e.id]));
  const set = (name: string, weight: number, allowed: number | null, rpe: number | null) => ({ exerciseId: byName.get(name)!, weight, reps: 10, rpe, isWarmup: false, allowedKg: allowed });
  const thursday = {
    date: '2026-09-17T00:00:00.000Z', name: 'Day A 45m — Sep 17', duration: 52 * 60,
    sets: [set('Leg Press', 37.5, 36, 1), set('Chest Press', 27, allowedRampKg({ weight: 23, rpe: 2 }, 70, 4.5), 2), set('Leg Extension', 30, allowedRampKg({ weight: 29, rpe: 2 }, 70, 9), 1)],
  };
  const history = [...data.workouts.filter((w) => w.name.startsWith('Day')), thursday];
  const clean = cleanRampSessionDates(history).map((d) => d.toISOString().slice(0, 10));
  assert(!clean.includes('2026-09-17'), `Thursday earned nothing — it was over-ramp (clean: ${clean.join(', ')})`);
  const thu = rampSessionVerdicts(history).find((x) => x.date.toISOString().startsWith('2026-09-17'))!;
  assert(!!thu && !thu.clean && !!thu.overRamp && thu.overRamp.lifted > thu.overRamp.allowed, `the verdict names the machine (got ${JSON.stringify(thu?.overRamp)})`);
  const stillCounts = getTrainingStatus(history.map((w) => new Date(w.date)), new Date('2026-09-18T12:00:00Z'), cleanRampSessionDates(history));
  assert(stillCounts.mode === 'return' && stillCounts.sessionsInBlock >= 4, 'it still counts as a session for calendar pacing — over-ramp is not punished');
}

// ── Tier 2.6: a removal is a fact the other device must honour ───────────
// Adversary 2026-09-18: a Watch-logged set un-ticked on the phone came back
// at finish — the Watch re-posts everything it logged, and the server had
// forgotten the removal the moment it deleted the key. Removals are now
// TOMBSTONES in the live row: kept, ordered by time, invisible to clients.
console.log('Tier 2 — live tombstones');
{
  const at = (m: number) => new Date(Date.UTC(2026, 8, 18, 10, m)).toISOString();
  const logged = (n: number, m: number, source: 'phone' | 'watch' = 'watch') =>
    ({ exerciseId: 'lat', setNumber: n, reps: 10, weight: 40, completedAt: at(m), source }) as const;
  // Watch logs set 1 at :00; phone removes it at :05.
  const s1 = mergeLiveSets([], [logged(1, 0)]);
  const s2 = mergeLiveSets(s1, [{ exerciseId: 'lat', setNumber: 1, remove: true, completedAt: at(5), source: 'phone' } as never]);
  assert(s2.length === 1 && s2[0].removed === true && s2[0].completedAt === at(5), 'a remove leaves a tombstone carrying its own time');
  assert(visibleSets(s2).length === 0, 'clients never see a tombstone');
  // The Watch re-posts the same set (its original :00 stamp): the tombstone is newer and wins.
  const s3 = mergeLiveSets(s2, [logged(1, 0)]);
  assert(s3.length === 1 && s3[0].removed === true, 'an older re-post cannot resurrect a removed set');
  // A GENUINE re-log later (:09) beats the tombstone.
  const s4 = mergeLiveSets(s2, [logged(1, 9)]);
  assert(s4.length === 1 && !s4[0].removed && s4[0].completedAt === at(9), 'a later real tick replaces the tombstone');
  // Finish: the posted sets themselves are filtered against tombstones.
  const posted = [{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 40, completedAt: at(0) }, { exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40, completedAt: at(2) }];
  const kept = dropRemovedSets(posted, s2);
  assert(kept.length === 1 && kept[0].setNumber === 2, 'the finish drops a posted set the other device removed after it was logged');
  const keptLater = dropRemovedSets([{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 40, completedAt: at(9) }], s2);
  assert(keptLater.length === 1, 'a set re-ticked AFTER the removal is kept');
  const noStamp = dropRemovedSets([{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 40 }], s2);
  assert(noStamp.length === 0, 'a posted set with no stamp yields to a tombstone (the removal is the later fact we know)');
  // Union never re-adds a tombstoned key.
  const u = unionForFinish([{ exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40 }], s2, 'phone');
  assert(u.length === 1 && u[0].setNumber === 2, 'the union skips tombstones');
  // Overlay: a newer tombstone un-ticks the local copy; an older one does not.
  const mk = (n: number, extra: Partial<OverlaySet> = {}): OverlaySet => ({ exerciseId: 'lat', setNumber: n, reps: 10, weight: 40, done: false, notes: '', rpe: 0, completedAt: null, ...extra });
  const ovA = overlayLiveSets([{ exerciseId: 'lat', sets: [mk(1, { done: true, completedAt: at(0) }), mk(2)] }], s2, (id) => ({ exerciseId: id, sets: [] }));
  assert(ovA.blocks[0].sets[0].done === false, 'a newer tombstone un-ticks the local set');
  const ovB = overlayLiveSets([{ exerciseId: 'lat', sets: [mk(1, { done: true, completedAt: at(9) }), mk(2)] }], s2, (id) => ({ exerciseId: id, sets: [] }));
  assert(ovB.blocks[0].sets[0].done === true, 'a local tick newer than the tombstone stays');
  // The MERGE path (second finisher after the row is closed): the Watch
  // re-posts set 1, which the phone un-ticked at :05 — it must not come back.
  const savedByPhone = [{ exerciseId: 'lat', setNumber: 2 }];
  const watchFinish = [{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 40, completedAt: at(0) }, { exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40, completedAt: at(2) }, { exerciseId: 'lat', setNumber: 3, reps: 10, weight: 40, completedAt: at(3) }];
  const cand = mergeCandidates(savedByPhone, watchFinish, s2);
  assert(cand.length === 1 && cand[0].setNumber === 3, `the merge adds only set 3 — set 2 is saved, set 1 was removed (got ${cand.map((c) => c.setNumber).join(',')})`);
  assert(mergeCandidates(savedByPhone, watchFinish, null).length === 2, 'with no live row the merge falls back to plain missing-by-key');
  // The client stamps a removal at the un-tick, so a same-device re-tick a second later wins.
  const stampedRemove = sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 2, remove: true, completedAt: at(10) }, 'phone')!;
  const afterRemove = mergeLiveSets([logged(2, 0, 'phone')], [stampedRemove]);
  const reTicked = mergeLiveSets(afterRemove, [{ exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40, completedAt: at(11), source: 'phone' } as never]);
  assert(afterRemove[0].completedAt === at(10) && visibleSets(reTicked).length === 1, 'a client-stamped removal is dated at the un-tick and yields to the later re-tick');
  const warmRemove = sanitizeLiveUpdate({ exerciseId: 'a', setNumber: 0, isWarmup: true, remove: true }, 'phone');
  assert(warmRemove !== null && 'remove' in warmRemove && warmRemove.isWarmup === true, 'a warm-up removal passes as set 0 with the flag');
  // Tombstones count toward the cap but never past it; sanitizer still refuses a bare set 0 remove.
  assert(sanitizeLiveUpdate({ exerciseId: 'lat', setNumber: 2, remove: true }, 'phone') !== null, 'remove still passes the sanitizer');
}

// ── summary ──────────────────────────────────────────────────────────────
// ── Tier 3 — progress compares to the last FULL-LOAD row (review 3.6) ──
console.log('Tier 3 — progress compares to the last full-load row');
{
  const rows = [
    { date: day('2026-06-01T12:00:00Z'), maxWeight: 40 },
    { date: day('2026-06-08T12:00:00Z'), maxWeight: 45 },
    { date: day('2026-09-06T12:00:00Z'), maxWeight: 27 }, // ramp, 60%
    { date: day('2026-09-12T12:00:00Z'), maxWeight: 32 }, // ramp, 70%
  ];
  const cut = day('2026-09-06T12:00:00Z').toISOString();
  assert(lastFullLoad(rows, cut)?.maxWeight === 45, 'during a ramp the figure compares to the last pre-break row, not the scaled one');
  assert(lastFullLoad(rows, null)?.maxWeight === 32, 'outside a ramp the latest row is the comparison');
  assert(lastFullLoad(rows.slice(2), cut) === undefined, 'a machine first met during the ramp has nothing full-load to compare — the tile shows a dash, not −100%');
  assert(lastFullLoad([], null) === undefined, 'no history, no figure');
}

// ── Tier 2.7: warm-ups travel in the live row; the later EDIT wins ───────
// Review 2026-10-02, two bugs on the handoff:
//  1. The phone's push skipped warm-ups ("the wrist has no such set" — it
//     has logged them since 2026-09-24), while the overlay put the Watch's
//     `ex#w` key in the phone's snapshot. Every snapshot key missing from
//     the push was "removed", so the phone tombstoned each warm-up the
//     Watch logged and the finish dropped it from history; and a warm-up
//     ticked on the phone never reached the row, so Continue asked for it
//     again. The phone now removes only what it showed ticked itself.
//  2. Phone ticks 20 kg unrated, the Watch copies it, the phone corrects to
//     22.5 Hard, the Watch finishes with its stale copy — and the poster
//     won: 20 kg, no rating, saved. Mirror: the phone finishes first and a
//     rating the Watch adds afterwards was dropped ("first finisher's
//     values"). A tick time cannot order two versions of ONE tick, so the
//     row carries an edit stamp per set and the finish picks by it.
console.log('Tier 2 — live session: warm-ups travel, the later edit wins');
{
  const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 10, m)).toISOString();
  const mk = (ex: string, n: number, extra: Partial<OverlaySet> = {}): OverlaySet => ({ exerciseId: ex, setNumber: n, reps: 10, weight: 40, done: false, notes: '', rpe: 0, completedAt: null, ...extra });
  const nb = (id: string) => ({ exerciseId: id, sets: [] as OverlaySet[] });
  const lv = (n: number, w: number, m: number, source: 'phone' | 'watch', extra: Partial<LiveSet> = {}): LiveSet => ({ exerciseId: 'lat', setNumber: n, reps: 10, weight: w, completedAt: at(m), source, ...extra });

  // ── Bug 1: warm-ups ──
  const watchWarm: LiveSet = { exerciseId: 'lat', setNumber: 0, reps: 10, weight: 15, isWarmup: true, completedAt: at(0), source: 'watch' };
  const ov = overlayLiveSets([{ exerciseId: 'lat', sets: [mk('lat', 0, { isWarmup: true, weight: 15 }), mk('lat', 1)] }], [watchWarm], nb);
  const snap = new Map(ov.applied.map((s) => [liveKey(s), liveSerial(s)]));
  const d1 = liveDiff(ownLiveSets(ov.blocks, 'phone'), snap, new Set(), at(1));
  assert(d1.updates.length === 0, `a Watch warm-up overlaid on the phone is neither pushed back nor tombstoned (got ${JSON.stringify(d1.updates)})`);
  // The other direction: a warm-up ticked on the phone reaches the row under the Watch's key (set 0 + flag).
  const ownWarm = ownLiveSets([{ exerciseId: 'lat', sets: [mk('lat', 1, { isWarmup: true, weight: 15, done: true, completedAt: at(0) }), mk('lat', 1, { done: true, completedAt: at(2) })] }], 'phone');
  const pw = ownWarm.find((s) => s.isWarmup);
  assert(ownWarm.length === 2 && !!pw && pw.setNumber === 0 && liveKey(pw) === 'lat#w', `a warm-up ticked on the phone travels as set 0 + isWarmup (got ${JSON.stringify(ownWarm.map((s) => liveKey(s)))})`);
  const d2 = liveDiff(ownWarm, new Map(), new Set(), at(3));
  const rowW = mergeLiveSets([], d2.updates.map((u) => sanitizeLiveUpdate(u, 'phone')!).filter(Boolean));
  assert(visibleSets(rowW).some((s) => s.isWarmup && s.setNumber === 0 && s.weight === 15) && visibleSets(rowW).length === 2, 'the row holds the phone warm-up beside working set 1 — the wrist will not ask for it again');
  // The phone never tombstones a set it did not itself remove: a key the
  // overlay put in the snapshot BEFORE the blocks caught up (the updater
  // runs eagerly, blocksRef only on render) is not "removed".
  const raceSnap = new Map([[liveKey(lv(1, 40, 0, 'watch')), liveSerial(lv(1, 40, 0, 'watch'))]]);
  const d3 = liveDiff([], raceSnap, new Set(), at(1));
  assert(d3.updates.length === 0, 'a snapshot key this phone never showed ticked is not tombstoned');
  // …but his own un-tick still is, stamped at the un-tick, warm-up included.
  const tickedSet = new Set(['lat#1', 'lat#w']);
  const d4 = liveDiff([], new Map([['lat#1', 'x'], ['lat#w', 'y']]), tickedSet, at(6));
  const rm = d4.updates.filter((u) => 'remove' in u);
  assert(rm.length === 2 && rm.every((u) => u.completedAt === at(6)) && rm.some((u) => u.isWarmup === true && u.setNumber === 0), 'a set un-ticked HERE is removed, stamped at the un-tick; the warm-up as set 0 + flag');
  // A removal that came FROM the row is reported, so the form can forget the key instead of re-sending it later-stamped.
  const tomb = mergeLiveSets([lv(1, 40, 0, 'watch')], [{ exerciseId: 'lat', setNumber: 1, remove: true, completedAt: at(5), source: 'watch' }]);
  const ovT = overlayLiveSets([{ exerciseId: 'lat', sets: [mk('lat', 1, { done: true, completedAt: at(0) })] }], tomb, nb);
  assert(ovT.unticked?.length === 1 && ovT.unticked[0] === 'lat#1', 'the overlay names the keys the other device un-ticked');

  // ── Bug 2: the live row orders versions of one tick by edit stamp ──
  const t0 = lv(1, 20, 0, 'phone');
  const snapE = new Map([[liveKey(t0), liveSerial(t0)]]);
  const corrected = lv(1, 22.5, 0, 'phone', { rpe: 3 });
  const dE = liveDiff([corrected], snapE, new Set(['lat#1']), at(3));
  assert(dE.updates.length === 1 && (dE.updates[0] as LiveSet).editedAt === at(3), 'a change to a set the row already holds is stamped as an edit');
  assert((liveDiff([t0], new Map(), new Set(), at(1)).updates[0] as LiveSet).editedAt === undefined, 'a first tick carries no edit stamp — its tick time is its version');
  const sE = sanitizeLiveUpdate(dE.updates[0], 'phone', new Date(at(3))) as LiveSet;
  assert(sE.editedAt === at(3), 'the edit stamp passes the sanitizer');
  assert((sanitizeLiveUpdate({ ...corrected, editedAt: 'junk' }, 'phone') as LiveSet).editedAt === undefined, 'a junk edit stamp is dropped, not fatal');
  assert((sanitizeLiveUpdate({ ...corrected, editedAt: at(50) }, 'phone', new Date(at(4))) as LiveSet).editedAt === at(4), 'an edit stamp from the future is pinned to now');
  const rowE = mergeLiveSets([t0], [sE], new Date(at(3)));
  assert(rowE[0].weight === 22.5 && rowE[0].rpe === 3 && rowE[0].editedAt === at(3), 'the correction replaces the first version on the row');
  // A stale copy of the same tick from the OTHER device is not an edit.
  const rowStale = mergeLiveSets(rowE, [lv(1, 20, 0, 'watch')], new Date(at(8)));
  assert(rowStale[0].weight === 22.5 && rowStale[0].rpe === 3 && rowStale[0].source === 'phone', `a stale copy posted to the row loses to the later edit (got ${rowStale[0].weight}/${rowStale[0].rpe})`);
  // A device re-posting its OWN set changed (the wrist's rating) is an edit, stamped on arrival.
  const rated = mergeLiveSets([lv(2, 40, 1, 'watch')], [lv(2, 40, 1, 'watch', { rpe: 2 })], new Date(at(4)));
  assert(rated[0].rpe === 2 && rated[0].editedAt === at(4), 'the wrist rating its own set is an edit, stamped on arrival');
  // An identical re-post changes nothing — not the owner, not the stamp.
  const same = mergeLiveSets(rowE, [lv(1, 22.5, 0, 'watch', { rpe: 3 })], new Date(at(9)));
  assert(same[0].source === 'phone' && same[0].editedAt === at(3), 'an identical re-post leaves the stored set alone');
  // No rating never erases the other device's rating at the same load.
  const keepR = mergeLiveSets([lv(3, 40, 2, 'watch', { rpe: 3 })], [lv(3, 40, 2, 'phone', { editedAt: at(5) })], new Date(at(5)));
  assert(keepR[0].rpe === 3, 'an unrated copy from the other device does not erase a rating at the same weight × reps');

  // ── Bug 2: the finish ──
  // The demonstrated case, with a Watch build that stamps its sets and one that does not (build 13).
  for (const stamp of [at(0), undefined]) {
    const r = resolveFinishSets<FinishSet & { notes?: string }>([{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 20, completedAt: stamp, notes: 'n' }], rowE, 'watch');
    assert(r.length === 1 && r[0].weight === 22.5 && r[0].rpe === 3 && r[0].notes === 'n', `the Watch's stale copy loses to the phone's later correction at finish (stamp ${stamp ? 'sent' : 'absent'}; got ${r[0]?.weight}/${r[0]?.rpe})`);
  }
  // The poster's own set: its copy is the newest there is (an un-pushed rating).
  const own = resolveFinishSets([{ exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40, rpe: 3, completedAt: at(1) }], rated, 'watch');
  assert(own[0].rpe === 3, 'the finishing device wins on a set it wrote last itself');
  // Same tick, never edited on the row, the poster changed it un-pushed: poster — but a rating is never lost.
  const tie = resolveFinishSets<FinishSet>([{ exerciseId: 'lat', setNumber: 3, reps: 10, weight: 40, completedAt: at(2) }], [lv(3, 40, 2, 'phone', { rpe: 3 })], 'watch');
  assert(tie[0].rpe === 3, 'an unrated copy never overwrites a rated one when weight and reps agree');
  const reTick = resolveFinishSets([{ exerciseId: 'lat', setNumber: 1, reps: 8, weight: 25, completedAt: at(9) }], rowE, 'watch');
  assert(reTick[0].weight === 25, 'a set the poster logged AFTER the row’s last edit wins');
  assert(resolveFinishSets([{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 40, completedAt: at(0) }], tomb, 'phone').length === 0, 'tombstones still drop a posted set');
  // Second finisher: the phone saved first; the Watch then rated its own set.
  const savedU = [{ exerciseId: 'lat', setNumber: 2, isWarmup: false, reps: 10, weight: 40, rpe: null, completedAt: at(1) }];
  const liveU = [lv(2, 40, 1, 'watch')];
  const lateRating = [{ exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40, rpe: 3, completedAt: at(1) }];
  const up = finishUpdates(savedU, lateRating, liveU, 'watch');
  assert(up.length === 1 && up[0].rpe === 3 && up[0].weight === 40, `a rating the Watch added after the phone finished reaches the saved set (got ${JSON.stringify(up)})`);
  assert(up.every((x) => !('allowedKg' in x) && !('notes' in x)), 'the update carries the logged values only — the recorded prescription is never rewritten from a device copy');
  assert(finishUpdates([{ ...savedU[0], rpe: 3 }], lateRating, liveU, 'watch').length === 0, 'a replay of the same finish updates nothing');
  // The phone saved its correction; the Watch's stale copy must not undo it.
  const savedC = [{ exerciseId: 'lat', setNumber: 1, isWarmup: false, reps: 10, weight: 22.5, rpe: 3, completedAt: at(0) }];
  assert(finishUpdates(savedC, [{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 20, completedAt: at(0) }], rowE, 'watch').length === 0, 'a stale copy never rewrites the saved correction');
  // …nor when the correction was saved inside the push debounce and the row never saw it.
  assert(finishUpdates(savedC, [{ exerciseId: 'lat', setNumber: 1, reps: 10, weight: 20, rpe: 2, completedAt: at(0) }], [lv(1, 20, 0, 'watch')], 'watch').length === 0, 'a saved value the row never saw is the first finisher’s un-pushed edit — it stands');
  // No row at all: only a missing rating is filled.
  const noRow = finishUpdates(savedU, [{ exerciseId: 'lat', setNumber: 2, reps: 10, weight: 40, rpe: 2 }, { exerciseId: 'lat', setNumber: 9, reps: 10, weight: 40 }], null, 'watch');
  assert(noRow.length === 1 && noRow[0].rpe === 2, 'with no live row a second finish fills a missing rating and nothing else');
  // ── Blind review of the above (2026-10-02, second pass) ──
  // 1. A rating describes the SET, a corrected load describes the stack:
  //    the wrist rating its set after the phone corrected the weight was
  //    dropped on every path, because the graft asked for equal loads.
  //    Must hold for a Watch build that sends no edit stamp.
  const w0 = mergeLiveSets([], [lv(4, 20, 1, 'watch')]);
  const w1 = mergeLiveSets(w0, [lv(4, 22.5, 1, 'phone', { editedAt: at(3) })], new Date(at(3)));
  const w2 = mergeLiveSets(w1, [lv(4, 20, 1, 'watch', { rpe: 3 })], new Date(at(5)));
  assert(w2[0].weight === 22.5 && w2[0].rpe === 3 && w2[0].source === 'phone', `the wrist's rating lands on the phone's corrected load in the row (got ${w2[0].weight}/${w2[0].rpe})`);
  const wf = resolveFinishSets<FinishSet>([{ exerciseId: 'lat', setNumber: 4, reps: 10, weight: 20, rpe: 3, completedAt: at(1) }], w1, 'watch');
  assert(wf[0].weight === 22.5 && wf[0].rpe === 3, `…and at the Watch's finish (got ${wf[0].weight}/${wf[0].rpe})`);
  const pf = resolveFinishSets<FinishSet>([{ exerciseId: 'lat', setNumber: 4, reps: 10, weight: 22.5, completedAt: at(1) }], w2, 'phone');
  assert(pf[0].weight === 22.5 && pf[0].rpe === 3, '…and at the phone’s finish, which never saw the rating');
  const uf = finishUpdates([{ exerciseId: 'lat', setNumber: 4, isWarmup: false, reps: 10, weight: 22.5, rpe: null, completedAt: at(1) }], [{ exerciseId: 'lat', setNumber: 4, reps: 10, weight: 20, rpe: 3, completedAt: at(1) }], w1, 'watch');
  assert(uf.length === 1 && uf[0].weight === 22.5 && uf[0].rpe === 3, `…and when the phone had already finished (got ${JSON.stringify(uf)})`);
  const nr = finishUpdates(savedU, [{ exerciseId: 'lat', setNumber: 2, reps: 10, weight: 45, rpe: 2 }], null, 'watch');
  assert(nr.length === 1 && nr[0].weight === 40 && nr[0].rpe === 2, 'with no live row a different weight never overwrites the saved one — but its rating fills a missing one');
  // The wrist cannot change a logged set's load without a new tick, so its
  // same-tick post onto a version the phone wrote is a RATING, stamped or not.
  const w3 = mergeLiveSets(mergeLiveSets(w1, [lv(4, 22.5, 1, 'phone', { rpe: 2, editedAt: at(4) })], new Date(at(4))), [lv(4, 20, 1, 'watch', { rpe: 4, editedAt: at(6) })], new Date(at(6)));
  assert(w3[0].weight === 22.5 && w3[0].rpe === 4, `a stamped re-rating from the wrist changes the rating, never the phone's load (got ${w3[0].weight}/${w3[0].rpe})`);

  // The Watch now stamps a rated set in the finish payload too. The stamp
  // must reach the merge (it was dropped by the route's sanitizer) — and
  // must carry the RATING only: a later-stamped wrist copy of a set whose
  // load the phone corrected would otherwise bring the stale load back.
  const wl = (editedAt: unknown) => sanitizeWatchLogSets([{ exerciseId: 'lat', setNumber: 4, reps: 10, weight: 20, rpe: 4, completedAt: at(1), editedAt }], new Date(at(9)))[0];
  assert(wl(at(8)).editedAt === at(8), 'the Watch finish keeps a set’s edit stamp for the merge');
  assert(wl('junk').editedAt === undefined && wl(at(50)).editedAt === at(9) && wl(at(0)).editedAt === at(1), 'a junk stamp is dropped, a future one pinned to now, one before the tick floored at it');
  const phoneRated = mergeLiveSets(w1, [lv(4, 22.5, 1, 'phone', { rpe: 2, editedAt: at(4) })], new Date(at(4)));
  const ws = resolveFinishSets([wl(at(8))], phoneRated, 'watch', new Date(at(9)));
  assert(ws[0].weight === 22.5 && ws[0].rpe === 4, `a stamped wrist rating wins the rating at finish and leaves the phone's load (got ${ws[0].weight}/${ws[0].rpe})`);
  const wu2 = finishUpdates([{ exerciseId: 'lat', setNumber: 4, isWarmup: false, reps: 10, weight: 22.5, rpe: 2, completedAt: at(1) }], [wl(at(8))], phoneRated, 'watch', new Date(at(9)));
  assert(wu2.length === 1 && wu2[0].weight === 22.5 && wu2[0].rpe === 4, `…and after the phone finished first (got ${JSON.stringify(wu2)})`);
  assert(!('editedAt' in (wu2[0] ?? {})), 'the edit stamp is never part of what is written to a saved set');

  // 2. A phone correction that never reached the row (Save inside the push
  //    debounce, an offline flush) was dated by its tick at the phone's own
  //    finish and lost to the row. The save now carries the edit's stamp.
  const edits = new Map<string, { ser: string; at: string }>();
  const wRated = lv(5, 20, 1, 'watch', { rpe: 3 });
  const snapW = new Map([[liveKey(wRated), liveSerial(wRated)]]);
  const fixed = lv(5, 22.5, 1, 'phone', { rpe: 3 });
  liveDiff([fixed], snapW, new Set(), at(6), edits);
  liveDiff([fixed], snapW, new Set(), at(9), edits);
  assert(edits.get('lat#5')?.at === at(6), 'an edit is dated when it was first seen, not at each retry of its push');
  const stamped = withEditStamps<FinishSet>([{ exerciseId: 'lat', setNumber: 5, reps: 10, weight: 22.5, rpe: 3, completedAt: at(1) }, { exerciseId: 'lat', setNumber: 6, reps: 10, weight: 40, completedAt: at(2) }], edits);
  assert(stamped[0].editedAt === at(6) && stamped[1].editedAt === undefined, 'the finish payload carries the edit stamp of a set changed after its tick, and only of that set');
  const rowLater = [lv(5, 20, 1, 'watch', { rpe: 3, editedAt: at(4) })];
  const pe = resolveFinishSets(stamped, rowLater, 'phone', new Date(at(7)));
  assert(pe[0].weight === 22.5 && pe[0].rpe === 3, `the phone's un-pushed correction wins at its own finish (got ${pe[0].weight}/${pe[0].rpe})`);
  const early = resolveFinishSets<FinishSet>([{ exerciseId: 'lat', setNumber: 5, reps: 10, weight: 22.5, completedAt: at(1), editedAt: at(0) }], [lv(5, 20, 1, 'watch')], 'phone', new Date(at(7)));
  assert(early[0].weight === 22.5, 'an edit stamped before its own tick is dated at the tick — it cannot lose to the version it edited');

  // 3. A phone whose clock runs behind: its correction of a Watch set was
  //    older than the server's stamp, silently rejected, and recorded as
  //    pushed. Live edits are dated by ARRIVAL; a stamp only says "edit".
  const floor = sanitizeLiveUpdate({ ...fixed, completedAt: at(5), editedAt: at(2) }, 'phone', new Date(at(8))) as LiveSet;
  assert(floor.editedAt === at(5), 'an edit cannot precede its tick: the stamp is floored at completedAt');
  const behind = mergeLiveSets(rowLater.map((s) => ({ ...s, editedAt: at(10) })), [lv(5, 22.5, 1, 'phone', { rpe: 3, editedAt: at(3) })], new Date(at(11)));
  assert(behind[0].weight === 22.5 && behind[0].editedAt === at(11), `an edit from a phone with a slow clock still lands, dated by arrival (got ${behind[0].weight} @ ${behind[0].editedAt})`);
  const pushed = new Map([['lat#5', liveSerial(fixed)], ['lat#6', liveSerial(lv(6, 40, 2, 'phone'))], ['lat#7', liveSerial(lv(7, 40, 3, 'phone'))]]);
  const landed = landedSerials(pushed, [...rowLater, lv(6, 40, 2, 'phone'), { ...lv(7, 0, 4, 'watch'), removed: true }]);
  assert(landed.size === 1 && landed.has('lat#6'), `a push is recorded only when the row holds that version (got ${[...landed.keys()].join(',')})`);
  // The phone adopts what the row holds that it did not write: the other
  // device's versions, and a rating grafted onto its own corrected set.
  const adopt = liveToAdopt(
    [lv(4, 22.5, 1, 'phone', { rpe: 3 }), lv(6, 40, 2, 'phone'), lv(8, 30, 3, 'watch')],
    new Map([['lat#4', liveSerial(lv(4, 22.5, 1, 'phone'))], ['lat#6', liveSerial(lv(6, 40, 2, 'phone', { rpe: 2 }))]]),
    'phone',
  );
  assert(adopt.length === 2 && adopt.some((s) => s.setNumber === 4) && adopt.some((s) => s.setNumber === 8), `the phone adopts a rating the row gained on its own set, never an older copy of its own edit (got ${adopt.map((s) => s.setNumber).join(',')})`);

  // 4. A malformed row must never make a save throw (data-steward).
  const cleanRow = validLiveSets([null, 'x', 7, { exerciseId: 1, setNumber: 1 }, { exerciseId: 'lat', setNumber: 1, reps: 'x', weight: 1, completedAt: at(0), source: 'phone' }, { exerciseId: 'lat', setNumber: 1, reps: 10, weight: 20, completedAt: 'never', source: 'phone' }, lv(1, 20, 0, 'phone'), { exerciseId: 'lat', setNumber: 2, completedAt: at(1), removed: true, source: 'watch' }]);
  assert(cleanRow.length === 2 && cleanRow[0].weight === 20 && cleanRow[1].removed === true && cleanRow[1].reps === 0, `junk elements of a stored row are dropped, tombstones kept (got ${cleanRow.length})`);
  assert(validLiveSets('nope').length === 0 && validLiveSets(null).length === 0, 'a row that is not an array is no sets');
  // 5. Two sets under one key in ONE payload hit the unique index on every
  //    retry — but a set he ticked must never vanish at save (owner's rule;
  //    the first fix collapsed them last-wins and dropped a real set). Two
  //    blocks of one exercise: the later set takes the next free number.
  //    Only a replay of ONE tick (same values, same instant) collapses.
  const dd = dedupeByKey([
    { exerciseId: 'lat', setNumber: 1, reps: 10, weight: 20, completedAt: at(1) },
    { exerciseId: 'lat', setNumber: 2, reps: 10, weight: 20, completedAt: at(2) },
    { exerciseId: 'lat', setNumber: 0, isWarmup: true, reps: 10, weight: 10, completedAt: at(0) },
    { exerciseId: 'lat', setNumber: 1, reps: 9, weight: 22.5, completedAt: at(3) },
    { exerciseId: 'lat', setNumber: 1, reps: 10, weight: 20, completedAt: at(1) },
  ]);
  assert(dd.length === 4 && dd.some((x) => x.setNumber === 1 && x.weight === 20) && dd.some((x) => x.setNumber === 3 && x.weight === 22.5), `a second set under one key is renumbered to the next free number, never dropped; a replay of one tick collapses (got ${JSON.stringify(dd.map((x) => [x.setNumber, x.weight]))})`);
  assert(new Set(dd.map((x) => liveKey(x))).size === dd.length, 'every key in the result is unique — the unique index cannot throw');
  // A warm-up is never renumbered into a working set: the first stands,
  // a later one replaces its values only as the same tick, and a
  // different one is reported, not dropped in silence.
  const warned: unknown[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a); };
  const dw = dedupeByKey([
    { exerciseId: 'lat', setNumber: 0, isWarmup: true, reps: 10, weight: 10, completedAt: at(0) },
    { exerciseId: 'lat', setNumber: 0, isWarmup: true, reps: 12, weight: 10, completedAt: at(0) },
    { exerciseId: 'lat', setNumber: 0, isWarmup: true, reps: 10, weight: 15, completedAt: at(4) },
  ]);
  console.warn = realWarn;
  assert(dw.length === 1 && dw[0].isWarmup === true && dw[0].reps === 12 && dw[0].weight === 10 && warned.length === 1, `one warm-up per machine: same tick updates it, a different one is kept out and logged (got ${JSON.stringify(dw)} / ${warned.length} warnings)`);
  // 6. Deleting, on the phone, a set the Watch logged IS a removal (he
  //    deleted a set he sees) — `ticked` means "shown ticked here",
  //    whoever logged it. Wholesale rebuilds reset it in the form.
  const seen = new Set<string>();
  const snapO = new Map([['lat#8', liveSerial(lv(8, 30, 3, 'watch'))]]);
  liveDiff([lv(8, 30, 3, 'phone')], snapO, seen, at(4));
  const del = liveDiff([], snapO, seen, at(5));
  assert(del.updates.length === 1 && 'remove' in del.updates[0], 'a Watch set shown ticked on the phone and then deleted there is removed');
}

// ── Week 4 of the ramp: one machine's 100% session must not null the cut for the others ──
console.log('Ramp cut — week 4 (adversary, 2026-09-18)');
{
  const sess = (date: string, name: string, w: number) => ({
    date: day(date + 'T00:00:00Z'), name, gym: 'bfit', duration: 2400,
    sets: [1, 2, 3, 4, 5, 6].map(() => ({ rpe: 2, isWarmup: false, weight: w, exerciseId: 'lat' })),
  });
  const pre = [
    sess('2026-05-10', 'Day B 30m — May 10', 26), sess('2026-05-13', 'Day A 45m — May 13', 0),
    sess('2026-05-19', 'Day B 45m — May 19', 40), sess('2026-05-23', 'Day A 45m — May 23', 0),
    sess('2026-05-30', 'Day B 45m — May 30', 40), sess('2026-06-16', 'Day A 30m — Jun 16', 0),
  ];
  const ramp = [
    sess('2026-09-01', 'Day B — Sep 1', 24), sess('2026-09-04', 'Day A — Sep 4', 0),
    sess('2026-09-08', 'Day B — Sep 8', 28), sess('2026-09-11', 'Day A — Sep 11', 0),
    sess('2026-09-15', 'Day B — Sep 15', 32), sess('2026-09-18', 'Day A — Sep 18', 0),
  ];
  const cutOn = (rows: ReturnType<typeof sess>[], now: Date) => {
    const training = rows.filter((w) => isTrainingSession(w));
    const clean = cleanRampSessionDates(training);
    const status = getTrainingStatus(training.map((w) => w.date), now, clean);
    return { status, cut: rampBaseBefore(training, clean, now) };
  };
  const before = cutOn([...pre, ...ramp], day('2026-09-22T00:00:00Z'));
  assert(before.status.mode === 'return' && before.status.returnWeek.loadPct === 100, `week 4 at 100% (got ${before.status.mode} ${before.status.mode === 'return' ? before.status.returnWeek.loadPct : ''})`);
  assert(before.cut === day('2026-09-01T00:00:00Z').toISOString(), `before the first week-4 session the cut is the first ramp session (got ${before.cut})`);
  const after = cutOn([...pre, ...ramp, sess('2026-09-22', 'Day A — Sep 22', 0)], day('2026-09-23T00:00:00Z'));
  assert(after.status.mode === 'return', 'one week-4 session does not end the ramp');
  assert(after.cut === day('2026-09-01T00:00:00Z').toISOString(), `Day A at 100% keeps the cut for Day B's machines — Lat Pulldown still reads 40, not its 85% row (got ${after.cut})`);
  const latHist = [
    { date: day('2026-05-19T00:00:00Z'), maxWeight: 40 }, { date: day('2026-05-30T00:00:00Z'), maxWeight: 40 },
    { date: day('2026-09-01T00:00:00Z'), maxWeight: 24 }, { date: day('2026-09-15T00:00:00Z'), maxWeight: 32 },
  ];
  assert(lastFullLoad(latHist, after.cut)?.maxWeight === 40, 'the progress tile compares to 40 the morning after');
  const done = cutOn([...pre, ...ramp, sess('2026-09-22', 'Day A — Sep 22', 0), sess('2026-09-25', 'Day B — Sep 25', 40)], day('2026-09-27T00:00:00Z'));
  assert(done.status.mode === 'normal', `two week-4 sessions finish the ramp (got ${done.status.mode})`);
  assert(done.cut === day('2026-09-01T00:00:00Z').toISOString(), 'the cut stands until a session is logged OUTSIDE the block — a machine skipped in week 4 must not read its 85% row');
  const later = cutOn([...pre, ...ramp, sess('2026-09-22', 'Day A — Sep 22', 0), sess('2026-09-25', 'Day B — Sep 25', 40), sess('2026-09-29', 'Day A — Sep 29', 0)], day('2026-09-30T00:00:00Z'));
  assert(later.cut === null, 'the first normal-mode session clears it — plain memory is right again');
  // A rescue logged in normal mode is 60% by construction and never a base
  // for rampBaseBefore's WALK (it reads a rescue as a scaled session inside a
  // ramp). prescriptionInputs no longer ASKS for a cut outside a ramp — the
  // rescue row is left out of memory itself; pinned in "Audit 2" (2026-10-02).
  const rescue = cutOn([
    sess('2026-08-01', 'Day B 45m — Aug 1', 40), sess('2026-08-05', 'Day A 45m — Aug 5', 0),
    sess('2026-08-09', 'Day B 45m — Aug 9', 42.5), sess('2026-08-13', 'Rescue 15m — Aug 13', 25),
  ], day('2026-08-15T00:00:00Z'));
  assert(rescue.status.mode === 'normal' && rescue.cut === day('2026-08-13T00:00:00Z').toISOString(), `rampBaseBefore still walks past a trailing rescue as a scaled session (got ${rescue.status.mode} ${rescue.cut})`);
}

// ── Doctor report: family history and investigations are not printed (owner, 2026-09-30) ──
console.log('Doctor report — sections the owner removed');
{
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
    const src = read(f);
    assert(!/Family history:/.test(src), `${f} does not print a family history line`);
    assert(!/Investigations:/.test(src), `${f} does not print an investigations line`);
    assert(!/profile\.familyHistory|profile\.investigations/.test(src), `${f} does not read them off the profile`);
  }
  // Removed from the report only; the data itself is kept.
  assert(/familyHistory/.test(read('src/app/api/health/export/route.ts')), 'the export still carries family history');
  assert(/investigations/.test(read('src/app/api/health/profile/route.ts')), 'the profile pipe still stores investigations');
}

// ── Doctor report trend charts (owner, 2026-09-30) ──
console.log('Doctor report — trend charts');
{
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const inBox = (c: ReturnType<typeof layoutChart>) =>
    c.series.every((s) => s.points.every((p) => p.x >= c.plot.left - 0.01 && p.x <= c.plot.right + 0.01 && p.y >= c.plot.top - 0.01 && p.y <= c.plot.bottom + 0.01));

  // Too few points is words, not a chart (tracker, not diagnostic).
  assert(weightChart([{ date: d('2026-09-01'), weight: 127 }, { date: d('2026-09-08'), weight: 126 }]) === null, 'two weigh-ins are not a weight trend');
  const w = weightChart([
    { date: d('2026-09-01'), weight: 127.9 }, { date: d('2026-09-08'), weight: null },
    { date: d('2026-09-15'), weight: 126.4 }, { date: d('2026-09-22'), weight: 125.6 }, { date: d('2026-09-29'), weight: 125.0 },
  ]);
  assert(w !== null && w.series[0].points.length === 4, 'a weigh-in without a weight is skipped, four make a chart');
  const wc = layoutChart(w!, 320, 112);
  assert(inBox(wc), 'every weight point lands inside the plot');
  const wTicks = wc.yTicks.map((t) => Number(t.label));
  assert(Math.min(...wTicks) <= 125 && Math.max(...wTicks) >= 127.9, `weight ticks bracket the data (got ${wTicks.join(',')})`);
  assert(wc.series[0].points[0].y < wc.series[0].points[2].y, 'a falling weight draws downward (first point higher on the page)');

  // BP: two lines, one chart.
  const bpc = bpChart([
    { at: d('2026-09-08'), systolic: 114, diastolic: 73 },
    { at: d('2026-09-11'), systolic: 112, diastolic: 72 },
    { at: d('2026-09-15'), systolic: 118, diastolic: 66 },
    { at: d('2026-09-18'), systolic: 116, diastolic: 70 },
  ]);
  assert(bpc !== null && bpc.series.map((s) => s.key).join() === 'systolic,diastolic', 'BP charts systolic and diastolic together');
  assert(bpChart([{ at: d('2026-09-08'), systolic: 114, diastolic: 73 }]) === null, 'one BP reading is not a trend');

  // CPAP: hours as bars from zero with the 4 h line; AHI skips unmeasured nights.
  const nights = [
    { night: d('2026-09-26'), usageHours: 7.1, ahi: 3 },
    { night: d('2026-09-27'), usageHours: 0.5, ahi: null },
    { night: d('2026-09-28'), usageHours: 3.65, ahi: 2 },
    { night: d('2026-09-29'), usageHours: 4.82, ahi: 1 },
    { night: d('2026-09-30'), usageHours: 6.1, ahi: 2 },
  ];
  const hc = cpapHoursChart(nights);
  assert(hc !== null && hc.series[0].kind === 'bar' && hc.zeroBased, 'CPAP hours are bars from zero');
  const hcl = layoutChart(hc!, 320, 112);
  assert(hcl.refs.length === 1 && hcl.refs[0].y > hcl.plot.top && hcl.refs[0].y < hcl.plot.bottom, 'the 4 h line sits inside the plot');
  assert(Number(hcl.yTicks[0].label) === 0, 'hours axis starts at 0');
  assert(hcl.series[0].barWidth > 0 && inBox(hcl), 'bars have width and stay inside the plot');
  const ac = cpapAhiChart(nights);
  assert(ac !== null && ac.series[0].points.length === 4, 'a night without AHI is absent, never zero');

  // Dose: a step that holds between injections and runs on to today.
  const dc = doseChart(
    [{ at: d('2026-09-08'), doseMg: 2.5 }, { at: d('2026-09-15'), doseMg: 2.5 }, { at: d('2026-09-22'), doseMg: 5 }, { at: d('2026-09-29'), doseMg: 5 }],
    d('2026-10-03'),
  );
  assert(dc !== null && dc.series[0].kind === 'step' && dc.zeroBased, 'the dose is a step from zero');
  const dcl = layoutChart(dc!, 320, 112);
  const steps = dcl.series[0].path;
  assert(steps.length === 4 * 2 - 1 + 1, `a step path has a corner per change plus the run to today (got ${steps.length})`);
  assert(Math.abs(steps[steps.length - 1].x - dcl.plot.right) < 0.01, 'the current dose runs to the right edge (today)');
  assert(steps[1].y === steps[0].y && steps[1].x === steps[2].x, 'the dose holds flat until the next injection, then steps');
  assert(doseChart([{ at: d('2026-09-15'), doseMg: 2.5 }]) === null, 'one injection is not a schedule');

  // Scale edge: a flat series still gets a visible band.
  const flat = yScale([5, 5, 5], false);
  assert(flat.max > flat.min, 'a flat series is not a zero-height axis');

  // One geometry for both surfaces.
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
    const t = src(f);
    for (const fn of ['weightChart', 'bpChart', 'cpapHoursChart', 'cpapAhiChart', 'doseChart']) {
      assert(t.includes(fn), `${f} draws ${fn}`);
    }
  }
  const pdfSrc = src('src/app/api/health/report-pdf/route.ts');
  assert(/y = top - H - 16;/.test(pdfSrc), 'the PDF leaves room under a chart for its date labels');
  assert(/const section = \(title: string\) => \{[\s\S]{0,300}ensure\((5\d|6\d)\)/.test(pdfSrc), 'a PDF section heading needs room for its first rows before a page ends');
  // Two pages: the written report, then every chart together.
  const trendsAt = pdfSrc.indexOf("text('Trends'");
  assert(trendsAt > 0 && pdfSrc.lastIndexOf('doc.addPage(A4)', trendsAt) > pdfSrc.indexOf("section('Current medications')"), 'the charts start on their own page after the written report');
  const chartCalls = [...pdfSrc.matchAll(/\bchart\(/g)].map((m) => m.index ?? 0);
  assert(chartCalls.every((i) => i < pdfSrc.indexOf("section('Weight')") || i > trendsAt), 'no chart is drawn inside the written sections');
  assert(src('src/components/health/ReportChart.tsx').includes('layoutChart') && src('src/app/api/health/report-pdf/route.ts').includes('layoutChart'), 'page and PDF lay out through the same layoutChart');
}

// ── Doctor report: lab reference ranges print both bounds (2026-09-30) ──
console.log('Doctor report — lab reference ranges');
{
  assert(labRefLabel({ refLow: 75, refHigh: 250 }) === 'ref 75–250', 'vitamin D prints its floor, not only its ceiling');
  assert(labRefLabel({ refLow: null, refHigh: 41 }) === 'ref ≤ 41', 'a ceiling-only range stays ≤');
  assert(labRefLabel({ refLow: 60, refHigh: null }) === 'ref ≥ 60', 'a floor-only range (eGFR) prints ≥');
  assert(labRefLabel({ refLow: null, refHigh: null }) === '', 'no range, no bracket');
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
    assert(read(f).includes('labRefLabel(l)') && !/ref (≤|<=) \$\{l\.refHigh\}/.test(read(f)), `${f} prints the lab range through labRefLabel`);
  }
  assert(pdfSafe('ref ≤ 2.59') === 'ref <= 2.59' && /pdfSafe/.test(read('src/app/api/health/report-pdf/route.ts')), 'the PDF font swaps ≤ for <= (WinAnsi has no ≤)');
}

// ── Doctor report: only LDL and Lp(a) print (owner, 2026-09-30) ──
console.log('Doctor report — labs limited to LDL and Lp(a)');
{
  const rows = [
    { test: 'alt', date: '2023-05-23', value: 86 },
    { test: 'ldl', date: '2026-08-20', value: 4.54 },
    { test: 'vitamin-d', date: '2026-09-17', value: 25 },
    { test: 'lp(a)', date: '2026-08-20', value: 18.9 },
    { test: 'LDL', date: '2025-01-10', value: 4.9 },
  ];
  const kept = reportLabs(rows);
  assert(kept.map((r) => r.test.toLowerCase()).every((t) => t === 'ldl' || t === 'lp(a)'), 'nothing but LDL and Lp(a) reaches the report');
  assert(kept.length === 2, `one row per test (got ${kept.length})`);
  assert(kept.find((r) => r.test.toLowerCase() === 'ldl')?.date === '2026-08-20', 'the LATEST LDL prints, the older one does not (owner: remove the Jul 2022 LDL)');
  assert(reportLabs([{ test: 'ldl', date: '2022-07-18' }, { test: 'ldl', date: '2026-08-20' }]).length === 1, 'an older LDL never prints beside the newer one');
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
    assert(/const labs = reportLabs\(data\.labs\)/.test(read(f)), `${f} filters labs through reportLabs, not the date range`);
  }
}

// ── PDF dose ledger folds consecutive doses at one strength (2026-09-30) ──
console.log('Doctor report — dose ledger by level');
{
  const at = (s: string) => new Date(`${s}T19:00:00Z`);
  const rows = ledgerByDose([
    { n: 1, at: at('2026-08-25'), doseMg: 2.5, site: 'abdomen-right', symptoms: [] },
    { n: 2, at: at('2026-09-01'), doseMg: 2.5, site: 'abdomen-left', symptoms: [] },
    { n: 3, at: at('2026-09-08'), doseMg: 2.5, site: 'thigh-left', symptoms: [{ kind: 'diarrhea', maxSeverity: 2, count: 1 }] },
    { n: 4, at: at('2026-09-15'), doseMg: 2.5, site: 'thigh-right', symptoms: [] },
    { n: 5, at: at('2026-09-22'), doseMg: 5, site: 'abdomen-left', symptoms: [] },
    { n: 6, at: at('2026-09-29'), doseMg: 5, site: 'abdomen-right', symptoms: [] },
  ]);
  assert(rows.length === 2 && rows[0].fromN === 1 && rows[0].toN === 4 && rows[1].fromN === 5 && rows[1].toN === 6, 'six doses fold to two lines, 2.5 mg x4 and 5 mg x2');
  assert(rows[0].symptoms.length === 1 && rows[0].symptoms[0].n === 3, 'a side effect keeps the dose number it followed');
  const back = ledgerByDose([
    { n: 1, at: at('2026-08-25'), doseMg: 5, site: 'x', symptoms: [] },
    { n: 2, at: at('2026-09-01'), doseMg: 2.5, site: 'x', symptoms: [] },
    { n: 3, at: at('2026-09-08'), doseMg: 5, site: 'x', symptoms: [] },
  ]);
  assert(back.length === 3, 'a step down and back up stays visible, never merged');
}

// ── In-app PDF viewer: every page, zoomable, within Safari's canvas limits (owner, 2026-09-30) ──
console.log('PDF viewer — pages, zoom, canvas budget');
{
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  // A4 at 3x zoom on a 3x iPhone was ~16.3 M pixels a page; Safari blanks anything over ~16.7 M.
  const w3 = 377 * 3, h3 = Math.round(w3 * 841.89 / 595.28);
  const d3 = canvasDensity(w3, h3, 3);
  assert(w3 * d3 * h3 * d3 <= MAX_CANVAS_PIXELS + 1, `a 3x page stays inside the pixel budget (got ${Math.round(w3 * d3 * h3 * d3)})`);
  assert(d3 >= 2, `3x stays sharp, at least 2 device pixels per point (got ${d3.toFixed(2)})`);
  assert(canvasDensity(377, 533, 3) === 3, 'fit-to-width uses the full retina density');
  assert(canvasDensity(377, 533, 1) === 1, 'never below 1');
  assert(ZOOMS[0] === 1 && ZOOMS[ZOOMS.length - 1] === 3, 'zoom runs fit to 3x');

  const viewer = read('src/components/health/PdfShareButton.tsx');
  assert((viewer.match(/<iframe/g) ?? []).length === 1 && /function OnePageFrame[\s\S]{0,900}<iframe/.test(viewer), 'the PDF is framed only in the fallback (WKWebView draws only page 1 in a frame)');
  assert(/fallback=\{<OnePageFrame/.test(viewer), 'if pdf.js fails, the old one-page view is the fallback, never an empty box');
  const pages = read('src/components/health/PdfPages.tsx');
  assert(!/transform:/.test(pages) && !/scale\(/.test(pages.replace(/getViewport\(\{ scale/g, '')), 'zoom re-renders at a new width, never a CSS transform (rule 3: WKWebView repaint)');
  assert(/pdfjs-dist\/legacy\/build\/pdf\.mjs/.test(pages) && /await import\(/.test(pages), 'pdf.js loads lazily, legacy build, only when the viewer opens');
  assert(/lastScroll\.current/.test(pages) && /onScroll=/.test(pages), 'zoom keeps the reader in place from the last scroll event');
  assert(/c\.width = 0;/.test(pages), 'a replaced page frees its canvas memory');
  assert(/"pdfjs-dist": "\^4\./.test(read('package.json')), 'pdf.js stays on the 4.x line the legacy import path belongs to');
}

// ── Doctor report: ongoing side effects (owner, 2026-09-30: mild constipation, never logged once) ──
console.log('Doctor report — ongoing side effects');
{
  const og = ongoingSymptoms([
    { kind: 'constipation', severity: 1 },
    { kind: 'made-up', severity: 2 },
    { kind: 'Nausea', severity: 9 },
    { kind: 'constipation', severity: 2 },
    null,
    { kind: 'gas' },
  ]);
  assert(og.length === 2, `unknown kinds and malformed rows are dropped (got ${og.length})`);
  assert(og.find((o) => o.kind === 'constipation')?.severity === 2, 'one entry per kind, the later wins');
  assert(og.find((o) => o.kind === 'nausea')?.severity === 3, 'severity clamps to 1-3');
  assert(ongoingSymptoms(undefined).length === 0 && ongoingSymptoms('x').length === 0, 'nothing stored, nothing printed');

  const rows = sideEffectRows([{ kind: 'constipation', severity: 1 }], new Map([['diarrhea', { n: 1, max: 2 }]]));
  assert(rows[0].label === 'Constipation' && rows[0].value === 'ongoing · mild', `the ongoing side effect prints first as "ongoing · mild" (got ${rows[0]?.value})`);
  assert(rows[1].label === 'Diarrhea' && rows[1].value === '1× · worst moderate', 'logged episodes follow');
  const both = sideEffectRows([{ kind: 'constipation', severity: 1 }], new Map([['constipation', { n: 2, max: 2 }]]));
  assert(both.length === 1 && both[0].value === 'ongoing · mild · 2× logged, worst moderate', 'ongoing and logged are one row, never two');
  assert(sideEffectRows([], new Map()).length === 0, 'no rows means the "nothing logged" line');

  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert(/ongoingSymptoms Json\?/.test(read('prisma/schema.prisma')), 'the profile has an additive, nullable ongoingSymptoms column');
  for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
    assert(/sideEffectRows\(ongoingSymptoms\(data\.profile\.ongoingSymptoms\), symptomAgg\)/.test(read(f)), `${f} prints ongoing side effects through sideEffectRows`);
  }
  const pipe = read('src/app/api/health/profile/route.ts');
  assert(/ongoingSymptoms: true/.test(pipe) && /ongoingSymptoms\(b\.ongoingSymptoms\)/.test(pipe), 'the profile pipe stores and returns ongoing side effects, validated');
}

// ── Gym check-in / check-out (owner, 2026-10-01) ──
console.log('Gym visits — door to door, by workout length');
{
  // Riyadh is UTC+3: 18:00 local = 15:00Z. Workouts carry the activity day at 00:00Z.
  const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+03:00`);
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const W = (d: string, name: string, durMin: number | null, gym: string | null = 'bfit') => ({
    name, date: day(d), gym, duration: durMin == null ? null : durMin * 60,
    sets: Array.from({ length: 8 }, () => ({ rpe: 1, isWarmup: false })),
  });
  const workouts = [
    W('2026-10-01', 'Day B 45m — Oct 1', 47),
    W('2026-10-03', 'Day A 45m — Oct 3', 49, null),
    W('2026-10-05', 'Day B 30m — Oct 5', 31),
    W('2026-10-07', 'Swim 20m — Oct 7', 20),
    W('2026-10-09', 'Day A 60m — Oct 9', 62, 'work'),
  ];
  const V = (id: string, d: string, inHm: string, outHm: string | null, gym = 'bfit') => ({
    id, gym, checkInAt: at(d, inHm).toISOString(), checkOutAt: outHm ? at(d, outHm).toISOString() : null,
  });

  const c1 = classifyVisit(V('a', '2026-10-01', '18:00', '19:15'), workouts);
  assert(c1.category === '45' && c1.liftMin === 47, `a visit takes its length from the session that day (got ${c1.category}/${c1.liftMin})`);
  assert(classifyVisit(V('b', '2026-10-03', '18:00', '19:20'), workouts).category === '45', 'untagged session history is B_Fit (rule 2)');
  assert(classifyVisit(V('c', '2026-10-09', '18:00', '19:30'), workouts).category === 'none', 'a session at Alrajhi does not explain a visit to B_Fit');
  assert(classifyVisit(V('d', '2026-10-09', '18:00', '19:30', 'work'), workouts).category === '60', 'the same session explains the Alrajhi visit');
  assert(classifyVisit(V('e', '2026-10-07', '18:00', '18:45'), workouts).category === 'cardio', 'a swim-only visit is its own row');
  assert(classifyVisit(V('f', '2026-10-02', '00:30', '01:40'), workouts).category === '45', 'a visit past midnight belongs to the evening it started (04:00 rollover)');

  const stats = gymTimeStats([
    V('a', '2026-10-01', '18:00', '19:15'),
    V('b', '2026-10-03', '18:00', '19:20'),
    V('g', '2026-10-05', '18:00', '18:55'),
    V('h', '2026-10-06', '18:00', null),
    V('i', '2026-10-08', '18:00', '18:02'),
  ], workouts);
  const r45 = stats.find((r) => r.category === '45');
  assert(r45?.visits === 2 && r45.avgVisitMin === 78, `45-minute workouts average 78 min door to door (got ${r45?.avgVisitMin})`);
  assert(r45?.avgLiftMin === 48 && r45.avgOtherMin === 30, `split: 48 lifting, 30 everything else (got ${r45?.avgLiftMin}/${r45?.avgOtherMin})`);
  const r30 = stats.find((r) => r.category === '30');
  assert(r30?.visits === 1 && r30.avgVisitMin === null, 'one visit is a count, not an average');
  assert(stats[0].category === '30' && stats[1].category === '45', 'rows read 30, 45, 60 in order');
  assert(!stats.some((r) => r.category === 'none' && r.visits > 0), 'an open visit and a 2-minute mis-tap stay out of the averages');

  const open = V('o', '2026-10-01', '18:00', null);
  assert(isStale(open, at('2026-10-02', '00:30')) && !isStale(open, at('2026-10-01', '22:00')), 'open past 6 hours is "forgot to check out"');
  const now = at('2026-10-01', '19:00');
  assert(adjustedTime(open, 'checkInAt', -5, now)?.toISOString() === at('2026-10-01', '17:55').toISOString(), 'check-in moves back 5 minutes');
  assert(adjustedTime(open, 'checkInAt', 5, at('2026-10-01', '18:03')) === null, 'check-in never moves past now');
  assert(adjustedTime(open, 'checkOutAt', 5, now) === null, 'an open visit has no check-out to move');
  const closed = V('p', '2026-10-01', '18:00', '18:05');
  assert(adjustedTime(closed, 'checkOutAt', -5, now) === null, 'check-out never moves to or before check-in');
  assert(adjustedTime(closed, 'checkInAt', 5, now) === null, 'check-in never moves to or after check-out');
  assert(fmtVisit(78) === '1 h 18' && fmtVisit(48) === '48 min' && fmtVisit(60) === '1 h', 'times read as "1 h 18" and "48 min"');

  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert(/model GymVisit \{/.test(read('prisma/schema.prisma')), 'gym visits have their own additive table');
  const actionsSrc = read('src/app/gym-visit-actions.ts');
  assert(/catch \{\s*return \{ open: null, forgotten: null, last: null \};/.test(actionsSrc), 'Train never fails if the table is missing');
  assert(!/checkOutAt: new Date\(\)/.test(actionsSrc.slice(actionsSrc.indexOf('closeForgotten'))), 'a forgotten visit is closed at the time he states, never guessed');
  assert(/if \(field !== 'checkInAt' && field !== 'checkOutAt'\) return null;/.test(actionsSrc), 'the time-fix action can write only the two time fields');
  assert(/deleteMany\(\{ where: \{ id, checkOutAt: null \} \}\)/.test(actionsSrc), 'Discard deletes only an open visit, never one closed on another device');
  assert(/if \(isStale\(toLite\(v\)\)\) return toLite\(v\);/.test(actionsSrc), 'checking out past 6 h records no guessed time');
  assert(/out\.getTime\(\) > Date\.now\(\)/.test(actionsSrc), 'a stated stay never puts the check-out in the future');
  // A visit closed hours late can still be fixed: shortening is always allowed.
  const long = V('q', '2026-10-01', '10:00', '17:00');
  assert(adjustedTime(long, 'checkOutAt', -5, at('2026-10-01', '20:00')) !== null, 'an over-long visit can be shortened');
  assert(adjustedTime(long, 'checkOutAt', 5, at('2026-10-01', '20:00')) === null, 'but never lengthened');
  assert(adjustedTime(long, 'checkInAt', 5, at('2026-10-01', '20:00')) !== null, 'moving its check-in later also shortens it');
  // Adversary, 2026-10-01. F1: a lifting session with no length in its
  // name (every Watch session, any renamed one) is a workout, not a swim.
  const named = [
    ...workouts,
    W('2026-10-11', 'Day A — Watch · Oct 11', 50),
    W('2026-10-13', 'Day B — Oct 13', null),
  ];
  const watch = classifyVisit(V('w', '2026-10-11', '18:00', '19:20'), named);
  assert(watch.category === '45' && watch.liftMin === 50, `a Watch session takes its length from its timer (got ${watch.category}/${watch.liftMin})`);
  assert(classifyVisit(V('x', '2026-10-13', '18:00', '19:20'), named).category === 'lift', 'a session with no length and no timer is still a workout, never "swim or walk"');
  // F3: two visits one day — the session belongs to ONE visit, the longest.
  const twice = gymTimeStats([
    V('a', '2026-10-01', '18:00', '19:15'),
    V('m', '2026-10-01', '08:00', '08:40'),
    V('b', '2026-10-03', '18:00', '19:20'),
  ], workouts);
  const t45 = twice.find((r) => r.category === '45');
  assert(t45?.visits === 2 && t45.avgVisitMin === 78, `a second visit that day does not claim the session (got ${t45?.visits} visits, ${t45?.avgVisitMin})`);
  assert(twice.some((r) => r.category === 'none' && r.visits === 1), 'the morning visit with nothing logged is "nothing logged"');
  // The split shows only when every visit in the row carries it, so the
  // two lines always add up to the headline.
  const partial = gymTimeStats([
    V('a', '2026-10-01', '18:00', '19:15'),
    V('k', '2026-10-15', '18:00', '19:00'),
  ], [...workouts, W('2026-10-15', 'Day A 45m — Oct 15', 70)]);
  const p45 = partial.find((r) => r.category === '45');
  assert(p45?.avgVisitMin != null && p45.avgLiftMin === null && p45.avgOtherMin === null, 'a lift longer than its visit hides the split instead of mixing two sets of visits');
  // F2: matching is grouped by day, not visits × workouts.
  {
    const manyW = Array.from({ length: 500 }, (_, i) => W(new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), 'Day A 45m', 47));
    const manyV = Array.from({ length: 300 }, (_, i) => V(`v${i}`, new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), '18:00', '19:15'));
    const t0 = Date.now();
    gymTimeStats(manyV, manyW);
    const ms = Date.now() - t0;
    assert(ms < 1500, `300 visits × 500 sessions classify in under 1.5 s (took ${ms} ms)`);
  }
  // F5: a wrong-gym tap is fixable while the visit is open, and only then.
  assert(/export async function switchGym[\s\S]*?updateMany\(\{ where: \{ id, checkOutAt: null \}, data: \{ gym: g \} \}\)/.test(actionsSrc), 'switching gym writes only the gym, only on an open visit');
  assert(/GYM_IDS\.has\(gym\)/.test(actionsSrc.slice(actionsSrc.indexOf('switchGym'))), 'switching gym accepts only a known gym');
  // F4: a page resumed from the background re-reads the visit, so a stale
  // "At B_Fit" clock never checks out a 14-hour visit.
  const cardSrc = read('src/components/GymCheckIn.tsx');
  assert(/visibilitychange/.test(cardSrc) && /getGymVisitState\(\)/.test(cardSrc), 'the check-in card re-reads its state when the app comes back');
  // Backups: a hand-typed table that is in no snapshot is lost on restore.
  for (const f of ['scripts/export-data.js', 'src/lib/export-data.ts', 'scripts/restore-from-snapshot.js']) {
    assert(/gymVisit/.test(read(f)), `${f} carries gym visits`);
  }
  assert(/healthProfile: \[[^\]]*'ongoingSymptoms'/.test(read('scripts/restore-from-snapshot.js')), 'restore treats ongoingSymptoms as a Json column (a null would crash the profile upsert)');
  assert(/'ongoingSymptoms'/.test(read('src/app/api/health/export/route.ts')), 'the health export carries ongoingSymptoms');
}

// ── Native bridge: Swift twins and the JS↔Swift method contract ──────────
// native/HealthKitBridge/ is the source; ios/App/App/ holds the copies Xcode
// compiles. A method the web calls that the Swift list lacks fails silently
// on the phone, so both are held here, in plain text.
console.log('Native bridge — Swift twins and plugin methods');
{
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['HealthKitBridgePlugin', 'RestActivityPlugin', 'CloudBackupPlugin', 'MainViewController']) {
    assert(read(`native/HealthKitBridge/${f}.swift`) === read(`ios/App/App/${f}.swift`), `${f}.swift: the ios/App/App copy is byte-identical to native/`);
  }
  const swiftMethods = (f: string) => new Set([...read(`native/HealthKitBridge/${f}.swift`).matchAll(/CAPPluginMethod\(name: "([a-zA-Z]+)"/g)].map((m) => m[1]));
  // The methods a TS file declares on its plugin interface(s) are the ones it calls.
  const jsMethods = (f: string) => {
    const out: string[] = [];
    for (const m of read(f).matchAll(/interface \w+Plugin \{([\s\S]*?)\n\}/g)) {
      for (const line of m[1].matchAll(/^  (\w+)\??(?:\(|: \()/gm)) out.push(line[1]);
    }
    return out;
  };
  const contract: [string, string[]][] = [
    ['RestActivityPlugin', ['src/lib/native-live-activity.ts', 'src/lib/native-widgets.ts']],
    ['CloudBackupPlugin', ['src/lib/native-cloud-backup.ts']],
    ['HealthKitBridgePlugin', ['src/lib/native-health.ts']],
  ];
  for (const [plugin, files] of contract) {
    const have = swiftMethods(plugin);
    const called = files.flatMap(jsMethods);
    assert(called.length > 0, `${plugin}: the JS side declares its methods`);
    for (const name of called) assert(have.has(name), `${plugin}: JS calls ${name}, and Swift exports it`);
  }
  assert(swiftMethods('RestActivityPlugin').has('reloadWidgets') && /WidgetCenter\.shared\.reloadAllTimelines\(\)/.test(read('native/HealthKitBridge/RestActivityPlugin.swift')), 'the plugin can reload the widgets');
  assert(/typeof plugin\?\.reloadWidgets !== 'function'/.test(read('src/lib/native-widgets.ts')), 'reloadWidgets is a no-op on a binary that predates it');
  assert(/await createWorkout\(payload\);\s*\n\s*reloadWidgets\(\)/.test(read('src/components/WorkoutForm.tsx')), 'a saved workout reloads the verdict widget');
  const restWidget = read('ios/App/WorkoutWidgets/RestActivityWidget.swift');
  assert(/context\.isStale/.test(restWidget), 'the rest Live Activity draws a finished state when stale');
}

// ── One Health push at a time (rule 11) ──────────────────────
// The autopilot and "Sync now" each ran check-then-write with no lock:
// both could read Health before either wrote, and the same session went
// in twice — a write the app can never undo (review, 2026-10-02).
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  type W = { startISO: string; endISO: string; activityType?: string };
  const store: W[] = [];
  let writes = 0;
  const tick = () => new Promise<void>((r) => setTimeout(r, 5));
  const bridge = {
    queryWorkouts: async () => { const seen = [...store]; await tick(); return seen; },
    queryWorkoutStats: async () => ({ avgHr: null, maxHr: null, activeKcal: null }),
    saveWorkout: async (w: { startISO: string; endISO: string; name: string }) => {
      await tick();
      writes++;
      store.push({ startISO: w.startISO, endISO: w.endISO, activityType: 'traditionalStrengthTraining' });
    },
  };
  const cand = [{ id: 'w1', name: 'Day B', start: '2026-10-01T18:00:00.000Z', durationMin: 57 }];
  let outs: Awaited<ReturnType<typeof pushWorkoutsToHealth>>[] = [];
  let doneAt = 0;
  void Promise.all([pushWorkoutsToHealth(cand, bridge as never), pushWorkoutsToHealth(cand, bridge as never)]).then((o) => { outs = o; doneAt = Date.now(); });
  const until = Date.now() + 2000;
  // The suite is synchronous; spin the loop until both pushes settle.
  pendingAsync.push((async () => {
    while (!doneAt && Date.now() < until) await tick();
    assert(writes === 1, `two pushes at once write the session to Health ONCE (wrote ${writes})`);
    assert(outs.length === 2 && outs[0].savedIds.length + outs[1].savedIds.length === 1 && outs[0].alreadyIds.length + outs[1].alreadyIds.length === 1, 'the second push finds it already there and marks it, never writes');
  })());
  assert(!/ownerDayKey|ownerTodayUtc/.test(src('src/app/nav-actions.ts')), 'the Rooms glances count the diet day on the activity-day clock, like the Diet page');
  const pilot = src('src/components/HealthAutoPilot.tsx');
  assert(/syncsStartedAt && Date\.now\(\) - syncsStartedAt < SYNC_GUARD_MS/.test(pilot) && !/let syncsRunning/.test(pilot), 'runSyncs cannot run twice at once, and a run that never settles releases the guard after 10 min');
  // A save that TIMES OUT may still land: the bridge gives up after 20 s,
  // HealthKit does not. The push queued behind it must not write again.
  {
    const late: W[] = [];
    let lateWrites = 0;
    const slow = {
      queryWorkouts: async () => [...late],
      queryWorkoutStats: async () => ({ avgHr: null, maxHr: null, activeKcal: null }),
      saveWorkout: (w: { startISO: string; endISO: string }) => new Promise<void>((_, reject) => {
        setTimeout(() => { lateWrites++; late.push({ startISO: w.startISO, endISO: w.endISO, activityType: 'traditionalStrengthTraining' }); }, 40);
        setTimeout(() => reject(new Error('Workout save timed out')), 10);
      }),
    };
    const c2 = [{ id: 'w2', name: 'Day A', start: '2026-09-17T18:00:00.000Z', durationMin: 51 }];
    pendingAsync.push((async () => {
      const [a, b] = await Promise.all([pushWorkoutsToHealth(c2, slow as never), pushWorkoutsToHealth(c2, slow as never)]);
      await new Promise((r) => setTimeout(r, 80));
      assert(lateWrites === 1, `a timed-out save is treated as possibly written: the queued push does not write it again (wrote ${lateWrites})`);
      assert(a.errors.length === 1 && b.savedIds.length === 0 && b.alreadyIds.length === 0 && b.errors.length === 1, 'neither push claims the session is in Health without proof: the row stays unmarked for a later load');
    })());
  }
  for (const f of ['scripts/ios-deploy.sh', 'scripts/testflight-upload.sh']) {
    assert(/check-server-url\.sh/.test(src(f)), `${f} refuses to build a shell that points anywhere but the live site`);
  }
  const guard = src('scripts/check-server-url.sh');
  assert(/workout-app-gamma-rouge\.vercel\.app/.test(guard) && /exit 1/.test(guard), 'the guard names the live site and fails the build otherwise');
}

// ── The doctor-review slot: one story on every screen ────────
// With 6 doses logged, Home said "Dose 7 · Tuesday", Journey said "Doctor
// review · next", and Dose day showed "— mg planned" while the form had 5 mg
// preselected: one tap would store 5 mg whatever the doctor decided
// (audit, 2026-10-02). Law: nothing ever suggests a dose.
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const dose = (iso: string, mg: number) => ({ at: new Date(iso), doseMg: mg, site: 'abdomen-left' });
  const six = ['2026-08-25', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']
    .map((d, i) => dose(`${d}T21:00:00+03:00`, i < 4 ? 2.5 : 5));
  const at = new Date('2026-10-02T12:00:00+03:00');
  const c6 = treatmentClock(six, DEFAULT_DOSE_PLAN, at)!;
  assert(c6.atCheckpoint === true && c6.planExhausted === false, 'after dose 6 the next slot is the doctor review, and the clock says so');
  assert(treatmentClock(six.slice(0, 4), DEFAULT_DOSE_PLAN, at)!.atCheckpoint === false, 'a scheduled slot is not a checkpoint');
  assert(nextDoseCaption(c6, 7, at) === 'Doctor review · Tuesday', `Home names the review, not a dose (got "${nextDoseCaption(c6, 7, at)}")`);
  assert(nextDoseCaption(treatmentClock(six.slice(0, 4), DEFAULT_DOSE_PLAN, new Date('2026-09-17T12:00:00+03:00'))!, 5, new Date('2026-09-17T12:00:00+03:00')) === 'Dose 5 · Tuesday', 'a scheduled dose is still named with its day');
  assert(initialDoseChoice(null, 5, false) === '' && initialDoseChoice(null, null, false) === '', 'a review slot preselects NOTHING — not the last dose');
  assert(initialDoseChoice(5, 2.5, false) === '5' && initialDoseChoice(2.5, null, true) === '2.5', 'a scheduled slot preselects the planned dose');
  const form = src('src/components/health/InjectionForm.tsx');
  assert(/initialDoseChoice\(plannedDoseMg, lastDoseMg, isFirst\)/.test(form), 'the form opens on that choice');
  // The dose he takes at the review slot belongs on the path, and a plan
  // extended past the review must name the same dose on every screen.
  const seven = [...six, dose('2026-10-06T21:00:00+03:00', 7.5)];
  const st7 = journeyStations(DEFAULT_DOSE_PLAN, seven, new Date('2026-10-07T12:00:00+03:00'));
  assert(st7.some((s) => s.kind === 'dose' && /^Dose 7 · 7\.5 mg/.test(s.label) && s.state === 'done'), 'the 7th dose appears on the Journey after the review');
  assert(st7.find((s) => s.kind === 'checkpoint')!.state === 'done', 'a review he has passed is no longer "next"');
  const longPlan = [...DEFAULT_DOSE_PLAN, { week: 8, mg: 7.5 }, { week: 9, mg: 10 }];
  const stLong = journeyStations(longPlan, seven, new Date('2026-10-07T12:00:00+03:00'));
  const cLong = treatmentClock(seven, longPlan, new Date('2026-10-07T12:00:00+03:00'))!;
  const nextStation = stLong.find((s) => s.state === 'next')!;
  assert(cLong.nextPlanned?.week === 8 && /^Dose 8 · 7\.5 mg/.test(nextStation.label), `Journey and Dose day name the same next dose (clock week ${cLong.nextPlanned?.week}, station "${nextStation.label}")`);
  // One dose, one date: a 02:00 Wednesday log is Wednesday in Riyadh on every screen.
  const late = journeyStations(DEFAULT_DOSE_PLAN, [dose('2026-09-30T02:00:00+03:00', 2.5)], new Date('2026-10-02T12:00:00+03:00'));
  assert(late[0].detail!.startsWith('Sep 30') && late[1].detail === 'due Oct 7', `Journey dates a dose in Riyadh (got "${late[0].detail}", "${late[1].detail}")`);
  assert((src('src/app/nav-actions.ts').match(/timeZone: 'Asia\/Riyadh'/g) ?? []).length >= 2, 'the Rooms labels date labs and doses in Riyadh');
  // The form can say WHEN: a dose logged after midnight was stored at the
  // save moment and hand-patched two weeks running.
  assert(/logInjection\(\{[\s\S]*?\bat:/.test(form) && /type="date"/.test(form) && /type="time"/.test(form) && !/datetime-local/.test(form), 'the injection form sends the time he took it');
  // Back-filling an earlier dose is not the next slot's dose: "Earlier"
  // drops the preselect (an extended plan would have offered slot 7's
  // 7.5 mg for a dose that was 5), and a plan with no week-1 dose shows no
  // hard-coded 2.5.
  assert(/setEarlier\(v\);\s*if \(v\) \{ setDose\(''\)/.test(form), 'choosing Earlier clears the preselected dose');
  assert(!/'2\.5'/.test(src('src/app/health/injection/page.tsx')), 'Dose day never prints a dose the plan does not hold');
  // A hand-edited plan with a duplicate week: the clock and the Journey read the same normalised plan.
  const dupPlan = [{ week: 1, mg: 2.5 }, { week: 2, mg: 5 }, { week: 2, mg: null, label: 'Doctor review' }, { week: 3, mg: 5 }];
  const cDup = treatmentClock(six.slice(0, 1), dupPlan, at)!;
  const stDup = journeyStations(dupPlan, six.slice(0, 1), at);
  assert(stDup.filter((x) => x.state === 'next').length === 1 && cDup.nextPlanned?.mg === 5 && /^Dose 2 · 5 mg/.test(stDup.find((x) => x.state === 'next')!.label), 'a duplicate week is read once, the same way by the clock and the Journey');
  assert(injectionTimeOk('2026-10-06T21:00:00+03:00', new Date('2026-10-07T02:00:00+03:00')) && !injectionTimeOk('2026-10-08T02:00:00+03:00', new Date('2026-10-07T02:00:00+03:00')) && !injectionTimeOk('2026-09-01T02:00:00+03:00', new Date('2026-10-07T02:00:00+03:00')) && !injectionTimeOk('junk', new Date()), 'a dose time is accepted from the last 14 days, never the future, never junk');
}

// ── Health writes: six ways the app stored or lost his data (audit, 2026-10-02) ──
// Every decision below is a pure function in src/lib/health-entry.ts; the
// actions, the fuel pipe and the Health import only apply what it returns.
import { stackMacros, checkInDayTotals, saveEach, weightImportPlan, manualWeightPlan, bpImportTwin, ownerDayWindow } from '../src/lib/health-entry';
import { ownerDayKey } from '../src/lib/health-insights';
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const fnBody = (file: string, from: string, to: string) => {
    const s = src(file);
    const a = s.indexOf(from);
    const b = s.indexOf(to, a + from.length);
    return a < 0 ? '' : s.slice(a, b < 0 ? undefined : b);
  };

  // A. "Add a meal" with only protein typed wrote kcal 0 / carbs 0 / fat 0,
  // and Diet said "0 kcal · 1800 left" for a day that had no calorie entry.
  const onlyProtein = stackMacros(null, { proteinG: 30 });
  assert(onlyProtein.proteinG === 30 && !('kcal' in onlyProtein) && !('carbsG' in onlyProtein) && !('fatG' in onlyProtein), 'adding only protein to an empty day stores protein and leaves kcal, carbs and fat blank');
  const onNullKcal = stackMacros({ kcal: null, proteinG: 67, carbsG: null, fatG: null }, { proteinG: 30 });
  assert(onNullKcal.proteinG === 97 && !('kcal' in onNullKcal), 'adding protein to a row whose kcal is blank stacks the protein and never writes kcal 0');
  const dinner = stackMacros({ kcal: 1170, proteinG: 66, carbsG: 120, fatG: 40 }, { kcal: 630, proteinG: 67 });
  assert(dinner.kcal === 1800 && dinner.proteinG === 133 && !('carbsG' in dinner) && !('fatG' in dinner), 'dinner stacks onto the delivery baseline; the fields he left blank are not rewritten');
  assert(Object.keys(stackMacros({ kcal: 500 }, { kcal: 0, proteinG: undefined, carbsG: -5, fatG: 9999 })).length === 0, 'nothing, a negative or an absurd number adds nothing');
  assert(stackMacros({ proteinG: 390 }, { proteinG: 30 }).proteinG === 400 && stackMacros({ waterMl: 500 }, { waterMl: 750 }).waterMl === 1250, 'a stacked total stays inside the same bounds; water stacks too (the pipe)');
  const addFn = fnBody('src/app/health-actions.ts', 'export async function addNutrition', '\nexport async function ');
  const fuelRoute = src('src/app/api/health/fuel/route.ts');
  assert(addFn.includes('stackMacros(') && !/\?\?\s*0\)\s*\+/.test(addFn), 'addNutrition sums through stackMacros — no (existing ?? 0) + inc of its own');
  assert(fuelRoute.includes('stackMacros(') && !/\?\?\s*0\)\s*\+/.test(fuelRoute), 'the fuel pipe sums through the same stackMacros');

  // B. The check-in asks "Anything measured today?" — a day figure. At 00:30
  // a 67 typed there replaced the NEXT calendar day's planned 133.
  const lower = checkInDayTotals({ proteinG: 133, waterMl: null }, { proteinG: 67, waterMl: 1500 });
  assert(!('proteinG' in lower.patch) && lower.kept.length === 1 && lower.kept[0].field === 'proteinG' && lower.kept[0].existing === 133, 'a check-in protein below what the day already holds changes nothing, and says what was kept');
  assert(lower.patch.waterMl === 1500, 'the water typed beside it is still saved');
  const higher = checkInDayTotals({ proteinG: 66, waterMl: 2000 }, { proteinG: 140, waterMl: 2000 });
  assert(higher.patch.proteinG === 140 && !('waterMl' in higher.patch) && higher.kept.length === 0, 'a higher day figure is saved; the same figure is neither rewritten nor reported');
  assert(checkInDayTotals(null, { proteinG: 90 }).patch.proteinG === 90 && Object.keys(checkInDayTotals(null, { proteinG: 0, waterMl: 99999 }).patch).length === 0, 'an empty day takes the figure; zero and out-of-range store nothing');
  assert(checkInDayTotals(null, { proteinG: 4000, waterMl: 1500 }).rejected.join() === 'proteinG' && checkInDayTotals(null, { proteinG: NaN }).rejected.length === 1 && checkInDayTotals(null, { proteinG: 90 }).rejected.length === 0, 'a mistyped figure is reported as rejected, so the save can fail out loud instead of ending on "noted"');
  // Adversary (2026-10-02): "only raises" made a water typo permanent — 5000
  // typed for 500 could not be lowered from anywhere in the app. The reason
  // for the rule is the pre-logged PROTEIN plan; water is his latest figure.
  const waterFix = checkInDayTotals({ proteinG: 133, waterMl: 5000 }, { waterMl: 500 });
  assert(waterFix.patch.waterMl === 500 && waterFix.kept.length === 0, 'a lower water figure replaces the day\'s — a typo can be corrected');
  const useMine = checkInDayTotals({ proteinG: 133, waterMl: 5000 }, { proteinG: 67 }, { replace: true });
  assert(useMine.patch.proteinG === 67 && useMine.kept.length === 0, '"Use 67 g instead" sets the protein he typed over the larger figure');
  const checkIn = src('src/components/health/CheckIn.tsx');
  assert(/Use \{[^}]*\} g instead/.test(checkIn) && /replace:\s*true/.test(checkIn) && /replace/.test(fnBody('src/app/health-actions.ts', 'export async function logCheckInNutrition', '\nexport async function ')), 'the kept-protein line carries the way out: one tap sets his figure');
  assert(/Boolean\(sys\) !== Boolean\(dia\)/.test(checkIn) && /a number is missing/.test(checkIn), 'a half-typed BP is said to be not saved and stays in its field — never cleared under "noted"');
  assert(checkIn.includes('activityDayStr(') && !/getDate\(\)/.test(checkIn), 'the check-in files protein and water under the 04:00 activity day, like Diet');
  assert(checkIn.includes('logCheckInNutrition(') && !/\blogNutrition\b/.test(checkIn), 'the check-in never calls the overwrite (logNutrition)');
  const checkInFn = fnBody('src/app/health-actions.ts', 'export async function logCheckInNutrition', '\nexport async function ');
  assert(checkInFn.includes('checkInDayTotals(') && /rejected\.length\) throw/.test(checkInFn) && /return\s*\{[^}]*kept/.test(checkInFn), 'logCheckInNutrition decides through checkInDayTotals and returns what it kept');

  // C. A mistyped diastolic threw, the protein after it was never sent, and
  // the screen said "That's today noted."
  pendingAsync.push((async () => {
    let ran = 0;
    let out: { saved: string[]; failed: string[] } | null = null;
    try {
      out = await saveEach([
        { key: 'bp', run: async () => { throw new Error('Reading out of range'); } },
        { key: 'nutrition', run: async () => { ran++; } },
      ]);
    } catch { /* the old behaviour: the first failure aborts the rest */ }
    assert(ran === 1, 'a failed BP save does not skip the protein save after it');
    assert(out !== null && out.failed.join() === 'bp' && out.saved.join() === 'nutrition', 'each answer reports saved or failed on its own');
    const allOk = await saveEach([{ key: 'a', run: async () => 1 }, { key: 'b', run: async () => 2 }]).catch(() => null);
    assert(allOk !== null && allOk.failed.length === 0 && allOk.saved.join() === 'a,b', 'two good saves report no failure');
  })());
  assert(checkIn.includes('saveEach(') && !/catch\s*\{\s*go\(next\)/.test(checkIn), 'the check-in saves each answer on its own and never walks past a failed save');
  assert(/not saved/i.test(checkIn) && /failed\.includes\('bp'\)/.test(checkIn), 'a failed save is said plainly, by name');
  assert(/if \(!failed\.includes\('bp'\)\)[^\n]*setSys\(''\)/.test(checkIn), 'only what saved is cleared — the failed entry stays in its fields for a retry');

  // D. Weight is ONE store. A waist-only manual row blocked that day's scale
  // weigh-in for good; a manual weight typed AFTER the scale synced lost to
  // the scale's later timestamp in every reader.
  const t = (h: string) => new Date(`2026-10-02T${h}:00.000Z`);
  assert(weightImportPlan([{ id: 'm', date: t('00:00'), source: 'manual', weight: null }]).kind === 'create', 'a waist-only manual entry does not block the scale weigh-in for that day');
  assert(weightImportPlan([{ id: 'm', date: t('00:00'), source: 'manual', weight: 126.4 }]).kind === 'skip', 'a manual WEIGHT blocks the import');
  assert(weightImportPlan([{ id: 'h', date: t('04:10'), source: 'apple-health', weight: 126.9 }, { id: 'm', date: t('09:00'), source: 'manual', weight: 126.4 }]).kind === 'skip', 'a manual weight blocks the import wherever it sorts in the day — not only as the first row');
  const upd = weightImportPlan([{ id: 'm', date: t('00:00'), source: 'manual', weight: null }, { id: 'h', date: t('04:10'), source: 'apple-health', weight: 126.9 }]);
  assert(upd.kind === 'update' && upd.id === 'h', 'a re-sync corrects the IMPORTED row of the day, never the manual waist row beside it');
  assert(weightImportPlan([]).kind === 'create', 'an empty day takes the scale reading');
  {
    // Data-steward round 2 (2026-10-02): history keyed by the UTC day can hold
    // two imported rows inside one Riyadh day (22:30Z and 06:00Z). A re-sync
    // rewrote the FIRST into a copy of the day's latest sample.
    const two = weightImportPlan([{ id: 'early', date: new Date('2026-10-02T22:30:00Z'), source: 'apple-health', weight: 127.1 }, { id: 'late', date: new Date('2026-10-03T06:00:00Z'), source: 'apple-health', weight: 126.8 }]);
    assert(two.kind === 'update' && two.id === 'late', 'with two imported rows in one of his days a re-sync corrects the LATEST — the 01:30 weigh-in is left as it was');
  }
  const take = manualWeightPlan([{ id: 'h1', date: t('04:10'), source: 'apple-health', weight: 126.9 }, { id: 'h2', date: t('04:12'), source: 'apple-health', weight: 127.0 }], { weight: 126.4 });
  assert(take.kind === 'takeOver' && take.id === 'h2', 'a manual weight on a day the scale already synced takes over the imported row (the latest) — one row, so every reader sees his number');
  assert(manualWeightPlan([{ id: 'h', date: t('04:10'), source: 'apple-health', weight: 126.9 }], {}).kind === 'create', 'a waist-only manual entry leaves the scale row alone');
  assert(manualWeightPlan([], { weight: 126.4 }).kind === 'create', 'an empty day takes the manual weight as its own row');
  // Data-steward (2026-10-02): the taken-over row keeps the scale's time, so
  // a correction typed later made a 00:00Z row EARLIER than it and lost.
  const fix = manualWeightPlan([{ id: 'm1', date: t('04:10'), source: 'manual', weight: 126.4 }], { weight: 126.1 });
  assert(fix.kind === 'update' && fix.id === 'm1', 'a second manual weight corrects the day\'s manual row — never a second row that sorts before it');
  const fix2 = manualWeightPlan([{ id: 'w', date: t('00:00'), source: 'manual', weight: null }, { id: 'm1', date: t('00:00'), source: 'manual', weight: 126.4 }, { id: 'h', date: t('04:10'), source: 'apple-health', weight: 126.9 }], { weight: 126.1 });
  assert(fix2.kind === 'update' && fix2.id === 'm1', 'the manual WEIGHT row is the one corrected, before any imported or waist-only row');
  assert(manualWeightPlan([{ id: 'm1', date: t('04:10'), source: 'manual', weight: 126.4 }], {}).kind === 'create', 'a waist-only entry never rewrites a weight row');
  // The day is HIS day (Riyadh), on both sides: a 01:00 weigh-in on the 3rd
  // is 22:00Z on the 2nd, and a manual weight backfilled for the 2nd used to
  // take it over and block the import for that UTC day.
  {
    const w3 = new Date('2026-10-03T01:00:00+03:00');
    const w2 = new Date('2026-10-02T23:30:00+03:00');
    const typed2 = new Date('2026-10-02'); // what BodyStatForm sends: a bare date
    const d2 = ownerDayWindow(ownerDayKey(typed2));
    const d3 = ownerDayWindow(ownerDayKey(w3));
    const inside = (d: Date, w: { start: Date; end: Date }) => d >= w.start && d < w.end;
    assert(ownerDayKey(w3) === '2026-10-03' && ownerDayKey(w2) === '2026-10-02' && ownerDayKey(typed2) === '2026-10-02', 'a 01:00 weigh-in belongs to the 3rd, a 23:30 one to the 2nd, a bare date to itself');
    assert(inside(typed2, d2) && inside(w2, d2) && !inside(w3, d2), 'a manual weight for the 2nd sees the 23:30 weigh-in and not the 01:00 one after midnight');
    assert(inside(w3, d3) && !inside(w2, d3) && inside(new Date('2026-10-03'), d3), 'the 01:00 weigh-in sits in the 3rd\'s window, with a manual entry for the 3rd');
    assert(d2.end.getTime() === d3.start.getTime() && d3.start.toISOString() === '2026-10-02T21:00:00.000Z', 'his days tile the clock: the 3rd starts at 00:00 Riyadh');
  }
  {
    // The reader every page uses, over what the two plans leave behind.
    const rows = [{ date: '2026-10-01T04:00:00.000Z', weight: 127.2 }, { date: '2026-10-02T04:12:00.000Z', weight: 126.4 }];
    const s = weightSnapshot({ heightCm: 169, startWeightKg: 133, goalWeightKg: 103 }, [120, 110, 103], rows);
    assert(s !== null && s.currentKg === 126.4, 'after the take-over the day holds one weight — his — and weightSnapshot reads it');
  }
  const bodyImport = fnBody('src/lib/health-import.ts', 'async function upsertBodyStats', 'async function enrichWorkouts');
  assert(bodyImport.includes('weightImportPlan(') && !/source === 'manual'/.test(bodyImport) && /findMany\(/.test(bodyImport), 'the weigh-in import reads the whole day and asks weightImportPlan — no first-row check of its own');
  const addStat = fnBody('src/app/actions.ts', 'export async function addBodyStat', '\nexport async function ');
  assert(addStat.includes('ownerDayWindow(ownerDayKey(') && bodyImport.includes('ownerDayWindow(') && bodyImport.includes('ownerDayKey(sample.date)') && !/dayKey\(sample\.date\)|dayRange\(/.test(bodyImport.replace(/ownerDayKey/g, '')), 'the import and the manual entry key a weigh-in by the same owner day, never the UTC day');
  assert(addStat.includes('manualWeightPlan(') && /source:\s*'manual'/.test(addStat), 'addBodyStat asks manualWeightPlan and marks a taken-over row manual');

  // E. Measured 08:00, typed 08:02, cuff synced later: two rows.
  const typed = { id: 'man', at: Date.parse('2026-10-02T05:02:10Z'), systolic: 126, diastolic: 80, notes: null };
  const cuff = { at: Date.parse('2026-10-02T05:00:00Z'), systolic: 126, diastolic: 80 };
  assert(bpImportTwin(cuff, [typed], new Set()) === 'man', 'the cuff\'s copy of a reading typed two minutes later is the same measurement');
  assert(bpImportTwin({ ...cuff, diastolic: 82 }, [typed], new Set()) === null, 'different numbers two minutes apart are two readings');
  assert(bpImportTwin({ ...cuff, at: cuff.at - 6 * 60_000 }, [typed], new Set()) === null, 'the same numbers eight minutes apart are two readings');
  assert(bpImportTwin(cuff, [{ ...typed, notes: 'Apple Health' }], new Set()) === null, 'two cuff readings minutes apart stay two rows — the five-minute rule is for a row he typed');
  assert(bpImportTwin({ ...cuff, systolic: 140, at: typed.at + 30_000 }, [{ ...typed, notes: 'Apple Health' }], new Set()) === 'man' && bpImportTwin({ ...cuff, systolic: 140, at: typed.at + 30_000 }, [{ ...typed, notes: 'Apple Health' }], new Set(['man'])) === 'man', 'any pair within a minute of an IMPORTED row is that row again (the rolling re-sync), claimed or not');
  assert(bpImportTwin({ at: typed.at + 50_000, systolic: 150, diastolic: 95 }, [typed], new Set()) === null, 'a different cuff reading 50 s from a typed one is its own measurement — never dropped on time alone');
  {
    // Adversary's probe: cuff 08:00 and 08:04, both 126/80; typed at 08:03:30.
    const typedLate = { ...typed, at: Date.parse('2026-10-02T05:03:30Z') };
    const claimed = new Set<string>();
    const first = bpImportTwin(cuff, [typedLate], claimed);
    if (first) claimed.add(first);
    const second = bpImportTwin({ ...cuff, at: Date.parse('2026-10-02T05:04:00Z') }, [typedLate], claimed);
    assert(first === 'man' && second === null, 'one typed row never swallows two cuff readings, even when the second is within its minute');
  }
  assert(bpImportTwin(cuff, [typed], new Set(['man'])) === null, 'one typed row answers for one cuff reading; a second identical reading is its own row');
  const bpImport = fnBody('src/lib/health-import.ts', 'async function importBpReadings', '\nexport async function importHealthSamples');
  assert(bpImport.includes('bpImportTwin(') && bpImport.includes('BP_SAME_READING_MS'), 'the BP import asks bpImportTwin and looks five minutes either side');
  assert(!/data:\s*\{[^}]*\bat\b/.test(bpImport.slice(bpImport.indexOf('if (twinId'), bpImport.indexOf('bpReading.create'))), 'a matched row keeps its own time; only a blank pulse is filled');

  // F. A failed save wiped what he typed.
  for (const f of ['src/components/health/BpTracker.tsx', 'src/components/health/FuelTracker.tsx']) {
    const s = src(f);
    assert(/return true;[\s\S]*?catch[\s\S]*?return false;/.test(s) && /\.then\(\(ok\)\s*=>\s*\{\s*if \(ok\)/.test(s), `${f.split('/').pop()} clears its inputs only after a save that succeeded`);
  }
}

// ── Health screens: one calendar, one definition, honest reports (audit 2, 2026-10-02) ──
console.log('Health screens — Riyadh calendar, shared definitions, report honesty');
{
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const dayRow = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const fnBody = (file: string, name: string) => {
    const t = src(file);
    const at = t.indexOf(`export function ${name}(`);
    const end = t.indexOf('\nexport ', at + 1);
    return at < 0 ? '' : t.slice(at, end < 0 ? undefined : end);
  };

  // 1. CPAP adherence. Nights arrive in a WEEKLY report, so a morning with
  // no row is "not reported yet", not "mask not used". On 2026-10-02 the
  // doctor report printed "Nights used 23 of 29 (79%)" from 25 reported
  // nights: the denominator was every morning up to today.
  {
    const nights = Array.from({ length: 25 }, (_, i) => ({
      night: dayRow(`2026-09-${String(5 + i).padStart(2, '0')}`),
      usageHours: i === 3 || i === 11 ? 0 : i === 7 ? 2.5 : 6,
    }));
    const a = cpapAdherence(nights);
    assert(a.reported === 25 && a.used === 23 && a.pct === 92, `adherence divides by the nights REPORTED: 23 of 25, 92% (got ${a.used} of ${a.reported}, ${a.pct}%)`);
    assert(a.over4 === 22, `nights of 4 h or more are counted by the same function (got ${a.over4})`);
    assert(a.through !== null && a.through.toISOString().slice(0, 10) === '2026-09-29', 'adherence says through which night the data runs');
    assert(cpapAdherenceLabel(a) === '23 of 25 reported (92%) · through 29 Sep', `the row names the denominator and the date (got "${cpapAdherenceLabel(a)}")`);
    assert(cpapAdherence([]).pct === null, 'no reported night, no percentage');
    for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
      const t = src(f);
      assert(/cpapAdherence\(/.test(t) && /cpapAdherenceLabel\(/.test(t) && !/cpapElapsed/.test(t), `${f} takes CPAP adherence from the one shared function`);
    }
  }

  // 2. BP weeks are HIS calendar weeks. His 7 Sep 01:24 reading (a Monday)
  // sat in the previous week on the server, and from 00:00 to 03:00 on a
  // Monday "this week" was still last week.
  {
    const bp = (iso: string) => ({ at: iso, systolic: 120, diastolic: 80 });
    const wk = bpWeeklyAverages(
      [bp('2026-09-07T01:24:00+03:00'), bp('2026-09-08T08:00:00+03:00'), bp('2026-09-09T08:00:00+03:00')],
      4, new Date('2026-09-10T12:00:00+03:00'),
    );
    assert(wk.length === 1 && wk[0].n === 3, `a Monday 01:24 Riyadh reading belongs to the week it starts (got ${wk.map((w) => w.n).join('+')})`);
    assert(wk.length > 0 && wk[0].weekStart.toISOString() === '2026-09-06T21:00:00.000Z', 'the week starts at Monday 00:00 Riyadh');
    const early = bpWeeklyAverages([bp('2026-09-14T00:30:00+03:00')], 4, new Date('2026-09-14T01:00:00+03:00'));
    assert(early.length === 1 && early[0].weekStart.toISOString() === '2026-09-13T21:00:00.000Z', 'at 01:00 on a Monday the current week is already the new one');
    const sunday = bpWeeklyAverages([bp('2026-09-13T23:50:00+03:00')], 4, new Date('2026-09-14T01:00:00+03:00'));
    assert(sunday.length === 1 && sunday[0].weekStart.toISOString() === '2026-09-06T21:00:00.000Z', 'Sunday 23:50 stays in the week that is ending');
  }

  // 3. Months are HIS calendar months: anything between 00:00 and 03:00
  // Riyadh on the 1st was counted in the month before.
  {
    const af = afStats([{ startedAt: '2026-10-01T01:00:00+03:00' }], new Date('2026-10-02T12:00:00+03:00'));
    assert(af.thisMonth === 1 && af.lastMonth === 0, `an AF episode at 01:00 on the 1st is this month's (got ${af.thisMonth}/${af.lastMonth})`);
    const afEarly = afStats([{ startedAt: '2026-09-30T20:00:00+03:00' }], new Date('2026-10-01T01:30:00+03:00'));
    assert(afEarly.thisMonth === 0 && afEarly.lastMonth === 1, 'at 01:30 on the 1st, yesterday evening is already last month');
    const jan = afStats([{ startedAt: '2025-12-31T22:00:00+03:00' }], new Date('2026-01-01T00:30:00+03:00'));
    assert(jan.lastMonth === 1 && jan.perMonth[0].month === '2025-12', 'last month crosses the year');

    const row = (iso: string, s: number) => ({ at: iso, systolic: s, diastolic: 80 });
    const story = bpWeightStory(
      [row('2026-09-05T08:00:00+03:00', 130), row('2026-09-12T08:00:00+03:00', 130), row('2026-09-20T08:00:00+03:00', 130),
       row('2026-10-01T01:00:00+03:00', 120), row('2026-10-01T09:00:00+03:00', 120), row('2026-10-02T09:00:00+03:00', 120)],
      [{ date: '2026-09-06T08:00:00+03:00', weight: 127 }, { date: '2026-09-20T08:00:00+03:00', weight: 126 },
       { date: '2026-10-01T02:00:00+03:00', weight: 125 }, { date: '2026-10-02T08:00:00+03:00', weight: 125 }],
    );
    assert(story !== null && story.length === 2 && story[1].month === '2026-10' && story[1].systolic === 120 && story[0].systolic === 130,
      'a reading and a weigh-in in the small hours of the 1st count in the new month');

    assert(ownerMonthKey(new Date('2026-10-01T01:00:00+03:00')) === '2026-10' && ownerMonthKey(new Date('2026-09-30T23:59:00+03:00')) === '2026-09', 'the month key is the Riyadh month');
    assert(monthLabel('2026-08') === 'Aug 2026' && monthLabel('2026-12') === 'Dec 2026', `months print as words (got "${monthLabel('2026-08')}")`);

    // The mask card: on 2 Oct no October night had been reported yet, so
    // the whole card — streaks and deep sleep included — disappeared.
    const sept = Array.from({ length: 10 }, (_, i) => ({ night: dayRow(`2026-09-${20 + i}`), usageHours: i === 4 ? 3 : 6 }));
    const strip = cpapCompliance(sept, new Date('2026-10-02T10:00:00+03:00'));
    assert(strip.monthLogged === 10 && strip.month4h === 9 && strip.month === '2026-09' && strip.monthIsCurrent === false,
      `with no night reported this month the card shows the latest reported month, labelled (got ${strip.monthLogged} nights, month ${strip.month})`);
    const oct = cpapCompliance([...sept, { night: dayRow('2026-10-01'), usageHours: 7 }], new Date('2026-10-02T10:00:00+03:00'));
    assert(oct.monthLogged === 1 && oct.month === '2026-10' && oct.monthIsCurrent === true, 'once this month has a reported night it is this month again');
    const first = cpapCompliance([{ night: dayRow('2026-09-01'), usageHours: 6 }], new Date('2026-09-01T01:00:00+03:00'));
    assert(first.monthLogged === 1 && first.monthIsCurrent === true, 'at 01:00 on the 1st the current month is the new one');
    const patterns = src('src/app/health/analytics/page.tsx');
    assert(!/getMonth\(\)|getFullYear\(\)/.test(patterns) && /ownerMonthKey/.test(patterns) && /monthLabel\(/.test(patterns), 'the Patterns page keys months on the Riyadh calendar and prints them as words');
    assert(/mask\.monthIsCurrent/.test(patterns), 'the mask card says which month it shows');
  }

  // 4. The diet week runs on the 04:00 activity day, like the rows it reads.
  {
    const logs = ['2026-09-25', '2026-09-26', '2026-10-01', '2026-10-02'].map((d2) => ({ day: dayRow(d2), kcal: 1800, proteinG: d2 === '2026-10-02' ? 60 : 130 }));
    // 03:30 Riyadh on 2 Oct is still the activity day of 1 Oct: the window
    // is 25 Sep – 1 Oct, and the planned row for the 2nd is not eaten yet.
    const wk = fuelWeek(logs, FUEL_DEFAULTS, 7, new Date('2026-10-02T03:30:00+03:00'));
    assert(wk.daysLogged === 3 && wk.proteinHitDays === 3, `before 04:00 the diet week ends on last evening's day (got ${wk.daysLogged} days, ${wk.proteinHitDays} on protein)`);
    const late = fuelWeek(logs, FUEL_DEFAULTS, 7, new Date('2026-10-02T00:30:00+03:00'));
    assert(late.daysLogged === 3 && late.proteinHitDays === 3, `at 00:30 the evening's row is today's row (got ${late.daysLogged})`);
    const after = fuelWeek(logs, FUEL_DEFAULTS, 7, new Date('2026-10-02T04:30:00+03:00'));
    assert(after.daysLogged === 3 && after.proteinHitDays === 2, `after 04:00 the window moves on a day: 26 Sep – 2 Oct (got ${after.daysLogged})`);
    assert(/ownerActivityDayUtc\(now\)/.test(fnBody('src/lib/health-insights.ts', 'fuelWeek')), 'fuelWeek reads the activity-day clock, not the server clock');
  }

  // 5. PDF text is total: one character Helvetica cannot encode ("≈", Greek
  // "μ", a non-breaking hyphen, any Arabic letter) in a med name, dose or
  // lab unit threw inside pdf-lib and the whole report returned 500.
  {
    const nasty = ['≈ 5 mg', 'μmol/L', 'Co‑amoxiclav', 'نيبيليت 5 ملغ', 'x ≠ y ↑ ✓', 'a\tb‏c', 'HbA₁c ٥٫٧', '😀 ok', 'Zoë · café – “q” €5 ±2°'];
    assert(pdfSafe('≈ 5 mg') === '~ 5 mg' && pdfSafe('Co‑amoxiclav') === 'Co-amoxiclav', 'the common glyphs map to their plain equivalents');
    assert(pdfSafe('μmol/L') === 'µmol/L', 'Greek mu becomes the micro sign Helvetica has');
    assert(/^\?+ 5 \?+$/.test(pdfSafe('نيبيليت 5 ملغ')), `what cannot be encoded prints as "?" (got "${pdfSafe('نيبيليت 5 ملغ')}")`);
    assert(pdfSafe('Zoë · café') === 'Zoë · café', 'what Helvetica can encode is left alone');
    pendingAsync.push((async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage();
      let threw = '';
      for (const s of nasty) {
        try {
          font.widthOfTextAtSize(pdfSafe(s), 9);
          page.drawText(pdfSafe(s), { x: 20, y: 400, size: 9, font });
        } catch (e) {
          threw += `[${s}: ${(e as Error).message.slice(0, 40)}] `;
        }
      }
      await doc.save();
      assert(threw === '', `pdf-lib draws every string after pdfSafe ${threw}`);
      // The conditions line ran 433 of 483 pt on one line with no wrap.
      const conditions = ['Paroxysmal atrial fibrillation', 'Obstructive sleep apnoea on CPAP', 'Hypertension', 'Dyslipidaemia with raised Lp(a)', 'Obesity class II', 'Fatty liver'].join(' · ');
      const measure = (s: string) => font.widthOfTextAtSize(s, 8.5);
      const lines = wrapLines(conditions, 483, measure);
      assert(lines.length > 1 && lines.every((l) => measure(l) <= 483), `a long conditions line wraps inside the margins (got ${lines.length} line(s))`);
      assert(lines.join(' ') === conditions, 'wrapping loses no word');
      assert(wrapLines('short', 483, measure).length === 1, 'a short line stays one line');
      assert(wrapLines('  noted at the time: gas', 483, measure)[0] === '  noted at the time: gas', 'an indented note keeps its indent');
    })());
    const pdf = src('src/app/api/health/report-pdf/route.ts');
    assert(/pdfSafe/.test(pdf) && !/const clean = /.test(pdf), 'the PDF route encodes text through pdfSafe');
    const rawDraws = [...pdf.matchAll(/drawText\(([^,]+),/g)].map((m) => m[1].trim()).filter((a) => !/^pdfSafe\(/.test(a));
    assert(rawDraws.length === 0, `every drawText argument goes through pdfSafe (raw: ${rawDraws.join(' | ')})`);
    assert(/wrapLines\(/.test(pdf), 'the PDF wraps long notes');
  }

  // 6. Law 5: "a chart from 3 points is a lie with axes" — and the report
  // drew trends from 3 points and the dose chart from 2.
  {
    const w3 = [1, 8, 15].map((d2) => ({ date: dayRow(`2026-09-${String(d2).padStart(2, '0')}`), weight: 127 - d2 / 10 }));
    assert(weightChart(w3) === null, 'three weigh-ins are not a chart');
    assert(weightChart([...w3, { date: dayRow('2026-09-22'), weight: 125 }]) !== null, 'four weigh-ins are');
    const b3 = [8, 11, 15].map((d2) => ({ at: dayRow(`2026-09-${String(d2).padStart(2, '0')}`), systolic: 114, diastolic: 73 }));
    assert(bpChart(b3) === null && bpChart([...b3, { at: dayRow('2026-09-18'), systolic: 112, diastolic: 70 }]) !== null, 'BP charts from four readings, not three');
    const n3 = [26, 27, 28].map((d2) => ({ night: dayRow(`2026-09-${d2}`), usageHours: 6, ahi: 2 }));
    assert(cpapHoursChart(n3) === null && cpapAhiChart(n3) === null, 'three CPAP nights are not a chart');
    const doses = [15, 22, 29].map((d2) => ({ at: dayRow(`2026-09-${d2}`), doseMg: 2.5 }));
    assert(doseChart(doses.slice(0, 2), dayRow('2026-10-03')) === null && doseChart(doses, dayRow('2026-10-03')) === null, 'two or three injections are not a dose chart');
    assert(doseChart([...doses, { at: dayRow('2026-10-06'), doseMg: 5 }], dayRow('2026-10-07')) !== null, 'four injections are');
    assert(/charts\.dose \? <ReportChart spec=\{charts\.dose\} \/> : tooFew/.test(src('src/app/health/report/page.tsx')), 'the report page says "not enough" under a dose chart it will not draw');
    assert(/4 points for a chart/.test(src('docs/HEALTH.md')), 'HEALTH.md law 5 states the chart threshold');
  }

  // 7. One fact, one definition. Home said "6 nights running on the mask"
  // (any use) while Patterns said "current streak 1" (4 h or more); and AF
  // "days calm" was Riyadh calendar days while "longest calm stretch" was
  // elapsed 24 h blocks, compared directly on the heart sheet.
  {
    const nights = [5, 6, 7, 8, 9, 10].map((d2, i) => ({ night: dayRow(`2026-09-${String(d2).padStart(2, '0')}`), usageHours: i === 3 ? 2 : 6 }));
    const now = new Date('2026-09-10T12:00:00+03:00');
    const home = cpapStats(nights, now).streak;
    const patterns = cpapCompliance(nights, now).currentStreak;
    assert(home === 2 && patterns === 2, `Home and Patterns report the same mask streak: nights of 4 h or more (got ${home} and ${patterns})`);
    assert(cpapStats([...nights, { night: dayRow('2026-09-12'), usageHours: 6 }], now).streak === 1 &&
      cpapCompliance([...nights, { night: dayRow('2026-09-12'), usageHours: 6 }], now).currentStreak === 1, 'a night with no report breaks the streak in both');
    const eps = [{ startedAt: '2026-08-01T23:00:00+03:00' }, { startedAt: '2026-08-21T01:00:00+03:00' }];
    const at = new Date('2026-09-10T00:30:00+03:00');
    const rec = afRecord(eps, at);
    const calm = afStats(eps, at).daysSinceLast;
    assert(rec !== null && rec.currentDays === calm && calm === 20, `"days calm" and the current calm stretch are the same number (got ${calm} and ${rec?.currentDays})`);
    assert(rec !== null && rec.longestDays === 20, `the longest stretch is counted in calendar days too (got ${rec?.longestDays})`);
  }

  // 8. The Journey said "125 kg today" for a weigh-in from 27 Sep.
  {
    const now = new Date('2026-10-02T10:00:00+03:00');
    assert(weighInLabel(125, '2026-09-27T05:30:49.000Z', now) === '125 kg · Sep 27', `an old weigh-in carries its date (got "${weighInLabel(125, '2026-09-27T05:30:49.000Z', now)}")`);
    assert(weighInLabel(124.6, '2026-10-02T06:00:00+03:00', now) === '124.6 kg today', 'a weigh-in from today may say today');
    assert(weighInLabel(125, '2026-10-01T23:30:00+03:00', new Date('2026-10-02T00:30:00+03:00')) === '125 kg · Oct 1', 'yesterday evening is not today after midnight');
    const journey = src('src/app/journey/page.tsx');
    assert(/weighInLabel\(/.test(journey) && !/currentKg\} kg today/.test(journey), 'the Journey header dates the weight');
  }

  // 9. Signs agree. A zero change printed "−0 kg"; a regain printed
  // "+1.5 kg (-1.1%)", and the Arabic line a negative percent after "gain".
  {
    assert(weightChangeLabel(0, 0) === '0 kg (0%)' && signedKg(0) === '0' && signedKg(-1.5) === '+1.5' && signedKg(8) === '−8', `no change is "0 kg" (got "${weightChangeLabel(0, 0)}")`);
    assert(weightChangeLabel(-1.5, -1.1) === '+1.5 kg (+1.1%)', `a regain is plus in both figures (got "${weightChangeLabel(-1.5, -1.1)}")`);
    assert(weightChangeLabel(8, 6) === '−8 kg (−6%)' && weightChangeLabel(8, 6, '-') === '-8 kg (-6%)', 'a loss is minus in both figures, on the page and in the PDF');
    const ar = weightChangeAr(-1.5, -1.1);
    assert(/زيادة/.test(ar) && !/[-−]/.test(ar) && /1\.1/.test(ar), `the Arabic line never prints a negative after the word for gain (got "${ar}")`);
    assert(/نقص 8 /.test(weightChangeAr(8, 6)) && !/نقص|زيادة/.test(weightChangeAr(0, 0)), 'loss says loss; zero says neither');
    for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts', 'src/app/health/analytics/page.tsx']) {
      assert(/weightChangeLabel\(/.test(src(f)) && !/const signedKg/.test(src(f)), `${f} prints the weight change through the one helper`);
    }
  }

  // The report's age was year − 1988, exact-looking and wrong before the
  // birthday. No birth date is stored, so it prints the honest pair.
  {
    const now = new Date('2026-10-02T10:00:00+03:00');
    assert(reportAge(null, now) === '37–38 y', `without a birth date the age is not printed as exact (got "${reportAge(null, now)}")`);
    assert(reportAge('1988-11-05', now) === '37 y' && reportAge('1988-10-02', now) === '38 y' && reportAge('1988-03-01', now) === '38 y', 'with a birth date the age respects the birthday');
    assert(reportAge('not a date', now) === '37–38 y', 'a junk birth date falls back to the year');
    for (const f of ['src/app/health/report/page.tsx', 'src/app/api/health/report-pdf/route.ts']) {
      assert(/reportAge\(/.test(src(f)) && !/getFullYear\(\) - 1988/.test(src(f)), `${f} prints the age through reportAge`);
    }
  }
}

// ── Audit 2: the phone logger (2026-10-02) ─────────────────────────────────
// Eight confirmed bugs, each a decision that lived inline in WorkoutForm
// where nothing could test it. The decisions are pure now
// (src/lib/logger-draft.ts, prescription.ts); these run them, and pin the
// form, the page, the banner and createWorkout to them.
console.log('Audit 2 — the phone logger: drafts, lengths, rescue memory, save ids, records, gym switch');
{
  const LD: typeof import('../src/lib/logger-draft') = require('../src/lib/logger-draft');
  const HI: typeof import('../src/lib/health-insights') = require('../src/lib/health-insights');
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const form = read('src/components/WorkoutForm.tsx');
  const acts = read('src/app/actions.ts');
  const banner = read('src/components/WorkoutDraftBanner.tsx');
  const page = read('src/app/workouts/new/page.tsx');
  // The phone's clock (local, 04:00 rollover) and the server's (Riyadh).
  const dayOf = (d: Date) => HI.activityDayStr(d);
  const serverDay = (d: Date) => HI.ownerActivityDayUtc(d).toISOString().slice(0, 10);
  const at = (mo: number, d: number, h: number, mi = 0) => new Date(2026, mo - 1, d, h, mi);
  const blk = (exerciseId: string, done: boolean[], programName: string | undefined = exerciseId) => ({
    uid: `u-${exerciseId}`, exerciseId, programName, sets: done.map((dn, i) => ({ done: dn, setNumber: i + 1 })),
  });
  const pageA45 = { day: 'A' as const, dur: 45, dayExplicit: false, durExplicit: false };

  // 1 — an untouched draft is not a session.
  assert(!LD.shouldWriteDraft({ finished: false, rescue: false, started: false, touched: false }), 'a logger he only looked at writes no draft');
  assert(LD.shouldWriteDraft({ finished: false, rescue: false, started: false, touched: true }) && LD.shouldWriteDraft({ finished: false, rescue: false, started: true, touched: false }), 'a tick or a typed number does');
  const peeked = { name: 'Day A 45m — Oct 2', savedAt: at(10, 2, 18).getTime(), blocks: [blk('lp', [false, false]), blk('cp', [false])] };
  assert(LD.planDraftRestore(peeked, { ...pageA45, today: '2026-10-04' }, dayOf).kind === 'discard', 'a draft with nothing ticked from 2 Oct is discarded on 4 Oct — never restored with its old date, weights and save id');
  assert(LD.draftDisposable(peeked, '2026-10-04', dayOf) && !LD.draftDisposable(peeked, '2026-10-02', dayOf), 'the same untouched draft is rubbish for the pill the next day, and kept the same day');
  assert(LD.planDraftRestore({ ...peeked, savedAt: at(10, 2, 23).getTime() }, { ...pageA45, today: dayOf(at(10, 3, 3)) }, dayOf).kind === 'restore', '03:00 is still the same activity day (04:00 rollover): the draft restores');
  assert(LD.planDraftRestore({ ...peeked, savedAt: at(10, 2, 23).getTime() }, { ...pageA45, today: dayOf(at(10, 3, 5)) }, dayOf).kind === 'discard', '…and at 05:00 it is yesterday\'s');
  assert(LD.draftDisposable({ name: 'x', blocks: peeked.blocks }, '2026-10-02', dayOf), 'an undated draft with nothing done is rubbish');
  const begun = { name: 'Day A 45m — Oct 2', savedAt: at(10, 2, 18).getTime(), blocks: [blk('lp', [true, false]), blk('cp', [false])] };
  const begunPlan = LD.planDraftRestore(begun, { ...pageA45, today: '2026-10-04' }, dayOf);
  assert(begunPlan.kind === 'restore' && begunPlan.represcribe && !begunPlan.refit, `a draft with done sets from an earlier day restores — and its unstarted machines are re-prescribed (got ${JSON.stringify(begunPlan)})`);
  assert(!LD.draftDisposable(begun, '2026-10-09', dayOf), 'a draft with a ticked set is never disposable, however old');
  const sameDay = LD.planDraftRestore(begun, { ...pageA45, today: '2026-10-02' }, dayOf);
  assert(sameDay.kind === 'restore' && !sameDay.represcribe, 'the same day: restored as stored, nothing repriced');
  const fresh = [blk('lp', [false, false, false]), blk('cp', [false, false, false]), blk('sh', [false])];
  const merged = LD.mergeDraftIntoPlan([blk('lp', [true, false]), blk('cp', [false]), blk('own', [false], ''), blk('gone', [true])], fresh);
  assert(merged[0].sets.length === 2 && merged[0].sets[0].done, 'a started machine keeps its rows exactly as stored');
  assert(merged[1] === fresh[1] && merged[2] === fresh[2], 'every machine not yet started is today\'s fresh block');
  assert(merged.length === 5 && merged[3].exerciseId === 'own' && merged[4].exerciseId === 'gone', 'a block he added and a started machine the plan dropped both stay');
  assert(LD.firstTickDay('2026-10-02', '2026-10-02', '2026-10-03') === '2026-10-03', 'a logger left open across 04:00: the first tick dates the session today');
  assert(LD.firstTickDay('2026-09-30', '2026-10-02', '2026-10-03') === '2026-09-30' && LD.firstTickDay('2026-10-02', '2026-10-02', '2026-10-02') === '2026-10-02', 'a date he set himself, or the same day, is left alone');
  assert(/planDraftRestore\(/.test(form) && /mergeDraftIntoPlan\(/.test(form), 'the logger restores through planDraftRestore and re-prescribes through mergeDraftIntoPlan');
  assert(/shouldWriteDraft\(/.test(form), 'the autosave asks shouldWriteDraft before it writes');
  assert(/firstTickDay\(/.test(form), 'the first tick re-reads the activity day');
  assert(/draftDisposable\(/.test(banner) && /durableRemove\(DRAFT_KEY\)/.test(banner) && !/localStorage\.removeItem\(DRAFT_KEY\);\s*setDraftName\(null\)/.test(banner), 'the pill\'s purge removes the native copy too, and only a draft with nothing done');

  // 2 — the length he chose wins.
  const p30 = { day: 'A' as const, dur: 30, dayExplicit: true, durExplicit: true, today: '2026-10-02' };
  assert(LD.planDraftRestore(peeked, p30, dayOf).kind === 'discard', 'an explicit 30 over an unstarted 45-minute draft: the tap wins, the draft goes');
  const refit = LD.planDraftRestore(begun, p30, dayOf);
  assert(refit.kind === 'restore' && refit.refit, `…over a started one: the done sets stay and the rest is re-fitted (got ${JSON.stringify(refit)})`);
  const bare = LD.planDraftRestore(begun, { ...p30, dur: 60, durExplicit: false }, dayOf);
  assert(bare.kind === 'hop' && bare.href === '/workouts/new?day=A&dur=45', 'a bare open (the + tab, the pill) still follows the draft to its own length');
  const otherDay = LD.planDraftRestore(begun, { ...p30, day: 'B' }, dayOf);
  assert(otherDay.kind === 'hop', 'a started draft from the other day is followed, never binned for a tap');
  assert(LD.planDraftRestore(peeked, { ...p30, day: 'B' }, dayOf).kind === 'discard', 'an unstarted one gives way to the day he tapped');
  assert(LD.renameForDuration('Day A 45m — Oct 2', 30) === 'Day A 30m — Oct 2' && LD.renameForDuration('Legs', 30) === 'Legs', 'the name follows the length; a name of his own is left alone');
  assert(/durExplicit=\{/.test(page) && /dayExplicit=\{/.test(page), 'the page tells the form whether day and length were chosen');

  // 3 — a rescue is never weight memory.
  {
    const id = (name: string) => data.exercises.find((e) => e.name === name)!.id;
    const [lat, row, lp, cpr] = [id('Lat Pulldown'), id('Mid Row'), id('Leg Press'), id('Chest Press')];
    type S = { exerciseId: string; exerciseName: string; setNumber: number; weight: number; reps: number; rpe: number | null; isWarmup: boolean };
    const three = (exerciseId: string, exerciseName: string, weight: number, rpe: number, n = 3): S[] =>
      Array.from({ length: n }, (_, i) => ({ exerciseId, exerciseName, setNumber: i + 1, weight, reps: 12, rpe, isWarmup: false }));
    const w = (date: string, name: string, sets: S[]) => ({ id: `${name}@${date}`, date: new Date(`${date}T00:00:00Z`), name, gym: 'bfit', duration: 2400, sets });
    const dayB = (date: string) => w(date, 'Day B 45m', [...three(lat, 'Lat Pulldown', 40, 2), ...three(row, 'Mid Row', 40, 3)]);
    const dayA = (date: string, kg: number) => w(date, 'Day A 45m', [...three(lp, 'Leg Press', kg, 2), ...three(cpr, 'Chest Press', 27.5, 2)]);
    const rescue = w('2026-09-24', 'Rescue 15m — Sep 24', [...three(lat, 'Lat Pulldown', 25, 2, 2), ...three(row, 'Mid Row', 25, 2, 2), ...three(lp, 'Leg Press', 24, 2, 2), ...three(cpr, 'Chest Press', 16.5, 2, 2)]);
    const history = [dayA('2026-09-06', 30), dayB('2026-09-08'), dayA('2026-09-10', 35), dayB('2026-09-12'), dayA('2026-09-14', 40), dayB('2026-09-16'), dayA('2026-09-18', 40), dayB('2026-09-20')];
    const rows = [...history, rescue, dayA('2026-09-26', 40)];
    const now = new Date('2026-09-28T09:00:00Z');
    const foldAll = (ws: typeof rows) => {
      const mem: MemorySetRow[] = [];
      const ev = new Map<string, Array<{ rpe: number | null; isWarmup: boolean }>>();
      for (const x of ws) {
        for (const st of x.sets) mem.push({ exerciseId: st.exerciseId, exerciseName: st.exerciseName, setNumber: st.setNumber, weight: st.weight, reps: st.reps, rpe: st.rpe, workout: { id: x.id, date: x.date, duration: x.duration, name: x.name } });
        ev.set(x.id, x.sets.map((st) => ({ rpe: st.rpe, isWarmup: false })));
      }
      mem.sort((a, b) => b.workout.date.getTime() - a.workout.date.getTime() || b.setNumber - a.setNumber);
      return foldExerciseMemory(mem, ev);
    };
    const exs = data.exercises.map((e) => ({ id: e.id, pinIncrement: null }));
    const inputs = prescriptionInputs(rows, exs, DEFAULT_GYM_ID, now);
    const without = prescriptionInputs([...history, dayA('2026-09-26', 40)], exs, DEFAULT_GYM_ID, now);
    assert(inputs.status.mode === 'normal' && inputs.cut === null, `the probe is a normal block, two sessions past the rescue (got ${inputs.status.mode}, cut ${inputs.cut})`);
    const memory = foldAll(rows);
    assert(memory[lat]?.weight === 40 && memory[row]?.weight === 40, `a Rescue 15m (2 × 25) is not weight memory two sessions later (got Lat Pulldown ${memory[lat]?.weight}, Mid Row ${memory[row]?.weight})`);
    const byName = new Map(data.exercises.map((e) => [e.name, { id: e.id }]));
    const plan = planExercises(getDayTemplate('B').exercises, byName, memory, inputs);
    const latP = plan.find((p) => p.name === 'Lat Pulldown')!.prescription;
    assert(latP.workingKg === 40 && latP.reason === 'last', `the Day B plan — phone, /train and the Watch read this one — opens Lat Pulldown at 40 (got ${JSON.stringify(latP)})`);
    assert(inputs.pinFor(lp) === without.pinFor(lp) && inputs.pinFor(lp) === 5, `a rescue's 60% weight teaches no pin and breaks no ladder (Leg Press 30/35/40 → 5; got ${inputs.pinFor(lp)}, without the rescue ${without.pinFor(lp)})`);
    assert(inputs.plateauKgFor(row) === 40 && without.plateauKgFor(row) === 40, `…and does not reset a plateau streak (Mid Row four sessions at 40 Hard; got ${inputs.plateauKgFor(row)})`);
    assert(/NOT: \{ name: \{ startsWith: 'Rescue' \} \},[\s\S]{0,120}\.\.\.\(before \? \{ date: \{ lt: before \} \} : \{\}\)/.test(acts), 'the memory query leaves Rescue rows out with or without a cut');
  }

  // 4 — one save id, one session.
  {
    const owner = LD.ownerOf({ date: new Date('2026-10-02'), sets: [{ completedAt: '2026-10-02T15:00:00.000Z' }, { completedAt: '2026-10-02T15:40:00.000Z' }] }, serverDay);
    assert(owner.day === '2026-10-02', `a phone save dated at UTC midnight is its own activity day (got ${owner.day})`);
    const today = [{ completedAt: '2026-10-04T15:00:00.000Z', n: 1 }, { completedAt: '2026-10-04T15:05:00.000Z', n: 2 }];
    const split = LD.splitBySessionDay(owner, today, serverDay);
    assert(split.same.length === 0 && split.other.length === 2 && split.otherDay === '2026-10-04', `sets lifted on 4 Oct under the id of a workout saved 2 Oct are a NEW session, never a merge (got ${JSON.stringify(split)})`);
    assert(LD.rehomedSaveId('abc', '2026-10-04') === 'abc~2026-10-04', 'its id is derived, so an outbox replay finds the workout it already made');
    const replay = LD.splitBySessionDay(owner, [{ completedAt: '2026-10-02T15:00:00.000Z' }, {}], serverDay);
    assert(replay.other.length === 0 && replay.same.length === 2, 'a replay of the same sitting — and a set with no stamp — still merges (deduped stays a SUCCESS, rule 8)');
    const late = LD.ownerOf({ date: new Date('2026-10-02'), sets: [{ completedAt: '2026-10-03T00:50:00.000Z' }] }, serverDay);
    assert(LD.splitBySessionDay(late, [{ completedAt: '2026-10-03T01:05:00.000Z' }], serverDay).other.length === 0, 'a handed-off session that runs past 04:00 Riyadh is still one session');
    const mixed = LD.splitBySessionDay(owner, [{ completedAt: '2026-10-02T15:00:00.000Z' }, ...today], serverDay);
    assert(mixed.same.length === 1 && mixed.other.length === 2, 'a payload holding both is split set by set');
    const saved = { ...owner, sets: [{ exerciseId: 'lp', setNumber: 1, isWarmup: false, reps: 12, weight: 40, rpe: 2 }] };
    const doneSet = (o: Partial<{ setNumber: number; weight: number; completedAt: string }>) => ({ exerciseId: 'lp', setNumber: 1, reps: 12, weight: 40, rpe: 2, completedAt: '2026-10-02T15:00:00.000Z', ...o });
    assert(LD.draftSaveIdFate({ owner: null, liveClosed: false }, [], serverDay) === 'keep', 'an id nobody owns is kept');
    assert(LD.draftSaveIdFate({ owner: null, liveClosed: true }, [doneSet({})], serverDay) === 'new', 'a draft whose live row was closed takes a new id');
    assert(LD.draftSaveIdFate({ owner: saved, liveClosed: true }, [], serverDay) === 'new', 'an unstarted draft holding a saved workout\'s id takes a new id');
    assert(LD.draftSaveIdFate({ owner: saved, liveClosed: true }, [doneSet({})], serverDay) === 'discard', 'a draft whose every done set is already in the saved workout is that session\'s ghost');
    assert(LD.draftSaveIdFate({ owner: saved, liveClosed: true }, [doneSet({}), doneSet({ setNumber: 2 })], serverDay) === 'keep', 'the Watch finished first and the phone holds a set it lacks: same id, the handoff merges it');
    assert(LD.draftSaveIdFate({ owner: saved, liveClosed: true }, [doneSet({ weight: 42.5, completedAt: '2026-10-04T15:00:00.000Z' })], serverDay) === 'new', 'a set lifted another day is never posted under the old id');
    assert(!LD.shouldWriteDraft({ finished: true, rescue: false, started: true, touched: true }), 'once saved, nothing writes the session back as a draft (the ghost)');
    assert(/export async function getSaveIdOwner\(/.test(acts) && /getSaveIdOwner\(/.test(form) && /draftSaveIdFate\(/.test(form), 'the server can say who owns a draft\'s save id, and the restore asks');
    assert(/finishedRef\.current = true/.test(form) && /finished: finishedRef\.current/.test(form), 'the save marks the form finished and the autosave reads it');
  }

  // 5 — deleting a row renumbers the working sets only.
  {
    const st = (setNumber: number, isWarmup = false) => ({ setNumber, isWarmup, id: `${isWarmup ? 'w' : 's'}${setNumber}` });
    const left = LD.removeSetAt([st(0, true), st(1), st(2), st(3)], 3);
    assert(left.map((s) => s.setNumber).join() === '0,1,2', `W,1,2,3 minus set 3 is W,1,2 (got ${left.map((s) => s.setNumber).join()})`);
    assert(LD.removeSetAt([st(0, true), st(1), st(2), st(3)], 1).map((s) => `${s.id}:${s.setNumber}`).join() === 'w0:0,s2:1,s3:2', 'minus set 1: the working sets close up from 1, the warm-up stays 0');
    assert(LD.removeSetAt([st(0, true), st(1)], 0).map((s) => s.setNumber).join() === '1', 'minus the warm-up: set 1 stays set 1');
    assert(/removeSetAt\(b\.sets, idx\)/.test(form) && !/\.map\(\(s, i\) => \(\{ \.\.\.s, setNumber: i \+ 1 \}\)\)/.test(form), 'removeSet goes through removeSetAt');
  }

  // 6 — records fire for program machines, and only celebrate.
  {
    const rec = { unit: 'reps', best: 40, byReps: { 10: 40, 12: 37.5 }, rampScaled: false };
    assert(LD.setRecord({ weight: 42.5, reps: 10 }, rec) === 'all-time', 'a template block (unit "reps") heavier than the record: all-time');
    assert(LD.setRecord({ weight: 40, reps: 12 }, rec) === 'rep', '12 reps at 40 where 12 was only ever done at 37.5: a rep record');
    assert(LD.setRecord({ weight: 37.5, reps: 10 }, rec) === null, 'lighter than a set of MORE reps is no record');
    assert(LD.setRecord({ weight: 24, reps: 15 }, { ...rec, rampScaled: true }) === null, 'a ramp-scaled set claims nothing below the real record');
    assert(LD.setRecord({ weight: 42.5, reps: 10 }, { ...rec, rampScaled: false }) === 'all-time', '…a held machine (not scaled) keeps its record in the ramp');
    assert(LD.setRecord({ weight: 30, reps: 30 }, { ...rec, unit: 'seconds' }) === null && LD.setRecord({ weight: 60, reps: 10, isWarmup: true }, rec) === null, 'never a timed hold, never a warm-up');
    assert(LD.setRecord({ weight: 20, reps: 12 }, { unit: 'reps', best: 0, rampScaled: false }) === null, 'no record at this gym yet (rule 2): the first visit is not fourteen records');
    assert(LD.setRecord({ weight: 42.5, reps: 10 }, { ...rec, earlier: [{ weight: 42.5, reps: 10 }] }) === null, 'three sets at the new weight are one record');
    const sets = [{ weight: 42.5, done: false }, { weight: 42.5, done: false }];
    assert(!LD.blockHasRecord(sets, 'lp', 'reps', { lp: 40 }), 'the PR chip does not light on the prefill, before the lift');
    assert(LD.blockHasRecord([{ ...sets[0], done: true }, sets[1]], 'lp', 'reps', { lp: 40 }), '…it lights on the lifted set');
    assert(!LD.blockHasRecord([{ weight: 60, done: true, exerciseId: 'cp' }], 'fly', 'reps', { fly: 20, cp: 60 }), 'a swapped block: each set against its own machine\'s record');
    assert(LD.movedLabel(42.5, 40, 2.5) === '+1 pin' && LD.movedLabel(45, 40, 2.5) === '+2 pins' && LD.movedLabel(41, 40, 2.5) === '+1 kg', 'what moved: whole pins, else kilograms');
    assert(LD.movedLabel(36, 40, 2.5) === null && LD.movedLabel(40, 40, 2.5) === null, 'a deload or a step down is never printed on the celebration screen');
    assert(!/!block\.unit\b/.test(form) && !/!b\.unit\b/.test(form), 'no guard reads "no unit" as "not timed" — every template block carries unit "reps"');
    assert(/setRecord\(/.test(form) && /blockHasRecord\(/.test(form) && /movedLabel\(/.test(form), 'the toast, the chip and the summary lines go through the tested rules');
  }

  // 7 — a gym switch that did not load.
  {
    const tap = LD.gymSwitchFailure({ shown: 'bfit', wanted: 'work', wantedName: 'Alrajhi Tower', by: 'tap', tries: 1 });
    assert(tap.tag === 'bfit' && !tap.retry && /did not load/.test(tap.notice), `a failed switch puts the tag back on the gym whose numbers are on screen, and says so (got ${JSON.stringify(tap)})`);
    const sess = LD.gymSwitchFailure({ shown: 'bfit', wanted: 'work', wantedName: 'Alrajhi Tower', by: 'session', tries: 1 });
    assert(sess.tag === 'work' && sess.retry && !LD.gymSwitchFailure({ shown: 'bfit', wanted: 'work', wantedName: 'Alrajhi Tower', by: 'session', tries: 3 }).retry, 'a switch the session asked for keeps its tag and retries, three times');
    assert(/gymSwitchFailure\(/.test(form) && !/lastGymRef\.current = gym;\s*restoreCancelRef/.test(form), 'the tag is confirmed only once that gym\'s numbers are on screen');
    assert(/lastGymRef = useRef<string \| null>\(DEFAULT_GYM_ID\)/.test(form), 'the form starts on the home gym\'s numbers: a Watch session at Alrajhi picked up with no draft refetches instead of adopting the tag');
  }

  // 8 — a HOLD morning holds on every rebuild.
  {
    const mem: ExerciseMemory = { weight: 20, reps: 12, rpe: 1, overload: true, allEasy: true, repsFloor: 12 };
    const tpl = getDayTemplate('B').exercises.find((e) => e.name === 'Rear Delt Fly')!;
    assert(prescribeWorking(tpl, mem, 2.5, null, { rampPct: null, rescue: false, readinessHold: true }).workingKg === 20, 'told HOLD, the prescription takes no pin');
    const direct = form.match(/buildBlocks\(/g)?.length ?? 0;
    assert(direct === 3 && /function freshBlocks\(\)[\s\S]{0,260}readinessRef\.current\?\.verdict === 'hold'/.test(form), `every rebuild — Start fresh, the Watch's row, a re-prescribed draft — goes through freshBlocks, which passes the hold (buildBlocks appears ${direct}×: its definition, the mount, freshBlocks)`);
    assert(/setBlocks\(freshBlocks\(\)\)/.test(form), 'Start fresh rebuilds through it');
  }

  // ── Review round on the above (trainer, data-steward, adversary — 2026-10-02) ──
  {
    const coachSrc = read('src/lib/coach.ts');
    const programSrc = read('src/lib/program.ts');
    const rx = (re: RegExp, src: string) => re.test(src);

    // A — a re-laid draft never holds two blocks under one uid.
    const ub = (uid: string, exerciseId: string, done: boolean[], programName?: string) => ({ uid, exerciseId, programName, sets: done.map((dn) => ({ done: dn, weight: 40, isWarmup: false })) });
    const freshA = [ub('b0-LP', 'LP', [false], 'Leg Press'), ub('b1-CP', 'CP', [false, false], 'Chest Press')];
    const swapped = LD.mergeDraftIntoPlan([ub('b0-LP', 'LP', [true], 'Leg Press'), ub('b1-CP', 'PF', [true, false])], freshA);
    assert(swapped.map((b) => `${b.uid}/${b.exerciseId}`).join() === 'b0-LP/LP,b1-CP/PF', `a swapped machine with a done set takes its own slot back — one block per uid (got ${swapped.map((b) => `${b.uid}/${b.exerciseId}`).join()})`);
    const swappedIdle = LD.mergeDraftIntoPlan([ub('b0-LP', 'LP', [true], 'Leg Press'), ub('b1-CP', 'PF', [false, false])], freshA);
    assert(swappedIdle.map((b) => `${b.uid}/${b.exerciseId}`).join() === 'b0-LP/LP,b1-CP/CP', `a swap he never started gives the slot back to today's plan (got ${swappedIdle.map((b) => `${b.uid}/${b.exerciseId}`).join()})`);
    const crowd = LD.mergeDraftIntoPlan([ub('b1-CP', 'PF', [true]), ub('b1-CP', 'XX', [true]), ub('r4nd', 'OWN', [false])], freshA);
    assert(new Set(crowd.map((b) => b.uid)).size === crowd.length && crowd.length === 4, `whatever the draft holds, the merge returns unique uids (got ${crowd.map((b) => b.uid).join()})`);

    // B / trainer 2 — a started machine's undone rows take today's weight.
    const rep = LD.repriceUndone([{ done: true, weight: 40 }, { done: false, weight: 40 }, { done: false, weight: 22, isWarmup: true }], 25, 12.5);
    assert(rep.map((x) => x.weight).join() === '40,25,12.5' && rep.length === 3, `set 1 done at 40 before the break; sets 2–3 open at today's 25, the done set stands, no row removed (got ${rep.map((x) => x.weight).join()})`);
    assert(LD.repriceUndone([{ done: false, weight: 40 }], null, null)[0].weight === 40 && LD.repriceUndone([{ done: false, weight: 22, isWarmup: true }], 25, null)[0].weight === 22, 'nothing to prescribe leaves the rows as stored');
    const relaid = LD.mergeDraftIntoPlan([ub('b0-LP', 'LP', [true, false], 'Leg Press')], [{ ...ub('b0-LP', 'LP', [false, false], 'Leg Press'), sets: [{ done: false, weight: 25, isWarmup: false }] }],
      (mine, slot) => ({ ...mine, sets: LD.repriceUndone(mine.sets, slot.sets[0].weight, null) }));
    assert(relaid[0].sets.map((x) => x.weight).join() === '40,25', 'the merge hands a started machine its plan slot to reprice from');
    assert(rx(/repriceUndone\(/, form) && rx(/repriceStarted/, form), 'the logger reprices a stale draft\'s started machines — at home from today\'s plan, away from that building\'s');

    // Trainer 1, steward 7–9, adversary C–D — every set to the workout of its sitting.
    const R = (known: Array<{ saveId: string; day: string; stamps: string[] }>, day: string, sets: Array<{ completedAt?: string }>) =>
      LD.routeSets('X', known.map((k) => ({ ...k, stamps: k.stamps.map((x) => Date.parse(x)) })), day, sets, serverDay).map((r) => `${r.saveId}@${r.day}:${r.sets.length}`).join(' ');
    const oct2 = [{ completedAt: '2026-10-02T15:00:00.000Z' }, { completedAt: '2026-10-02T15:04:00.000Z' }];
    const oct5 = [0, 5, 10, 15].map((m) => ({ completedAt: `2026-10-05T15:${String(m).padStart(2, '0')}:00.000Z`, exerciseId: `m${m}`, setNumber: 1, rpe: 2 }));
    assert(R([], '2026-10-02', [...oct2, ...oct5]) === 'X@null:2 X~2026-10-05@2026-10-05:4', `two sets ticked 2 Oct, never saved, finished 5 Oct: two workouts, each on the day it was lifted (got ${R([], '2026-10-02', [...oct2, ...oct5])})`);
    assert(R([{ saveId: 'X', day: '2026-10-02', stamps: oct2.map((x) => x.completedAt) }, { saveId: 'X~2026-10-05', day: '2026-10-05', stamps: oct5.map((x) => x.completedAt) }], '2026-10-02', [...oct2, ...oct5]) === 'X@null:2 X~2026-10-05@null:4', 'the outbox replaying it finds both again');
    assert(R([], '2026-09-30', oct2) === 'X@null:2', 'one sitting he back-dated stays one workout on the date he set');
    const o350 = '2026-10-03T00:50:00.000Z', o405 = '2026-10-03T01:05:00.000Z', o1800 = '2026-10-03T15:00:00.000Z';
    const mixedPayload = [{ completedAt: o350 }, { completedAt: o405 }, { completedAt: o1800 }];
    const firstRoute = R([{ saveId: 'X', day: '2026-10-02', stamps: [o350] }], '2026-10-02', mixedPayload);
    assert(firstRoute === 'X@null:2 X~2026-10-03@2026-10-03:1', `03:50 and 04:05 are one sitting; 18:00 the next day is another (got ${firstRoute})`);
    assert(R([{ saveId: 'X', day: '2026-10-02', stamps: [o350, o405] }], '2026-10-02', mixedPayload) === firstRoute, 'replay after the merge widened the owner (and before the second workout landed): the split is the same');
    assert(R([{ saveId: 'X', day: '2026-10-02', stamps: [o350, o405] }, { saveId: 'X~2026-10-03', day: '2026-10-03', stamps: [o1800] }], '2026-10-02', mixedPayload) === 'X@null:2 X~2026-10-03@null:1', '…and after both landed: nothing grafted into the old workout, nothing stored twice');
    const sep30 = { saveId: 'X', day: '2026-09-30', stamps: ['2026-09-30T17:00:00.000Z'] };
    const o410 = '2026-10-03T01:10:00.000Z';
    assert(R([sep30], '2026-09-30', [{ completedAt: o410 }]) === 'X~2026-10-03@2026-10-03:1', 'the phone finishes first with only its 04:10 set');
    assert(R([sep30, { saveId: 'X~2026-10-03', day: '2026-10-03', stamps: [o410] }], '2026-09-30', [{ completedAt: o350 }, { completedAt: o410 }]) === 'X~2026-10-03@null:2', 'the Watch then posts 03:50 and 04:10: the SAME workout, found by its sets — not a second one a day earlier');
    assert(R([sep30], '2026-10-05', [{}, {}]) === 'X~2026-10-05@2026-10-05:2', 'sets with no stamp under a stale id go by the payload\'s date — never merged into the old workout by default');
    assert(R([sep30], '2026-09-30', [{}, {}]) === 'X@null:2', '…and a replay of the same unstamped save still dedupes (rule 8)');
    const watchRow = LD.ownerOf({ date: new Date('2026-10-03T00:30:00.000Z'), sets: [] }, serverDay);
    assert(watchRow.day === '2026-10-02' && !('days' in watchRow), `an instant-dated row at 03:30 Riyadh owns ONE activity day (got ${JSON.stringify(watchRow)})`);
    assert(LD.datedName('Day B 45m — Oct 2', '2026-10-05') === 'Day B 45m — Oct 5' && LD.datedName('Legs', '2026-10-05') === 'Legs — Oct 5', 'a re-homed workout carries its own date in its name');
    assert(LD.sittingSeconds(oct5) === 900 && LD.sittingSeconds([{}]) === null, 'its length is its own sets\', not the other day\'s');
    const rowOwner = { day: '2026-10-02', stamps: oct2.map((x) => Date.parse(x.completedAt)) };
    assert(LD.closedRowVerdict(rowOwner, oct2, serverDay) === 'handoff' && LD.closedRowVerdict(rowOwner, oct5, serverDay) === 'new-id' && LD.closedRowVerdict(rowOwner, [...oct2, ...oct5], serverDay) === 'stay', 'a closed row: its own sets are handed off, another day\'s take a new id, a mix stays on screen (never thrown to the old workout mid-session)');
    assert(rx(/routeSets\(/, acts) && rx(/datedName\(/, acts) && rx(/sittingSeconds\(/, acts), 'createWorkout routes every set by sitting, with or without an owner');
    assert(rx(/startsWith: `\$\{root\}~`/, acts), 'the derived id is resolved by lookup: every workout saved under the id or derived from it is read first');
    assert(rx(/routeLiveSets\(/, acts) && rx(/closeLive\(root, /, acts), 'a re-homed save still reconciles with the live row under the posted id, and closes it');

    // Trainer 3 — no cut for a trailing rescue.
    {
      const day3 = (date: string, name: string, kg: number) => ({
        date: new Date(`${date}T00:00:00Z`), name, gym: 'bfit', duration: 2400,
        sets: [1, 2, 3, 4, 5, 6].map(() => ({ exerciseId: 'lat', weight: kg, rpe: 2, isWarmup: false })),
      });
      const rows3 = [day3('2026-09-06', 'Day B 45m', 40), day3('2026-09-10', 'Day A 45m', 30), day3('2026-09-14', 'Day B 45m', 40), day3('2026-09-18', 'Rescue 15m — Sep 18', 24)];
      const in3 = prescriptionInputs(rows3, [], DEFAULT_GYM_ID, new Date('2026-09-19T09:00:00Z'));
      assert(in3.status.mode === 'normal' && in3.cut === null, `outside a ramp a trailing rescue sets no memory cut — rescue rows are never memory, and the cut walked back over a finished ramp to pre-break weights (got ${in3.status.mode}, cut ${in3.cut})`);
    }

    // Trainer 4, adversary F — records never celebrate breaking the ramp, or a rep count he never reached.
    const rec = { unit: 'reps', best: 40, byReps: { 12: 40, 15: 37.5 }, rampScaled: false };
    assert(LD.setRecord({ weight: 42.5, reps: 10 }, { ...rec, rampScaled: true }) === null, 'REBOOT, prescribed ~25, he lifts 42.5 against a best of 40: no record line for the lift the judge marks over-ramp');
    assert(LD.setRecord({ weight: 20, reps: 20 }, rec) === null && LD.setRecord({ weight: 30, reps: 16 }, rec) === null, '20 kg × 20 against a 40 kg best is not "best 20-rep set": a rep record needs a set of at least that many reps to beat');
    assert(LD.setRecord({ weight: 40, reps: 13 }, rec) === 'rep', '13 reps at 40 where 15 was only done at 37.5 still is');
    assert(!LD.blockHasRecord([{ weight: 42.5, done: true }], 'lp', 'reps', { lp: 40 }, true) && LD.blockHasRecord([{ weight: 42.5, done: true }], 'lp', 'reps', { lp: 40 }, false), 'the chip and the summary line follow the same ramp guard');
    assert(rx(/const rampScaledFor = /, form) && rx(/rescueMode \|\|/, form.slice(form.indexOf('const rampScaledFor = '), form.indexOf('const rampScaledFor = ') + 400)) && rx(/rampHold/, form.slice(form.indexOf('const rampScaledFor = '), form.indexOf('const rampScaledFor = ') + 400)), 'a rescue session and a scaled ramp machine are "scaled"; a held machine (first met in the ramp) keeps its record');

    // Trainer 5 — rescue rows are out of every per-machine reader.
    {
      const cs = (w: number, rpe: number) => [1, 2, 3].map(() => ({ exerciseId: 'row', reps: 12, weight: w, rpe, exercise: { id: 'row', name: 'Mid Row', category: 'BACK' } }));
      const stuck = ['2026-09-08', '2026-09-12', '2026-09-16', '2026-09-20'].map((d0) => ({ date: new Date(`${d0}T00:00:00Z`), name: 'Day B 45m', sets: cs(40, 3) }));
      const withRescue = [...stuck, { date: new Date('2026-09-24T00:00:00Z'), name: 'Rescue 15m — Sep 24', sets: cs(25, 2) }];
      const says = (ws: CoachWorkout[]) => weeklyReport(ws, [], { mode: 'normal', week: 6 }, new Date('2026-09-25T09:00:00Z')).focus.some((f) => f.includes('Mid Row stuck at 40'));
      assert(says(stuck) && says(withRescue), 'the Stats report still says Mid Row is stuck at 40 after a rescue — the logger opens it at the deload weight');
      assert(rx(/NOT: \{ name: \{ startsWith: 'Rescue' \} \}/, acts.slice(acts.indexOf('export async function getRecentExerciseSessions'), acts.indexOf('export async function getRecentExerciseSessions') + 900)), 'the ⓘ drawer never shows a rescue\'s weight as a session top');
      assert(rx(/NOT: \{ name: \{ startsWith: 'Rescue' \} \}/, acts.slice(acts.indexOf('export async function getExerciseHistory'), acts.indexOf('export async function getExerciseHistory') + 1200)), 'nor does the progress chart');
      void coachSrc;
    }

    // Trainer 6 — a rescue never closes the ramp.
    {
      const dts = (list: string[]) => list.map((x) => new Date(`${x}T00:00:00Z`));
      const before = dts(['2026-05-10', '2026-05-14', '2026-05-18']);
      const ramp = dts(['2026-09-01', '2026-09-05', '2026-09-09', '2026-09-13', '2026-09-17', '2026-09-21', '2026-09-25']);
      const resc = dts(['2026-09-29']);
      const st = getTrainingStatus([...before, ...ramp, ...resc], new Date('2026-09-30T09:00:00Z'), [], resc);
      assert(st.mode === 'return' && st.week === 4 && st.sessionsInBlock === 7, `seven ramp sessions and a 15-minute rescue: still RESTORE — the rescue is not session 8 (got ${JSON.stringify(st)})`);
      const real = getTrainingStatus([...before, ...ramp, ...resc], new Date('2026-09-30T09:00:00Z'), [], []);
      assert(real.mode === 'normal', 'the same eight rows, all real sessions, do finish it');
      const later = getTrainingStatus([...before, ...ramp, ...resc], new Date('2026-10-18T09:00:00Z'), [], resc);
      assert(later.mode === 'return' && later.sessionsInBlock === 7, `…and the rescue still keeps the chain: 19 days after it (23 after the last real session) is not a new layoff (got ${JSON.stringify(later)})`);
      const sameDay = getTrainingStatus([...before, ...ramp, ...resc, ...resc], new Date('2026-09-30T09:00:00Z'), [], resc);
      assert(sameDay.mode === 'normal', 'a real session on the rescue\'s day counts');
      const rsess = (date: string, name: string) => ({ date: new Date(`${date}T00:00:00Z`), name, gym: 'bfit', duration: 2400, sets: [1, 2, 3, 4, 5, 6].map(() => ({ exerciseId: 'lat', weight: 20, rpe: 2, isWarmup: false })) });
      const viaInputs = prescriptionInputs([
        ...['2026-05-10', '2026-05-14', '2026-05-18'].map((x) => rsess(x, 'Day B 45m')),
        ...['2026-09-01', '2026-09-05', '2026-09-09', '2026-09-13', '2026-09-17', '2026-09-21', '2026-09-25'].map((x, i) => rsess(x, i % 2 ? 'Day A 45m' : 'Day B 45m')),
        rsess('2026-09-29', 'Rescue 15m — Sep 29'),
      ], [], DEFAULT_GYM_ID, new Date('2026-09-30T09:00:00Z'));
      assert(viaInputs.status.mode === 'return' && viaInputs.rampRpeCap != null, `the one prescription (phone, /train, Watch, save-time judge) reads it that way: Day A still opens under RESTORE with its effort cap (got ${viaInputs.status.mode})`);
      // Every screen and the Watch verdict must agree with the logger about
      // where the ramp ends: no caller of getTrainingStatus may leave the
      // rescue dates out (a sixth caller cannot be added without them).
      const bare: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (/\.tsx?$/.test(e.name)) {
            fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
              if (/getTrainingStatus\(/.test(line) && !/export function getTrainingStatus/.test(line) && !/^\s*(\/\/|\*)/.test(line) && !/rescueDatesOf\(/.test(line)) bare.push(`${path.relative(path.join(__dirname, '..'), full)}:${i + 1}`);
            });
          }
        }
      };
      walk(path.join(__dirname, '..', 'src'));
      assert(bare.length === 0, `every getTrainingStatus call in src/ passes rescueDatesOf (missing: ${bare.join(', ') || 'none'})`);
      void programSrc;
    }

    // Adversary E — a session's gym that will not load.
    const gaveUp = LD.gymSwitchFailure({ shown: 'bfit', wanted: 'work', wantedName: 'Alrajhi Tower', by: 'session', tries: 3 });
    assert(gaveUp.tag === 'work' && gaveUp.blank && !gaveUp.retry && /tap it to retry/.test(gaveUp.notice), `B_Fit prefills are never left under the Alrajhi tag: the unstarted weights are blanked, and the notice says how to retry (got ${JSON.stringify(gaveUp)})`);
    assert(!LD.gymSwitchFailure({ shown: 'work', wanted: 'work', wantedName: 'Alrajhi Tower', by: 'session', tries: 1 }).blank, 'a restored Alrajhi draft\'s own numbers are that building\'s: nothing blanked');
    assert(rx(/g\.id === gym && gymReloadRef\.current/, form) && rx(/blankUnstarted\(/, form), 'tapping the tagged gym retries its load, and a failed session load blanks the other building\'s prefills');

    // Adversary G.
    const renamed = { name: 'Push day', day: 'A', dur: 45, savedAt: at(10, 2, 18).getTime(), blocks: [blk('lp', [true, false])] };
    const pRenamed = LD.planDraftRestore(renamed, { day: 'A', dur: 30, dayExplicit: true, durExplicit: true, today: '2026-10-02' }, dayOf);
    assert(pRenamed.kind === 'restore' && pRenamed.refit, `a draft he renamed still knows its day and length: an explicit 30 re-fits it (got ${JSON.stringify(pRenamed)})`);
    const pHop = LD.planDraftRestore(renamed, { day: 'B', dur: 45, dayExplicit: false, durExplicit: false, today: '2026-10-02' }, dayOf);
    assert(pHop.kind === 'hop' && pHop.href === '/workouts/new?day=A&dur=45', 'and a bare open follows it to its own day');
    assert(rx(/day: dayAccent \?\? null, dur: durationMin \?\? null/, form), 'the autosave writes the day and the length as fields');
    assert(!rx(/key=\{`[^`]*dayLabel/, page), 'the form is NOT keyed by the day: a server re-render after 04:00 must not remount a session in flight');
    assert(rx(/rolloverAskedRef\.current/, form) && rx(/ownerActivityDayUtc\(\)/, form), 'the rollover reset happens only when this form asked for it with nothing ticked, on the page\'s own clock');
    assert(rx(/saveIdUnsettledRef/, form) && !rx(/const kept = draft \? await settleSaveId/, form), 'the save-id question no longer holds the autosave shut: ticks during the wait are drafted, pushes wait, and it is asked again when the network returns');
  }
  // ── Review round 2 on the save router (adversary probe + data-steward — 2026-10-02) ──
  // A split is the exception: only a later sitting that is a SESSION of its
  // own is one. A piece that is not a session never becomes a workout row.
  {
    const RY = (d0: string, hm: string) => new Date(`${d0}T${hm}:00+03:00`).toISOString(); // Riyadh clock
    type PS = { exerciseId: string; setNumber: number; isWarmup?: boolean; rpe?: number | null; completedAt?: string };
    const st = (ex: string, n: number, atISO?: string, rpe: number | null = null): PS => ({ exerciseId: ex, setNumber: n, completedAt: atISO, rpe, isWarmup: n === 0 });
    const full = (d0: string, hm: string, rpe: number | null = 2): PS[] =>
      ['m1', 'm2', 'm3'].flatMap((ex, i) => [1, 2].map((n) => st(ex, n, new Date(Date.parse(RY(d0, hm)) + (i * 2 + n) * 4 * 60_000).toISOString(), rpe)));
    type K = { saveId: string; day: string; stamps: number[]; sets?: Array<{ key: string; at: number | null }> };
    const kOf = (saveId: string, d0: string, sets: PS[]): K => ({
      saveId, day: d0,
      stamps: sets.filter((x) => x.completedAt).map((x) => Date.parse(x.completedAt!)),
      sets: sets.map((x) => ({ key: LD.setKey(x), at: x.completedAt ? Date.parse(x.completedAt) : null })),
    });
    const RR = (known: K[], payload: { day: string; dateByHand?: boolean }, sets: PS[]) =>
      LD.routeSets('X', known, payload, sets, serverDay).map((r) => `${r.saveId}@${r.day}:${r.sets.length}`).join(' ');

    // 1 — the date he set, and late ticks.
    const evening = [st('a', 1, RY('2026-10-01', '19:00')), st('a', 2, RY('2026-10-01', '19:05'))];
    assert(RR([], { day: '2026-10-01' }, [...evening, st('b', 1, RY('2026-10-02', '08:00'))]) === 'X@null:3', `a machine he forgot, ticked the next morning with the date still yesterday: ONE workout on the date he set (got ${RR([], { day: '2026-10-01' }, [...evening, st('b', 1, RY('2026-10-02', '08:00'))])})`);
    assert(RR([], { day: '2026-10-01' }, [...evening, st('b', 1, RY('2026-10-02', '08:00'), 2), st('b', 2, RY('2026-10-02', '08:03'), 2)]) === 'X@null:4', 'two RATED late ticks are still not a session of their own');
    const twoEvenings = [...full('2026-10-01', '21:00'), ...full('2026-10-02', '21:00').map((x) => ({ ...x, exerciseId: `n${x.exerciseId}` }))];
    assert(RR([], { day: '2026-09-29' }, twoEvenings) === 'X@null:12', `a back-fill dated last Tuesday, ticked across two evenings: no sitting is on the payload's date, so the date was set by hand — one workout on it (got ${RR([], { day: '2026-09-29' }, twoEvenings)})`);
    const incident = [st('a', 1, RY('2026-10-02', '18:00')), st('a', 2, RY('2026-10-02', '18:04')), ...full('2026-10-05', '18:00')];
    assert(RR([], { day: '2026-10-02' }, incident) === 'X@null:2 X~2026-10-05@2026-10-05:6', `the incident stands: a stale draft continued as a FULL session three days later is two workouts, each on its day (got ${RR([], { day: '2026-10-02' }, incident)})`);
    assert(RR([], { day: '2026-10-02', dateByHand: true }, incident) === 'X@null:8', 'a hand-set date is never split or re-dated, whatever the ticks say');
    assert(RR([kOf('X', '2026-09-20', full('2026-09-20', '18:00'))], { day: '2026-10-02', dateByHand: true }, full('2026-10-05', '18:00')) === 'X~2026-10-02@2026-10-02:6', 'a hand-set date under a stale id is one NEW workout on that date — still never merged into the old one');
    assert(LD.sessionOfItsOwn(full('2026-10-05', '18:00')) && !LD.sessionOfItsOwn([st('b', 1, RY('2026-10-02', '08:00'), 2), st('b', 2, RY('2026-10-02', '08:03'), 2)]) && !LD.sessionOfItsOwn([st('a', 0, RY('2026-10-02', '02:00'))]), 'a session of its own: the app\'s evidence bar AND four working sets');
    assert(/dateSetByHand: dateByHandRef\.current/.test(form) && /dateByHand: data\.dateSetByHand/.test(acts), 'the form says when the date is his, and the router is told');

    // 3 — a stray tick before 04:00.
    const stray = [st('a', 0, RY('2026-10-02', '02:00')), st('a', 1, RY('2026-10-02', '18:00')), st('a', 2, RY('2026-10-02', '18:30'))];
    assert(RR([], { day: '2026-10-02' }, stray) === 'X@null:3', `a warm-up ticked at 02:00 and the session at 18:00: one workout, no one-set row in history (got ${RR([], { day: '2026-10-02' }, stray)})`);
    assert(RR([], { day: '2026-10-02' }, [st('a', 1, RY('2026-10-02', '23:58')), st('a', 2, RY('2026-10-03', '04:00'))]) === 'X@null:2', 'a pause of 4 h 02 across the rollover is still one evening');
    const pushRow = { id: 'w', name: 'Day A', date: new Date('2026-10-01T00:00:00Z'), duration: 60, createdAt: new Date('2026-10-01T16:00:00Z'), setTimes: [new Date('2026-10-01T15:00:00Z')], setCount: 1 };
    assert(planHealthPush([{ ...pushRow, session: false }], new Date('2026-10-03T12:00:00Z')).length === 0 && planHealthPush([{ ...pushRow, session: true }], new Date('2026-10-03T12:00:00Z')).length === 1, 'a row that is not a session is never a candidate for Apple Health (rule 11)');
    assert(/session: isTrainingSession\(/.test(read('src/app/health-actions.ts')), 'the push query judges each row by the evidence bar');

    // 4 — a second finisher whose payload bridges two saved sittings.
    const a1 = st('a', 1, RY('2026-10-02', '23:00')), b1 = st('b', 1, RY('2026-10-03', '01:30')), c1 = st('c', 1, RY('2026-10-03', '04:10'));
    const famA = kOf('X', '2026-10-02', [a1]), famC = kOf('X~2026-10-03', '2026-10-03', [c1]);
    const bridged = RR([famA, famC], { day: '2026-10-02' }, [a1, b1, c1]);
    assert(bridged === 'X@null:2 X~2026-10-03@null:1', `each posted set goes first to the workout already holding that tick; only the rest is routed by time (got ${bridged})`);
    assert(RR([famC, famA], { day: '2026-10-02' }, [a1, b1, c1]) === bridged, 'whatever order the family is read in');
    assert(/orderBy: \{ clientSaveId: 'asc' \}/.test(acts), 'and it is read in a fixed order');

    // 5 — a Watch-saved workout whose sets carry no stamp.
    const bareOwner = LD.ownerOf({ date: new Date('2026-10-01T00:00:00Z'), createdAt: new Date(RY('2026-10-02', '04:02')), sets: [{ completedAt: null }] }, serverDay);
    assert(bareOwner.stamps.length === 1 && bareOwner.stamps[0] === Date.parse(RY('2026-10-02', '04:02')), 'an owner with no stamped set stands at the moment it was saved');
    assert(RR([{ saveId: 'X', ...bareOwner }], { day: '2026-10-02' }, [st('b', 1, RY('2026-10-02', '04:05'))]) === 'X@null:1', 'so the phone\'s half of a handoff across 04:00 still joins it');

    // 2, 6, 7 — the glue in createWorkout.
    assert(/duration: last \? data\.duration \?\? sittingSeconds\(r\.sets\) \?\? undefined : sittingSeconds\(r\.sets\) \?\? undefined/.test(acts), 'the sitting being finished keeps the payload\'s duration (the HealthKit-detected one included); only an older sitting takes its own span');
    assert(/SAVE_ID_FAMILY\.test\(/.test(acts) && LD.SAVE_ID_FAMILY.test('~2026-10-03') && !LD.SAVE_ID_FAMILY.test('~%') && LD.plainSaveId('save-abc-123') && !LD.plainSaveId('X~2026-10-03') && !LD.plainSaveId('a%') && !LD.plainSaveId('a_b'), 'the family is filtered in code to the id and id~YYYY-MM-DD; an id with ~, % or _ is not a root');
    assert(/plainSaveId\(/.test(read('src/app/api/watch/log/route.ts')) && /plainSaveId\(/.test(read('src/app/api/live/route.ts')), '/api/watch/log and /api/live refuse such an id');
    assert(/const allowedOnce = await rampAllowances\(data\.sets, data\.gym, data\.name, root, true\)/.test(acts) && /allowed: allowedOnce/.test(acts), 'rule 10: the ramp allowances of a split save are computed ONCE, before any sitting is committed, from a snapshot without the whole family');

    // 8 — the live row on a split save.
    const routesL = [{ saveId: 'X', sets: [st('a', 1, RY('2026-10-02', '18:00'))] }, { saveId: 'X~2026-10-05', sets: full('2026-10-05', '18:00') }];
    const tomb = { ...st('a', 1, RY('2026-10-05', '18:30')), completedAt: RY('2026-10-05', '18:30'), removed: true as const };
    const watchSet = { ...st('w', 1, RY('2026-10-05', '18:20')), completedAt: RY('2026-10-05', '18:20') };
    const farSet = { ...st('z', 1, RY('2026-10-09', '18:20')), completedAt: RY('2026-10-09', '18:20') };
    const lr = LD.routeLiveSets(routesL, [tomb, watchSet, farSet], []);
    assert(lr.byRoute.get('X')?.includes(tomb) === true && !lr.byRoute.get('X~2026-10-05')?.includes(tomb), 'an un-tick made during the later sitting reaches the sitting that HOLDS the set');
    assert(lr.byRoute.get('X~2026-10-05')?.includes(watchSet) === true, 'the other device\'s tick joins the sitting it was lifted in');
    assert(lr.orphans.length === 1 && lr.orphans[0] === farSet, 'a live set no sitting takes is reported, never dropped');
    assert(LD.routeLiveSets(routesL, [farSet], [{ saveId: 'X~2026-10-09', day: '2026-10-09', stamps: [], sets: [{ key: LD.setKey(farSet), at: Date.parse(farSet.completedAt) }] }]).orphans.length === 0, '…unless a saved workout already holds that tick');
    assert(/routeLiveSets\(/.test(acts) && /if \(!liveOrphans\.length\) await closeLive\(root, /.test(acts), 'and the row is left open while it holds a set nobody saved');
  }
}

Promise.all(pendingAsync).then(() => {
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
});
