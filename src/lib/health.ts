// Pure helpers for the Apple Health bridge: payload parsing, sample→workout
// matching, and the token guard on /api/export.

export type HealthSampleType =
  | 'weight'
  | 'heart_rate'
  | 'active_energy'
  // Daily recovery metrics — one value per calendar day, stored so the phone
  // is no longer the only holder of the recovery history. These are NEVER
  // matched to workouts (enrichWorkouts filters on heart_rate/active_energy
  // only); they live purely as HealthSample rows.
  | 'resting_hr'
  | 'hrv_sdnn'
  | 'sleep_asleep_h'
  | 'vo2max'
  | 'wrist_temp_c'
  | 'respiratory_rate'
  | 'steps'
  // Blood-pressure halves as HealthKit reports them (paired into BpReading
  // rows by the import route via pairBpSamples).
  | 'bp_systolic'
  | 'bp_diastolic';

export interface ParsedSample {
  type: HealthSampleType;
  date: Date;
  value: number;
  unit: string;
  /** Optional per-period extremes (Health Auto Export aggregated metrics). */
  min?: number;
  max?: number;
}

export interface ParseResult {
  samples: ParsedSample[];
  skipped: number;
}

const DEFAULT_UNITS: Record<HealthSampleType, string> = {
  weight: 'kg',
  heart_rate: 'count/min',
  active_energy: 'kcal',
  resting_hr: 'count/min',
  hrv_sdnn: 'ms',
  sleep_asleep_h: 'h',
  vo2max: 'mL/kg·min',
  wrist_temp_c: 'degC',
  respiratory_rate: 'count/min',
  steps: 'count',
  bp_systolic: 'mmHg',
  bp_diastolic: 'mmHg',
};

/** Liberal metric-name matching: maps any recognisable name to a canonical type. */
export function normalizeSampleType(name: string): HealthSampleType | null {
  const n = name.toLowerCase();
  // Specific names FIRST. "resting_heart_rate" contains "heart_rate", and the
  // liberal check below would classify a daily resting-HR aggregate as
  // workout heart rate — which enrichWorkouts would then write onto whatever
  // workout shares the day. Order is load-bearing.
  if (n.includes('resting')) return 'resting_hr';
  if (n.includes('hrv') || n.includes('variability')) return 'hrv_sdnn';
  // Wrist temp BEFORE sleep: "apple_sleeping_wrist_temperature" contains
  // "sleep", and the wrong branch stores a temperature as hours of sleep.
  if (n.includes('wrist_temp') || n.includes('wristtemperature')) return 'wrist_temp_c';
  if (n.includes('sleep')) return 'sleep_asleep_h';
  if (n.includes('vo2')) return 'vo2max';
  if (n.includes('respiratory')) return 'respiratory_rate';
  if (n.includes('step_count') || n === 'steps') return 'steps';
  if (n.includes('systolic')) return 'bp_systolic';
  if (n.includes('diastolic')) return 'bp_diastolic';
  if (n.includes('body_mass') || n.includes('weight')) return 'weight';
  if (n.includes('heart_rate') || n.includes('heartrate')) return 'heart_rate';
  if (n.includes('active_energy') || n.includes('activeenergy')) return 'active_energy';
  return null;
}

/** Parses Health Auto Export style dates ("2026-07-29 07:00:00 +0300"), ISO strings, and bare days. */
export function parseHealthDate(raw: unknown): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let d = new Date(raw);
  if (isNaN(d.getTime())) {
    // "YYYY-MM-DD HH:mm:ss ±HHMM" → "YYYY-MM-DDTHH:mm:ss±HHMM"
    d = new Date(raw.trim().replace(' ', 'T').replace(/\s+(?=[+-]\d)/, ''));
  }
  return isNaN(d.getTime()) ? null : d;
}

/** True when a date carries no time-of-day component (a bare calendar day). */
export function isBareDay(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/** UTC calendar-day key (YYYY-MM-DD) used to bucket samples against workouts and body stats. */
export function dayKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function toNumber(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) ? n : null;
}

interface AutoExportDataPoint {
  date?: unknown;
  qty?: unknown;
  Avg?: unknown;
  Min?: unknown;
  Max?: unknown;
}

interface AutoExportMetric {
  name?: unknown;
  units?: unknown;
  data?: unknown;
}

function parseAutoExportMetrics(metrics: unknown): ParseResult {
  const samples: ParsedSample[] = [];
  let skipped = 0;
  if (!Array.isArray(metrics)) return { samples, skipped };

  for (const metric of metrics as AutoExportMetric[]) {
    const type = typeof metric?.name === 'string' ? normalizeSampleType(metric.name) : null;
    const points = Array.isArray(metric?.data) ? (metric.data as AutoExportDataPoint[]) : [];
    if (!type) {
      skipped += points.length || 1;
      continue;
    }
    const unit = typeof metric.units === 'string' && metric.units ? metric.units : DEFAULT_UNITS[type];
    for (const point of points) {
      const date = parseHealthDate(point?.date);
      const value = toNumber(point?.qty) ?? toNumber(point?.Avg) ?? toNumber(point?.Max) ?? toNumber(point?.Min);
      if (!date || value === null) {
        skipped++;
        continue;
      }
      const min = toNumber(point?.Min);
      const max = toNumber(point?.Max);
      samples.push({
        type,
        date,
        value,
        unit,
        ...(min !== null ? { min } : {}),
        ...(max !== null ? { max } : {}),
      });
    }
  }
  return { samples, skipped };
}

interface SimpleSample {
  type?: unknown;
  value?: unknown;
  unit?: unknown;
  date?: unknown;
  /** Optional window extremes — the push sends the real max heart rate. */
  min?: unknown;
  max?: unknown;
}

function parseSimpleSamples(input: unknown): ParseResult {
  const samples: ParsedSample[] = [];
  let skipped = 0;
  const entries = Array.isArray(input) ? input : [input];

  for (const entry of entries as SimpleSample[]) {
    const type = typeof entry?.type === 'string' ? normalizeSampleType(entry.type) : null;
    const value = toNumber(entry?.value);
    if (!type || value === null) {
      skipped++;
      continue;
    }
    const date = entry.date !== undefined ? parseHealthDate(entry.date) : new Date();
    if (!date) {
      skipped++;
      continue;
    }
    const unit = typeof entry.unit === 'string' && entry.unit ? entry.unit : DEFAULT_UNITS[type];
    // min/max ride along when sent: dropped, the push's one averaged heart-
    // rate sample became the workout's "max" (steward, 2026-09-24).
    const min = toNumber(entry?.min);
    const max = toNumber(entry?.max);
    samples.push({ type, date, value, unit, ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) });
  }
  return { samples, skipped };
}

/**
 * Parses either inbound payload shape into canonical samples:
 * (a) Health Auto Export REST push: { data: { metrics: [...], workouts: [...] } }
 * (b) simple: { type, value, unit?, date? } or an array of them.
 */
export function parseHealthPayload(payload: unknown): ParseResult {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const data = (payload as { data?: unknown }).data;
    if (data && typeof data === 'object' && Array.isArray((data as { metrics?: unknown }).metrics)) {
      return parseAutoExportMetrics((data as { metrics: unknown }).metrics);
    }
    // Tolerate the Auto Export shape without the outer "data" wrapper.
    if (Array.isArray((payload as { metrics?: unknown }).metrics)) {
      return parseAutoExportMetrics((payload as { metrics: unknown }).metrics);
    }
  }
  return parseSimpleSamples(payload);
}

export interface WorkoutWindowInput {
  date: Date;
  /** Workout duration in seconds (app stores seconds). */
  duration: number | null;
  createdAt: Date;
  /** completedAt of every stamped set, any order. */
  setTimes?: Date[] | null;
}

const DEFAULT_DURATION_SECONDS = 60 * 60;

const HOUR_MS = 3_600_000;
/** Setup and warm-up before the first set is ticked done. */
const SET_LEAD_MS = 5 * 60_000;
/** Ticks further apart than this belong to different sittings. */
const SITTING_GAP_MS = 30 * 60_000;
/** No logged session runs longer — the logger clamps its own duration here. */
const MAX_SESSION_MS = 3 * HOUR_MS;

/**
 * The sitting a session's stamped sets describe: ticks split at 30-minute
 * gaps, and the sitting with the most sets wins (ties to the later one). A
 * stray tick in the morning, a set ticked late at Save, or a draft carried
 * into the next day otherwise stretched a 45-minute session across 13 to 25
 * hours in Apple Health (second review, 2026-09-24).
 */
function mainSitting(times: Date[] | null | undefined): { first: number; last: number } | null {
  const t = (times ?? []).map((d) => d.getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  let best: { first: number; last: number; n: number } | null = null;
  let i = 0;
  while (i < t.length) {
    let j = i;
    while (j + 1 < t.length && t[j + 1] - t[j] < SITTING_GAP_MS) j++;
    const n = j - i + 1;
    if (n >= 2 && (!best || n >= best.n)) best = { first: t[i], last: t[j], n };
    i = j + 1;
  }
  return best && best.last > best.first ? { first: best.first, last: best.last } : null;
}

/**
 * A logged session's clock window — or null when it has no honest one.
 *
 *  - A row with a real start instant uses it.
 *  - A bare-day row (almost all of them) is timed by its main sitting of
 *    stamped sets: first set − 5 min to the last set, which is when he
 *    trained however late he tapped Save. That first set must fall inside
 *    the row's ACTIVITY day, [date + 01:00Z, date + 25:00Z) — the 04:00
 *    Riyadh rollover — and the lead-in never crosses the rollover.
 *  - Without stamps (the logger before set times) it ENDED at the Save:
 *    createdAt − duration, which must start inside the activity day.
 * Never longer than 3 h. A session typed in days later, or whose sets
 * contradict its date, has no clock time, and none is invented.
 */
function sessionWindow(w: WorkoutWindowInput): { start: Date; end: Date } | null {
  const durationMs = Math.min((w.duration ?? DEFAULT_DURATION_SECONDS) * 1000, MAX_SESSION_MS);
  if (!isBareDay(w.date)) return { start: w.date, end: new Date(w.date.getTime() + durationMs) };
  const dayStart = w.date.getTime() + HOUR_MS;
  const dayEnd = w.date.getTime() + 25 * HOUR_MS;
  const inDay = (t: number) => t >= dayStart && t < dayEnd;
  const sit = mainSitting(w.setTimes);
  if (sit) {
    if (!inDay(sit.first)) return null;
    const start = Math.max(sit.first - SET_LEAD_MS, sit.last - MAX_SESSION_MS, dayStart);
    return { start: new Date(start), end: new Date(sit.last) };
  }
  const start = w.createdAt.getTime() - durationMs;
  return inDay(start) ? { start: new Date(start), end: w.createdAt } : null;
}

/**
 * Time window a workout's heart-rate / energy samples must fall inside — the
 * SAME window the Apple Health push reads (healthPushWindow), so the two can
 * never disagree. A row with no honest clock time matches nothing: a
 * zero-length window, rather than whatever pulse was recorded while he typed
 * it in.
 */
export function workoutWindow(workout: WorkoutWindowInput): { start: Date; end: Date } {
  return sessionWindow(workout) ?? { start: workout.date, end: workout.date };
}

export type HealthPushInput = WorkoutWindowInput;

/**
 * The real clock window to write a logged session into Apple Health — or
 * null when there is no honest one. Every push used the bare date, which is
 * UTC midnight: 03:00 Riyadh for every session he ever logged (2026-09-24).
 */
export function healthPushWindow(w: HealthPushInput): { start: Date; end: Date } | null {
  return sessionWindow(w);
}

/**
 * A session is written to Apple Health only once it is this old. Finished on
 * the phone while the Watch is still recording, the Watch saves its own copy
 * on the next wrist raise; writing at once duplicated it (second review).
 * Waiting lets that copy land, and the push then finds it and writes nothing.
 */
export const PUSH_DELAY_MS = 12 * HOUR_MS;

export interface HealthPushRow extends HealthPushInput {
  id: string;
  name: string;
  setCount: number;
}

/**
 * Which logged sessions to write to Apple Health, and when. Strength sessions
 * only: a cardio quick-log carries no sets, and it used to go into Health as
 * "Traditional Strength Training" at 03:00 — the only type the bridge writes.
 * A row with no honest clock time is skipped rather than guessed, and a row
 * younger than PUSH_DELAY_MS waits.
 */
export function planHealthPush(rows: HealthPushRow[], now: Date = new Date()): Array<{ id: string; name: string; start: Date; end: Date; durationMin: number }> {
  const out: Array<{ id: string; name: string; start: Date; end: Date; durationMin: number }> = [];
  for (const r of rows) {
    if (r.setCount < 1) continue;
    if (now.getTime() - r.createdAt.getTime() < PUSH_DELAY_MS) continue;
    const win = healthPushWindow(r);
    if (!win) continue;
    out.push({ id: r.id, name: r.name, start: win.start, end: win.end, durationMin: Math.max(1, Math.round((win.end.getTime() - win.start.getTime()) / 60_000)) });
  }
  return out;
}

/** The phone app's bundle id. The Watch app is `${OWN_BUNDLE_ID}.watchkitapp`. */
export const OWN_BUNDLE_ID = 'com.aralhamoud.workout';
export type HealthSourceKind = 'phone' | 'watch' | 'foreign';

/**
 * Who wrote an Apple Health workout — one rule for every screen. The Stats
 * card matched the bundle id EXACTLY and the Home banner by PREFIX, so the
 * Watch app's own workouts were offered as "trained without the app" on one
 * screen and hidden on the other, and a lookalike id would have slipped
 * through the prefix (2026-09-24).
 */
export function healthSourceKind(bundleId?: string | null): HealthSourceKind {
  if (bundleId === OWN_BUNDLE_ID) return 'phone';
  if (bundleId?.startsWith(`${OWN_BUNDLE_ID}.`)) return 'watch';
  return 'foreign';
}

/** A Watch-app session still unlogged after this long is a lost upload, worth showing. */
export const WATCH_UPLOAD_GRACE_H = 6;

/** Share of a push window another Health workout must cover to be the same session. */
export const SAME_SESSION_OVERLAP = 0.5;
/**
 * The Apple Health workout types that ARE a logged machine day — one rule for
 * the session detector (health-detect) and the push's duplicate check. They
 * disagreed: the detector hid HIIT and Core Training as the session he had
 * logged, while the push ignored them and wrote a second copy (third review).
 * Matched case- and separator-insensitively, like the bridge's names.
 */
const STRENGTH_ACTIVITY_KEYS = new Set([
  'traditionalstrengthtraining',
  'functionalstrengthtraining',
  'highintensityintervaltraining',
  'coretraining',
]);
export function isStrengthActivity(type?: string | null): boolean {
  return STRENGTH_ACTIVITY_KEYS.has((type ?? '').toLowerCase().replace(/[^a-z]/g, ''));
}

/**
 * Does Apple Health already hold a workout over this window? Any source
 * counts: Apple's Workout app, the Watch app (it saves its own HKWorkout even
 * when it posted nothing to the server), or an earlier push whose mark
 * failed. The phone's write-through skips such a window instead of writing a
 * second copy on top (review, 2026-09-24). Only a STRENGTH workout counts: a
 * walk left running across the session is not the session, and counting it
 * marked the session synced and kept it out of Health for good (second
 * review). A workout that only brushes the window is a different workout.
 */
export function coveredByExisting(
  win: { start: number; end: number },
  existing: Array<{ startISO: string; endISO: string; activityType?: string }>,
): boolean {
  const len = win.end - win.start;
  if (len <= 0) return false;
  return existing.some((e) => {
    if (!isStrengthActivity(e.activityType)) return false;
    const s0 = Date.parse(e.startISO);
    const e0 = Date.parse(e.endISO);
    if (!Number.isFinite(s0) || !Number.isFinite(e0)) return false;
    return Math.min(win.end, e0) - Math.max(win.start, s0) >= SAME_SESSION_OVERLAP * len;
  });
}

export interface WorkoutHealthAggregates {
  avgHr: number | null;
  maxHr: number | null;
  activeKcal: number | null;
}

/**
 * Aggregates HR / active-energy samples inside a workout's time window:
 * average + max heart rate, summed active kilocalories.
 */
export function matchSamplesToWorkout(
  samples: ParsedSample[],
  workout: WorkoutWindowInput,
): WorkoutHealthAggregates {
  const { start, end } = workoutWindow(workout);
  const inWindow = samples.filter((s) => s.date >= start && s.date <= end);

  const hr = inWindow.filter((s) => s.type === 'heart_rate');
  const energy = inWindow.filter((s) => s.type === 'active_energy');

  const avgHr = hr.length ? Math.round(hr.reduce((sum, s) => sum + s.value, 0) / hr.length) : null;
  const maxHr = hr.length ? Math.round(hr.reduce((m, s) => Math.max(m, s.max ?? s.value), 0)) : null;
  const activeKcal = energy.length ? Math.round(energy.reduce((sum, s) => sum + s.value, 0)) : null;

  return { avgHr, maxHr, activeKcal };
}

export type HealthAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; message: string };

/**
 * Token guard for /api/export — now the only guarded route.
 *
 * Everything the app itself does goes through server actions, which are
 * same-origin and need no token. Export is different: it is a plain GET that
 * returns the entire history, it is reached by URL rather than by the app, and
 * an unguarded one would be a public copy of every workout he has logged. The
 * token costs nothing here because nothing has to paste it into the app.
 */
export function checkExportAuth(request: Request): HealthAuthResult {
  const token = process.env.HEALTH_SYNC_TOKEN;
  if (!token) {
    return { ok: false, status: 500, message: 'HEALTH_SYNC_TOKEN is not configured on the server' };
  }
  const header = request.headers.get('authorization');
  if (header === `Bearer ${token}`) return { ok: true };
  const queryToken = new URL(request.url).searchParams.get('token');
  if (queryToken === token) return { ok: true };
  return { ok: false, status: 401, message: 'Invalid or missing sync token' };
}

// ── Blood pressure pairing ────────────────────────────────────────────────
// HealthKit stores a monitor reading as two quantity samples (systolic +
// diastolic) that share the correlation's timestamp. The bridge reads them
// as two series; this reunites them.

export interface BpPair {
  at: Date;
  systolic: number;
  diastolic: number;
}

/**
 * Pairs systolic and diastolic series into readings. Each sample is used at
 * most once; a half with no partner within `toleranceMs` is dropped (half a
 * reading is not a reading). Pairs failing the same plausibility bounds the
 * manual logger enforces — systolic 60–260, diastolic 30–160, systolic above
 * diastolic — are dropped too, so a device glitch can't become history.
 */
export function pairBpSamples(
  systolic: Array<{ dateISO: string; value: number }>,
  diastolic: Array<{ dateISO: string; value: number }>,
  toleranceMs = 60_000,
): BpPair[] {
  const sys = systolic
    .map((s) => ({ t: new Date(s.dateISO).getTime(), v: s.value }))
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);
  const dia = diastolic
    .map((s) => ({ t: new Date(s.dateISO).getTime(), v: s.value, used: false }))
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.v))
    .sort((a, b) => a.t - b.t);

  const pairs: BpPair[] = [];
  let start = 0;
  for (const s of sys) {
    // Advance past diastolic samples too old to ever match again.
    while (start < dia.length && (dia[start].used || dia[start].t < s.t - toleranceMs)) start++;
    let best = -1;
    let bestGap = Infinity;
    for (let i = start; i < dia.length && dia[i].t <= s.t + toleranceMs; i++) {
      if (dia[i].used) continue;
      const gap = Math.abs(dia[i].t - s.t);
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best === -1) continue;
    const systolicV = Math.round(s.v);
    const diastolicV = Math.round(dia[best].v);
    dia[best].used = true;
    if (systolicV < 60 || systolicV > 260 || diastolicV < 30 || diastolicV > 160) continue;
    if (systolicV <= diastolicV) continue;
    pairs.push({ at: new Date(s.t), systolic: systolicV, diastolic: diastolicV });
  }
  return pairs;
}
