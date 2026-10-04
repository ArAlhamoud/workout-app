import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getHealthData, getSleepNights } from '@/app/health-actions';
import { sleepReportRows, sleepReportSummary } from '@/lib/sleep';
import { cpapAdherenceLabel, pdfSafe, reportAge, weightChangeLabel, wrapLines } from '@/lib/health-format';
import {
  afStats,
  bpAverage,
  cpapAdherence,
  bpSplitAroundAnchor,
  doseLedger,
  ledgerByDose,
  labRefLabel,
  ownerDayKey,
  ongoingSymptoms,
  sideEffectRows,
  reportLabs,
  treatmentClock,
  weightPace,
  weightSnapshot,
  DEFAULT_DOSE_PLAN,
  SYMPTOM_LABEL,
  type DosePlanStep,
} from '@/lib/health-insights';
import {
  bpChart,
  cpapAhiChart,
  cpapHoursChart,
  doseChart,
  layoutChart,
  weightChart,
  type ChartSpec,
} from '@/lib/report-charts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;
const RANGES = { '4w': 28, '3m': 91, all: 100_000 } as const;
type RangeKey = keyof typeof RANGES;

const SEVERITY_WORD = ['none', 'mild', 'moderate', 'severe'];
const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' });
const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;

// Standard-font PDFs speak WinAnsi only. EVERY string drawn goes through
// pdfSafe (src/lib/health-format.ts): the six-glyph swap that lived here
// let one "≈", "μ" or Arabic letter in a med name throw inside pdf-lib and
// take the whole report down with a 500 (2026-10-02). The suite fails on
// a drawText whose first argument is not pdfSafe(...).

/**
 * The doctor report as a real PDF file — same aggregates as the page
 * (English side; the Arabic summary lives on the printable web view,
 * because standard PDF fonts cannot shape Arabic honestly). A5-margin
 * A4, label-left value-right rows, flows to extra pages as data grows.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rangeParam = url.searchParams.get('range');
  const range: RangeKey = rangeParam === '3m' || rangeParam === 'all' ? rangeParam : '4w';
  const since = new Date(Date.now() - RANGES[range] * DAY_MS);
  const rangeLabel = range === '4w' ? 'Last 4 weeks' : range === '3m' ? 'Last 3 months' : 'All data';

  const [data, sleepNights] = await Promise.all([getHealthData(), getSleepNights()]);
  const inRange = <T,>(rows: T[], at: (r: T) => Date | string) =>
    rows.filter((r) => new Date(at(r)) >= since);

  const symptoms = inRange(data.symptoms, (sy) => sy.at);
  const episodes = inRange(data.afEpisodes, (e) => e.startedAt);
  const bp = inRange(data.bpReadings, (r) => r.at);
  const cpap = inRange(data.cpapNights, (n) => n.night);
  const labs = reportLabs(data.labs);

  const clock = treatmentClock(
    data.injections,
    ((data.profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN),
    new Date(),
    data.firstInjectionAt ?? undefined,
    data.injectionCount,
  );
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
  const bpAvg = bpAverage(
    bp.map((r) => ({ at: r.at, systolic: r.systolic, diastolic: r.diastolic })),
    RANGES[range],
  );
  const af = afStats(data.afEpisodes);
  // One adherence for the page and this file (cpapAdherence): of the
  // nights REPORTED, never of every morning up to today.
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
  // Sleep from the wearable — the page's own function and words; the
  // oxygen row is labelled a wrist reading there.
  const sleepRows = sleepReportRows(
    sleepReportSummary(sleepNights, data.cpapNights, ownerDayKey(since), ownerDayKey(new Date())),
  );
  const firstCpapNight = data.cpapNights.length
    ? [...data.cpapNights].sort((a, b) => new Date(a.night).getTime() - new Date(b.night).getTime())[0].night
    : null;
  const symptomAgg = new Map<string, { n: number; max: number }>();
  for (const sy of symptoms) {
    const cur = symptomAgg.get(sy.kind) ?? { n: 0, max: 0 };
    cur.n += 1;
    cur.max = Math.max(cur.max, sy.severity);
    symptomAgg.set(sy.kind, cur);
  }
  const pulses = bp.filter((r) => r.pulse != null).map((r) => r.pulse as number);
  const pulseAvg =
    pulses.length >= 3 ? Math.round(pulses.reduce((s, p) => s + p, 0) / pulses.length) : null;
  const meds = data.meds.filter((m) => !m.stoppedOn);
  const conditions = ((data.profile.conditions as string[] | null) ?? []).filter(
    (c): c is string => typeof c === 'string',
  );

  // Trend charts — the SAME specs the page draws (src/lib/report-charts.ts).
  const weightsInRange = inRange(data.bodyStats.filter((b) => b.weight != null), (b) => b.date);
  const charts = {
    weight: weightChart(weightsInRange),
    bp: bpChart(bp.map((r) => ({ at: r.at, systolic: r.systolic, diastolic: r.diastolic }))),
    cpapHours: cpapHoursChart(cpap),
    cpapAhi: cpapAhiChart(cpap),
    dose: doseChart(ledger),
  };

  // ── draw ──────────────────────────────────────────────────
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const INK = rgb(0.04, 0.04, 0.06);
  const DIM = rgb(0.42, 0.42, 0.46);
  const LINE = rgb(0.85, 0.85, 0.87);
  // Accent tokens from tailwind.config.ts (text-safe darks): teal #0f766e,
  // violet #6d28d9, cyan #0e7490. Same colour per series as the page.
  const TONE: Record<string, ReturnType<typeof rgb>> = {
    weight: rgb(0.059, 0.463, 0.431),
    systolic: rgb(0.427, 0.157, 0.851),
    diastolic: rgb(0.055, 0.455, 0.565),
    hours: rgb(0.059, 0.463, 0.431),
    ahi: rgb(0.427, 0.157, 0.851),
    dose: rgb(0.059, 0.463, 0.431),
  };

  const A4: [number, number] = [595.28, 841.89];
  const M = 56; // margin
  let page = doc.addPage(A4);
  let y = A4[1] - M;

  const ensure = (need: number) => {
    if (y - need < M) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };
  const text = (t: string, x: number, size: number, f = font, color = INK) =>
    page.drawText(pdfSafe(t), { x, y, size, font: f, color });
  // Compact rhythm so the written report fits page 1 and the charts get
  // page 2 (owner, 2026-09-30: "two pages, one normal, one the graphs").
  const row = (label: string, value: string, dim = false) => {
    ensure(15);
    text(label, M, 9.5, font, DIM);
    const w = bold.widthOfTextAtSize(pdfSafe(value), 9.5);
    page.drawText(pdfSafe(value), { x: A4[0] - M - w, y, size: 9.5, font: bold, color: dim ? DIM : INK });
    y -= 13.5;
  };
  const section = (title: string) => {
    // Room for the heading AND its first rows: a heading alone at the foot
    // of a page, its content on the next, reads as an empty section.
    ensure(56);
    y -= 6;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, thickness: 0.7, color: LINE });
    y -= 11;
    text(title.toUpperCase(), M, 8.5, bold, DIM);
    y -= 13;
  };
  // A note wraps inside the margins: the conditions line was one unwrapped
  // line at 433 of 483 pt — one more diagnosis and it ran off the page.
  const note = (t: string) => {
    for (const line of wrapLines(pdfSafe(t), A4[0] - 2 * M, (s) => font.widthOfTextAtSize(s, 8.5))) {
      ensure(14);
      text(line, M, 8.5, font, DIM);
      y -= 12;
    }
  };
  const fmtV = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  /** One trend chart, drawn from the shared layout. Layout y runs down from
   *  the box top; pdf-lib y runs up, so every point is `top - p.y`. */
  const chart = (spec: ChartSpec, H = 108) => {
    const W = A4[0] - 2 * M;
    ensure(H + 22);
    y -= 4;
    const caption = `${spec.title} · ${spec.unit}`;
    text(caption, M, 8, bold, DIM);
    if (spec.series.length > 1) {
      let lx = A4[0] - M;
      for (const s of [...spec.series].reverse()) {
        const lbl = pdfSafe(`- ${s.label}`);
        lx -= bold.widthOfTextAtSize(lbl, 8) + 8;
        page.drawText(pdfSafe(lbl), { x: lx, y, size: 8, font: bold, color: TONE[s.key] ?? INK });
      }
    }
    y -= 6;
    const top = y;
    const c = layoutChart(spec, W, H, { left: 30, right: 36, top: 6, bottom: 14 });
    const X = (x: number) => M + x;
    const Y = (py: number) => top - py;
    for (const t of c.yTicks) {
      page.drawLine({ start: { x: X(c.plot.left), y: Y(t.y) }, end: { x: X(c.plot.right), y: Y(t.y) }, thickness: 0.4, color: LINE });
      const w = font.widthOfTextAtSize(pdfSafe(t.label), 7);
      page.drawText(pdfSafe(t.label), { x: X(c.plot.left) - 4 - w, y: Y(t.y) - 2.5, size: 7, font, color: DIM });
    }
    c.xTicks.forEach((t, i) => {
      const w = font.widthOfTextAtSize(pdfSafe(t.label), 7);
      const x = i === 0 ? X(t.x) : i === c.xTicks.length - 1 ? X(t.x) - w : X(t.x) - w / 2;
      page.drawText(pdfSafe(t.label), { x, y: Y(c.height) + 2, size: 7, font, color: DIM });
    });
    for (const r of c.refs) {
      page.drawLine({ start: { x: X(c.plot.left), y: Y(r.y) }, end: { x: X(c.plot.right), y: Y(r.y) }, thickness: 0.7, color: DIM, dashArray: [3, 3] });
      page.drawText(pdfSafe(r.label), { x: X(c.plot.right) + 3, y: Y(r.y) - 2.5, size: 7, font, color: DIM });
    }
    for (const s of c.series) {
      const color = TONE[s.key] ?? INK;
      if (s.kind === 'bar') {
        for (const p of s.points) {
          const h = Math.max(0, c.plot.bottom - p.y);
          page.drawRectangle({ x: X(p.x - s.barWidth / 2), y: Y(c.plot.bottom), width: s.barWidth, height: h, color, opacity: 0.75 });
        }
        continue;
      }
      for (let i = 1; i < s.path.length; i++) {
        page.drawLine({
          start: { x: X(s.path[i - 1].x), y: Y(s.path[i - 1].y) },
          end: { x: X(s.path[i].x), y: Y(s.path[i].y) },
          thickness: 1.3,
          color,
        });
      }
      for (const p of s.points) page.drawCircle({ x: X(p.x), y: Y(p.y), size: 1.6, color });
      const last = s.points[s.points.length - 1];
      if (last) page.drawText(pdfSafe(fmtV(last.v)), { x: X(c.plot.right) + 3, y: Y(last.y) - 2.5, size: 7, font: bold, color });
    }
    // Clear the date labels before the next line (a Dose 1 row once sat on them).
    y = top - H - 16;
  };

  // Header
  text('AR Health - Doctor Report', M, 18, bold);
  y -= 20;
  text(`${rangeLabel} · generated ${fmt(new Date())} · self-reported data, not a medical record`, M, 9, font, DIM);
  y -= 24;

  row('Patient', 'Abdulrahman Alhamoud');
  // Only the birth YEAR is stored, so the age prints as the pair it can be.
  row('Born', `1988 · ${reportAge(null)}`);
  row('Height', `${data.profile.heightCm} cm`);
  if (conditions.length) note(conditions.join(' · '));
  // Family history and investigations are not printed (owner, 2026-09-30).
  // They stay stored on the profile and in the export.
  // No at-a-glance strip: the sections carry these numbers once each
  // (owner removed it as redundant, 2026-08-30 — say each thing once).

  section('Weight');
  if (snapshot) {
    row('First clinic visit -> now', `${snapshot.startKg} -> ${snapshot.currentKg} kg`);
    row('Change', weightChangeLabel(snapshot.lostKg, snapshot.pctLost, '-'));
    row('BMI', `${snapshot.startBmi} -> ${snapshot.bmi}`);
    if (pace) row('Current pace', `${pace.kgPerWeek > 0 ? '+' : ''}${pace.kgPerWeek} kg/week`);
  } else {
    note('No weigh-ins logged.');
  }

  if (clock && ledger.length) {
    section('Mounjaro (tirzepatide) - since dose 1');
    row('First dose', fmt(clock.anchor));
    row('Current dose', `${clock.lastDoseMg} mg weekly · treatment week ${clock.week}`);
    // One line per dose LEVEL on page 1; the dose chart on page 2 shows
    // the weekly steps. Injection sites stay on the web report's ledger.
    y -= 2;
    for (const g of ledgerByDose(ledger)) {
      ensure(24);
      const doses = g.fromN === g.toN ? `dose ${g.fromN}` : `doses ${g.fromN}-${g.toN}`;
      const when = g.fromN === g.toN ? fmt(g.fromAt) : `${fmt(g.fromAt)} - ${fmt(g.toAt)}`;
      text(`${g.doseMg} mg · ${doses} · ${when}`, M, 9.5, bold);
      y -= 11.5;
      const sideEffects = g.symptoms.length
        ? g.symptoms.slice(0, 3).map((sy) => `${SYMPTOM_LABEL[sy.kind] ?? sy.kind} after dose ${sy.n} (${SEVERITY_WORD[sy.maxSeverity]}, ${sy.count}x)`).join(', ')
        : 'no side effects logged';
      text(sideEffects, M + 10, 8.5, font, DIM);
      y -= 12.5;
    }
  }

  section('Side effects & GI');
  // Ongoing side effects (profile) first, then logged episodes; a kind
  // that is both prints once — the same rows as the web report.
  const sideEffects = sideEffectRows(ongoingSymptoms(data.profile.ongoingSymptoms), symptomAgg);
  if (sideEffects.length === 0) note('Nothing logged in this range.');
  for (const r of sideEffects) row(r.label, r.value.replace(/×/g, 'x'));

  section('Atrial fibrillation');
  row('Episodes in range', String(episodes.length));
  for (const e of episodes) {
    const flags = (
      [
        ['after a meal', e.afterMeal], ['bloating', e.bloating], ['gas', e.gas],
        ['during/after sleep', e.sleepRelated], ['around exercise', e.exerciseRelated],
        ['caffeine', e.caffeine], ['dehydration', e.dehydration], ['stress', e.stress],
      ] as Array<[string, boolean | null]>
    ).filter(([, v]) => v === true).map(([l]) => l);
    row(
      `${fmt(e.startedAt)} ${new Date(e.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })}`,
      `${e.durationMin != null ? fmtMin(e.durationMin) : 'duration unknown'}${e.hrBpm ? ` · ${e.hrBpm} bpm` : ''}`,
    );
    if (flags.length) note(`  noted at the time: ${flags.join(', ')}`);
  }
  if (af.daysSinceLast != null) row('Days since last', String(af.daysSinceLast), true);

  section('Blood pressure');
  if (bpAvg) row(`Average (${bpAvg.n} readings)`, `${bpAvg.systolic}/${bpAvg.diastolic}`);
  else note(bp.length ? `${bp.length} reading(s) - too few for an average.` : 'No readings in this range.');
  // The treatment split lives here, not under Mounjaro (owner's call).
  if (pulseAvg != null) row('Average pulse', `${pulseAvg} bpm`);
  if (bpSplit.before) row('Before treatment', `${bpSplit.before.systolic}/${bpSplit.before.diastolic} (${bpSplit.before.n} readings)`);
  if (bpSplit.since) row('Since treatment', `${bpSplit.since.systolic}/${bpSplit.since.diastolic} (${bpSplit.since.n} readings)`);

  section('Sleep (wearable)');
  if (sleepRows.length) for (const r of sleepRows) row(r.label, r.value);
  else note('No sleep nights tracked in this range.');

  section('CPAP');
  if (cpap.length) {
    if (firstCpapNight) row('Therapy since', fmt(firstCpapNight));
    row('Nights logged', String(cpap.length));
    row('Average use', `${cpapAvgH ?? '-'} h/night`);
    row('Nights >= 4 h', `${adherence.over4} of ${adherence.reported}`);
    row('Nights used', cpapAdherenceLabel(adherence));
    if (cpapAvgAhi != null) row('Average AHI', String(cpapAvgAhi));
    if (cpapDeepMin != null) {
      row('Deep sleep (device estimate)', `${cpapDeepMin} min/night - ${cpapDeep.length} nights`);
    }
  } else {
    note('No CPAP nights logged in this range.');
  }

  section('Laboratory');
  if (!labs.length) note('No LDL or Lp(a) result logged.');
  for (const l of labs) {
    row(`${l.test.toUpperCase()} · ${fmt(l.date)}`, `${l.value} ${l.unit}${labRefLabel(l) ? ` (${labRefLabel(l)})` : ''}`);
  }

  section('Current medications');
  if (!meds.length) note('-');
  for (const m of meds) row(m.name, `${m.doseLabel} · ${m.frequency}`);

  // ── Page 2: every trend chart together (owner, 2026-09-30) ──
  page = doc.addPage(A4);
  y = A4[1] - M;
  text('Trends', M, 14, bold);
  y -= 16;
  text(`${rangeLabel} · weight, blood pressure and CPAP follow the range; the dose runs since dose 1`, M, 8.5, font, DIM);
  y -= 16;
  const trend = (title: string, spec: ChartSpec | null) => {
    if (spec) chart(spec);
    else note(`${title}: not enough data yet for a chart.`);
  };
  trend('Weight', charts.weight);
  trend('Mounjaro dose', charts.dose);
  trend('Blood pressure', charts.bp);
  trend('CPAP use', charts.cpapHours);
  trend('AHI', charts.cpapAhi);

  // Footer on every page — a printed page separated from the stack must
  // still identify itself. Drawn last, when the page count is known.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(pdfSafe(`Abdulrahman Alhamoud · prepared ${fmt(new Date())} · AR Health`), {
      x: M, y: 30, size: 7.5, font, color: DIM,
    });
    const pn = `page ${i + 1} of ${pages.length}`;
    p.drawText(pdfSafe(pn), {
      x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: 30, size: 7.5, font, color: DIM,
    });
  });

  const bytes = await doc.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ar-health-report-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
