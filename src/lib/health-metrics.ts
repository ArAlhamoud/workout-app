// Health-derived numbers for the glance layer: daily steps and a readiness read.
//
// Client-safe: every export is importable from anywhere (server components
// included) because nothing runs at module scope — the bridge is only touched
// inside the async functions, and each of those short-circuits to `null` when
// isNativeApp() is false. On the plain web / PWA the whole module is inert and
// the callers render nothing.
//
// Failures are swallowed on purpose. This is ambient decoration on top of the
// coach's real instruction, so a HealthKit timeout must degrade to "no number"
// rather than an error chip — silence is the honest fallback. The sync UI
// (NativeHealthCard) is where failures are allowed to be loud.

// Relative, not '@/': this module is imported by scripts/coach-tests.ts,
// which runs under plain ts-node with no path-alias resolution.
import type { ReadinessSignal } from './coach';
import { isNativeApp, queryCategory, queryDailyStats } from './native-health';

const HOUR_MS = 3_600_000;

/** Daily step target — a walking floor for fat loss, not an athletic goal. */
export const STEP_TARGET = 8000;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Mean of a list, or null when it's empty. */
function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Median of a list, or null when it's empty. Even counts average the middle pair. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Steps ────────────────────────────────────────────────────

export interface StepDay {
  /** Start of the day bucket, as reported by HealthKit. */
  dateISO: string;
  /**
   * null means HealthKit held no samples that day — the phone was in a drawer,
   * or the day predates the watch. That is NOT a zero-step day, and averaging
   * it as zero would quietly invent a slump that never happened.
   */
  steps: number | null;
}

export interface StepsSummary {
  /** Oldest first, ending today. Nulls preserved. */
  days: StepDay[];
  /** Today's steps so far, or null when nothing has been recorded yet today. */
  today: number | null;
  /**
   * Mean over the previous 7 days that actually have samples — today is
   * excluded because a partial day always drags the baseline down, and days
   * with no samples are skipped rather than counted as zero.
   */
  avgPrev7: number | null;
  /** False when the whole window came back empty — nothing worth showing. */
  hasAnyData: boolean;
}

/**
 * Daily step buckets for the trailing `days` days (oldest first, ending today).
 * Returns null off-native or when the bridge fails.
 */
export async function dailySteps(days = 14): Promise<StepsSummary | null> {
  if (!isNativeApp()) return null;
  try {
    const { days: buckets } = await queryDailyStats('stepCount', days);
    if (!buckets.length) return null;

    const stepDays: StepDay[] = buckets.map((b) => ({
      dateISO: b.dateISO,
      steps: b.value === null ? null : Math.round(b.value),
    }));

    // The bridge documents this list as ending today, so the last bucket is
    // today's. Deriving it from the clock instead would need the device's
    // timezone to line up with the ISO strings — this doesn't.
    const today = stepDays[stepDays.length - 1].steps;
    const previous = stepDays.slice(0, -1).slice(-7);
    const avg = mean(previous.filter((d): d is StepDay & { steps: number } => d.steps !== null).map((d) => d.steps));

    return {
      days: stepDays,
      today,
      avgPrev7: avg === null ? null : Math.round(avg),
      hasAnyData: stepDays.some((d) => d.steps !== null),
    };
  } catch {
    return null;
  }
}

// ── Resting heart rate ───────────────────────────────────────

export interface RestingHeartRateTrend {
  /** Today's resting HR in bpm, or null when the watch hasn't reported yet. */
  today: number | null;
  /** Median over the trailing window EXCLUDING today — the personal baseline. */
  median: number | null;
  /** today − median, positive = elevated. null unless both sides exist. */
  deltaBpm: number | null;
}

/**
 * Resting HR against its own trailing median. Median, not mean: one illness
 * spike or one bad sensor night shouldn't move the baseline it's measured
 * against. Today is excluded from the baseline so it can't chase itself.
 */
export async function restingHeartRateTrend(days = 28): Promise<RestingHeartRateTrend | null> {
  if (!isNativeApp()) return null;
  try {
    const { days: buckets } = await queryDailyStats('restingHeartRate', days);
    if (!buckets.length) return null;

    const today = buckets[buckets.length - 1].value;
    const baseline = median(
      buckets
        .slice(0, -1)
        .map((b) => b.value)
        .filter((v): v is number => v !== null),
    );

    return {
      today: today === null ? null : round1(today),
      median: baseline === null ? null : round1(baseline),
      deltaBpm: today === null || baseline === null ? null : round1(today - baseline),
    };
  } catch {
    return null;
  }
}

// ── Sleep ────────────────────────────────────────────────────

/**
 * HKCategoryValueSleepAnalysis values that mean actually asleep.
 * 0 = inBed is deliberately excluded: lying in bed reading for two hours is
 * not recovery, and counting it would inflate every night on an iPhone-only
 * setup where inBed is the only value ever written.
 */
const ASLEEP_VALUES = new Set([
  1, // asleepUnspecified
  3, // asleepCore
  4, // asleepDeep
  5, // asleepREM
]);

/** How far back to look for "last night" — long enough to catch a late lie-in. */
const SLEEP_WINDOW_HOURS = 36;

/**
 * Two asleep samples separated by less than this are the same night; a bigger
 * gap starts a new block, which is what separates last night from yesterday's
 * afternoon nap.
 */
const SLEEP_BLOCK_GAP_MS = 60 * 60_000;

/**
 * Hours actually asleep last night, or null when nothing was recorded.
 *
 * Two things this guards against. First, double counting: the Watch and a
 * third-party sleep app both write overlapping asleep samples for the same
 * night, and naively summing durations can hand back eleven hours of sleep for
 * a seven-hour night. Overlapping intervals are unioned first. Second, naps:
 * the samples are grouped into blocks and only the most recent block counts, so
 * yesterday's couch nap doesn't get added to last night's total.
 */
export async function lastNightSleepHours(): Promise<number | null> {
  if (!isNativeApp()) return null;
  try {
    const startISO = new Date(Date.now() - SLEEP_WINDOW_HOURS * HOUR_MS).toISOString();
    const samples = await queryCategory('sleepAnalysis', { startISO });

    const intervals = samples
      .filter((s) => ASLEEP_VALUES.has(s.value))
      .map((s) => ({ start: new Date(s.startISO).getTime(), end: new Date(s.endISO).getTime() }))
      .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
      .sort((a, b) => a.start - b.start);

    if (!intervals.length) return null;

    // Union overlapping intervals (across every source), then keep only the
    // trailing block — consecutive stretches less than an hour apart.
    const merged: { start: number; end: number }[] = [];
    for (const next of intervals) {
      const last = merged[merged.length - 1];
      if (last && next.start <= last.end) last.end = Math.max(last.end, next.end);
      else merged.push({ ...next });
    }

    let asleepMs = 0;
    for (let i = merged.length - 1; i >= 0; i--) {
      if (i < merged.length - 1 && merged[i + 1].start - merged[i].end > SLEEP_BLOCK_GAP_MS) break;
      asleepMs += merged[i].end - merged[i].start;
    }

    const hours = round1(asleepMs / HOUR_MS);
    return hours > 0 ? hours : null;
  } catch {
    return null;
  }
}

// ── HRV ──────────────────────────────────────────────────────

export interface HrvTrend {
  /** Today's SDNN in ms, or null when the Watch hasn't reported. */
  today: number | null;
  /** Median over the trailing window excluding today. */
  median: number | null;
  /** today / median. Below ~0.75 reads as autonomic stress. */
  ratio: number | null;
}

/** Fewer baseline days than this and the ratio is noise, not signal. */
const HRV_MIN_BASELINE_DAYS = 10;

/**
 * SDNN against its own trailing median. Watch SDNN is sparse (mostly sleep
 * and Breathe sessions), so this returns nulls freely — the readiness rule
 * treats null as "no opinion", never as a bad sign.
 */
export async function hrvTrend(days = 28): Promise<HrvTrend | null> {
  if (!isNativeApp()) return null;
  try {
    const { days: buckets } = await queryDailyStats('heartRateVariabilitySDNN', days);
    if (!buckets.length) return null;
    const today = buckets[buckets.length - 1].value;
    const base = buckets
      .slice(0, -1)
      .map((b) => b.value)
      .filter((v): v is number => v !== null);
    if (base.length < HRV_MIN_BASELINE_DAYS) {
      return { today: today === null ? null : round1(today), median: null, ratio: null };
    }
    const med = median(base);
    return {
      today: today === null ? null : round1(today),
      median: med === null ? null : round1(med),
      ratio: today === null || med === null || med === 0 ? null : round1(today / med),
    };
  } catch {
    return null;
  }
}

// ── Sick signal ──────────────────────────────────────────────
// His 17-day gap was illness, and it died the way breaks die: open-ended,
// no re-entry date. This converts "sick" into a state with an exit — the
// gap ladder pauses while it holds, and a comeback fires when it clears.

export type SickState = 'sick' | 'clear' | 'unknown';

/** Elevated this far above the trailing median reads as illness... */
const SICK_RHR_BPM = 5;
/** ...and back within this of the median reads as recovered. */
const CLEAR_RHR_BPM = 2;

/**
 * Classify the last two daily resting-HR buckets against the median of the
 * days before them. Pure — feed it queryDailyStats output. Two consecutive
 * elevated days are required: one high reading is a bad night's sensor data,
 * two is a pattern.
 *
 * 'unknown' whenever the data cannot say either way (missing days, short
 * baseline). Callers must treat 'unknown' as "no change", never as a verdict.
 */
export function assessSickSignal(buckets: Array<number | null>): SickState {
  if (buckets.length < 9) return 'unknown';
  const recent = buckets.slice(-2);
  const base = buckets.slice(0, -2).filter((v): v is number => v !== null);
  if (base.length < 7 || recent.some((v) => v === null)) return 'unknown';
  const med = median(base);
  if (med === null) return 'unknown';
  if (recent.every((v) => (v as number) > med + SICK_RHR_BPM)) return 'sick';
  if (recent.every((v) => (v as number) <= med + CLEAR_RHR_BPM)) return 'clear';
  return 'unknown';
}

/** Fetch daily resting HR and classify. Null off-native or on query failure. */
export async function readSickSignal(days = 28): Promise<SickState | null> {
  if (!isNativeApp()) return null;
  try {
    const { days: buckets } = await queryDailyStats('restingHeartRate', days);
    return assessSickSignal(buckets.map((b) => b.value));
  } catch {
    return null;
  }
}

// ── Readiness ────────────────────────────────────────────────

export interface ReadinessInputs {
  /** Today's resting HR minus its trailing median, bpm. Positive = elevated. */
  rhrDeltaBpm: number | null;
  /** Hours actually asleep last night. */
  sleepHours: number | null;
  /** Hours since the last logged training session. */
  hoursSinceLastSession: number | null;
  /** Today's HRV SDNN over its trailing median. Optional; null = no opinion. */
  hrvRatio?: number | null;
}

/** Resting HR this far above baseline is a stress signal, not noise. */
const RHR_ALARM_BPM = 5;
/** Below this, the nervous system didn't get its repair window. */
const SLEEP_FLOOR_H = 5.5;
/** Below this, it's the same training stimulus twice — recover instead. */
const RECOVERY_FLOOR_H = 24;
/** Resting HR at or under baseline AND this much sleep earns a green light. */
const SLEEP_GREEN_H = 7;
/** SDNN this far below its median is autonomic stress, not day-to-day noise. */
const HRV_HOLD_RATIO = 0.75;

const rhrNote = (delta: number) => {
  const bpm = Math.round(delta);
  if (bpm === 0) return 'resting HR steady';
  return `resting HR ${bpm > 0 ? '+' : ''}${bpm} bpm`;
};
const sleepNote = (hours: number) => `${hours.toFixed(1)} h sleep`;
const recoveryNote = (hours: number) => `trained ${Math.round(hours)} h ago`;

/**
 * Turns whatever health data exists into one verdict, or nothing at all.
 *
 * Pure and deliberately conservative. With NO inputs it returns null — the
 * caller then behaves exactly as it does today, because a guess dressed up as
 * a signal is worse than staying quiet. A 'hold' needs only one red flag; a
 * 'push' needs both green ones present and passing.
 */
export function computeReadiness({
  rhrDeltaBpm,
  sleepHours,
  hoursSinceLastSession,
  hrvRatio = null,
}: ReadinessInputs): ReadinessSignal | null {
  if (rhrDeltaBpm === null && sleepHours === null && hoursSinceLastSession === null && hrvRatio === null) {
    return null;
  }

  // Note stays two facts at most — this renders as a single glanceable line.
  const note = (parts: string[]) => parts.slice(0, 2).join(' · ');

  const holds: string[] = [];
  if (rhrDeltaBpm !== null && rhrDeltaBpm > RHR_ALARM_BPM) holds.push(rhrNote(rhrDeltaBpm));
  if (sleepHours !== null && sleepHours < SLEEP_FLOOR_H) holds.push(sleepNote(sleepHours));
  if (hoursSinceLastSession !== null && hoursSinceLastSession < RECOVERY_FLOOR_H) {
    holds.push(recoveryNote(hoursSinceLastSession));
  }
  if (hrvRatio !== null && hrvRatio < HRV_HOLD_RATIO) {
    holds.push(`HRV ${Math.round(hrvRatio * 100)}% of baseline`);
  }
  if (holds.length) return { verdict: 'hold', note: note(holds) };

  if (rhrDeltaBpm !== null && sleepHours !== null && rhrDeltaBpm <= 0 && sleepHours >= SLEEP_GREEN_H) {
    return { verdict: 'push', note: note([rhrNote(rhrDeltaBpm), sleepNote(sleepHours)]) };
  }

  const facts: string[] = [];
  if (sleepHours !== null) facts.push(sleepNote(sleepHours));
  if (rhrDeltaBpm !== null) facts.push(rhrNote(rhrDeltaBpm));
  return { verdict: 'proceed', note: note(facts) };
}

/** Whole-ish hours since an ISO timestamp; null for missing or unparseable input. */
export function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return round1((Date.now() - then) / HOUR_MS);
}

/**
 * Reads the bridge and returns today's readiness, or null when there's nothing
 * to say (off-native, no data, or every query failed).
 *
 * `lastSessionISO` should come from the app's own workout log — HealthKit's
 * workout list includes walks and other apps' sessions, which are not the
 * training stimulus this rule is about. Omitting it simply drops the recovery
 * clause; the resting-HR and sleep clauses still stand on their own.
 */
export async function readReadiness(
  options: { lastSessionISO?: string | null } = {},
): Promise<ReadinessSignal | null> {
  if (!isNativeApp()) return null;
  const [rhr, sleepHours, hrv] = await Promise.all([
    restingHeartRateTrend(),
    lastNightSleepHours(),
    hrvTrend(),
  ]);
  return computeReadiness({
    rhrDeltaBpm: rhr?.deltaBpm ?? null,
    sleepHours,
    hoursSinceLastSession: hoursSince(options.lastSessionISO),
    hrvRatio: hrv?.ratio ?? null,
  });
}
