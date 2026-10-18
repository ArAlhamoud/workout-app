import type { Metadata } from 'next';
import Link from 'next/link';
import BackLink from '@/components/BackLink';
import PrintButton from '@/components/health/PrintButton';
import PdfShareButton from '@/components/health/PdfShareButton';
import ReportChart from '@/components/health/ReportChart';
import { bpChart, cpapAhiChart, cpapHoursChart, doseChart, weightChart } from '@/lib/report-charts';
import { getHealthData, getSleepNights } from '../../health-actions';
import { sleepReportRows, sleepReportSummary } from '@/lib/sleep';
import { bornLabel, cpapAdherenceLabel, signedKg, weightChangeAr, weightChangeLabel } from '@/lib/health-format';
import {
  afStats,
  cpapAdherence,
  bpSplitAroundAnchor,
  doseLedger,
  ownerDayKey,
  ongoingSymptoms,
  sideEffectRows,
  siteLabel,
  treatmentClock,
  weightPace,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  SYMPTOM_LABEL,
  type DosePlanStep,
} from '@/lib/health-insights';
import {
  bpControl,
  bpControlRows,
  bpWindowAverage,
  doctorQuestions,
  labCellText,
  labColumnLabel,
  labGrid,
  labTable,
  openQuestionCount,
  openQuestionGroups,
  pulseRows,
  pulseTrend,
  reportSince,
  weightWindowRows,
  REPORT_RANGES,
  type ReportRange,
} from '@/lib/doctor-report';

export const metadata: Metadata = { title: 'Doctor Report' };
export const dynamic = 'force-dynamic';

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' });

const SEVERITY_WORD = ['none', 'mild', 'moderate', 'severe'];

/** One fact per line: label left, value right — a doctor scans, never reads. */
function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-sm text-app-tx2 print:text-gray-700">{label}</span>
      <span
        className={`text-right text-sm font-bold tabular-nums ${dim ? 'text-app-tx3 print:text-gray-600' : 'text-app-tx1 print:text-black'}`}
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ink/10 pt-3 print:border-gray-300">
      <p className="section-label mb-1.5 print:font-bold print:text-black">{title}</p>
      {children}
    </section>
  );
}

export default async function DoctorReportPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const range: ReportRange = (['4w', '3m', 'all'] as const).includes(searchParams.range as ReportRange)
    ? (searchParams.range as ReportRange)
    : '4w';
  // HIS day clock: the window starts N of his days back (reportSince).
  const now = new Date();
  const since = reportSince(range, now);

  const [data, sleepNights] = await Promise.all([getHealthData(), getSleepNights()]);
  const inRange = <T,>(rows: T[], at: (r: T) => Date | string) =>
    rows.filter((r) => new Date(at(r)) >= since);

  const injections = inRange(data.injections, (i) => i.at);
  const symptoms = inRange(data.symptoms, (s) => s.at);
  const episodes = inRange(data.afEpisodes, (e) => e.startedAt);
  const bp = inRange(data.bpReadings, (r) => r.at);
  const cpap = inRange(data.cpapNights, (n) => n.night);
  // Every draw in the range, per test, with ITS lab's range; the most
  // recent earlier draw as "previous" (owner, 2026-10-18).
  const labs = labTable(data.labs, since);
  const grid = labGrid(labs);
  const weights = data.bodyStats.filter((b) => b.weight != null);
  const weightsInRange = inRange(weights, (b) => b.date);
  const questionList = doctorQuestions(data.profile.doctorQuestions);
  const questions = openQuestionGroups(questionList);

  const clock = treatmentClock(
    data.injections,
    ((data.profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN),
    now,
    data.firstInjectionAt ?? undefined,
    data.injectionCount,
  );

  // The checkpoint pack — everything the dose-review visit decides on,
  // anchored at treatment start (never range-scoped: the doctor reads the
  // whole treatment, not the last four weeks).
  // Numbered from the TRUE total: data.injections is a bounded window, and
  // past its size "Dose 1" would be wrong on a medical document (the same
  // truncated-window class the treatment clock guards against).
  const ledgerOffset = Math.max(0, (data.injectionCount ?? 0) - data.injections.length);
  const ledger = clock
    ? doseLedger(
        data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site })),
        data.symptoms.map((sy) => ({ at: sy.at, kind: sy.kind, severity: sy.severity })),
      ).map((d) => ({ ...d, n: d.n + ledgerOffset }))
    : [];
  const bpSplit = clock
    ? bpSplitAroundAnchor(
        data.bpReadings.map((r) => ({ at: r.at, systolic: r.systolic, diastolic: r.diastolic })),
        clock.anchor,
      )
    : { before: null, since: null };
  const pace = weightPace(data.bodyStats, now);
  const snapshot = weightSnapshot(
    data.profile,
    (data.profile.milestonesKg as number[] | null) ?? [],
    data.bodyStats,
  );
  // ONE cut for the whole BP section: the average, the control rows and
  // the pulse pair all run over the readings since `since` (the average
  // once cut at now − N·24h and disagreed with the row beneath it).
  const bpAvg = bpWindowAverage(bp);
  const control = bpControlRows(bpControl(bp), fmt);
  const pulse = pulseRows(pulseTrend(data.bpReadings, since, REPORT_RANGES[range]), REPORT_RANGES[range]);
  const af = afStats(data.afEpisodes, now);

  // CPAP aggregates computed over the SELECTED RANGE — cpapStats' 30-day
  // window under a "last 3 months" heading printed month-old compliance as
  // if it covered the quarter (three reviewers, independently).
  // Adherence — nights used and nights of 4 h or more, of the nights the
  // weekly reports cover — is ONE function for this page and the PDF.
  const adherence = cpapAdherence(cpap);
  const cpapUsed = cpap.filter((n) => n.usageHours > 0);
  const cpapAvgH = cpapUsed.length
    ? Math.round((cpapUsed.reduce((s, n) => s + n.usageHours, 0) / cpapUsed.length) * 10) / 10
    : null;
  const cpapAhis = cpap.filter((n) => n.ahi != null) as Array<{ ahi: number }>;
  const cpapAvgAhi = cpapAhis.length
    ? Math.round((cpapAhis.reduce((s, n) => s + n.ahi, 0) / cpapAhis.length) * 10) / 10
    : null;

  // Deep sleep is device-ESTIMATED from airflow. Reported in MINUTES, the
  // unit the prisma app itself shows, so the two never disagree (owner,
  // 2026-09-07). Two reporting nights minimum; a night the report did not
  // measure is absent, never zero. A corroborating number, never advice.
  const cpapDeep = cpap.filter(
    (n) => n.deepSleepMin != null && n.usageHours > 0,
  ) as Array<{ deepSleepMin: number; usageHours: number }>;
  const cpapDeepMin =
    cpapDeep.length >= 2
      ? Math.round(cpapDeep.reduce((s, n) => s + n.deepSleepMin, 0) / cpapDeep.length)
      : null;

  const rangeLabel = range === '4w' ? 'Last 4 weeks' : range === '3m' ? 'Last 3 months' : 'All data';
  const rangeLabelAr = range === '4w' ? 'آخر ٤ أسابيع' : range === '3m' ? 'آخر ٣ أشهر' : 'كل البيانات';
  // The window in clinical terms — change, share lost, pace per week,
  // weeks on treatment — ONE function for this page and the PDF
  // (weightWindowRows). Honest sign everywhere: a regain prints as +N kg,
  // never as an unsigned number sitting in a "lost" position.
  const windowRows = snapshot
    ? weightWindowRows({ weights: weightsInRange, rangeLabel, treatmentWeek: clock?.week ?? null })
    : [];

  // Symptom summary: max + average severity per kind in range.
  const symptomAgg = new Map<string, { total: number; n: number; max: number }>();
  for (const s of symptoms) {
    const cur = symptomAgg.get(s.kind) ?? { total: 0, n: 0, max: 0 };
    cur.total += s.severity; cur.n += 1; cur.max = Math.max(cur.max, s.severity);
    symptomAgg.set(s.kind, cur);
  }

  // Trend charts (owner, 2026-09-30). Weight, BP and CPAP follow the
  // selected range like their sections; the dose runs since dose 1 like
  // the Mounjaro section. null = too few points to call it a trend.
  const charts = {
    weight: weightChart(weightsInRange),
    bp: bpChart(bp.map((r) => ({ at: r.at, systolic: r.systolic, diastolic: r.diastolic }))),
    cpapHours: cpapHoursChart(cpap),
    cpapAhi: cpapAhiChart(cpap),
    dose: doseChart(ledger),
  };
  // Sleep from the wearable, over the same range — ONE function for this
  // page and the PDF (sleepReportSummary / sleepReportRows). Nights are
  // keyed by the morning he woke, so the range is compared in HIS days.
  const sleep = sleepReportSummary(sleepNights, data.cpapNights, ownerDayKey(since), ownerDayKey(now));
  const sleepRows = sleepReportRows(sleep);

  const tooFew = (
    <p className="mt-1 text-xs text-app-tx3 print:text-gray-600">Not enough data yet for a chart.</p>
  );

  const sideEffects = sideEffectRows(ongoingSymptoms(data.profile.ongoingSymptoms), symptomAgg);

  const fmtMin = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;

  const meds = data.meds.filter((m) => !m.stoppedOn);
  const conditions = ((data.profile.conditions as string[] | null) ?? []).filter(
    (c): c is string => typeof c === 'string',
  );
  const firstCpapNight = data.cpapNights.length
    ? [...data.cpapNights].sort((a, b) => new Date(a.night).getTime() - new Date(b.night).getTime())[0].night
    : null;

  return (
    <div className="space-y-4 pb-8 print:space-y-3 print:text-black">
      <div className="print:hidden">
        <BackLink label="Home" />
        <div className="mt-1 flex items-center justify-between gap-2">
          <div>
            <p className="section-label text-acc-cyan/80">For the follow-up visit</p>
            <h1 className="mt-0.5 font-round text-2xl font-bold tracking-tight text-app-tx1">
              Doctor Report
            </h1>
          </div>
          <PrintButton />
        </div>
        <div className="mt-3 flex gap-1.5">
          {(['4w', '3m', 'all'] as const).map((r) => (
            <Link
              key={r}
              href={`/health/report?range=${r}`}
              className={`flex-1 rounded-card border py-2 text-center text-xs font-bold transition-all ${
                range === r
                  ? 'border-acc-cyan/60 bg-acc-cyan/15 text-acc-cyan'
                  : 'border-app-border bg-app-surface2/60 text-app-tx3'
              }`}
            >
              {r === '4w' ? '4 weeks' : r === '3m' ? '3 months' : 'All'}
            </Link>
          ))}
          <PdfShareButton range={range} />
          <a
            href={`/api/health/export?range=${range}`}
            className="flex-1 rounded-card border border-app-border bg-app-surface2/60 py-2 text-center text-xs font-bold text-app-tx3"
          >
            CSV ↓
          </a>
        </div>
      </div>

      {/* The report body — the four headline numbers first, then one fact
          per line. A doctor scans; nothing here asks to be read twice. */}
      <div className="card-lg space-y-4 p-4 print:border-0 print:bg-white print:p-0 print:shadow-none">
        <div>
          <p className="text-base font-bold text-app-tx1 print:text-black">
            Health summary — {rangeLabel}
          </p>
          <p className="text-xs text-app-tx3 print:text-gray-600">
            Self-reported data from AR Health · generated {fmt(now)} · not a
            medical record
          </p>
        </div>

        {/* Patient block — what a clinician expects at the top of a page */}
        <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
          <Row label="Patient" value="Abdulrahman Alhamoud" />
          {/* Birth month and year as the owner gave them; the age turns with
              the month (bornLabel). Without a stored date, the honest pair. */}
          <Row label="Born" value={bornLabel(data.profile.birthDate, now)} />
          <Row label="Height" value={`${data.profile.heightCm} cm`} />
          {conditions.length > 0 && (
            <p className="pt-1 text-xs leading-relaxed text-app-tx2 print:text-gray-700">
              {conditions.join(' · ')}
            </p>
          )}
          {/* Family history and investigations are not printed (owner,
              2026-09-30). They stay stored on the profile and in the export. */}
        </div>

        {/* The headline numbers */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
            <p className="metric-value print:text-black">{snapshot ? snapshot.currentKg : '—'}</p>
            <p className="metric-label print:text-gray-700">
              kg now{snapshot ? ` · from ${snapshot.startKg} at first clinic visit (${signedKg(snapshot.lostKg)})` : ''}
            </p>
          </div>
          <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
            <p className="metric-value print:text-black">{clock ? `${clock.lastDoseMg} mg` : '—'}</p>
            <p className="metric-label print:text-gray-700">
              {clock ? `weekly · week ${clock.week}` : 'not started'}
            </p>
          </div>
          <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
            <p className="metric-value print:text-black">
              {bpAvg ? `${bpAvg.systolic}/${bpAvg.diastolic}` : '—'}
            </p>
            <p className="metric-label print:text-gray-700">
              {bpAvg ? `BP average · ${bpAvg.n} readings` : 'BP · too few readings'}
            </p>
          </div>
          <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
            <p className="metric-value print:text-black">{episodes.length}</p>
            <p className="metric-label print:text-gray-700">
              {/* One expression: JSX once rendered "AF episode s". */}
              {episodes.length === 1 ? 'AF episode' : 'AF episodes'} in range
            </p>
          </div>
        </div>

        <Section title="Weight">
          {snapshot ? (
            <>
              {/* "Start" alone is ambiguous in a doctor-facing document: his
                  pre-programme peak was 135 kg, his weight at the first clinic
                  visit 133 kg, and the percentage below hangs off the latter
                  (owner, 2026-09-11; physician review flagged it). */}
              <Row label="First clinic visit → now" value={`${snapshot.startKg} → ${snapshot.currentKg} kg`} />
              <Row label="Change" value={weightChangeLabel(snapshot.lostKg, snapshot.pctLost)} />
              <Row label="BMI" value={`${snapshot.startBmi} → ${snapshot.bmi}`} />
              {windowRows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} dim={r.dim} />
              ))}
              {charts.weight ? <ReportChart spec={charts.weight} /> : tooFew}
            </>
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">No weigh-ins logged.</p>
          )}
        </Section>

        {clock && ledger.length > 0 && (
          <Section title="Mounjaro — since dose 1">
            <Row label="First dose" value={fmt(clock.anchor)} />
            {pace && (
              <Row
                label="Current pace"
                value={`${pace.kgPerWeek > 0 ? '+' : pace.kgPerWeek < 0 ? '−' : ''}${Math.abs(pace.kgPerWeek)} kg/week`}
              />
            )}
            {charts.dose ? <ReportChart spec={charts.dose} /> : tooFew}
            <div className="mt-1.5 space-y-1">
              {ledger.map((d) => (
                <div key={d.n} className="text-sm tabular-nums">
                  <p className="font-bold text-app-tx1 print:text-black">
                    Dose {d.n} · {fmt(d.at)} · {d.doseMg} mg · {siteLabel(d.site)}
                  </p>
                  <p className="text-xs text-app-tx2 print:text-gray-700">
                    {d.symptoms.length
                      ? d.symptoms
                          .slice(0, 3)
                          .map((sy) => `${SYMPTOM_LABEL[sy.kind] ?? sy.kind} — ${SEVERITY_WORD[sy.maxSeverity]}, ${sy.count}×`)
                          .join(' · ')
                      : 'no side effects logged'}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Side effects & GI">
          {/* Ongoing side effects (profile) first, then logged episodes;
              a kind that is both prints once (owner, 2026-09-30). */}
          {sideEffects.length === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">Nothing logged in this range.</p>
          ) : (
            sideEffects.map((r) => <Row key={r.kind} label={r.label} value={r.value} />)
          )}
        </Section>

        <Section title="Atrial fibrillation">
          <Row label="Episodes in range" value={String(episodes.length)} />
          {episodes.map((e) => {
            const flags = (
              [
                ['after a meal', e.afterMeal], ['bloating', e.bloating], ['gas', e.gas],
                ['during/after sleep', e.sleepRelated], ['around exercise', e.exerciseRelated],
                ['caffeine', e.caffeine], ['dehydration', e.dehydration], ['stress', e.stress],
              ] as Array<[string, boolean | null]>
            ).filter(([, v]) => v === true).map(([label]) => label);
            return (
              <div key={e.id}>
                <Row
                  label={`${fmt(e.startedAt)} · ${new Date(e.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })}`}
                  value={`${e.durationMin != null ? fmtMin(e.durationMin) : 'duration unknown'}${e.hrBpm ? ` · ${e.hrBpm} bpm` : ''}`}
                />
                {flags.length > 0 && (
                  <p className="text-xs text-app-tx3 print:text-gray-600">
                    noted at the time: {flags.join(', ')}
                  </p>
                )}
              </div>
            );
          })}
          {af.daysSinceLast != null && (
            <Row label="Days since last" value={String(af.daysSinceLast)} dim />
          )}
        </Section>

        <Section title="Blood pressure">
          {bpAvg ? (
            <Row label={`Average · ${bpAvg.n} readings`} value={`${bpAvg.systolic}/${bpAvg.diastolic}`} />
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">
              {bp.length
                ? `${bp.length} reading${bp.length === 1 ? '' : 's'} — too few for an average.`
                : 'No readings in this range.'}
            </p>
          )}
          {/* Control, highest and lowest, the morning/evening split, then
              the pulse pair (bpControlRows / pulseRows — the PDF's rows). */}
          {[...control, ...pulse].map((r) => (
            <Row key={r.label} label={r.label} value={r.value} dim={r.dim} />
          ))}
          {/* The treatment split lives here, not under Mounjaro — BP facts
              stay in the BP section (owner's call, 2026-08-30). */}
          {bpSplit.before && (
            <Row
              label="Before treatment"
              value={`${bpSplit.before.systolic}/${bpSplit.before.diastolic} · ${bpSplit.before.n} readings`}
            />
          )}
          {bpSplit.since && (
            <Row
              label="Since treatment"
              value={`${bpSplit.since.systolic}/${bpSplit.since.diastolic} · ${bpSplit.since.n} readings`}
            />
          )}
          {bp.length > 0 && (charts.bp ? <ReportChart spec={charts.bp} /> : tooFew)}
        </Section>

        <Section title="Sleep (wearable)">
          {sleepRows.length ? (
            sleepRows.map((r) => <Row key={r.label} label={r.label} value={r.value} />)
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">No sleep nights tracked in this range.</p>
          )}
        </Section>

        <Section title="CPAP">
          {cpap.length ? (
            <>
              {firstCpapNight && <Row label="Therapy since" value={fmt(firstCpapNight)} />}
              <Row label="Nights logged" value={String(cpap.length)} />
              <Row label="Average use" value={`${cpapAvgH ?? '—'} h/night`} />
              <Row label="Nights ≥ 4 h" value={`${adherence.over4} of ${adherence.reported}`} />
              {/* Of the nights REPORTED, and through which date: the weekly
                  report lags, and unreported is not unused (2026-10-02). */}
              <Row label="Nights used" value={cpapAdherenceLabel(adherence)} />
              {cpapAvgAhi != null && <Row label="Average AHI" value={String(cpapAvgAhi)} />}
              {cpapDeepMin != null && (
                <Row
                  label="Deep sleep (device estimate)"
                  value={`${cpapDeepMin} min/night · ${cpapDeep.length} nights`}
                />
              )}
              {charts.cpapHours ? <ReportChart spec={charts.cpapHours} /> : tooFew}
              {charts.cpapAhi && <ReportChart spec={charts.cpapAhi} />}
            </>
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">No CPAP nights logged in this range.</p>
          )}
        </Section>

        <Section title="Laboratory">
          {labs.length === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">No result in this range.</p>
          ) : (
            <>
              {/* One row per test, one column per draw (newest first), the
                  previous draw dimmed last, and the newest value's own range
                  (a range belongs to its draw — HEALTH.md law 3; when a row's
                  labs differ each cell carries its own). Units as stored.
                  The dates scroll INSIDE the card — the page never scrolls
                  sideways (owner, 2026-10-18: "like a table"). */}
              <p className="text-xs text-app-tx3 print:text-gray-600">
                ▲ above · ▼ below the lab&apos;s own range · bold = newest · previous = last draw before the range
              </p>
              <div className="-mx-1 mt-2 overflow-x-auto print:overflow-visible">
                <table className="w-full border-collapse text-[12px] tabular-nums">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-app-tx3 print:text-gray-600">
                      <th className="sticky left-0 z-10 bg-app-surface px-1 py-1 font-semibold print:bg-white">Test</th>
                      {grid.columns.map((c) => (
                        <th key={c.key} className="min-w-[76px] whitespace-nowrap px-1 py-1 text-right font-semibold">{c.label}</th>
                      ))}
                      {grid.hasPrevious && <th className="min-w-[76px] px-1 py-1 text-right font-semibold">Previous</th>}
                      <th className="min-w-[64px] px-1 py-1 text-right font-semibold">Ref</th>
                    </tr>
                  </thead>
                  {grid.groups.map((g) => (
                    <tbody key={g.heading}>
                      <tr>
                        <td
                          colSpan={grid.columns.length + (grid.hasPrevious ? 1 : 0) + 2}
                          className="border-t border-ink/10 bg-app-surface2/60 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-app-tx3 print:border-gray-300 print:bg-gray-100 print:text-gray-600"
                        >
                          {g.heading}
                        </td>
                      </tr>
                      {g.rows.map((r) => (
                        <tr key={r.test} className="border-t border-ink/5 align-top print:border-gray-200">
                          <td className="sticky left-0 z-10 bg-app-surface px-1 py-1 text-app-tx1 print:bg-white print:text-black">{r.label}</td>
                          {r.cells.map((c, i) => (
                            <td key={grid.columns[i].key} className="whitespace-nowrap px-1 py-1 text-right">
                              {c && (
                                <>
                                  <span className={c.newest ? 'font-bold text-app-tx1 print:text-black' : 'text-app-tx2 print:text-gray-700'}>{labCellText(c)}</span>
                                  {r.mixedLabs && c.ref && <span className="block text-[10px] text-app-tx3 print:text-gray-600">{c.ref}</span>}
                                </>
                              )}
                            </td>
                          ))}
                          {grid.hasPrevious && (
                            <td className="whitespace-nowrap px-1 py-1 text-right text-app-tx3 print:text-gray-600">
                              {r.previous && (
                                <>
                                  {labCellText(r.previous)}
                                  <span className="block text-[10px]">
                                    {labColumnLabel(r.previous.dayKey, r.previous.lab)}{r.mixedLabs && r.previous.ref ? ` · ${r.previous.ref}` : ''}
                                  </span>
                                </>
                              )}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-1 py-1 text-right text-[10px] text-app-tx3 print:text-gray-600">{r.ref}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            </>
          )}
        </Section>

        <Section title="Current medications">
          {meds.length ? (
            meds.map((m) => <Row key={m.id} label={m.name} value={`${m.doseLabel} · ${m.frequency}`} />)
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">—</p>
          )}
        </Section>

        {/* The owner's own questions, last, in his words (owner, 2026-10-18).
            Open ones only; asked ones stay on /health/plan. */}
        {questions.length > 0 && (
          <Section title="Questions for the doctor">
            {questions.map((g) => (
              <div key={g.for} className="mt-1 break-inside-avoid">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-app-tx3 print:text-gray-600">
                  {g.label}
                </p>
                <ol className="mt-0.5 space-y-1">
                  {g.items.map((q) => (
                    <li key={q.id} className="flex gap-2 text-sm leading-snug text-app-tx1 print:text-black">
                      <span className="w-5 flex-none text-right tabular-nums text-app-tx3 print:text-gray-600">{q.n}.</span>
                      <span>{q.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </Section>
        )}

        {/* Arabic summary — same key numbers, right-to-left */}
        <section dir="rtl" lang="ar" className="border-t border-ink/10 pt-3 print:border-gray-300">
          <p className="section-label mb-1 print:font-bold print:text-black">الملخّص — {rangeLabelAr}</p>
          <div className="space-y-1 text-sm leading-relaxed text-app-tx1 print:text-black">
            <p>
              الوزن منذ أول زيارة للعيادة: {snapshot ? `${snapshot.startKg} كجم ← ${snapshot.currentKg} كجم (${weightChangeAr(snapshot.lostKg, snapshot.pctLost)})` : 'لا يوجد'}
            </p>
            <p>
              مونجارو: {clock ? `الأسبوع ${clock.week} · الجرعة الحالية ${clock.lastDoseMg} ملغ أسبوعيًا` : 'لم يبدأ بعد'} · عدد الحقن في الفترة: {injections.length}
            </p>
            <p>نوبات الرجفان الأذيني في الفترة: {episodes.length}</p>
            <p>
              ضغط الدم: {bpAvg ? `المتوسط ${bpAvg.systolic}/${bpAvg.diastolic}` : 'قراءات غير كافية'}
            </p>
            <p>
              جهاز التنفس (CPAP): {cpap.length ? `متوسط الاستخدام ${cpapAvgH ?? '—'} ساعة/ليلة${cpapAvgAhi != null ? ` · مؤشر AHI ${cpapAvgAhi}` : ''}` : 'لا يوجد تسجيل'}
            </p>
            {sleep.avgHours !== null && (
              <p>النوم: متوسط {sleep.avgHours} ساعة/ليلة · {sleep.nights} ليلة</p>
            )}
            {labs.length > 0 && (
              <p>التحاليل في الفترة: {labs.reduce((s, g) => s + g.tests.length, 0)} فحصًا</p>
            )}
            <p>أسئلة للطبيب: {openQuestionCount(questionList)}</p>
            <p className="text-xs text-app-tx3 print:text-gray-600">
              بيانات مسجّلة ذاتيًا من تطبيق المتابعة الشخصي — ليست سجلًا طبيًا.
            </p>
          </div>
        </section>
      </div>

      <Link
        href="/health/plan"
        className="block text-center text-xs font-bold text-app-tx3 print:hidden"
      >
        adjust the plan & profile →
      </Link>
    </div>
  );
}
