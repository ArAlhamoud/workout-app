import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getHealthData, getSleepNights } from '@/app/health-actions';
import { sleepReportRows, sleepReportSummary } from '@/lib/sleep';
import { bornLabel, cpapAdherenceLabel, pdfSafe, weightChangeLabel } from '@/lib/health-format';
import {
  afStats,
  cpapAdherence,
  bpSplitAroundAnchor,
  doseLedger,
  ledgerByDose,
  ownerDayKey,
  ongoingSymptoms,
  sideEffectRows,
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
  labGrid,
  labTable,
  openQuestionGroups,
  pulseRows,
  pulseTrend,
  reportSince,
  weightWindowRows,
  REPORT_RANGES,
  type ReportRange,
} from '@/lib/doctor-report';
import {
  A4, DIM, INK, LINE, MARGIN as M, LAB_SECTION_NEED, QUESTIONS_SECTION_NEED, createPdfWriter, drawLabGrid, drawQuestions,
} from '@/lib/report-pdf';
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

const SEVERITY_WORD = ['none', 'mild', 'moderate', 'severe'];
const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' });
const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;

// Standard-font PDFs speak WinAnsi only. EVERY string drawn goes through
// pdfSafe (src/lib/health-format.ts): the six-glyph swap that lived here
// let one "≈", "μ" or Arabic letter in a med name throw inside pdf-lib and
// take the whole report down with a 500 (2026-10-02). The suite fails on
// a drawText whose first argument is not pdfSafe(...). The cursor and the
// row/section/note primitives live in src/lib/report-pdf.ts, where the
// suite draws the lab table from a fixture and checks it paginates.

/**
 * The doctor report as a real PDF file — same aggregates as the page
 * (English side; the Arabic summary lives on the printable web view,
 * because standard PDF fonts cannot shape Arabic honestly). A5-margin
 * A4, label-left value-right rows, flows to extra pages as data grows.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rangeParam = url.searchParams.get('range');
  const range: ReportRange = rangeParam === '3m' || rangeParam === 'all' ? rangeParam : '4w';
  // HIS day clock: the window starts N of his days back (reportSince).
  const now = new Date();
  const since = reportSince(range, now);
  const rangeLabel = range === '4w' ? 'Last 4 weeks' : range === '3m' ? 'Last 3 months' : 'All data';

  const [data, sleepNights] = await Promise.all([getHealthData(), getSleepNights()]);
  const inRange = <T,>(rows: T[], at: (r: T) => Date | string) =>
    rows.filter((r) => new Date(at(r)) >= since);

  const symptoms = inRange(data.symptoms, (sy) => sy.at);
  const episodes = inRange(data.afEpisodes, (e) => e.startedAt);
  const bp = inRange(data.bpReadings, (r) => r.at);
  const cpap = inRange(data.cpapNights, (n) => n.night);
  // Every draw in the range, per test, with ITS lab's range; the most
  // recent earlier draw as "previous" (owner, 2026-10-18).
  const labs = labTable(data.labs, since);
  const questions = openQuestionGroups(doctorQuestions(data.profile.doctorQuestions));

  const clock = treatmentClock(
    data.injections,
    ((data.profile.dosePlan as DosePlanStep[] | null) ?? DEFAULT_DOSE_PLAN),
    now,
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
  const pace = weightPace(data.bodyStats, now);
  const snapshot = weightSnapshot(
    data.profile,
    (data.profile.milestonesKg as number[] | null) ?? [],
    data.bodyStats,
  );
  // ONE cut for the whole BP section: the average, the control rows and
  // the pulse pair all run over the readings since `since` — the same
  // rows the page prints (doctor-report.ts).
  const bpAvg = bpWindowAverage(bp);
  const control = bpControlRows(bpControl(bp), fmt);
  const pulse = pulseRows(pulseTrend(data.bpReadings, since, REPORT_RANGES[range]), REPORT_RANGES[range]);
  const af = afStats(data.afEpisodes, now);
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
    sleepReportSummary(sleepNights, data.cpapNights, ownerDayKey(since), ownerDayKey(now)),
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
  const meds = data.meds.filter((m) => !m.stoppedOn);
  const conditions = ((data.profile.conditions as string[] | null) ?? []).filter(
    (c): c is string => typeof c === 'string',
  );

  // Trend charts — the SAME specs the page draws (src/lib/report-charts.ts).
  const weightsInRange = inRange(data.bodyStats.filter((b) => b.weight != null), (b) => b.date);
  const windowRows = snapshot
    ? weightWindowRows({ weights: weightsInRange, rangeLabel, treatmentWeek: clock?.week ?? null }, '-')
    : [];
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

  // The cursor, rows, sections and notes (src/lib/report-pdf.ts). A note
  // wraps inside the margins: the conditions line was one unwrapped line
  // at 433 of 483 pt — one more diagnosis and it ran off the page.
  const w = createPdfWriter(doc, font, bold);
  const { row, section, note } = w;
  const text = (t: string, x: number, size: number, f = font, color = INK) => w.text(t, size, f, color, x);
  const fmtV = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  /** One trend chart, drawn from the shared layout. Layout y runs down from
   *  the box top; pdf-lib y runs up, so every point is `top - p.y`. */
  const chart = (spec: ChartSpec, H = 108) => {
    const W = A4[0] - 2 * M;
    w.ensure(H + 22);
    // The page is fixed for the whole chart once ensure has run.
    const page = w.page;
    w.setY(w.y - 4);
    const caption = `${spec.title} · ${spec.unit}`;
    text(caption, M, 8, bold, DIM);
    if (spec.series.length > 1) {
      let lx = A4[0] - M;
      for (const s of [...spec.series].reverse()) {
        const lbl = pdfSafe(`- ${s.label}`);
        lx -= bold.widthOfTextAtSize(lbl, 8) + 8;
        page.drawText(pdfSafe(lbl), { x: lx, y: w.y, size: 8, font: bold, color: TONE[s.key] ?? INK });
      }
    }
    w.setY(w.y - 6);
    const top = w.y;
    const c = layoutChart(spec, W, H, { left: 30, right: 36, top: 6, bottom: 14 });
    const X = (x: number) => M + x;
    const Y = (py: number) => top - py;
    for (const t of c.yTicks) {
      page.drawLine({ start: { x: X(c.plot.left), y: Y(t.y) }, end: { x: X(c.plot.right), y: Y(t.y) }, thickness: 0.4, color: LINE });
      const tw = font.widthOfTextAtSize(pdfSafe(t.label), 7);
      page.drawText(pdfSafe(t.label), { x: X(c.plot.left) - 4 - tw, y: Y(t.y) - 2.5, size: 7, font, color: DIM });
    }
    c.xTicks.forEach((t, i) => {
      const tw = font.widthOfTextAtSize(pdfSafe(t.label), 7);
      const x = i === 0 ? X(t.x) : i === c.xTicks.length - 1 ? X(t.x) - tw : X(t.x) - tw / 2;
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
    w.setY(top - H - 16);
  };

  // Header
  text('AR Health - Doctor Report', M, 18, bold);
  w.setY(w.y - 20);
  text(`${rangeLabel} · generated ${fmt(now)} · self-reported data, not a medical record`, M, 9, font, DIM);
  w.setY(w.y - 24);

  row('Patient', 'Abdulrahman Alhamoud');
  // Birth month and year as the owner gave them; the age turns with the
  // month (bornLabel). Without a stored date, the honest pair.
  row('Born', bornLabel(data.profile.birthDate, now));
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
    // The window: change, share lost, pace per week, weeks on treatment —
    // the page's rows (weightWindowRows), with the PDF's own minus.
    for (const r of windowRows) row(r.label, r.value, r.dim);
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
    w.setY(w.y - 2);
    for (const g of ledgerByDose(ledger)) {
      w.ensure(24);
      const doses = g.fromN === g.toN ? `dose ${g.fromN}` : `doses ${g.fromN}-${g.toN}`;
      const when = g.fromN === g.toN ? fmt(g.fromAt) : `${fmt(g.fromAt)} - ${fmt(g.toAt)}`;
      text(`${g.doseMg} mg · ${doses} · ${when}`, M, 9.5, bold);
      w.setY(w.y - 11.5);
      const sideEffects = g.symptoms.length
        ? g.symptoms.slice(0, 3).map((sy) => `${SYMPTOM_LABEL[sy.kind] ?? sy.kind} after dose ${sy.n} (${SEVERITY_WORD[sy.maxSeverity]}, ${sy.count}x)`).join(', ')
        : 'no side effects logged';
      text(sideEffects, M + 10, 8.5, font, DIM);
      w.setY(w.y - 12.5);
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
  // Control, highest and lowest, the morning/evening split, then the
  // pulse pair (bpControlRows / pulseRows — the page's rows).
  for (const r of [...control, ...pulse]) row(r.label, r.value, r.dim);
  // The treatment split lives here, not under Mounjaro (owner's call).
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

  // The lab grid (owner, 2026-10-18: "like a table"): one row per test, a
  // column per draw, the previous draw dimmed, each lab's own range. The
  // heading needs room for the note, the header, a group and a row.
  section('Laboratory', LAB_SECTION_NEED);
  if (!labs.length) note('No result in this range.');
  else note("Each value against its own lab's range; ^ above it, v below it; bold = newest; Previous = the last draw before the range.");
  drawLabGrid(w, labGrid(labs));

  section('Current medications');
  if (!meds.length) note('-');
  for (const m of meds) row(m.name, `${m.doseLabel} · ${m.frequency}`);

  // The owner's own questions, last, in his words (owner, 2026-10-18).
  if (questions.length) {
    section('Questions for the doctor', QUESTIONS_SECTION_NEED);
    drawQuestions(w, questions);
  }

  // ── The last page(s): every trend chart together (owner, 2026-09-30) ──
  w.newPage();
  text('Trends', M, 14, bold);
  w.setY(w.y - 16);
  text(`${rangeLabel} · weight, blood pressure and CPAP follow the range; the dose runs since dose 1`, M, 8.5, font, DIM);
  w.setY(w.y - 16);
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
    p.drawText(pdfSafe(`Abdulrahman Alhamoud · prepared ${fmt(now)} · AR Health`), {
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
      'Content-Disposition': `inline; filename="ar-health-report-${ownerDayKey(now)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
