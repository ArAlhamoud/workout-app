import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkHealthAuth, dayKey, isBareDay, workoutWindow } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Which HealthKit workouts the app is willing to offer as "you trained this
// and never logged it". Deliberately narrow. The Watch writes a workout for
// every 9-minute walk, and offering those would (a) bury the one real session
// in noise and (b) corrupt the dynamic plan, which reads ANY logged workout as
// "he trained" — a walk imported as a session would tell him to recover
// tomorrow. Strength sessions are the training log; swimming is here because
// it is the Day B cardio finisher he actually does.
//
// The strings mirror the native bridge's activityName() vocabulary exactly
// (see HealthKitBridgePlugin.swift); matching is case- and separator-insensitive
// so a bridge that ever switches to "Traditional Strength Training" still lands.
const STRENGTH_TYPES = new Set([
  'traditionalstrengthtraining',
  'functionalstrengthtraining',
  'highintensityintervaltraining',
  'coretraining',
]);
const CARDIO_TYPES = new Set(['swimming']);

/** Anything shorter than this is incidental movement, not a session. */
const MIN_DURATION_SEC = 10 * 60;
/** Payload ceiling — a 14-day window can't honestly contain more than this. */
const MAX_CANDIDATES = 100;

const DAY_MS = 86_400_000;
/**
 * How far either side of the candidate window to pull existing workouts. Wide
 * because a workout logged with a bare date sits at UTC midnight, which can
 * land a calendar day away from the session it describes.
 */
const LOOKUP_PAD_MS = 3 * DAY_MS;

type DetectKind = 'strength' | 'cardio';

interface Candidate {
  uuid: string;
  start: Date;
  end: Date;
  durationSec: number;
  kind: DetectKind;
  /**
   * Device-local calendar day (YYYY-MM-DD) of the session start, sent by the
   * client. The server has no idea what timezone the phone is in, and deriving
   * the day from the UTC instant would misfile an evening session as tomorrow.
   */
  localDay: string | null;
}

function str(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function classify(activityType: string | null): DetectKind | null {
  const key = activityType?.toLowerCase().replace(/[\s_-]/g, '') ?? '';
  if (STRENGTH_TYPES.has(key)) return 'strength';
  if (CARDIO_TYPES.has(key)) return 'cardio';
  return null;
}

/**
 * Validates the client's HealthKit workout list into candidates. Anything
 * unparseable, too short, or of an activity type we don't offer is dropped
 * silently — this endpoint answers "which of these are new", and a malformed
 * entry is simply not one of them.
 */
function parseCandidates(payload: unknown): Candidate[] {
  const raw = (payload as { candidates?: unknown })?.candidates;
  if (!Array.isArray(raw)) return [];

  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const entry of raw.slice(0, MAX_CANDIDATES) as Record<string, unknown>[]) {
    const uuid = str(entry?.uuid);
    const startISO = str(entry?.startISO);
    if (!uuid || !startISO || seen.has(uuid)) continue;

    const start = new Date(startISO);
    if (Number.isNaN(start.getTime())) continue;

    const kind = classify(str(entry?.activityType));
    if (!kind) continue;

    const rawDuration = typeof entry?.durationSec === 'number' ? entry.durationSec : NaN;
    const endISO = str(entry?.endISO);
    const end = endISO ? new Date(endISO) : new Date(NaN);
    const durationSec = Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.round(rawDuration)
      : !Number.isNaN(end.getTime()) && end > start
        ? Math.round((end.getTime() - start.getTime()) / 1000)
        : 0;
    if (durationSec < MIN_DURATION_SEC) continue;

    seen.add(uuid);
    out.push({
      uuid,
      start,
      end: !Number.isNaN(end.getTime()) && end > start ? end : new Date(start.getTime() + durationSec * 1000),
      durationSec,
      kind,
      localDay: str(entry?.localDay),
    });
  }
  return out;
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) =>
  a.start < b.end && b.start < a.end;

const minutes = (sec: number) => Math.max(1, Math.round(sec / 60));

/**
 * Which of the client's HealthKit workouts are genuinely NOT in the app yet.
 *
 * The client cannot answer this — it has no database — and it must not guess,
 * because the cost of guessing wrong is offering a session he already logged.
 * A candidate counts as already known when:
 *
 *   1. its UUID is stored on a workout (it was imported before); or
 *   2. its time window overlaps a workout that carries a real clock time; or
 *   3. — STRENGTH ONLY — a workout logged with a BARE date exists on the same
 *      calendar day. Hand-logged sessions store a bare day with no time of
 *      day, so rule 2 can never match them, and the session he just logged off
 *      this very list would be offered straight back to him.
 *
 * Rule 3 deliberately does NOT apply to swims. The swim IS the Day B finisher:
 * it happens on the same day as the strength session by design, so a day-level
 * match would suppress every single one. And the same reason rules out judging
 * a swim against a bare-day workout's createdAt window — that window is
 * fabricated from when the form was saved, not when the training happened.
 *
 * Rule 3 costs the ability to detect a genuine SECOND strength session on a day
 * that already has one. For a 3-sessions-per-week trainee that trade is the
 * right way round: a duplicate offer nags on every visit, a missed second
 * session is one manual log.
 */
export async function POST(request: Request) {
  const auth = checkHealthAuth(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const candidates = parseCandidates(payload);
  if (!candidates.length) return NextResponse.json({ candidates: [] });

  const earliest = Math.min(...candidates.map((c) => c.start.getTime()));
  const latest = Math.max(...candidates.map((c) => c.end.getTime()));

  const known = await prisma.workout.findMany({
    where: {
      OR: [
        { date: { gte: new Date(earliest - LOOKUP_PAD_MS), lte: new Date(latest + LOOKUP_PAD_MS) } },
        { healthWorkoutUuid: { in: candidates.map((c) => c.uuid) } },
      ],
    },
    select: { date: true, duration: true, createdAt: true, healthWorkoutUuid: true },
  });

  const importedUuids = new Set(
    known.map((w) => w.healthWorkoutUuid).filter((u): u is string => u !== null),
  );
  const loggedBareDays = new Set(known.filter((w) => isBareDay(w.date)).map((w) => dayKey(w.date)));
  // Only workouts whose date carries a real time of day get a usable window.
  const windows = known.filter((w) => !isBareDay(w.date)).map((w) => workoutWindow(w));

  const fresh = candidates
    .filter((c) => !importedUuids.has(c.uuid))
    .filter((c) => !(c.kind === 'strength' && c.localDay && loggedBareDays.has(c.localDay)))
    .filter((c) => !windows.some((w) => overlaps(c, w)))
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .map((c) => ({
      uuid: c.uuid,
      startISO: c.start.toISOString(),
      durationMin: minutes(c.durationSec),
      durationSec: c.durationSec,
      kind: c.kind,
      /** Glance label for the row — one word. */
      label: c.kind === 'cardio' ? 'Swim' : 'Strength',
      /**
       * Ready-made Workout.name for a one-tap cardio import. Strength
       * candidates open the normal logger, which names itself from the day
       * template, so this is only ever used for the cardio path.
       */
      name: `Swim ${minutes(c.durationSec)}m`,
    }));

  return NextResponse.json({ candidates: fresh });
}
