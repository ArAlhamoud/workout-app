#!/usr/bin/env node
/**
 * Rebuild the database from a snapshot written by scripts/export-data.js.
 *
 * A backup nobody has restored is a hypothesis. This is the other half of
 * sync-data.yml: the path that turns data/workout-history.json back into rows.
 *
 *   node scripts/restore-from-snapshot.js                  # dry run, default
 *   node scripts/restore-from-snapshot.js --apply          # write (empty DB)
 *   node scripts/restore-from-snapshot.js --apply --force  # write over rows
 *   node scripts/restore-from-snapshot.js --file other.json
 *
 * DRY RUN IS THE DEFAULT and it touches nothing. It parses the snapshot,
 * checks every referenced exercise exists, checks the totals the exporter
 * recorded still match the arrays it wrote, and prints what --apply would do.
 *
 * Restores are idempotent: rows carry their original ids and are upserted, so
 * running twice lands in the same place. Writes are ordered exercises ->
 * workouts -> sets -> bodyStats because sets reference both of the first two.
 *
 * Point DATABASE_URL at the target. NEVER point it at production to "test"
 * this — use a Neon branch. --apply refuses a non-empty database unless
 * --force is passed as well.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const fileArg = args.indexOf('--file');
const FILE = fileArg !== -1 ? args[fileArg + 1] : 'data/workout-history.json';

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const full = path.resolve(process.cwd(), FILE);
  if (!fs.existsSync(full)) die(`no snapshot at ${full}`);

  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    die(`snapshot is not valid JSON: ${e.message}`);
  }

  const exercises = snap.exercises ?? [];
  const workouts = snap.workouts ?? [];
  const bodyStats = snap.bodyStats ?? [];
  const healthSamples = snap.healthSamples ?? [];
  const holds = snap.holds ?? [];
  const sets = workouts.flatMap((w) => w.sets ?? []);

  console.log(`snapshot   ${FILE}`);
  console.log(`exported   ${snap.exportedAt ?? 'unknown'}`);
  console.log(`contents   ${exercises.length} exercises · ${workouts.length} workouts · ${sets.length} sets · ${bodyStats.length} body stats · ${healthSamples.length} health samples`);
  // Print the treatment record explicitly. It used to be invisible here, so a
  // snapshot missing all of it looked identical to one carrying all of it.
  const healthCounts = Object.entries(snap.health ?? {})
    .map(([t, rows]) => `${(rows ?? []).length} ${t}`)
    .join(' · ');
  console.log(`health     ${healthCounts || 'NONE — no health section in this snapshot'}`);

  // ── Integrity checks — these are the point of the dry run ──────────────
  const problems = [];

  // The exporter records what it believed it was writing. A mismatch means the
  // file was truncated or hand-edited between export and now.
  if (snap.totalWorkouts !== undefined && snap.totalWorkouts !== workouts.length) {
    problems.push(`header says ${snap.totalWorkouts} workouts, array holds ${workouts.length}`);
  }
  if (snap.totalBodyStats !== undefined && snap.totalBodyStats !== bodyStats.length) {
    problems.push(`header says ${snap.totalBodyStats} body stats, array holds ${bodyStats.length}`);
  }
  if (snap.totalExercises !== undefined && snap.totalExercises !== exercises.length) {
    problems.push(`header says ${snap.totalExercises} exercises, array holds ${exercises.length}`);
  }
  // Snapshots written before health samples were included carry a count with
  // no rows. Say so rather than restore a silently incomplete database.
  if (snap.totalHealthSamples && healthSamples.length !== snap.totalHealthSamples) {
    problems.push(
      `header says ${snap.totalHealthSamples} health samples, snapshot holds ${healthSamples.length} — pre-fix snapshot, those rows are not recoverable from this file`,
    );
  }
  // A snapshot with no `health` section at all used to print "no issues
  // found": the checks above only fire on a header/array MISMATCH, and a file
  // carrying neither header nor rows mismatches nothing. Every iCloud backup
  // taken before 2026-09-07 is such a file — no injections, labs, BP, CPAP,
  // AF or nutrition. Absence has to be louder than a clean bill of health,
  // because the treatment record is the one thing here that cannot be
  // re-derived from anything else.
  if (!snap.health) {
    problems.push(
      'snapshot carries NO health section (injections, labs, BP, CPAP, AF, nutrition, medications) — ' +
        'pre-2026-09-07 iCloud backup; restoring it will leave the treatment record empty',
    );
  } else if (snap.totalInjections !== undefined && (snap.health.injection ?? []).length !== snap.totalInjections) {
    problems.push(
      `header says ${snap.totalInjections} injections, snapshot holds ${(snap.health.injection ?? []).length}`,
    );
  }

  const exerciseIds = new Set(exercises.map((e) => e.id));
  const orphanSets = sets.filter((s) => !exerciseIds.has(s.exerciseId));
  if (orphanSets.length) {
    problems.push(`${orphanSets.length} sets reference an exercise missing from the snapshot`);
  }
  const workoutIds = new Set(workouts.map((w) => w.id));
  const strayParents = sets.filter((s) => s.workoutId && !workoutIds.has(s.workoutId));
  if (strayParents.length) {
    problems.push(`${strayParents.length} sets reference a workout missing from the snapshot`);
  }
  const undated = workouts.filter((w) => !w.date || Number.isNaN(Date.parse(w.date)));
  if (undated.length) problems.push(`${undated.length} workouts have an unparseable date`);

  if (problems.length) {
    console.log('\nissues');
    for (const p of problems) console.log(`  ! ${p}`);
  } else {
    console.log('\nintegrity  no issues found');
  }

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply against a scratch database.');
    process.exit(problems.length ? 1 : 0);
  }

  // ── Write path ─────────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) die('--apply needs DATABASE_URL');

  const { PrismaClient, Prisma } = require('@prisma/client');
  const prisma = new PrismaClient();

  // A nullable Json column round-trips through JSON.stringify as `null`, and
  // Prisma will NOT accept `null` there: the generated input type is
  // `NullableJsonNullValueInput | InputJsonValue`, with no `| null`. Passing
  // it through raw dies on the first workout (`hrSeries: null` — every row in
  // the current snapshot) and again on nutritionLog (`flags: null`). The app
  // already works around this in four places with Prisma.DbNull. Without this
  // the restore is a hypothesis, not a backup.
  const JSON_COLUMNS = {
    workout: ['hrSeries'],
    healthProfile: ['milestonesKg', 'conditions', 'dosePlan', 'targets', 'reminders'],
    symptomLog: ['context'],
    nutritionLog: ['flags'],
    coachNote: ['directives', 'proposal'],
    coachLadderCopy: ['copy'],
  };
  /** Row with its nullable-Json nulls swapped for the JSON null Prisma wants. */
  const jsonSafe = (table, row) => {
    const cols = JSON_COLUMNS[table];
    if (!cols) return row;
    const out = { ...row };
    for (const c of cols) if (out[c] === null) out[c] = Prisma.DbNull;
    return out;
  };

  const existing = await prisma.workout.count();
  if (existing > 0 && !FORCE) {
    die(`target already holds ${existing} workouts. Pass --force only if overwriting is intended.`);
  }

  console.log(`\nwriting to the database in DATABASE_URL …`);

  for (const e of exercises) {
    const { id, name, category, pinIncrement } = e;
    await prisma.exercise.upsert({
      where: { id },
      update: { name, category, pinIncrement },
      create: { id, name, category, pinIncrement },
    });
  }
  console.log(`  exercises   ${exercises.length}`);

  for (const w of workouts) {
    const { sets: workoutSets = [], ...raw } = w;
    const row = jsonSafe('workout', raw);
    await prisma.workout.upsert({ where: { id: w.id }, update: row, create: row });
    for (const s of workoutSets) {
      const { exercise, ...setRow } = s;
      await prisma.workoutSet.upsert({
        where: { id: s.id },
        update: setRow,
        create: { ...setRow, workoutId: w.id },
      });
    }
  }
  console.log(`  workouts    ${workouts.length} (${sets.length} sets)`);

  for (const b of bodyStats) {
    await prisma.bodyStat.upsert({ where: { id: b.id }, update: b, create: b });
  }
  console.log(`  body stats  ${bodyStats.length}`);

  for (const h of healthSamples) {
    await prisma.healthSample.upsert({ where: { id: h.id }, update: h, create: h });
  }
  if (healthSamples.length) console.log(`  health      ${healthSamples.length}`);

  // Holds are the streak's excuse ledger — a restore without them turns
  // every excused week into a broken streak. Absent in pre-fix snapshots.
  for (const h of holds) {
    await prisma.hold.upsert({ where: { id: h.id }, update: h, create: h });
  }
  if (holds.length) console.log(`  holds       ${holds.length}`);

  // Health wave tables (absent in pre-health snapshots). CpapNight and
  // NutritionLog upsert by their UNIQUE natural key (night/day), not id —
  // an id-keyed upsert against a table that already holds that night under
  // a different id crashes the restore mid-run on the unique constraint
  // (data-steward, reproduced).
  const healthTables = [
    ['healthProfile', (r) => ({ id: r.id })],
    ['injection', (r) => ({ id: r.id })],
    ['symptomLog', (r) => ({ id: r.id })],
    ['afEpisode', (r) => ({ id: r.id })],
    ['bpReading', (r) => ({ id: r.id })],
    ['cpapNight', (r) => ({ night: r.night })],
    ['labResult', (r) => ({ id: r.id })],
    ['medication', (r) => ({ id: r.id })],
    ['nutritionLog', (r) => ({ day: r.day })],
  ];
  for (const [table, whereOf] of healthTables) {
    const rowsForTable = (snap.health && snap.health[table]) || [];
    for (const r of rowsForTable) {
      const row = jsonSafe(table, r);
      await prisma[table].upsert({ where: whereOf(r), update: row, create: row });
    }
    if (rowsForTable.length) console.log(`  ${table.padEnd(12)}${rowsForTable.length}`);
  }

  const after = await prisma.workout.count();
  console.log(`\ndone — target now holds ${after} workouts.`);
  await prisma.$disconnect();
}

main().catch((e) => die(e.message));
