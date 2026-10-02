/**
 * Trend charts for the doctor report (owner, 2026-09-30: "add trend graph
 * for every major reading — weight, bp, cpap, dose").
 *
 * Pure geometry, no drawing. The report page renders it as inline SVG and
 * the PDF route draws the same shapes with pdf-lib, so the two can never
 * show different pictures of the same numbers. Coordinates are measured
 * from the TOP-LEFT of the chart box (SVG convention); the PDF flips them
 * with `y = top - point.y`.
 *
 * Tracker, not diagnostic (HEALTH.md): a chart needs enough points to be a
 * trend — below the minimum the builder returns null and the report says
 * so in words. No target bands, no "normal" shading: the doctor reads the
 * line, the app does not grade it.
 */

const DAY_MS = 86_400_000;

export type SeriesKind = 'line' | 'step' | 'bar';

export interface ChartPoint {
  t: number; // epoch ms
  v: number;
}

export interface ChartSeries {
  key: string;
  label: string;
  kind: SeriesKind;
  points: ChartPoint[];
}

export interface ChartSpec {
  /** Axis labels at chosen points, in place of the three date ticks (a
   *  day-since-dose axis, a month axis). */
  xLabels?: Array<{ t: number; label: string }>;
  /** The five report charts, or a Patterns chart (src/lib/patterns.ts). */
  key: 'weight' | 'bp' | 'cpap-hours' | 'cpap-ahi' | 'dose' | `pattern-${string}`;
  title: string;
  unit: string;
  series: ChartSeries[];
  /** Horizontal reference lines, e.g. the 4-hour CPAP use threshold. */
  refs: Array<{ v: number; label: string }>;
  /** Force the y axis to start at zero (bars, doses, hours, AHI). */
  zeroBased: boolean;
  /** Extend the x axis to this time (a dose step runs on to today). */
  extendTo?: number;
}

export interface PlottedPoint {
  x: number;
  y: number;
  t: number;
  v: number;
}

export interface PlottedSeries {
  key: string;
  label: string;
  kind: SeriesKind;
  points: PlottedPoint[];
  /** Polyline vertices: for a step series, the corners are included. */
  path: Array<{ x: number; y: number }>;
  barWidth: number;
}

export interface PlottedChart {
  spec: ChartSpec;
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; label: string }>;
  refs: Array<{ y: number; label: string }>;
  series: PlottedSeries[];
}

/**
 * Fewest points that make a chart. HEALTH.md law 5: "a chart from 3 points
 * is a lie with axes" — so four. This was 3, and the dose chart drew from
 * 2 (audit, 2026-10-02): the code now obeys the law as written, for every
 * chart on the report, the dose step included.
 */
export const MIN_TREND_POINTS = 4;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 1, 2, 2.5, 5 × 10^k — steps a person reads without arithmetic. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * Y range and ticks that bracket every value (and every reference line)
 * with a little air, on round numbers. A flat series still gets a visible
 * band instead of a zero-height axis.
 */
export function yScale(
  values: number[],
  zeroBased: boolean,
  tickCount = 4,
): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (zeroBased) lo = Math.min(0, lo);
  if (hi - lo < 1e-9) {
    const pad = Math.max(1, Math.abs(hi) * 0.05);
    hi += pad;
    if (!zeroBased) lo -= pad;
  }
  const step = niceStep((hi - lo) / tickCount);
  const min = zeroBased && lo >= 0 ? 0 : Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 1e6; v += step) ticks.push(round1(v));
  return { min, max, ticks };
}

const shortDate = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' });

const tickLabel = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Lay a chart spec into a box. Pure; the same call feeds SVG and PDF. */
export function layoutChart(
  spec: ChartSpec,
  width: number,
  height: number,
  pad = { left: 30, right: 34, top: 8, bottom: 16 },
): PlottedChart {
  const all = spec.series.flatMap((s) => s.points);
  const ts = all.map((p) => p.t);
  const tMin = Math.min(...ts);
  let tMax = Math.max(...ts, spec.extendTo ?? -Infinity);
  const hasBars = spec.series.some((s) => s.kind === 'bar');
  // Bars sit centred on their night; give the edges half a day of room.
  const tLo = hasBars ? tMin - DAY_MS / 2 : tMin;
  if (hasBars) tMax += DAY_MS / 2;
  const tSpan = Math.max(tMax - tLo, DAY_MS);

  const { min, max, ticks } = yScale(
    [...all.map((p) => p.v), ...spec.refs.map((r) => r.v)],
    spec.zeroBased,
  );
  const plot = { left: pad.left, right: width - pad.right, top: pad.top, bottom: height - pad.bottom };
  const px = (t: number) => plot.left + ((t - tLo) / tSpan) * (plot.right - plot.left);
  const py = (v: number) => plot.bottom - ((v - min) / (max - min)) * (plot.bottom - plot.top);

  const barWidth = hasBars
    ? Math.max(2, Math.min(14, ((plot.right - plot.left) / Math.max(1, tSpan / DAY_MS)) * 0.7))
    : 0;

  const series: PlottedSeries[] = spec.series.map((s) => {
    const sorted = [...s.points].sort((a, b) => a.t - b.t);
    const points = sorted.map((p) => ({ x: px(p.t), y: py(p.v), t: p.t, v: p.v }));
    let path: Array<{ x: number; y: number }> = points.map(({ x, y }) => ({ x, y }));
    if (s.kind === 'step' && points.length) {
      path = [];
      points.forEach((p, i) => {
        if (i > 0) path.push({ x: p.x, y: points[i - 1].y });
        path.push({ x: p.x, y: p.y });
      });
      // The current dose continues to the end of the axis.
      const endX = px(tMax);
      if (endX > points[points.length - 1].x) path.push({ x: endX, y: points[points.length - 1].y });
    }
    return { key: s.key, label: s.label, kind: s.kind, points, path, barWidth: s.kind === 'bar' ? barWidth : 0 };
  });

  const mid = tLo + tSpan / 2;
  const clampX = (t: number) => px(Math.min(Math.max(t, tLo), tLo + tSpan));
  const xTicks = spec.xLabels
    ? spec.xLabels.map((l) => ({ x: clampX(l.t), label: l.label }))
    : (tSpan >= 3 * DAY_MS ? [tMin, mid, tMax] : [tMin, tMax]).map((t) => ({ x: clampX(t), label: shortDate(t) }));

  return {
    spec,
    width,
    height,
    plot,
    yTicks: ticks.map((v) => ({ y: py(v), label: tickLabel(v) })),
    xTicks,
    refs: spec.refs.map((r) => ({ y: py(r.v), label: r.label })),
    series,
  };
}

// ── Builders: rows in, spec out (or null when there is no trend yet) ──

export function weightChart(rows: Array<{ date: Date | string; weight: number | null }>): ChartSpec | null {
  const points = rows
    .filter((r) => r.weight != null)
    .map((r) => ({ t: new Date(r.date).getTime(), v: r.weight as number }));
  if (points.length < MIN_TREND_POINTS) return null;
  return {
    key: 'weight',
    title: 'Weight',
    unit: 'kg',
    series: [{ key: 'weight', label: 'Weight', kind: 'line', points }],
    refs: [],
    zeroBased: false,
  };
}

export function bpChart(rows: Array<{ at: Date | string; systolic: number; diastolic: number }>): ChartSpec | null {
  if (rows.length < MIN_TREND_POINTS) return null;
  const at = (r: { at: Date | string }) => new Date(r.at).getTime();
  return {
    key: 'bp',
    title: 'Blood pressure',
    unit: 'mmHg',
    series: [
      { key: 'systolic', label: 'Systolic', kind: 'line', points: rows.map((r) => ({ t: at(r), v: r.systolic })) },
      { key: 'diastolic', label: 'Diastolic', kind: 'line', points: rows.map((r) => ({ t: at(r), v: r.diastolic })) },
    ],
    refs: [],
    zeroBased: false,
  };
}

/** Mask time per night. The 4-hour line is the same threshold the report
 *  already counts ("Nights ≥ 4 h"), drawn rather than restated. */
export function cpapHoursChart(rows: Array<{ night: Date | string; usageHours: number }>): ChartSpec | null {
  if (rows.length < MIN_TREND_POINTS) return null;
  return {
    key: 'cpap-hours',
    title: 'CPAP use per night',
    unit: 'h',
    series: [{
      key: 'hours',
      label: 'Hours',
      kind: 'bar',
      points: rows.map((r) => ({ t: new Date(r.night).getTime(), v: round1(r.usageHours) })),
    }],
    refs: [{ v: 4, label: '4 h' }],
    zeroBased: true,
  };
}

/** A night without a measured AHI is absent, never zero. */
export function cpapAhiChart(rows: Array<{ night: Date | string; ahi: number | null }>): ChartSpec | null {
  const points = rows
    .filter((r) => r.ahi != null)
    .map((r) => ({ t: new Date(r.night).getTime(), v: r.ahi as number }));
  if (points.length < MIN_TREND_POINTS) return null;
  return {
    key: 'cpap-ahi',
    title: 'AHI per night',
    unit: 'events/h',
    series: [{ key: 'ahi', label: 'AHI', kind: 'line', points }],
    refs: [],
    zeroBased: true,
  };
}

/** Weekly dose as a step: it holds between injections and runs on to
 *  today. Held to the same minimum as every chart — the dose ledger above
 *  it already lists each injection in words. */
export function doseChart(
  ledger: Array<{ at: Date | string; doseMg: number }>,
  now: Date = new Date(),
): ChartSpec | null {
  if (ledger.length < MIN_TREND_POINTS) return null;
  return {
    key: 'dose',
    title: 'Mounjaro dose',
    unit: 'mg',
    series: [{
      key: 'dose',
      label: 'Dose',
      kind: 'step',
      points: ledger.map((d) => ({ t: new Date(d.at).getTime(), v: d.doseMg })),
    }],
    refs: [],
    zeroBased: true,
    extendTo: now.getTime(),
  };
}
