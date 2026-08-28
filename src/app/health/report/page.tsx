import type { Metadata } from 'next';
import Link from 'next/link';
import BackLink from '@/components/BackLink';
import PrintButton from '@/components/health/PrintButton';
import { getHealthData } from '../../health-actions';
import {
  afStats,
  bpAverage,
  bpSplitAroundAnchor,
  doseLedger,
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
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
  const labs = inRange(data.labs, (l) => l.date);
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
  const ledger = clock
    ? doseLedger(
        data.injections.map((i) => ({ at: i.at, doseMg: i.doseMg, site: i.site })),
        data.symptoms.map((sy) => ({ at: sy.at, kind: sy.kind, severity: sy.severity })),
      )
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
  const cpapUsed = cpap.filter((n) => n.usageHours > 0);
  const cpapAvgH = cpapUsed.length
    ? Math.round((cpapUsed.reduce((s, n) => s + n.usageHours, 0) / cpapUsed.length) * 10) / 10
    : null;
  const cpapOver4 = cpapUsed.filter((n) => n.usageHours >= 4).length;
  const cpapAhis = cpap.filter((n) => n.ahi != null) as Array<{ ahi: number }>;
  const cpapAvgAhi = cpapAhis.length
    ? Math.round((cpapAhis.reduce((s, n) => s + n.ahi, 0) / cpapAhis.length) * 10) / 10
    : null;

  // A range delta needs two weigh-ins — one row is a moment, not a change.
  const rangeStartW = weightsInRange.length >= 2 ? weightsInRange[0].weight : null;
  const rangeEndW = weightsInRange.length >= 2 ? weightsInRange[weightsInRange.length - 1].weight : null;
  const rangeDelta =
    rangeStartW != null && rangeEndW != null ? Math.round((rangeEndW - rangeStartW) * 10) / 10 : null;
  // Honest sign everywhere: a regain prints as +N kg, never as an unsigned
  // number sitting in a "lost" position (clinical-safety).
  const signedKg = (lost: number) => (lost >= 0 ? `−${Math.abs(lost)}` : `+${Math.abs(lost)}`);

  // Symptom summary: max + average severity per kind in range.
  const symptomAgg = new Map<string, { total: number; n: number; max: number }>();
  for (const s of symptoms) {
    const cur = symptomAgg.get(s.kind) ?? { total: 0, n: 0, max: 0 };
    cur.total += s.severity; cur.n += 1; cur.max = Math.max(cur.max, s.severity);
    symptomAgg.set(s.kind, cur);
  }

  const fmtMin = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;

  const meds = data.meds.filter((m) => !m.stoppedOn);
  const rangeLabel = range === '4w' ? 'Last 4 weeks' : range === '3m' ? 'Last 3 months' : 'All data';
  const rangeLabelAr = range === '4w' ? 'آخر ٤ أسابيع' : range === '3m' ? 'آخر ٣ أشهر' : 'كل البيانات';

  return (
    <div className="space-y-4 pb-8 print:space-y-3 print:text-black">
      <div className="print:hidden">
        <BackLink label="Health" />
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

        {/* The headline numbers */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
            <p className="metric-value print:text-black">{snapshot ? snapshot.currentKg : '—'}</p>
            <p className="metric-label print:text-gray-700">
              kg now{snapshot ? ` · from ${snapshot.startKg} (${signedKg(snapshot.lostKg)})` : ''}
            </p>
          </div>
          <div className="rounded-card border border-app-border p-2.5 print:border-gray-300">
            <p className="metric-value print:text-black">{clock ? `${clock.lastDoseMg} mg` : '—'}</p>
            <p className="metric-label print:text-gray-700">
              {clock ? `weekly · treatment week ${clock.week}` : 'not started'}
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
              <Row label="Start → now" value={`${snapshot.startKg} → ${snapshot.currentKg} kg`} />
              <Row label="Change" value={`${signedKg(snapshot.lostKg)} kg (${snapshot.pctLost}%)`} />
              <Row label="BMI" value={`${snapshot.startBmi} → ${snapshot.bmi}`} />
              {rangeDelta != null && (
                <Row
                  label={rangeLabel}
                  value={`${rangeDelta > 0 ? '+' : ''}${rangeDelta} kg · ${weightsInRange.length} weigh-ins`}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">No weigh-ins logged.</p>
          )}
        </Section>

        {clock && ledger.length > 0 && (
          <Section title="Mounjaro — since dose 1">
            <Row label="First dose" value={fmt(clock.anchor)} />
            {pace && <Row label="Current pace" value={`${pace.kgPerWeek} kg/week`} />}
            {bpSplit.before && (
              <Row
                label="BP before treatment"
                value={`${bpSplit.before.systolic}/${bpSplit.before.diastolic} · ${bpSplit.before.n} readings`}
              />
            )}
            {bpSplit.since && (
              <Row
                label="BP since"
                value={`${bpSplit.since.systolic}/${bpSplit.since.diastolic} · ${bpSplit.since.n} readings`}
              />
            )}
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
          {symptomAgg.size === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">Nothing logged in this range.</p>
          ) : (
            [...symptomAgg.entries()]
              .sort((a, b) => b[1].max - a[1].max)
              .map(([kind, v]) => (
                <Row
                  key={kind}
                  label={SYMPTOM_LABEL[kind] ?? kind.replace('-', ' ')}
                  value={`${v.n}× · worst ${SEVERITY_WORD[v.max]}`}
                />
              ))
          )}
        </Section>

        <Section title="Atrial fibrillation">
          <Row label="Episodes in range" value={String(episodes.length)} />
          {episodes.map((e) => (
            <Row
              key={e.id}
              label={fmt(e.startedAt)}
              value={e.durationMin != null ? fmtMin(e.durationMin) : 'duration unknown'}
            />
          ))}
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
        </Section>

        <Section title="CPAP">
          {cpap.length ? (
            <>
              <Row label="Nights logged" value={String(cpap.length)} />
              <Row label="Average use" value={`${cpapAvgH ?? '—'} h/night`} />
              <Row label="Nights ≥ 4 h" value={`${cpapOver4} of ${cpap.length}`} />
              {cpapAvgAhi != null && <Row label="Average AHI" value={String(cpapAvgAhi)} />}
            </>
          ) : (
            <p className="text-sm text-app-tx3 print:text-gray-600">No CPAP nights logged in this range.</p>
          )}
        </Section>

        <Section title="Laboratory">
          {labs.length === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">No labs in this range.</p>
          ) : (
            labs.map((l) => (
              <Row
                key={l.id}
                label={`${l.test.toUpperCase()} · ${fmt(l.date)}`}
                value={`${l.value} ${l.unit}${l.refHigh != null ? ` (ref ≤ ${l.refHigh})` : ''}`}
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
              الوزن: {snapshot ? `${snapshot.startKg} كجم ← ${snapshot.currentKg} كجم (${snapshot.lostKg >= 0 ? 'نقص' : 'زيادة'} ${Math.abs(snapshot.lostKg)} كجم، ${snapshot.pctLost}٪)` : 'لا يوجد'}
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
    </div>
  );
}
