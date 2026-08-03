'use client';

// Body & recovery signals read straight from Apple Health. Native shell only —
// returns null everywhere else, so the web app is unaffected.
//
// Deliberately a compact scoreboard rather than charts: the useful question
// between sessions is "which way is this trending", not "what was it on the
// 14th". Each row shows a recent average and its change against the previous
// window of the same length.
//
// Every metric here was requested at authorization time. If a row reads "—"
// it means Health returned nothing: either the type was declined, or nothing
// has ever written it. HealthKit refuses to say which, so neither do we.

import { useCallback, useEffect, useState } from 'react';
import {
  isNativeApp,
  queryCategory,
  queryDailyStats,
  queryQuantity,
  type QuantityIdentifier,
} from '@/lib/native-health';

const WINDOW_DAYS = 7;

interface Row {
  key: string;
  label: string;
  /** Formatted current value, or null when Health had nothing. */
  value: string | null;
  /** Change vs the previous window, already formatted with a sign. */
  delta: string | null;
  /** Whether a rise is good, bad, or neither — drives the delta colour. */
  direction: 'higher-better' | 'lower-better' | 'neutral';
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Split a day series into [previous window, current window]. */
function split(values: Array<number | null>): [number[], number[]] {
  const clean = (xs: Array<number | null>) => xs.filter((v): v is number => v !== null);
  return [clean(values.slice(0, values.length - WINDOW_DAYS)), clean(values.slice(-WINDOW_DAYS))];
}

export default function HealthInsights() {
  const [native, setNative] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNative(isNativeApp());
  }, []);


  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    const next: Row[] = [];

    // Averaged day-buckets: one call each, and the split gives the trend free.
    const daily: Array<{
      key: string;
      label: string;
      id: QuantityIdentifier;
      unit: string;
      digits: number;
      direction: Row['direction'];
    }> = [
      // Steps deliberately absent: StepsCard above already carries today's
      // count and a 7-day average. Two step readouts on one screen is noise.
      { key: 'rhr', label: 'Resting HR', id: 'restingHeartRate', unit: ' bpm', digits: 0, direction: 'lower-better' },
      { key: 'hrv', label: 'HRV', id: 'heartRateVariabilitySDNN', unit: ' ms', digits: 0, direction: 'higher-better' },
    ];

    for (const metric of daily) {
      try {
        const { days } = await queryDailyStats(metric.id, WINDOW_DAYS * 2);
        const [prev, curr] = split(days.map((d) => d.value));
        const now = mean(curr);
        const before = mean(prev);
        next.push({
          key: metric.key,
          label: metric.label,
          value: now === null ? null : `${now.toFixed(metric.digits)}${metric.unit}`,
          delta:
            now === null || before === null
              ? null
              : `${now - before >= 0 ? '+' : ''}${(now - before).toFixed(metric.digits)}`,
          direction: metric.direction,
        });
      } catch {
        next.push({ key: metric.key, label: metric.label, value: null, delta: null, direction: 'neutral' });
      }
    }

    // Sleep is a category type: sum each night's asleep intervals, then average.
    try {
      const samples = await queryCategory('sleepAnalysis');
      const cutoff = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
      const byNight = new Map<string, number>();
      for (const s of samples) {
        const start = Date.parse(s.startISO);
        if (start < cutoff) continue;
        // HKCategoryValueSleepAnalysis: 0 inBed, 1 asleep(legacy), 3/4/5 stages.
        if (s.value === 0) continue;
        const hours = (Date.parse(s.endISO) - start) / 3_600_000;
        const night = new Date(start).toISOString().slice(0, 10);
        byNight.set(night, (byNight.get(night) ?? 0) + hours);
      }
      const avg = mean([...byNight.values()]);
      next.push({
        key: 'sleep',
        label: 'Sleep',
        value: avg === null ? null : `${avg.toFixed(1)} h`,
        delta: null,
        direction: 'higher-better',
      });
    } catch {
      next.push({ key: 'sleep', label: 'Sleep', value: null, delta: null, direction: 'neutral' });
    }

    // Body composition: latest sample wins. Weight alone cannot tell fat loss
    // from muscle loss, which is the whole question during a cut.
    const latest: Array<{ key: string; label: string; id: QuantityIdentifier; pct: boolean }> = [
      { key: 'bodyfat', label: 'Body fat', id: 'bodyFatPercentage', pct: true },
      { key: 'lean', label: 'Lean mass', id: 'leanBodyMass', pct: false },
    ];
    for (const metric of latest) {
      try {
        const { samples, unit } = await queryQuantity(metric.id, { limit: 500 });
        const last = samples.at(-1);
        next.push({
          key: metric.key,
          label: metric.label,
          value:
            last === undefined
              ? null
              : metric.pct
                ? `${(last.value * 100).toFixed(1)}%`
                : `${last.value.toFixed(1)} ${unit}`,
          delta: null,
          direction: 'neutral',
        });
      } catch {
        next.push({ key: metric.key, label: metric.label, value: null, delta: null, direction: 'neutral' });
      }
    }

    if (next.every((r) => r.value === null)) {
      setError('Health returned nothing. Tap Recheck access above and allow every type.');
    }
    setRows(next);
    setBusy(false);
  }, []);

  // Load on mount rather than behind a tap, matching StepsCard. A card that
  // shows nothing until you press a button is asking for work before it gives
  // anything back.
  useEffect(() => {
    if (native) void load();
  }, [native, load]);

  if (!native) return null;

  // Same rule StepsCard follows: no data, no card. Resting HR, HRV and sleep
  // need a Watch; body composition needs a scale. Someone with neither should
  // get a shorter Stats page, not a row of em-dashes explaining an absence.
  const hasAny = rows?.some((r) => r.value !== null) ?? false;
  if (rows && !hasAny) return null;
  if (!rows && !busy) return null;

  const deltaClass = (row: Row) => {
    if (!row.delta || row.direction === 'neutral') return 'text-app-tx3';
    const rising = !row.delta.startsWith('-');
    const good = row.direction === 'higher-better' ? rising : !rising;
    return good ? 'text-acc-teal' : 'text-rose-300';
  };

  return (
    <div className="card-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="section-label">Body &amp; Recovery</p>
        <button
          onClick={load}
          disabled={busy}
          className="chip bg-app-surface2 border border-app-border text-app-tx3 hover:text-app-tx1 transition-colors disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {rows && (
        <div className="divide-y divide-app-border/60">
          {rows.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between py-2">
              <span className="text-app-tx2 text-sm">{row.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-app-tx1 text-sm font-semibold tabular-nums">
                  {row.value ?? '—'}
                </span>
                {row.delta && (
                  <span className={`text-[11px] tabular-nums ${deltaClass(row)}`}>{row.delta}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs mt-3 text-rose-300">{error}</p>}
    </div>
  );
}
