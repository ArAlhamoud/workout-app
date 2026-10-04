import type { Metadata } from 'next';
import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import BackLink from '@/components/BackLink';
import ReportChart from '@/components/health/ReportChart';
import { getHealthData, getPatternSessions, getSleepNights } from '../../health-actions';
import { monthLabel, weightChangeLabel } from '@/lib/health-format';
import {
  afCorrelates,
  cpapCompliance,
  cpapStats,
  afStats,
  dayRelativeSymptoms,
  deliveryDayPattern,
  severityByDose,
  weightSnapshot,
  SYMPTOM_LABEL as KIND_LABEL,
} from '@/lib/health-insights';
import {
  doseLevels,
  foodAndScale,
  foodAndScaleCharts,
  kcalLabel,
  kgChangeLabel,
  lowDayNote,
  monthRows,
  monthTrendCharts,
  monthTrends,
  sleepAndNextDay,
  weekAfterDose,
  weekAfterDoseCharts,
  weekLabel,
  type SleepSide,
} from '@/lib/patterns';

export const metadata: Metadata = { title: 'Health Patterns' };
export const dynamic = 'force-dynamic';

/** 0-3 severity → cell background. */
const heat = (v: number) =>
  v >= 2.5 ? 'bg-rpe-hard/70' : v >= 1.5 ? 'bg-rpe-med/70' : v >= 0.5 ? 'bg-acc-cyan/40' : 'bg-ink/5';

/** Label left, number right, its count beside it — the Diet page's row. */
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

/** The chart and the sentences sit behind one tap (glance rule). */
function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-3 border-t border-ink/10 pt-2">
      <summary className="cursor-pointer text-[11px] font-bold text-app-tx3">{summary}</summary>
      <div className="mt-1.5 space-y-2 text-[11px] leading-relaxed text-app-tx3">{children}</div>
    </details>
  );
}

const notYet = (what: string) => <p className="text-sm text-app-tx3">Not enough data yet · {what}</p>;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// Patterns: five questions the logs he keeps every day can answer, then one
// collapsed line for the cards still waiting on symptom and AF logs. Every
// number comes from src/lib/patterns.ts — this file fetches and renders.
export default async function HealthAnalyticsPage() {
  const [data, sessions, sleepNights] = await Promise.all([getHealthData(), getPatternSessions(), getSleepNights()]);
  const injections = data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site }));
  const symptoms = data.symptoms.map((s) => ({ at: s.at, kind: s.kind, severity: s.severity }));
  const diet = data.nutrition.map((n) => ({ day: n.day, kcal: n.kcal, proteinG: n.proteinG }));
  const nights = data.cpapNights.map((n) => ({
    night: n.night, usageHours: n.usageHours, ahi: n.ahi, p95Pressure: n.p95Pressure,
  }));

  // The five cards.
  const doseWeek = weekAfterDose(injections, diet, data.bodyStats);
  const doseWeekCharts = doseWeek ? weekAfterDoseCharts(doseWeek) : null;
  const levels = doseLevels(injections, diet, data.bodyStats);
  const food = foodAndScale(diet, data.bodyStats);
  const foodCharts = food ? foodAndScaleCharts(food) : null;
  const delivery = deliveryDayPattern(diet);
  const sleep = sleepAndNextDay(
    sleepNights.map((n) => ({ night: `${n.day}T00:00:00.000Z`, asleepHours: n.hours })),
    nights,
    data.bpReadings,
    sessions,
  );
  const months = monthTrends(data.bpReadings, nights, data.bodyStats);
  const monthCharts = months ? monthTrendCharts(months) : null;

  // The cards that were here before.
  const relative = dayRelativeSymptoms(symptoms, injections);
  const byDose = severityByDose(symptoms, injections);
  const af = afStats(data.afEpisodes);
  const mask = cpapCompliance(
    data.cpapNights.map((n) => ({ night: n.night, usageHours: n.usageHours })),
  );
  // Only for the deep-sleep share — the compliance numbers above own the rest.
  const cpap = cpapStats(data.cpapNights);
  const correlates = afCorrelates(data.afEpisodes);
  const weight = weightSnapshot(
    data.profile,
    (data.profile.milestonesKg as number[] | null) ?? [],
    data.bodyStats,
  );
  const relativeKinds = Object.entries(relative).filter(([, cells]) =>
    cells.some((c) => c.count >= 2),
  );

  /* Side effects relative to injection day */
  const relativeCard = (
    <div className="card-lg p-4" key="relative">
      <p className="section-label mb-1">Days after injection</p>
      {relativeKinds.length === 0 ? (
        <p className="text-sm text-app-tx3">
          Not enough data yet · a few weeks of symptom logs
        </p>
      ) : (
        <>
          <div className="mb-1.5 flex items-center gap-2 pl-24 pr-1">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="flex-1 text-center text-[9px] font-bold text-app-tx3">
                {i === 0 ? 'D0' : `+${i}`}
              </span>
            ))}
          </div>
          <div className="space-y-1.5">
            {relativeKinds.map(([kind, cells]) => {
              const byOffset = new Map(cells.map((c) => [c.offset, c]));
              return (
                <div key={kind} className="flex items-center gap-2">
                  <span className="w-22 min-w-[5.5rem] text-xs font-semibold text-app-tx2">
                    {KIND_LABEL[kind] ?? kind}
                  </span>
                  <div className="flex flex-1 gap-1">
                    {Array.from({ length: 8 }, (_, offset) => {
                      const cell = byOffset.get(offset);
                      return (
                        // Value in the cell, not a title tooltip — there
                        // is no hover on a phone (device-tester).
                        <div
                          key={offset}
                          className={`flex h-6 flex-1 items-center justify-center rounded text-[8px] font-bold text-app-tx1/80 ${heat(cell?.avgSeverity ?? 0)}`}
                        >
                          {cell ? cell.avgSeverity : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-app-tx3">
            Cell = average logged severity on that day after an injection.
          </p>
        </>
      )}
    </div>
  );

  /* Severity by dose */
  const symptomDoseCard = (
    <div className="card-lg p-4" key="symptom-dose">
      <p className="section-label mb-1">By dose level</p>
      {Object.keys(byDose).length === 0 ? (
        <p className="text-sm text-app-tx3">
          Not enough data yet · 3+ logs per dose level
        </p>
      ) : (
        <div className="space-y-2">
          {Object.entries(byDose).map(([kind, rows]) => (
            <div key={kind} className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-app-tx1">{KIND_LABEL[kind] ?? kind}</span>
              <span className="text-xs tabular-nums text-app-tx2">
                {rows.map((r) => `${r.doseMg} mg: avg ${r.avgSeverity} (${r.n})`).join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* AF */
  const afCard = (
    <div className="card-lg p-4" key="af">
      <p className="section-label mb-1">AF episodes</p>
      <div className="flex items-baseline gap-4">
        <div>
          <div className="metric-value text-app-tx1">{af.thisMonth}</div>
          <div className="metric-label">this month</div>
        </div>
        <div>
          <div className="metric-value text-app-tx2">{af.lastMonth}</div>
          <div className="metric-label">last month</div>
        </div>
        {af.perMonth.length >= 2 && (
          <div className="ml-auto flex items-end gap-1">
            {af.perMonth.slice(-6).map((m) => (
              <div key={m.month} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-4 rounded-t bg-rpe-hard/60"
                  style={{ height: `${Math.min(40, 6 + m.count * 8)}px` }}
                />
                <span className="text-[8px] font-bold text-app-tx3">{m.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 border-t border-ink/10 pt-3">
        {correlates === null ? (
          <p className="text-sm text-app-tx3">
            Not enough data yet · 5+ episodes with circumstances logged
          </p>
        ) : (
          <div className="space-y-1.5">
            {correlates.map((c) => (
              <div key={c.label} className="flex items-center gap-2 text-sm">
                <span className="w-32 flex-none text-xs text-app-tx2">{c.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className="h-full rounded-full bg-rpe-hard/70"
                    style={{ width: `${Math.round((c.hits / c.answered) * 100)}%` }}
                  />
                </div>
                <span className="w-14 flex-none text-right text-xs tabular-nums text-app-tx1">
                  {c.hits} of {c.answered}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // A card with data shows as a card; one still waiting moves behind the line.
  const older = [
    { card: relativeCard, has: relativeKinds.length > 0 },
    { card: symptomDoseCard, has: Object.keys(byDose).length > 0 },
    { card: afCard, has: correlates !== null },
  ];
  const waiting = older.filter((o) => !o.has);

  const sleepCell = (title: string, s: SleepSide) => (
    <div>
      <p className="text-[11px] font-bold text-app-tx2">
        {title} · {plural(s.nights, 'night')}
      </p>
      <p className="metric-value mt-1">{s.bp ? `${s.bp.systolic}/${s.bp.diastolic}` : '—'}</p>
      <p className="metric-label">next-day BP{s.bp ? ` × ${s.bp.n}` : ''}</p>
      <p className="metric-value mt-2">{s.hard ? `${s.hard.pct}%` : '—'}</p>
      <p className="metric-label">sets Hard or above{s.hard ? ` × ${s.hard.sets}` : ''}</p>
      {s.coverage && (
        <p className="mt-2 text-[11px] font-semibold text-app-tx3">
          mask on {s.coverage.pct}% of it × {s.coverage.nights}
        </p>
      )}
    </div>
  );

  const lowDayNotes = food ? food.weeks.map((w) => lowDayNote(w)).filter((n): n is string => n !== null) : [];

  // One row a month: weight, BP, AHI. It listed BP months and then AHI
  // months, the weight twice (2026-10-02).
  const monthList = months ? monthRows(months).slice(-6) : [];
  const hasMonthLine = !!monthCharts && (monthCharts.bp !== null || monthCharts.apnea !== null);
  /** First and latest month when a line exists; every month otherwise. */
  const shownMonths = hasMonthLine && monthList.length > 2 ? [monthList[0], monthList[monthList.length - 1]] : monthList;
  const pressMonths = monthList.filter((m) => m.press !== null);

  return (
    <div className="space-y-4 pb-8">
      <BackLink label="Home" />
      <div>
        <p className="section-label text-acc-cyan/80">Observed patterns · your logs only</p>
        <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
          Patterns
        </h1>
      </div>

      {/* 1 · The week after a dose */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">The week after a dose</p>
        {doseWeek && doseWeekCharts ? (
          <>
            <div className="space-y-1.5 text-sm text-app-tx1">
              <Row
                label={`Lowest · day ${doseWeek.low.offset}`}
                value={`${kcalLabel(doseWeek.low.kcal)} kcal`}
                count={`× ${doseWeek.low.n}`}
              />
              {doseWeek.other && (
                <Row
                  label={doseWeek.other.after ? `Up to, by day ${doseWeek.other.offset}` : `Highest · day ${doseWeek.other.offset}`}
                  value={`${kcalLabel(doseWeek.other.kcal)} kcal`}
                  count={`× ${doseWeek.other.n}`}
                />
              )}
            </div>
            <More summary={`Day by day · ${plural(doseWeek.weeks, 'dose week')}`}>
              {doseWeekCharts.kcal && <ReportChart spec={doseWeekCharts.kcal} />}
              {doseWeekCharts.weight && <ReportChart spec={doseWeekCharts.weight} />}
              <div className="space-y-1 text-xs">
                {doseWeek.days.map((d) => (
                  <div key={d.offset} className="flex items-baseline justify-between gap-2">
                    <span className="text-app-tx3">Day {d.offset}</span>
                    <span className="tabular-nums text-app-tx1">
                      {d.kcal !== null ? `${kcalLabel(d.kcal)} kcal × ${d.nKcal}` : '—'}
                    </span>
                    <span className="tabular-nums text-app-tx2">
                      {d.kgChange !== null ? `${kgChangeLabel(d.kgChange)} × ${d.nKg}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
              <p>
                Day 0 is the day of the injection on your calendar. Each figure is the average of the
                days logged that far from a dose, and × is how many. The scale is read against the
                weigh-in of the dose day; a week with no weigh-in that day is left out, and nothing
                is filled in. A figure needs 3 days, a line needs 4 points.
              </p>
              <p>Seen together in your logs — not a reason.</p>
            </More>
          </>
        ) : (
          notYet('3 dose weeks of logged food')
        )}
      </div>

      {/* 2 · What each dose level did */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">What each dose level did</p>
        {levels ? (
          <>
            <div className="space-y-3">
              {levels.map((l) => (
                <div key={l.doseMg} className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="metric-value">{l.doseMg}</p>
                    <p className="metric-label">mg · {plural(l.weeks, 'week')}</p>
                  </div>
                  <div>
                    <p className="metric-value">{l.kgPerWeek !== null ? kgChangeLabel(l.kgPerWeek).replace(' kg', '') : '—'}</p>
                    <p className="metric-label">kg a week × {l.weightWeeks}</p>
                  </div>
                  <div>
                    <p className="metric-value">{l.avgKcal !== null ? kcalLabel(l.avgKcal) : '—'}</p>
                    <p className="metric-label">kcal a day × {l.kcalDays}</p>
                  </div>
                </div>
              ))}
            </div>
            <More summary="How the weeks are counted">
              <p>
                A week runs from a dose day to the day before the next dose, 7 days at most, and
                belongs to the dose that opened it. Its change on the scale is read from the first
                and last weigh-in of that week, at least 5 days apart, scaled to 7 days; × is the
                weeks that had one. kcal is the average of the logged days, × the days. A figure
                needs 3 weeks or 3 days — until then it shows a dash beside its count.
              </p>
              <p>Numbers for the doctor review. The app does not rank dose levels.</p>
            </More>
          </>
        ) : (
          notYet('a dose and 3 logged days after it')
        )}
      </div>

      {/* 3 · Food and the scale */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Food and the scale</p>
        {food && foodCharts ? (
          <>
            <div className="space-y-1.5 text-sm text-app-tx1">
              {[food.low, food.high].map((b, i) => (
                <Row
                  key={i}
                  label={
                    b.n > 1
                      ? `Weeks around ${kcalLabel(b.kcal)} kcal`
                      : `${i === 0 ? 'Lightest' : 'Fullest'} week · ${kcalLabel(b.kcal)} kcal`
                  }
                  value={kgChangeLabel(b.kgChange)}
                  count={`× ${b.n}`}
                />
              ))}
            </div>
            <More summary={`Week by week · ${plural(food.weeks.length, 'week')}`}>
              {foodCharts.kcal && <ReportChart spec={foodCharts.kcal} />}
              {foodCharts.weight && <ReportChart spec={foodCharts.weight} />}
              <div className="space-y-1 text-xs">
                {food.weeks.map((w) => (
                  <div key={w.weekStart} className="flex items-baseline justify-between gap-2">
                    <span className="text-app-tx3">{weekLabel(w.weekStart)}</span>
                    <span className="tabular-nums text-app-tx1">{kcalLabel(w.kcal)} kcal × {w.days}</span>
                    <span className="tabular-nums text-app-tx2">{w.proteinG !== null ? `${w.proteinG} g` : '—'}</span>
                    <span className="tabular-nums text-app-tx1">{kgChangeLabel(w.kgChange)}</span>
                  </div>
                ))}
              </div>
              <p>
                A week is Monday to Sunday and counts with 5 or more logged days; × is the days.
                The grams are protein. The change is from the first to the last weigh-in between
                that Monday and the next, at least 5 days apart, scaled to 7 days. With 6 or more
                weeks the lower and the upper half are averaged; before that the lightest and the
                fullest week stand alone.
              </p>
              {lowDayNotes.length > 0 && (
                <p>
                  {lowDayNotes.join('. ')}. A day under half its week&apos;s median is named here and
                  stays in the average.
                </p>
              )}
              <p>Seen together in your logs — water moves the scale as much as food does.</p>
            </More>
          </>
        ) : (
          notYet('4 weeks with 5+ logged days and weigh-ins')
        )}
        {delivery && (
          <div className="mt-3 space-y-1.5 border-t border-ink/10 pt-3 text-sm text-app-tx1">
            <Row label="Sun–Thu (delivered)" value={`${kcalLabel(delivery.deliveryAvg)} kcal`} count={`× ${delivery.nDelivery}`} />
            <Row label="Fri–Sat (yours)" value={`${kcalLabel(delivery.ownAvg)} kcal`} count={`× ${delivery.nOwn}`} />
          </div>
        )}
      </div>

      {/* 4 · Sleep and the next day */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Sleep and the next day</p>
        {sleep ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-center">
              {sleepCell('7 h or more asleep', sleep.long)}
              {sleepCell('Under 7 h', sleep.short)}
            </div>
            <More summary="What is counted">
              <p>
                Nights are split by hours asleep as the wearable recorded them: 7 h or more, and
                under 7 h; × is the nights. The pressure is the average reading on the day the
                night ended, × the days that had one. The share is of rated working sets in a
                session on that day, × the sets. A pressure needs 3 days; a share needs 3 sessions
                and 5 rated sets — until then it shows a dash. The mask line is the part of the
                hours asleep the CPAP was on, × the nights with a CPAP night; it shows once each
                side has 4 of them.
              </p>
              <p>Seen together in your logs — not a reason.</p>
            </More>
          </>
        ) : (
          notYet('4 nights on each side of 7 h asleep')
        )}
      </div>

      {/* 5 · Pressure and apnea as the weight falls */}
      <div className="card-lg p-4">
        <p className="section-label mb-2">Pressure and apnea as the weight falls</p>
        {shownMonths.length === 0 ? (
          notYet('2 months of BP or CPAP with weigh-ins')
        ) : (
          // One grid, so the columns line up down the months; keyed by month.
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-baseline gap-x-2 gap-y-1.5 whitespace-nowrap text-sm tabular-nums">
            {shownMonths.map((m) => (
              <Fragment key={m.month}>
                <span className="text-xs text-app-tx3">{monthLabel(m.month)}</span>
                <span className="text-right text-app-tx1">{m.kg} kg</span>
                <span className="text-right text-app-tx2">{m.bp ? `BP ${m.bp.systolic}/${m.bp.diastolic}` : '—'}</span>
                <span className="text-right text-app-tx2">{m.ahi !== null ? `AHI ${m.ahi}` : '—'}</span>
              </Fragment>
            ))}
          </div>
        )}
        {shownMonths.length > 0 && (
          <More summary={hasMonthLine ? 'The months as lines' : 'What is counted'}>
            {monthCharts?.weight && <ReportChart spec={monthCharts.weight} />}
            {monthCharts?.bp && <ReportChart spec={monthCharts.bp} />}
            {monthCharts?.apnea && <ReportChart spec={monthCharts.apnea} />}
            {pressMonths.length > 0 && (
              <div className="space-y-1 text-xs">
                {pressMonths.map((m) => (
                  <div key={m.month} className="flex items-baseline justify-between gap-2">
                    <span className="text-app-tx3">{monthLabel(m.month)} · machine pressure</span>
                    <span className="tabular-nums text-app-tx1">{m.press} hPa</span>
                  </div>
                ))}
              </div>
            )}
            <p>
              Each figure is a month&apos;s average. A BP month needs 3 readings, an AHI month 3
              measured nights, and both need 2 weigh-ins; a month without one shows a dash. A line
              needs 4 months.
            </p>
            <p>Seen together in your logs — not a reason.</p>
          </More>
        )}
        {weight && (
          <p className="mt-2 border-t border-ink/10 pt-2 text-[11px] text-app-tx3">
            Total so far: {weightChangeLabel(weight.lostKg, weight.pctLost)}.
          </p>
        )}
      </div>

      {older.filter((o) => o.has).map((o) => o.card)}

      {mask.monthLogged > 0 && (
        <div className="card-lg p-4">
          {/* Nights arrive in a weekly report: before the first one of a
              month lands, the card shows the latest reported month, named —
              it used to disappear whole (2026-10-02). */}
          <p className="section-label mb-2">
            {mask.monthIsCurrent || !mask.month ? 'The mask, this month' : `The mask · ${monthLabel(mask.month)}`}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="metric-value">{mask.month4h}<span className="text-sm text-app-tx3">/{mask.monthLogged}</span></p>
              <p className="metric-label">nights ≥4h</p>
            </div>
            <div>
              <p className="metric-value">{mask.currentStreak}</p>
              <p className="metric-label">current streak</p>
            </div>
            <div>
              <p className="metric-value">{mask.bestStreak}</p>
              <p className="metric-label">best streak</p>
            </div>
          </div>
          {cpap.deepAvgMin != null && (
            <details className="mt-3 border-t border-ink/10 pt-2">
              <summary className="cursor-pointer text-[11px] font-bold text-app-tx3">
                Deep sleep · {cpap.deepAvgMin} min a night
              </summary>
              <p className="mt-1.5 text-[11px] leading-relaxed text-app-tx3">
                Machine estimate from airflow over {cpap.deepNights} {cpap.deepNights === 1 ? 'night' : 'nights'} — not a sleep study; won&apos;t match the Watch.
              </p>
            </details>
          )}
        </div>
      )}

      {/* Everything still waiting for data: one line, the cards behind it. */}
      {waiting.length > 0 && (
        <details>
          <summary className="cursor-pointer text-center text-xs font-bold text-app-tx3">
            {waiting.length} more appear{waiting.length === 1 ? 's' : ''} as you log symptoms and AF episodes
          </summary>
          <div className="mt-4 space-y-4">{waiting.map((o) => o.card)}</div>
        </details>
      )}

      <Link href="/health/timeline" className="block text-center text-xs font-bold text-app-tx3">
        the full log, entry by entry →
      </Link>
    </div>
  );
}
