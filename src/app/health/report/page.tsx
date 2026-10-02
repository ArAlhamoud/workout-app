import type { Metadata } from 'next';
import Link from 'next/link';
import BackLink from '@/components/BackLink';
import PrintButton from '@/components/health/PrintButton';
import PdfShareButton from '@/components/health/PdfShareButton';
import ReportChart from '@/components/health/ReportChart';
import { bpChart, cpapAhiChart, cpapHoursChart, doseChart, weightChart } from '@/lib/report-charts';
import { getHealthData } from '../../health-actions';
import { cpapAdherenceLabel, reportAge, signedKg, weightChangeAr, weightChangeLabel } from '@/lib/health-format';
import {
  afStats,
  bpAverage,
  cpapAdherence,
  bpSplitAroundAnchor,
  doseLedger,
  labRefLabel,
  ongoingSymptoms,
  sideEffectRows,
  reportLabs,
  siteLabel,
  treatmentClock,
  weightPace,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  SYMPTOM_LABEL,
  type DosePlanStep,
} from '@/lib/health-insights';

export const metadata: Metadata = { title: 'Doctor Report' };
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;
const RANGES = { '4w': 28, '3m': 91, all: 100_000 } as const;
type RangeKey = keyof typeof RANGES;

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
  const range: RangeKey = (['4w', '3m', 'all'] as const).includes(searchParams.range as RangeKey)
    ? (searchParams.range as RangeKey)
    : '4w';
  const since = new Date(Date.now() - RANGES[range] * DAY_MS);

  const data = await getHealthData();
  const inRange = <T,>(rows: T[], at: (r: T) => Date | string) =>
    rows.filter((r) => new Date(at(r)) >= since);

  const injections = inRange(data.injections, (i) => i.at);
  const symptoms = inRange(data.symptoms, (s) => s.at);
  const episodes = inRange(data.afEpisodes, (e) => e.startedAt);
  const bp = inRange(data.bpReadings, (r) => r.at);
  const cpap = inRange(data.cpapNights, (n) => n.night);
  const labs = reportLabs(data.labs);
  const weights = data.bodyStats.filter((b) => b.weight != null);
  const weightsInRange = inRange(weights, (b) => b.date);

  const clock = treatmentClock(
    data.injections,
    ((data.profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN),
    new Date(),
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
  const pace = weightPace(data.bodyStats);
  const snapshot = weightSnapshot(
    data.profile,
    (data.profile.milestonesKg as number[] | null) ?? [],
    data.bodyStats,
  );
  const bpAvg = bpAverage(bp.map((r) => ({ at: r.at, systolic: r.systolic, diastolic: r.diastolic })), RANGES[range]);
  const af = afStats(data.afEpisodes);

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

  // A range delta needs two weigh-ins — one row is a moment, not a change.
  const rangeStartW = weightsInRange.length >= 2 ? weightsInRange[0].weight : null;
  const rangeEndW = weightsInRange.length >= 2 ? weightsInRange[weightsInRange.length - 1].weight : null;
  const rangeDelta =
    rangeStartW != null && rangeEndW != null ? Math.round((rangeEndW - rangeStartW) * 10) / 10 : null;
  // Honest sign everywhere: a regain prints as +N kg, never as an unsigned
  // number sitting in a "lost" position (clinical-safety) — and the percent
  // carries the same sign (weightChangeLabel, shared with the PDF).

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
  const pulses = bp.filter((r) => r.pulse != null).map((r) => r.pulse as number);
  const pulseAvg =
    pulses.length >= 3 ? Math.round(pulses.reduce((s, p) => s + p, 0) / pulses.length) : null;
  const rangeLabel = range === '4w' ? 'Last 4 weeks' : range === '3m' ? 'Last 3 months' : 'All data';
  const rangeLabelAr = range === '4w' ? 'آخر ٤ أسابيع' : range === '3m' ? 'آخر ٣ أشهر' : 'كل البيانات';

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
            Self-reported data from AR Health · generated {fmt(new Date())} · not a
            medical record
          </p>
        </div>

        {/* Patient block — what a clinician expects at the top of a page */}
        <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
          <Row label="Patient" value="Abdulrahman Alhamoud" />
          {/* No birth date is stored, only the year — so the age prints as
              the pair it can be, never as an exact figure (2026-10-02). */}
          <Row label="Born" value={`1988 · ${reportAge(null)}`} />
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
              AF episode{episodes.length === 1 ? '' : 's'} in range
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
              {rangeDelta != null && (
                <Row
                  label={rangeLabel}
                  value={`${rangeDelta > 0 ? '+' : ''}${rangeDelta} kg · ${weightsInRange.length} weigh-ins`}
                />
              )}
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
          {pulseAvg != null && <Row label="Average pulse" value={`${pulseAvg} bpm`} />}
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
            <p className="text-sm text-app-tx3 print:text-gray-600">No LDL or Lp(a) result logged.</p>
          ) : (
            labs.map((l) => (
              <Row
                key={l.id}
                label={`${l.test.toUpperCase()} · ${fmt(l.date)}`}
                value={`${l.value} ${l.unit}${labRefLabel(l) ? ` (${labRefLabel(l)})` : ''}`}
              />
            ))
          )}
        </Section>

        <Section title="Current medications">
          {meds.length ? (
            meds.map((m) => <Row key={m.id} label={m.name} value={`${m.doseLabel} · ${m.frequency}`} />)
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">—</p>
          )}
        </Section>

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
            {labs.length > 0 && (
              <p>التحاليل: {labs.map((l) => `${l.test.toUpperCase()} ‏${l.value} ${l.unit}`).join(' · ')}</p>
            )}
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
