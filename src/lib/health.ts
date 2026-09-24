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
    samples.push({ type, date, value, unit });
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
}

const DEFAULT_DURATION_SECONDS = 60 * 60;

/**
 * Time window a workout's samples must fall inside. When the workout date is a
 * bare day (no time-of-day), falls back to createdAt..createdAt+duration.
 */
export function workoutWindow(workout: WorkoutWindowInput): { start: Date; end: Date } {
  const durationMs = (workout.duration ?? DEFAULT_DURATION_SECONDS) * 1000;
  // A bare-day row is saved when he taps Save at the END of the session, so it
  // began at createdAt − duration. This used to START the window at createdAt,
  // which read heart rate and energy for the 50 minutes after he had already
  // left (2026-09-24).
  if (isBareDay(workout.date)) {
    const end = workout.createdAt;
    return { start: new Date(end.getTime() - durationMs), end };
  }
  return { start: workout.date, end: new Date(workout.date.getTime() + durationMs) };
}

const HOUR_MS = 3_600_000;
/** A save this long after the last set is a replay, not the end of the session. */
const REPLAY_GAP_MS = 10 * 60_000;

export interface HealthPushInput {
  date: Date;
  duration: number | null;
  createdAt: Date;
  /** Latest completedAt among the workout's sets, when any set carries one. */
  lastSetAt?: Date | null;
}

/**
 * The real clock window to write a logged session into Apple Health — or
 * null when there is no honest one. Every push used the bare date, which is
 * UTC midnight: 03:00 Riyadh for every session he ever logged (2026-09-24).
 *
 * A bare-day row ends at its save (createdAt), unless it was saved long after
 * its last set (an outbox replay) — then the last set ends it. The start must
 * fall inside the row's ACTIVITY day, [date + 01:00Z, date + 25:00Z) — the
 * 04:00 Riyadh rollover; an entry typed in days later has no real clock time,
 * and one is never invented.
 */
export function healthPushWindow(w: HealthPushInput): { start: Date; end: Date } | null {
  const durationMs = (w.duration ?? DEFAULT_DURATION_SECONDS) * 1000;
  if (!isBareDay(w.date)) return { start: w.date, end: new Date(w.date.getTime() + durationMs) };
  const end = w.lastSetAt && w.createdAt.getTime() - w.lastSetAt.getTime() > REPLAY_GAP_MS ? w.lastSetAt : w.createdAt;
  const start = new Date(end.getTime() - durationMs);
  const day = w.date.getTime();
  if (start.getTime() < day + HOUR_MS || start.getTime() >= day + 25 * HOUR_MS) return null;
  return { start, end };
}

export interface HealthPushRow extends HealthPushInput {
  id: string;
  name: string;
  setCount: number;
}

/**
 * Which logged sessions to write to Apple Health, and when. Strength sessions
 * only: a cardio quick-log carries no sets, and it used to go into Health as
 * "Traditional Strength Training" at 03:00 — the only type the bridge writes.
 * A row with no honest clock time is skipped rather than guessed.
 */
export function planHealthPush(rows: HealthPushRow[]): Array<{ id: string; name: string; start: Date; end: Date; durationMin: number }> {
  const out: Array<{ id: string; name: string; start: Date; end: Date; durationMin: number }> = [];
  for (const r of rows) {
    if (r.setCount < 1) continue;
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
