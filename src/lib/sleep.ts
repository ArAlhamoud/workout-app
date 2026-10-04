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
 * The night rule (owner, 2026-10-03; reviews, 2026-10-05). Asleep intervals
 * from every source are unioned into blocks; blocks separated by an awake
 * gap under RUN_GAP_MIN are one RUN, capped at RUN_MAX_H (a longer run is
 * split at its largest gap, so a night is never chained onto a long sleep
 * the next day).
 *
 * A run is a NAP — not stored — only when it starts at or after 14:00,
 * ends before 20:00 the same day and lasts under 3 h. Otherwise:
 *  · ending at or after 20:00 → the night ending the NEXT morning (a 20:00
 *    doze before bed, 17:30 → 05:00 after a bad night ends next morning
 *    anyway);
 *  · ending before 14:00 → that morning's night;
 *  · ending 14:00–20:00 → that day's, and a DAY SLEEP when it started at or
 *    after 10:00 the same day.
 * The night runs of one wake day (ending before 14:00, or rolled from the
 * evening) are ONE night, summed — his split Fitbit night 02:00–06:55 +
 * 09:49–13:30 is 8 h 4 min. Any other run keyed to the same day competes:
 * the LONGER stands, never a sum (a sick day added onto the night counted
 * it twice). A day sleep stands only when that day has no other sleep.
 */
export const NAP_FROM_HOUR = 14;
export const NAP_ENDS_BEFORE_HOUR = 20;
export const NAP_MAX_MIN = 180;
export const RUN_GAP_MIN = 90;
export const RUN_MAX_H = 16;
/** A run ending at or after this hour belongs to the next morning's night. */
export const ROLL_FROM_HOUR = 20;
/** A run ending after this hour (and before ROLL_FROM_HOUR) is a day's sleep. */
export const MORNING_ENDS_HOUR = 14;
/** …a DAY SLEEP when it began at or after this hour that day. */
export const DAY_SLEEP_FROM_HOUR = 10;
/** Every read starts this much before the nights it may write, so a run
 *  that began before the window is read whole; a night is written by the
 *  read whose owned window holds its first asleep instant. */
export const SLEEP_READ_OVERLAP_MS = 24 * 3_600_000;
/** Oxygen and breathing readings count from first asleep to final wake
 *  plus this much: a Fitbit may stamp its reading at the session's end. */
export const SPOT_AFTER_WAKE_MIN = 30;
/** This morning's night is written only this long after its last block… */
export const SETTLE_MIN = 60;
/** …and not before this local hour: an open at 03:00 is mid-night. */
export const SETTLE_FROM_HOUR = 5;

/** Reads go in chunks this long, so no bridge call spans months. */
export const SLEEP_CHUNK_DAYS = 60;
/** The first run walks back this far, across empty chunks. */
export const SLEEP_BACKFILL_MAX_DAYS = 1826;
/** Later runs re-read from the newest stored night minus this many days:
 *  a wearable that syncs late corrects the nights it lands in. */
export const SLEEP_RESYNC_DAYS = 3;
/** Nights per import call. Each night is at most 8 upserts in one
 *  transaction, so one server action writes at most 160 rows. */
export const SLEEP_IMPORT_MAX_NIGHTS = 20;
export const SLEEP_SOURCE = 'apple-health';
/** The backfill's own cursor: one HealthSample row of this type (value =
 *  the instant the walk has reached, ms) — no schema change. */
export const SLEEP_BACKFILL_TYPE = 'sleep_backfill_from';

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

/** A run longer than RUN_MAX_H split at its largest awake gap, repeatedly. */
function capRun(run: Interval[]): Interval[][] {
  if (run.length < 2 || run[run.length - 1].end - run[0].start <= RUN_MAX_H * 3_600_000) return [run];
  let at = 1;
  for (let i = 2; i < run.length; i++) {
    if (run[i].start - run[i - 1].end > run[at].start - run[at - 1].end) at = i;
  }
  return [...capRun(run.slice(0, at)), ...capRun(run.slice(at))];
}

const runMs = (run: Interval[]) => run.reduce((ms, b) => ms + (b.end - b.start), 0);

/**
 * Asleep blocks grouped into nights by the rule above: { wakeDay, blocks }
 * oldest first. Naps are dropped. ONE implementation for the stored nights
 * (sleepNights) and readiness (nightAsleepMs).
 */
export function groupSleepBlocks(intervals: Interval[], offsetMin?: number): Array<{ wakeDay: string; blocks: Interval[] }> {
  const blocks = mergeIntervals(intervals);
  const joined: Interval[][] = [];
  for (const b of blocks) {
    const run = joined[joined.length - 1];
    if (run && b.start - run[run.length - 1].end < RUN_GAP_MIN * MIN_MS) run.push(b);
    else joined.push([b]);
  }
  const runs = joined.flatMap(capRun);
  // Per wake day: the night runs (summed into one), and every other run.
  const byDay = new Map<string, { night: Interval[]; others: Interval[][]; daySleeps: Interval[][] }>();
  for (const run of runs) {
    const start = run[0].start;
    const end = run[run.length - 1].end;
    const s = localParts(start, offsetMin);
    const e = localParts(end, offsetMin);
    const sameDay = s.y === e.y && s.m === e.m && s.d === e.d;
    if (s.h >= NAP_FROM_HOUR && sameDay && e.h < NAP_ENDS_BEFORE_HOUR && end - start < NAP_MAX_MIN * MIN_MS) continue;
    const roll = e.h >= ROLL_FROM_HOUR;
    const key = roll ? keyOf(e.y, e.m, e.d + 1) : keyOf(e.y, e.m, e.d);
    const day = byDay.get(key) ?? { night: [], others: [], daySleeps: [] };
    byDay.set(key, day);
    if (roll || e.h < MORNING_ENDS_HOUR) day.night.push(...run);
    else if (sameDay && s.h >= DAY_SLEEP_FROM_HOUR) day.daySleeps.push(run);
    else day.others.push(run);
  }
  const longest = (xs: Interval[][]) => xs.reduce((a, b) => (runMs(b) > runMs(a) ? b : a));
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([wakeDay, d]) => {
      const candidates = [...(d.night.length ? [d.night] : []), ...d.others];
      const chosen = candidates.length ? longest(candidates) : longest(d.daySleeps);
      return { wakeDay, blocks: [...chosen].sort((a, b) => a.start - b.start) };
    });
}

/**
 * The earliest instant a night keyed `wakeDay` is expected to reach back
 * to: noon local the day before (a run ending from 18:00 rolls to the next
 * night, so a night's sleep starts after that morning — noon leaves room
 * for a long evening run such as 17:30 → 05:00).
 */
export function nightWindowStart(wakeDay: string, offsetMin?: number): number {
  const [y, m, d] = wakeDay.split('-').map(Number);
  if (offsetMin === undefined) return new Date(y, m - 1, d - 1, 12).getTime();
  return Date.UTC(y, m - 1, d - 1, 12) - offsetMin * MIN_MS;
}

/** Where a later run starts reading: the window of the newest stored night
 *  minus SLEEP_RESYNC_DAYS, so those nights are re-read whole. */
export function incrementalSleepStart(newestWakeDay: string, offsetMin?: number): number {
  const back = new Date(Date.parse(`${newestWakeDay}T00:00:00Z`) - SLEEP_RESYNC_DAYS * DAY_MS).toISOString().slice(0, 10);
  return nightWindowStart(back, offsetMin);
}

/** Where the forward read starts: the newest stored night minus
 *  SLEEP_RESYNC_DAYS, or — while no night is stored yet (a first backfill
 *  that found nothing: HealthKit answers a denied read with EMPTY, not an
 *  error) — the last 14 days, every run, until a night lands. */
export function forwardSleepStart(newestWakeDay: string | null, now: number, offsetMin?: number): number {
  return newestWakeDay === null ? now - 14 * DAY_MS : incrementalSleepStart(newestWakeDay, offsetMin);
}

/**
 * The nights a run may write: only those whose first asleep instant lies at
 * or after `fromMs` — every read starts SLEEP_READ_OVERLAP_MS earlier, so
 * such a night was read whole, and a night that began before belongs to
 * the read that owns that instant — none that ends after today, and this morning's
 * night only once it has settled — its last block ended SETTLE_MIN ago and
 * it is past SETTLE_FROM_HOUR. An open at 03:00 would otherwise store
 * three hours as "last night" for Stats, the glance and the room.
 */
export function nightsToWrite(nights: SleepNight[], fromMs: number, now: number, offsetMin?: number): SleepNight[] {
  const today = localDayKey(now, offsetMin);
  const settled = localParts(now, offsetMin).h >= SETTLE_FROM_HOUR;
  return nights.filter((n) => {
    if (Date.parse(n.bedISO) < fromMs) return false;
    if (n.wakeDay > today) return false;
    if (n.wakeDay === today) return settled && Date.parse(n.wakeISO) <= now - SETTLE_MIN * MIN_MS;
    return true;
  });
}

/**
 * Every night in the samples, keyed by wake day, oldest first. Asleep time
 * is the UNION of asleep values across sources — a Watch and a Fitbit on
 * the same night never add up to fourteen hours. Stages come from the one
 * source that staged the most of the night (two stagers would double
 * count); a night nobody staged has null stages, never zeros. Awake time,
 * oxygen and breathing count from first asleep to final wake plus
 * SPOT_AFTER_WAKE_MIN. `spo2`/`resp` null = the read failed or was not
 * made: the night then has null figures, and the writer leaves any stored
 * ones alone (it never removes them).
 */
export function sleepNights(
  samples: SleepSampleIn[],
  opts: { offsetMin?: number; spo2?: SpotIn[] | null; resp?: SpotIn[] | null } = {},
): SleepNight[] {
  const valid = samples.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  const asleep = valid.filter((s) => ASLEEP_VALUES.has(s.value));
  const groups = groupSleepBlocks(asleep, opts.offsetMin);
  const spans = groups.map((g) => ({
    bed: Math.min(...g.blocks.map((b) => b.start)),
    wake: Math.max(...g.blocks.map((b) => b.end)),
  }));
  // The night whose [bed, wake + slack] holds t. Nights never overlap.
  const nightAt = (t: number): number => {
    for (let i = 0; i < spans.length; i++) {
      if (t >= spans[i].bed && t <= spans[i].wake + SPOT_AFTER_WAKE_MIN * MIN_MS) return i;
    }
    return -1;
  };
  const sources = groups.map(() => new Set<string>());
  const stages = groups.map(() => new Map<string, Map<number, Interval[]>>());
  for (const s of valid) {
    if (s.value !== AWAKE && !ASLEEP_VALUES.has(s.value)) continue;
    const i = nightAt(s.start);
    if (i < 0) continue;
    if (ASLEEP_VALUES.has(s.value)) sources[i].add(s.source);
    if (s.value === AWAKE || s.value === CORE || s.value === DEEP || s.value === REM) {
      // Awake counts only between first asleep and final wake: a trailing
      // "awake in bed" spell made a real night longer than itself and the
      // server refused it (second review, 2026-10-05).
      const iv = s.value === AWAKE
        ? { start: Math.max(s.start, spans[i].bed), end: Math.min(s.end, spans[i].wake) }
        : { start: s.start, end: s.end };
      if (iv.end <= iv.start) continue;
      const byValue = stages[i].get(s.source) ?? new Map<number, Interval[]>();
      stages[i].set(s.source, byValue);
      byValue.set(s.value, [...(byValue.get(s.value) ?? []), iv]);
    }
  }
  const spot = (xs: SpotIn[] | null | undefined, norm: (v: number) => number | null): number[][] => {
    const out = groups.map((): number[] => []);
    for (const x of xs ?? []) {
      if (!Number.isFinite(x.t) || !Number.isFinite(x.value)) continue;
      const i = nightAt(x.t);
      const v = norm(x.value);
      if (i >= 0 && v !== null) out[i].push(v);
    }
    return out;
  };
  // HealthKit's percent unit is a fraction (0.95); some writers send 95.
  const ox = spot(opts.spo2, (v) => {
    const pct = v <= 1.5 ? v * 100 : v;
    return pct >= 50 && pct <= 100 ? pct : null;
  });
  const br = spot(opts.resp, (v) => (v >= 4 && v <= 60 ? v : null));

  const minutes = (xs: Interval[] | undefined) =>
    Math.round(mergeIntervals(xs ?? []).reduce((ms, b) => ms + (b.end - b.start), 0) / MIN_MS);

  return groups.map((g, i) => {
    // The source that staged the most of this night; ties go alphabetically.
    let staged: { deep: number; rem: number; core: number; awake: number } | null = null;
    let best = 0;
    for (const source of [...stages[i].keys()].sort()) {
      const v = stages[i].get(source)!;
      const s = { deep: minutes(v.get(DEEP)), rem: minutes(v.get(REM)), core: minutes(v.get(CORE)), awake: minutes(v.get(AWAKE)) };
      const total = s.deep + s.rem + s.core;
      if (total > best) {
        best = total;
        staged = s;
      }
    }
    return {
      wakeDay: g.wakeDay,
      asleepMin: minutes(g.blocks),
      deepMin: staged ? staged.deep : null,
      remMin: staged ? staged.rem : null,
      coreMin: staged ? staged.core : null,
      awakeMin: staged ? staged.awake : null,
      bedISO: new Date(spans[i].bed).toISOString(),
      wakeISO: new Date(spans[i].wake).toISOString(),
      sources: [...sources[i]].sort(),
      spo2Low: ox[i].length ? round1(Math.min(...ox[i])) : null,
      spo2Avg: ox[i].length ? round1(mean(ox[i])) : null,
      respRate: br[i].length ? round1(mean(br[i])) : null,
    };
  });
}

// ── The sync walk ────────────────────────────────────────────

/**
 * Read [fromMs, toMs] in SLEEP_CHUNK_DAYS chunks, newest first. One failed
 * chunk fails the whole read (it throws): a night is only ever built from a
 * read that succeeded end to end.
 */
export async function readChunked<T>(
  query: (startISO: string, endISO: string) => Promise<T[]>,
  fromMs: number,
  toMs: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let end = toMs; end > fromMs; end -= SLEEP_CHUNK_DAYS * DAY_MS) {
    const start = Math.max(fromMs, end - SLEEP_CHUNK_DAYS * DAY_MS);
    out.push(...(await query(new Date(start).toISOString(), new Date(end).toISOString())));
  }
  return out;
}

/** How far past a chunk's newer edge it is read, so a night that begins
 *  just inside the chunk is read to its end. */
const CHUNK_OVERLAP_MS = 2 * DAY_MS;

/**
 * The backfill: walk BACKWARDS from `cursor` (or now, on the first run) in
 * SLEEP_CHUNK_DAYS chunks to the 5-year floor, across empty chunks — a
 * broken band for four months must not hide the nights before it. Each
 * chunk is read from SLEEP_READ_OVERLAP_MS before its start, writes the
 * nights whose first asleep instant lies inside it, then stores the
 * cursor, so an interrupted walk resumes where it stopped on the next run,
 * independently of the forward incremental cursor. A read that fails stops
 * the walk with the cursor where it was: nothing is written or removed from
 * a failed read.
 */
export async function walkSleepBackfill(o: {
  cursor: number | null;
  now: number;
  offsetMin?: number;
  /** Nights grouped from a SUCCESSFUL read of [startMs, endMs]; throws on failure. */
  read: (startMs: number, endMs: number) => Promise<SleepNight[]>;
  /** Resolves with the wake days the server REFUSED (none: all stored). */
  write: (nights: SleepNight[]) => Promise<string[] | void>;
  setCursor: (ms: number) => Promise<void>;
}): Promise<{ chunks: number; cursor: number; done: boolean }> {
  const floor = o.now - SLEEP_BACKFILL_MAX_DAYS * DAY_MS;
  let cursor = o.cursor ?? o.now;
  let chunks = 0;
  while (cursor > floor) {
    const start = Math.max(cursor - SLEEP_CHUNK_DAYS * DAY_MS, floor);
    let nights: SleepNight[];
    try {
      nights = await o.read(start - SLEEP_READ_OVERLAP_MS, Math.min(cursor + CHUNK_OVERLAP_MS, o.now));
    } catch {
      return { chunks, cursor, done: false };
    }
    chunks += 1;
    // This chunk owns the nights whose first asleep instant lies in
    // [start, cursor); one that began earlier is the next chunk's.
    const mine = nightsToWrite(nights, start, o.now, o.offsetMin).filter((n) => Date.parse(n.bedISO) < cursor);
    if (mine.length) {
      const refused = await o.write(mine);
      // A refused night is never stepped over: the cursor stays, and the
      // next run retries this chunk.
      if (refused && refused.length) return { chunks, cursor, done: false };
    }
    await o.setCursor(start);
    cursor = start;
  }
  return { chunks, cursor, done: true };
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
 * `meta`. The sync only ever ADDS or CORRECTS a figure from a successful
 * read:
 *  · oxygen and breathing come from separate queries that can fail or time
 *    out — a null there is "unknown", so they are upserted when present and
 *    NEVER removed;
 *  · stage rows are removed when null. That is safe because a night is only
 *    built from a sleepAnalysis read that succeeded over the night's whole
 *    window (readChunked throws on any failed chunk; nightsToWrite drops a
 *    night cut by the window's edge) — so null stages mean that read
 *    carried stage data from no source for that night.
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
  const add = (type: string, value: number | null, unit: string, removable: boolean) => {
    if (value !== null) upserts.push({ type, date, value, unit, meta: null });
    else if (removable) removes.push(type);
  };
  add(SLEEP_TYPES.deep, n.deepMin, 'min', true);
  add(SLEEP_TYPES.rem, n.remMin, 'min', true);
  add(SLEEP_TYPES.core, n.coreMin, 'min', true);
  add(SLEEP_TYPES.awake, n.awakeMin, 'min', true);
  add(SLEEP_TYPES.spo2Low, n.spo2Low, '%', false);
  add(SLEEP_TYPES.spo2Avg, n.spo2Avg, '%', false);
  add(SLEEP_TYPES.resp, n.respRate, 'count/min', false);
  return { date, upserts, removes };
}

/**
 * A night as it arrives over the wire, checked against `todayKey` (the
 * owner's day on the server); null when malformed. The key must be a real
 * day (2026-02-31 is refused, not stored as 3 Mar) no later than tomorrow —
 * a 2099 row would become the sync cursor and stop every later write; bed
 * and wake must sit around that day; the stages must fit the night.
 */
export function parseSleepNight(raw: unknown, todayKey: string): SleepNight | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number): number | null | undefined => {
    if (v === null || v === undefined) return null;
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
  };
  if (typeof r.wakeDay !== 'string' || !DAY_RE.test(r.wakeDay)) return null;
  const dayMs = Date.parse(`${r.wakeDay}T00:00:00Z`);
  if (Number.isNaN(dayMs) || new Date(dayMs).toISOString().slice(0, 10) !== r.wakeDay) return null;
  if (!DAY_RE.test(todayKey) || r.wakeDay > shiftDay(todayKey, 1)) return null;
  const asleep = num(r.asleepMin, 1, 24 * 60);
  if (asleep == null) return null;
  const stage = [r.deepMin, r.remMin, r.coreMin, r.awakeMin].map((v) => num(v, 0, 24 * 60));
  const spo2 = [r.spo2Low, r.spo2Avg].map((v) => num(v, 50, 100));
  const resp = num(r.respRate, 1, 80);
  if ([...stage, ...spo2, resp].some((v) => v === undefined)) return null;
  const bed = typeof r.bedISO === 'string' ? Date.parse(r.bedISO) : NaN;
  const wake = typeof r.wakeISO === 'string' ? Date.parse(r.wakeISO) : NaN;
  if (!Number.isFinite(bed) || !Number.isFinite(wake) || wake <= bed) return null;
  // Around the key in any zone (UTC−12…+14): a night keyed D starts after
  // noon of D−1 local and ends before 18:00 of D local.
  if (bed < dayMs - 2 * DAY_MS || wake > dayMs + 33 * 3_600_000) return null;
  const spanMin = (wake - bed) / MIN_MS;
  if (asleep > spanMin + 1) return null;
  // Deep + REM + core come from one source's asleep time, so they fit the
  // minutes asleep; awake (clipped to the night) fits the night's span.
  if ((stage[0] ?? 0) + (stage[1] ?? 0) + (stage[2] ?? 0) > asleep + 1 || (stage[3] ?? 0) > spanMin + 1) return null;
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

/** One night's rows and removals as ONE write — prisma.$transaction on the
 *  server, a Map in the suite — so a failure half-way leaves it untouched. */
export interface SleepDb {
  writeNight(date: Date, rows: SleepRow[], removes: string[], source: string): Promise<void>;
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
  todayKey: string,
): Promise<{ nights: number; rows: number; skipped: number; skippedDays: string[] } | { error: string }> {
  if (!Array.isArray(raw)) return { error: 'expected a list of nights' };
  if (raw.length > SLEEP_IMPORT_MAX_NIGHTS) return { error: `at most ${SLEEP_IMPORT_MAX_NIGHTS} nights per call` };
  let nights = 0;
  let rows = 0;
  let skipped = 0;
  const skippedDays: string[] = [];
  for (const item of raw) {
    const night = parseSleepNight(item, todayKey);
    if (!night) {
      skipped += 1;
      const day = item && typeof item === 'object' ? (item as { wakeDay?: unknown }).wakeDay : undefined;
      skippedDays.push(typeof day === 'string' ? day.slice(0, 10) : '?');
      continue;
    }
    const { date, upserts, removes } = sleepNightRows(night);
    await db.writeNight(date, upserts, removes, SLEEP_SOURCE);
    nights += 1;
    rows += upserts.length;
  }
  return { nights, rows, skipped, skippedDays };
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

/** The Averages row's words: the average with its count once there are
 *  enough nights, otherwise how many there are and that 3 are needed. */
export function sleepAverageText(a: SleepAverage): { value: string; count: string | null } {
  if (a.hours === null) return { value: `${a.nights} night${a.nights === 1 ? '' : 's'} · ${MIN_AVG_NIGHTS} needed`, count: null };
  const value = [`${a.hours} h`, a.deepMin !== null ? `deep ${a.deepMin}` : null, a.remMin !== null ? `REM ${a.remMin}` : null]
    .filter(Boolean)
    .join(' · ');
  return { value, count: `× ${a.nights}` };
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

