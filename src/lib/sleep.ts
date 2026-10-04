// Sleep — every night Apple Health holds, grouped ONCE on the phone and
// stored per wake day (owner, 2026-10-05: "track all", "why 14 days only i
// want from [when] i began tracking sleep").
//
// Pure, client-safe (no prisma, no bridge): the night rule, the sync window
// arithmetic, the rows one night becomes, and every reader the screens use.
// HealthAutoPilot feeds it raw HealthKit samples; health-import writes what
// it returns; /health/sleep, Patterns and the doctor report read it back.
//
// Clocks (CLAUDE.md rule 12): the grouping runs on HIS phone in HIS local
// time (Riyadh), so a night is keyed by the calendar day he woke. The server
// stores that key at UTC midnight like every other day row, and its readers
// compare keys against ownerDayKey — never a server setHours.
//
// Tracker, not diagnosis (docs/HEALTH.md): hours, stages and wrist oxygen
// are what the wearable wrote. Nothing here grades a night, sets a sleep
// target, or reads apnea from the wrist.

// Relative imports: scripts/coach-tests.ts runs under plain ts-node.
import { MIN_TREND_POINTS, type ChartSpec } from './report-charts';
import { shortDay } from './health-format';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * HKCategoryValueSleepAnalysis values that mean actually asleep. 0 = inBed
 * is left out: lying in bed reading is not sleep, and an iPhone-only setup
 * writes nothing else. 2 = awake is counted only as awake-in-bed.
 */
export const ASLEEP_VALUES = new Set([
  1, // asleepUnspecified
  3, // asleepCore
  4, // asleepDeep
  5, // asleepREM
]);
const AWAKE = 2;
const CORE = 3;
const DEEP = 4;
const REM = 5;

/**
 * The night a block of sleep belongs to runs from 18:00 the evening before
 * to 14:00 on the morning he wakes. Everything that STARTS inside that
 * window is one night, however many times he woke: his first Fitbit night
 * was 02:00–06:55 then 09:49–13:30, and counting only the last block
 * reported 3.7 h of an 8 h night (owner, 2026-10-03; Apple Health scores it
 * the same way). A block starting at 14:00 or later is a nap and never
 * joins a night; a doze from 18:00 belongs to the night ending tomorrow.
 */
export const NIGHT_FROM_HOUR = 18;
export const NAP_FROM_HOUR = 14;

/** The first run reads backwards in chunks this long… */
export const SLEEP_CHUNK_DAYS = 60;
/** …until a chunk comes back empty, and never further back than 5 years. */
export const SLEEP_BACKFILL_MAX_DAYS = 1826;
/** Later runs re-read from the newest stored night minus this many days:
 *  a wearable that syncs late corrects the nights it lands in. */
export const SLEEP_RESYNC_DAYS = 3;
/** Nights per import call. Each night is at most 8 upserts, so one server
 *  action writes at most 160 rows — a first run over years of nights is
 *  many short calls, never one that can time out. */
export const SLEEP_IMPORT_MAX_NIGHTS = 20;
export const SLEEP_SOURCE = 'apple-health';

/** The HealthSample types one night writes. `sleep_asleep_h` predates this
 *  module (Stats' sleep debt reads it) and keeps its name and unit. */
export const SLEEP_TYPES = {
  asleep: 'sleep_asleep_h',
  deep: 'sleep_deep_min',
  rem: 'sleep_rem_min',
  core: 'sleep_core_min',
  awake: 'sleep_awake_min',
  spo2Low: 'sleep_spo2_low',
  spo2Avg: 'sleep_spo2_avg',
  resp: 'sleep_resp_rate',
} as const;
export const SLEEP_ROW_TYPES: string[] = Object.values(SLEEP_TYPES);

export interface Interval { start: number; end: number }
export interface SleepSampleIn { start: number; end: number; value: number; source: string }
/** A point reading (oxygen saturation, respiratory rate). */
export interface SpotIn { t: number; value: number }

export interface SleepNight {
  /** The calendar day he woke, in the phone's local time. */
  wakeDay: string;
  /** Union of every asleep value across sources, in minutes. */
  asleepMin: number;
  /** From the one source that staged the night; null when none did. */
  deepMin: number | null;
  remMin: number | null;
  coreMin: number | null;
  awakeMin: number | null;
  /** First asleep instant and final wake. */
  bedISO: string;
  wakeISO: string;
  sources: string[];
  /** Wrist oxygen inside the asleep blocks, in percent; null without samples. */
  spo2Low: number | null;
  spo2Avg: number | null;
  /** Breaths per minute inside the asleep blocks. */
  respRate: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10 + 0;
const round2 = (n: number) => Math.round(n * 100) / 100 + 0;
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── The night rule ───────────────────────────────────────────

/** Overlapping intervals unioned, oldest first. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last && next.start <= last.end) last.end = Math.max(last.end, next.end);
    else merged.push(next);
  }
  return merged;
}

/** Wall-clock parts of an instant: in the given UTC offset (minutes), or in
 *  the device's own zone when none is given — the phone's case. */
function localParts(t: number, offsetMin?: number) {
  const off = offsetMin ?? -new Date(t).getTimezoneOffset();
  const d = new Date(t + off * MIN_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}
const keyOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** The local calendar day of an instant. */
export function localDayKey(t: number, offsetMin?: number): string {
  const p = localParts(t, offsetMin);
  return keyOf(p.y, p.m, p.d);
}

/** The wake day of the night a block starting at `t` belongs to, or null
 *  for a nap (a start from 14:00 to 18:00). */
export function nightOf(t: number, offsetMin?: number): string | null {
  const p = localParts(t, offsetMin);
  if (p.h >= NIGHT_FROM_HOUR) return keyOf(p.y, p.m, p.d + 1);
  if (p.h < NAP_FROM_HOUR) return keyOf(p.y, p.m, p.d);
  return null;
}

/** The instant a night's window opens: 18:00 local the evening before. */
export function nightWindowStart(wakeDay: string, offsetMin?: number): number {
  const [y, m, d] = wakeDay.split('-').map(Number);
  if (offsetMin === undefined) return new Date(y, m - 1, d - 1, NIGHT_FROM_HOUR).getTime();
  return Date.UTC(y, m - 1, d - 1, NIGHT_FROM_HOUR) - offsetMin * MIN_MS;
}

/** Where a later run starts reading: the window of the newest stored night
 *  minus SLEEP_RESYNC_DAYS, so those nights are re-read whole. */
export function incrementalSleepStart(newestWakeDay: string, offsetMin?: number): number {
  const back = new Date(Date.parse(`${newestWakeDay}T00:00:00Z`) - SLEEP_RESYNC_DAYS * DAY_MS).toISOString().slice(0, 10);
  return nightWindowStart(back, offsetMin);
}

/**
 * The nights a run may write: only those whose whole window lies inside
 * what was read (a night cut by the window's edge would overwrite a stored
 * night with half of it), and none that ends after today.
 */
export function nightsToWrite(nights: SleepNight[], fromMs: number, now: number, offsetMin?: number): SleepNight[] {
  const today = localDayKey(now, offsetMin);
  return nights.filter((n) => nightWindowStart(n.wakeDay, offsetMin) >= fromMs && n.wakeDay <= today);
}

/** Index of the block holding `t` (start ≤ t ≤ end), or -1. Blocks sorted. */
function blockAt(blocks: Interval[], t: number, endInclusive: boolean): number {
  let lo = 0;
  let hi = blocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  const b = blocks[found];
  return t < b.end || (endInclusive && t === b.end) ? found : -1;
}

/**
 * Every night in the samples, keyed by wake day, oldest first. Asleep time
 * is the UNION of asleep values across sources — a Watch and a Fitbit on
 * the same night never add up to fourteen hours. Stages come from the one
 * source that staged the most of the night (two stagers would double
 * count); a night nobody staged has null stages, never zeros. Oxygen and
 * breathing rate count only inside the night's asleep blocks. Naps (blocks
 * starting 14:00–18:00) are not nights and are dropped.
 */
export function sleepNights(
  samples: SleepSampleIn[],
  opts: { offsetMin?: number; spo2?: SpotIn[]; resp?: SpotIn[] } = {},
): SleepNight[] {
  const o = opts.offsetMin;
  const valid = samples.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  const blocks = mergeIntervals(valid.filter((s) => ASLEEP_VALUES.has(s.value)));
  const blockNight = blocks.map((b) => nightOf(b.start, o));
  // A sample inside an asleep block goes with that block (a 14:10 REM
  // segment of a block that began at 13:00); otherwise by its own start.
  const nightFor = (t: number) => {
    const i = blockAt(blocks, t, false);
    return i >= 0 ? blockNight[i] : nightOf(t, o);
  };

  interface Acc {
    blocks: Interval[];
    sources: Set<string>;
    stages: Map<string, Map<number, Interval[]>>;
    spo2: number[];
    resp: number[];
  }
  const nights = new Map<string, Acc>();
  const acc = (key: string): Acc => {
    let a = nights.get(key);
    if (!a) {
      a = { blocks: [], sources: new Set(), stages: new Map(), spo2: [], resp: [] };
      nights.set(key, a);
    }
    return a;
  };
  blocks.forEach((b, i) => {
    const key = blockNight[i];
    if (key) acc(key).blocks.push(b);
  });
  for (const s of valid) {
    if (ASLEEP_VALUES.has(s.value)) {
      const key = nightFor(s.start);
      if (key && nights.has(key)) acc(key).sources.add(s.source);
    }
    if (s.value === AWAKE || s.value === CORE || s.value === DEEP || s.value === REM) {
      const key = nightFor(s.start);
      if (!key || !nights.has(key)) continue;
      const bySource = acc(key).stages;
      const byValue = bySource.get(s.source) ?? new Map<number, Interval[]>();
      bySource.set(s.source, byValue);
      byValue.set(s.value, [...(byValue.get(s.value) ?? []), { start: s.start, end: s.end }]);
    }
  }
  const spot = (xs: SpotIn[] | undefined, into: (a: Acc) => number[], norm: (v: number) => number | null) => {
    for (const x of xs ?? []) {
      if (!Number.isFinite(x.t) || !Number.isFinite(x.value)) continue;
      const i = blockAt(blocks, x.t, true);
      const key = i >= 0 ? blockNight[i] : null;
      const v = norm(x.value);
      if (key && v !== null) into(acc(key)).push(v);
    }
  };
  // HealthKit's percent unit is a fraction (0.95); some writers send 95.
  spot(opts.spo2, (a) => a.spo2, (v) => {
    const pct = v <= 1.5 ? v * 100 : v;
    return pct >= 50 && pct <= 100 ? pct : null;
  });
  spot(opts.resp, (a) => a.resp, (v) => (v >= 4 && v <= 60 ? v : null));

  const minutes = (xs: Interval[] | undefined) =>
    Math.round(mergeIntervals(xs ?? []).reduce((ms, b) => ms + (b.end - b.start), 0) / MIN_MS);

  const out: SleepNight[] = [];
  for (const [wakeDay, a] of [...nights.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (!a.blocks.length) continue;
    // The source that staged the most of this night; ties go alphabetically.
    let staged: { deep: number; rem: number; core: number; awake: number } | null = null;
    let best = 0;
    for (const source of [...a.stages.keys()].sort()) {
      const v = a.stages.get(source)!;
      const s = { deep: minutes(v.get(DEEP)), rem: minutes(v.get(REM)), core: minutes(v.get(CORE)), awake: minutes(v.get(AWAKE)) };
      const total = s.deep + s.rem + s.core;
      if (total > best) {
        best = total;
        staged = s;
      }
    }
    out.push({
      wakeDay,
      asleepMin: minutes(a.blocks),
      deepMin: staged ? staged.deep : null,
      remMin: staged ? staged.rem : null,
      coreMin: staged ? staged.core : null,
      awakeMin: staged ? staged.awake : null,
      bedISO: new Date(Math.min(...a.blocks.map((b) => b.start))).toISOString(),
      wakeISO: new Date(Math.max(...a.blocks.map((b) => b.end))).toISOString(),
      sources: [...a.sources].sort(),
      spo2Low: a.spo2.length ? round1(Math.min(...a.spo2)) : null,
      spo2Avg: a.spo2.length ? round1(mean(a.spo2)) : null,
      respRate: a.resp.length ? round1(mean(a.resp)) : null,
    });
  }
  return out;
}

// ── The sync walk ────────────────────────────────────────────

/**
 * The first run: read backwards from now in SLEEP_CHUNK_DAYS chunks until
 * one comes back empty, never past SLEEP_BACKFILL_MAX_DAYS. `fromMs` is the
 * start of the last chunk read — nothing before it was looked at.
 */
export async function walkSleepBackfill<T>(
  query: (startISO: string, endISO: string) => Promise<T[]>,
  now: number,
): Promise<{ samples: T[]; fromMs: number; chunks: number }> {
  const floor = now - SLEEP_BACKFILL_MAX_DAYS * DAY_MS;
  const samples: T[] = [];
  let end = now;
  let fromMs = now;
  let chunks = 0;
  while (end > floor) {
    const start = Math.max(end - SLEEP_CHUNK_DAYS * DAY_MS, floor);
    const got = await query(new Date(start).toISOString(), new Date(end).toISOString());
    chunks += 1;
    fromMs = start;
    if (!got.length) break;
    samples.push(...got);
    end = start;
  }
  return { samples, fromMs, chunks };
}

export function batches<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

// ── Storage: one night → HealthSample rows ───────────────────

export interface SleepRow { type: string; date: Date; value: number; unit: string; meta: string | null }

/**
 * The rows one night becomes, keyed at UTC midnight of the wake day. The
 * hours row carries bed, wake, sources and the exact minutes as JSON in
 * `meta`. A figure the night lacks is listed in `removes`, so a re-sync
 * clears an old value instead of leaving it standing.
 */
export function sleepNightRows(n: SleepNight): { date: Date; upserts: SleepRow[]; removes: string[] } {
  const date = new Date(`${n.wakeDay}T00:00:00.000Z`);
  const upserts: SleepRow[] = [
    {
      type: SLEEP_TYPES.asleep,
      date,
      value: round2(n.asleepMin / 60),
      unit: 'h',
      meta: JSON.stringify({ bed: n.bedISO, wake: n.wakeISO, sources: n.sources, asleepMin: n.asleepMin }),
    },
  ];
  const removes: string[] = [];
  const add = (type: string, value: number | null, unit: string) => {
    if (value === null) removes.push(type);
    else upserts.push({ type, date, value, unit, meta: null });
  };
  add(SLEEP_TYPES.deep, n.deepMin, 'min');
  add(SLEEP_TYPES.rem, n.remMin, 'min');
  add(SLEEP_TYPES.core, n.coreMin, 'min');
  add(SLEEP_TYPES.awake, n.awakeMin, 'min');
  add(SLEEP_TYPES.spo2Low, n.spo2Low, '%');
  add(SLEEP_TYPES.spo2Avg, n.spo2Avg, '%');
  add(SLEEP_TYPES.resp, n.respRate, 'count/min');
  return { date, upserts, removes };
}

/** A night as it arrives over the wire, checked; null when malformed. */
export function parseSleepNight(raw: unknown): SleepNight | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number): number | null | undefined => {
    if (v === null || v === undefined) return null;
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
  };
  if (typeof r.wakeDay !== 'string' || !DAY_RE.test(r.wakeDay) || Number.isNaN(Date.parse(`${r.wakeDay}T00:00:00Z`))) return null;
  const asleep = num(r.asleepMin, 1, 24 * 60);
  if (asleep == null) return null;
  const stage = [r.deepMin, r.remMin, r.coreMin, r.awakeMin].map((v) => num(v, 0, 24 * 60));
  const spo2 = [r.spo2Low, r.spo2Avg].map((v) => num(v, 50, 100));
  const resp = num(r.respRate, 1, 80);
  if ([...stage, ...spo2, resp].some((v) => v === undefined)) return null;
  const bed = typeof r.bedISO === 'string' ? Date.parse(r.bedISO) : NaN;
  const wake = typeof r.wakeISO === 'string' ? Date.parse(r.wakeISO) : NaN;
  if (!Number.isFinite(bed) || !Number.isFinite(wake) || wake <= bed) return null;
  const sources = Array.isArray(r.sources)
    ? r.sources.filter((s): s is string => typeof s === 'string').slice(0, 10).map((s) => s.slice(0, 100))
    : [];
  const whole = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  return {
    wakeDay: r.wakeDay,
    asleepMin: Math.round(asleep),
    deepMin: whole(stage[0]),
    remMin: whole(stage[1]),
    coreMin: whole(stage[2]),
    awakeMin: whole(stage[3]),
    bedISO: new Date(bed).toISOString(),
    wakeISO: new Date(wake).toISOString(),
    sources,
    spo2Low: spo2[0] ?? null,
    spo2Avg: spo2[1] ?? null,
    respRate: resp ?? null,
  };
}

/** The two writes the import needs — prisma on the server, a Map in the suite. */
export interface SleepDb {
  upsert(row: SleepRow & { source: string }): Promise<void>;
  remove(types: string[], date: Date, source: string): Promise<void>;
}

/**
 * Write a batch of nights: idempotent upserts on (type, date, source), so a
 * re-sync REPLACES a night's values and a late block corrects it. A batch
 * over SLEEP_IMPORT_MAX_NIGHTS is refused whole; a malformed night is
 * skipped and counted.
 */
export async function writeSleepNights(
  raw: unknown,
  db: SleepDb,
): Promise<{ nights: number; rows: number; skipped: number } | { error: string }> {
  if (!Array.isArray(raw)) return { error: 'expected a list of nights' };
  if (raw.length > SLEEP_IMPORT_MAX_NIGHTS) return { error: `at most ${SLEEP_IMPORT_MAX_NIGHTS} nights per call` };
  let nights = 0;
  let rows = 0;
  let skipped = 0;
  for (const item of raw) {
    const night = parseSleepNight(item);
    if (!night) {
      skipped += 1;
      continue;
    }
    const { date, upserts, removes } = sleepNightRows(night);
    for (const row of upserts) await db.upsert({ ...row, source: SLEEP_SOURCE });
    if (removes.length) await db.remove(removes, date, SLEEP_SOURCE);
    nights += 1;
    rows += upserts.length;
  }
  return { nights, rows, skipped };
}

// ── Reading the store back ───────────────────────────────────

export interface StoredNight {
  /** Wake day, YYYY-MM-DD — his calendar day. */
  day: string;
  hours: number;
  deepMin: number | null;
  remMin: number | null;
  coreMin: number | null;
  awakeMin: number | null;
  spo2Low: number | null;
  spo2Avg: number | null;
  respRate: number | null;
  /** null on a row written before the night sync (hours only). */
  bedISO: string | null;
  wakeISO: string | null;
  sources: string[];
}

/** HealthSample rows → nights, oldest first. A day needs its hours row. */
export function nightsFromRows(rows: Array<{ type: string; date: Date | string; value: number; meta?: string | null }>): StoredNight[] {
  const byDay = new Map<string, Map<string, { value: number; meta?: string | null }>>();
  for (const r of rows) {
    const day = new Date(r.date).toISOString().slice(0, 10);
    const m = byDay.get(day) ?? new Map();
    m.set(r.type, { value: r.value, meta: r.meta });
    byDay.set(day, m);
  }
  const out: StoredNight[] = [];
  for (const [day, m] of byDay) {
    const h = m.get(SLEEP_TYPES.asleep);
    if (!h) continue;
    let meta: { bed?: unknown; wake?: unknown; sources?: unknown } = {};
    try {
      meta = h.meta ? JSON.parse(h.meta) : {};
    } catch {
      meta = {};
    }
    const v = (t: string) => m.get(t)?.value ?? null;
    out.push({
      day,
      hours: h.value,
      deepMin: v(SLEEP_TYPES.deep),
      remMin: v(SLEEP_TYPES.rem),
      coreMin: v(SLEEP_TYPES.core),
      awakeMin: v(SLEEP_TYPES.awake),
      spo2Low: v(SLEEP_TYPES.spo2Low),
      spo2Avg: v(SLEEP_TYPES.spo2Avg),
      respRate: v(SLEEP_TYPES.resp),
      bedISO: typeof meta.bed === 'string' ? meta.bed : null,
      wakeISO: typeof meta.wake === 'string' ? meta.wake : null,
      sources: Array.isArray(meta.sources) ? meta.sources.filter((s): s is string => typeof s === 'string') : [],
    });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Share of the hours asleep the mask was on: min(mask, asleep) ÷ asleep. */
export function maskCoverage(asleepH: number, maskH: number): number | null {
  if (!(asleepH > 0) || !Number.isFinite(maskH)) return null;
  return Math.min(Math.max(maskH, 0), asleepH) / asleepH;
}

/** Fewest nights behind any average shown (the Patterns rule). */
const MIN_AVG_NIGHTS = 3;
const shiftDay = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const upTo = (nights: StoredNight[], todayKey: string) => nights.filter((n) => n.day <= todayKey);
const cpapDay = (n: { night: Date | string }) => new Date(n.night).toISOString().slice(0, 10);

export interface SleepAverage { nights: number; hours: number | null; deepMin: number | null; deepNights: number; remMin: number | null; remNights: number }

/** Averages over the last `days` wake days ending today, each with its
 *  count; null under three nights. */
export function sleepAverage(nights: StoredNight[], todayKey: string, days: number): SleepAverage {
  const from = shiftDay(todayKey, -(days - 1));
  const rows = upTo(nights, todayKey).filter((n) => n.day >= from);
  const deep = rows.filter((n) => n.deepMin !== null).map((n) => n.deepMin as number);
  const rem = rows.filter((n) => n.remMin !== null).map((n) => n.remMin as number);
  return {
    nights: rows.length,
    hours: rows.length >= MIN_AVG_NIGHTS ? round1(mean(rows.map((n) => n.hours))) : null,
    deepMin: deep.length >= MIN_AVG_NIGHTS ? Math.round(mean(deep)) : null,
    deepNights: deep.length,
    remMin: rem.length >= MIN_AVG_NIGHTS ? Math.round(mean(rem)) : null,
    remNights: rem.length,
  };
}

export interface CpapNightIn { night: Date | string; usageHours: number }
export interface SleepGlance {
  night: StoredNight;
  /** False when this morning has no night yet and an older one is shown. */
  isLastNight: boolean;
  /** Mask hours of the time asleep (capped at the hours asleep), when the
   *  CPAP night for that morning exists. */
  maskHours: number | null;
}

export function sleepGlance(nights: StoredNight[], cpap: CpapNightIn[], todayKey: string): SleepGlance | null {
  const rows = upTo(nights, todayKey);
  const night = rows[rows.length - 1];
  if (!night) return null;
  const mask = cpap.find((c) => cpapDay(c) === night.day);
  return {
    night,
    isLastNight: night.day === todayKey,
    maskHours: mask ? round1(Math.min(Math.max(mask.usageHours, 0), night.hours)) : null,
  };
}

const fmtHours = (h: number) => String(round1(h));
const dayLabel = (key: string) => shortDay(`${key}T12:00:00Z`, 'UTC');

/** The Rooms glance: "7.4 h last night", or the latest night by its date. */
export function sleepNavGlance(latest: { day: string; hours: number } | null, todayKey: string): string {
  if (!latest) return 'no nights yet';
  return latest.day === todayKey ? `${fmtHours(latest.hours)} h last night` : `${fmtHours(latest.hours)} h · ${dayLabel(latest.day)}`;
}

const CHART_NIGHTS = 30;
const dayT = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** Hours asleep per night: the last 30 nights as bars, one label per bar
 *  (thinned only on collision). No reference line — no target is drawn. */
export function sleepHoursChart(nights: StoredNight[], todayKey: string): ChartSpec | null {
  const rows = upTo(nights, todayKey).slice(-CHART_NIGHTS);
  if (rows.length < MIN_TREND_POINTS) return null;
  return {
    key: 'sleep-hours',
    title: 'Hours asleep per night',
    unit: 'h',
    series: [{ key: 'hours', label: 'Asleep', kind: 'bar', points: rows.map((n) => ({ t: dayT(n.day), v: round1(n.hours) })) }],
    refs: [],
    zeroBased: true,
    xLabels: rows.map((n) => ({ t: dayT(n.day), label: dayLabel(n.day) })),
  };
}

/** Lowest wrist oxygen per night, over the last 30 nights that have one. */
export function sleepSpo2Chart(nights: StoredNight[], todayKey: string): ChartSpec | null {
  const rows = upTo(nights, todayKey).slice(-CHART_NIGHTS).filter((n) => n.spo2Low !== null);
  if (rows.length < MIN_TREND_POINTS) return null;
  return {
    key: 'sleep-spo2',
    title: 'Lowest overnight oxygen (wrist)',
    unit: '%',
    series: [{ key: 'spo2', label: 'Lowest', kind: 'line', points: rows.map((n) => ({ t: dayT(n.day), v: n.spo2Low as number })) }],
    refs: [],
    zeroBased: false,
  };
}

/** The whole history by month, newest first: nights counted, average hours
 *  (null under three nights). The wake-day key is already his day. */
export function sleepMonths(nights: StoredNight[], todayKey: string): Array<{ month: string; hours: number | null; nights: number }> {
  const by = new Map<string, number[]>();
  for (const n of upTo(nights, todayKey)) by.set(n.day.slice(0, 7), [...(by.get(n.day.slice(0, 7)) ?? []), n.hours]);
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, hs]) => ({ month, nights: hs.length, hours: hs.length >= MIN_AVG_NIGHTS ? round1(mean(hs)) : null }));
}

export interface SleepReport {
  nights: number;
  avgHours: number | null;
  /** Average mask coverage over nights with both a sleep night and a CPAP
   *  night; null under three such nights. */
  coverage: { pct: number; nights: number } | null;
  /** Lowest wrist oxygen of the range, and the nights that had a reading. */
  spo2Low: number | null;
  spo2Nights: number;
}

/** The doctor report's sleep row — ONE function for the page and the PDF. */
export function sleepReportSummary(nights: StoredNight[], cpap: CpapNightIn[], sinceKey: string, todayKey: string): SleepReport {
  const rows = upTo(nights, todayKey).filter((n) => n.day >= sinceKey);
  const maskBy = new Map(cpap.map((c) => [cpapDay(c), c.usageHours]));
  const cov = rows
    .filter((n) => maskBy.has(n.day))
    .map((n) => maskCoverage(n.hours, maskBy.get(n.day) as number))
    .filter((c): c is number => c !== null);
  const ox = rows.filter((n) => n.spo2Low !== null).map((n) => n.spo2Low as number);
  return {
    nights: rows.length,
    avgHours: rows.length >= MIN_AVG_NIGHTS ? round1(mean(rows.map((n) => n.hours))) : null,
    coverage: cov.length >= MIN_AVG_NIGHTS ? { pct: Math.round(mean(cov) * 100), nights: cov.length } : null,
    spo2Low: ox.length ? Math.min(...ox) : null,
    spo2Nights: ox.length,
  };
}

/**
 * The report's sleep rows, worded ONCE for the page and the PDF (the PDF
 * passes each through pdfSafe). No nights: no rows, and the caller says so.
 * The oxygen row always says it is a wrist reading.
 */
export function sleepReportRows(r: SleepReport): Array<{ label: string; value: string }> {
  if (r.nights === 0) return [];
  const nightsWord = (n: number) => `${n} night${n === 1 ? '' : 's'}`;
  const rows = [
    r.avgHours !== null
      ? { label: `Average asleep · ${nightsWord(r.nights)}`, value: `${r.avgHours} h/night` }
      : { label: 'Nights tracked', value: `${r.nights} — too few for an average` },
  ];
  if (r.coverage) {
    rows.push({ label: `Mask on, of the hours asleep · ${nightsWord(r.coverage.nights)}`, value: `${r.coverage.pct}%` });
  }
  if (r.spo2Low !== null) {
    rows.push({ label: 'Lowest overnight oxygen (wrist reading)', value: `${r.spo2Low}% · ${nightsWord(r.spo2Nights)}` });
  }
  return rows;
}
