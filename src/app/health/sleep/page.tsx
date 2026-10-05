import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import BackLink from '@/components/BackLink';
import ReportChart from '@/components/health/ReportChart';
import { getSleepRoom } from '../../health-actions';
import { ownerDayKey } from '@/lib/health-insights';
import { monthLabel, shortDay } from '@/lib/health-format';
import {
  bedtimeSpread,
  efficiencyAverage,
  sleepAverage,
  sleepEfficiency,
  sleepAverageText,
  sleepGlance,
  sleepHoursChart,
  sleepMonths,
  sleepSpo2Chart,
  type SleepAverage,
} from '@/lib/sleep';

export const metadata: Metadata = { title: 'Sleep' };
export const dynamic = 'force-dynamic';

// The Sleep room: every night Apple Health holds, as the wearable wrote it
// (src/lib/sleep.ts groups and stores them; docs/HEALTH.md has the rules).
// A tracker: hours, stages and wrist oxygen with their counts — no grade
// and nothing read into the wrist numbers.

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
const shiftKey = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const h1 = (h: number) => String(Math.round(h * 10) / 10);
const notYet = (what: string) => <p className="text-sm text-app-tx3">Not enough data yet · {what}</p>;

/** Label left, number right, its count beside it — the Patterns row. */
function Row({ label, value, count }: { label: string; value: string; count?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-semibold text-app-tx2">{label}</span>
      <span className="flex-none font-round font-extrabold tabular-nums">
        {value}
        {count && <span className="ml-1.5 text-[11px] font-semibold text-app-tx3">{count}</span>}
      </span>
    </div>
  );
}

function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-3 border-t border-ink/10 pt-2">
      <summary className="cursor-pointer text-[11px] font-bold text-app-tx3">{summary}</summary>
      <div className="mt-1.5 space-y-2 text-[11px] leading-relaxed text-app-tx3">{children}</div>
    </details>
  );
}

export default async function SleepPage() {
  const { nights, cpap } = await getSleepRoom();
  // His calendar day, never the server's: a night is keyed by the morning
  // he woke, in Riyadh (CLAUDE.md rule 12).
  const today = ownerDayKey(new Date());

  const glance = sleepGlance(nights, cpap, today);
  const avg7 = sleepAverage(nights, today, 7);
  const avg30 = sleepAverage(nights, today, 30);
  const hoursChart = sleepHoursChart(nights, today);
  const oxygenChart = sleepSpo2Chart(nights, today);
  const hasOxygen = nights.some((n) => n.spo2Low !== null);
  const months = sleepMonths(nights, today);
  const tracked = nights.filter((x) => x.day <= today);
  const eff7 = efficiencyAverage(nights, today, 7);
  const bed7 = bedtimeSpread(nights, today, 7);
  const recent7 = nights.filter((x) => x.day <= today && x.day >= shiftKey(today, -6));
  const needed = (have: number) => `${have} night${have === 1 ? '' : 's'} · 3 needed`;

  // "1 night · 3 needed" until an average exists, then the average with its count.
  const avgRow = (label: string, a: SleepAverage) => {
    const t = sleepAverageText(a);
    return <Row label={label} value={t.value} count={t.count ?? undefined} />;
  };

  const n = glance?.night;
  const stageLine = n
    ? [
        n.deepMin !== null ? `deep ${n.deepMin} min` : null,
        n.remMin !== null ? `REM ${n.remMin} min` : null,
        glance.maskHours !== null ? `mask ${h1(glance.maskHours)} h of it` : null,
      ].filter(Boolean).join(' · ')
    : '';
  // How broken the night was: wake-ups, minutes awake, and the share of
  // first-asleep → final-wake spent asleep. Counts only, no grade.
  const eff = n ? sleepEfficiency(n) : null;
  const wakeLine = n
    ? [
        n.wakeUps !== null ? `${n.wakeUps} wake-up${n.wakeUps === 1 ? '' : 's'}` : null,
        n.awakeMin !== null ? `awake ${n.awakeMin} min` : null,
        eff !== null ? `${eff}% asleep` : null,
      ].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Home" />
      <div>
        <p className="section-label text-acc-violet/80">From Apple Health</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">Sleep</h1>
      </div>

      {/* Last night: hours, bed → wake, then deep / REM and the mask. */}
      <div className="card-lg p-4">
        {n ? (
          <>
            <p className="metric-value">{h1(n.hours)} h</p>
            <p className="metric-label">
              {glance.isLastNight ? 'asleep last night' : `asleep · night to ${shortDay(`${n.day}T12:00:00Z`, 'UTC')}`}
              {n.bedISO && n.wakeISO ? ` · ${time(n.bedISO)} → ${time(n.wakeISO)}` : ''}
            </p>
            {stageLine && <p className="mt-1.5 text-sm font-semibold tabular-nums text-app-tx2">{stageLine}</p>}
            {wakeLine && <p key={wakeLine} className="mt-0.5 text-xs font-semibold tabular-nums text-app-tx3">{wakeLine}</p>}
          </>
        ) : (
          <p className="text-sm text-app-tx3">
            No nights yet · they arrive from Apple Health when the app opens on the phone.
          </p>
        )}
      </div>

      {/* Averages with their counts */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Averages</p>
        <div className="space-y-1.5 text-sm">
          {avgRow('Last 7 nights', avg7)}
          {avgRow('Last 30 nights', avg30)}
          <Row
            label="Asleep of bed → wake"
            value={eff7 ? `${eff7.pct}%` : needed(recent7.filter((x) => sleepEfficiency(x) !== null).length)}
            count={eff7 ? `× ${eff7.nights}` : undefined}
          />
          <Row
            label="Bedtime"
            value={bed7 ? `${bed7.typical} · ${bed7.earliest}–${bed7.latest}` : needed(recent7.filter((x) => x.bedISO).length)}
            count={bed7 ? `× ${bed7.nights}` : undefined}
          />
        </div>
        <More summary="What is counted">
          <p>
            Hours asleep as the wearable recorded them — time in bed awake is left out, and two
            devices on the same night count once. Deep and REM are minutes, averaged over the
            nights that had them. A wake-up is a break in sleep of 5 minutes or more; “% asleep”
            is the share of the time from first falling asleep to final waking. Bedtime is the
            typical time you first fell asleep over the last 7 nights, with the earliest and
            latest. An average needs 3 nights; × is the nights.
          </p>
        </More>
      </div>

      {/* Hours per night */}
      <div className="card-lg p-4">
        <p className="section-label mb-1">Hours asleep</p>
        {hoursChart ? <ReportChart spec={hoursChart} /> : notYet('4 nights for a chart')}
      </div>

      {/* Wrist oxygen — only once Health has any */}
      {hasOxygen && (
        <div className="card-lg p-4">
          <p className="section-label mb-1">Overnight oxygen</p>
          {oxygenChart ? <ReportChart spec={oxygenChart} /> : notYet('4 nights with an oxygen reading')}
          <p className="mt-1 text-[11px] text-app-tx3">Lowest per night · wrist reading, not a medical oxygen test.</p>
        </div>
      )}

      {/* The whole history, behind a tap */}
      {months.length > 0 && (
        <div className="card-lg p-4">
          <p className="section-label mb-1">Since the first night</p>
          <Row label="Nights tracked" value={String(tracked.length)} count={`since ${shortDay(`${tracked[0].day}T12:00:00Z`, 'UTC')}`} />
          <More summary="Every month">
            <div className="space-y-1 text-xs">
              {months.map((m) => (
                <div key={m.month} className="flex items-baseline justify-between gap-2">
                  <span className="text-app-tx3">{monthLabel(m.month)}</span>
                  <span className="tabular-nums text-app-tx1">
                    {m.hours !== null ? `${m.hours} h` : '—'}
                    <span className="ml-1.5 text-app-tx3">× {m.nights}</span>
                  </span>
                </div>
              ))}
            </div>
          </More>
        </div>
      )}
    </div>
  );
}
