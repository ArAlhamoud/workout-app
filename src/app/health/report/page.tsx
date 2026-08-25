import type { Metadata } from 'next';
import Link from 'next/link';
import BackLink from '@/components/BackLink';
import PrintButton from '@/components/health/PrintButton';
import { getHealthData } from '../../health-actions';
import {
  afStats,
  bpAverage,
  siteLabel,
  treatmentClock,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
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

      {/* The report body — reads in under two minutes, prints clean */}
      <div className="card-lg space-y-4 p-4 print:border-0 print:bg-white print:p-0 print:shadow-none">
        <div>
          <p className="text-base font-bold text-app-tx1 print:text-black">
            Health summary — {rangeLabel}
          </p>
          <p className="text-xs text-app-tx3 print:text-gray-600">
            Self-reported data from Aurora Health · generated {fmt(new Date())} · not a
            medical record
          </p>
        </div>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Weight</p>
          <p className="text-sm text-app-tx1 print:text-black">
            {snapshot
              ? `${snapshot.startKg} kg (start) → ${snapshot.currentKg} kg now · ${signedKg(snapshot.lostKg)} kg (${snapshot.pctLost}%) · BMI ${snapshot.startBmi} → ${snapshot.bmi}`
              : 'No weigh-ins logged.'}
            {rangeDelta != null && ` · ${rangeLabel.toLowerCase()}: ${rangeDelta > 0 ? '+' : ''}${rangeDelta} kg (${weightsInRange.length} weigh-ins)`}
          </p>
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Mounjaro (tirzepatide)</p>
          {injections.length === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">No injections in this range.</p>
          ) : (
            <div className="space-y-0.5 text-sm text-app-tx1 print:text-black">
              {clock && (
                <p className="text-xs text-app-tx3 print:text-gray-600">
                  Treatment week {clock.week} · current dose {clock.lastDoseMg} mg weekly
                </p>
              )}
              {injections.map((i) => (
                <p key={i.id} className="tabular-nums">
                  {fmt(i.at)} · {i.doseMg} mg · {siteLabel(i.site)}
                  {i.onSchedule ? '' : ' · off-plan'}
                </p>
              ))}
            </div>
          )}
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Side effects & GI</p>
          {symptomAgg.size === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">Nothing logged in this range.</p>
          ) : (
            <p className="text-sm leading-relaxed text-app-tx1 print:text-black">
              {[...symptomAgg.entries()]
                .sort((a, b) => b[1].max - a[1].max)
                .map(
                  ([kind, v]) =>
                    `${kind.replace('-', ' ')} (${v.n}×, worst ${SEVERITY_WORD[v.max]})`,
                )
                .join(' · ')}
            </p>
          )}
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Atrial fibrillation</p>
          <p className="text-sm text-app-tx1 print:text-black">
            {episodes.length} episode{episodes.length === 1 ? '' : 's'} in range
            {episodes.length > 0 &&
              ` · durations ${episodes
                .map((e) => (e.durationMin != null ? `${e.durationMin}m` : '?'))
                .join(', ')}`}
            {af.daysSinceLast != null && ` · ${af.daysSinceLast} days since last`}
          </p>
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Blood pressure</p>
          <p className="text-sm text-app-tx1 print:text-black">
            {bpAvg
              ? `Average ${bpAvg.systolic}/${bpAvg.diastolic} over ${bpAvg.n} readings`
              : bp.length
              ? `${bp.length} reading${bp.length === 1 ? '' : 's'} (too few for an average)`
              : 'No readings in this range.'}
          </p>
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">CPAP</p>
          <p className="text-sm text-app-tx1 print:text-black">
            {cpap.length
              ? `${cpap.length} nights logged · avg ${cpapAvgH ?? '—'} h/night · ${cpapOver4} nights ≥4 h${cpapAvgAhi != null ? ` · avg AHI ${cpapAvgAhi}` : ''}`
              : 'No CPAP nights logged in this range.'}
          </p>
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Laboratory</p>
          {labs.length === 0 ? (
            <p className="text-sm text-app-tx3 print:text-gray-600">No labs in this range.</p>
          ) : (
            <div className="space-y-0.5 text-sm tabular-nums text-app-tx1 print:text-black">
              {labs.map((l) => (
                <p key={l.id}>
                  {fmt(l.date)} · {l.test.toUpperCase()} {l.value} {l.unit}
                  {l.refHigh != null && ` (ref ≤ ${l.refHigh})`}
                  {l.notes && <span className="text-app-tx3 print:text-gray-600"> · {l.notes}</span>}
                </p>
              ))}
            </div>
          )}
        </section>

        <section>
          <p className="section-label mb-1 print:font-bold print:text-black">Current medications</p>
          <p className="text-sm text-app-tx1 print:text-black">
            {meds.map((m) => `${m.name} ${m.doseLabel} ${m.frequency}`).join(' · ') || '—'}
          </p>
        </section>

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
