import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getHealthData } from '@/app/health-actions';
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

/** Standard-font PDFs speak WinAnsi only — swap the glyphs it lacks. */
const clean = (s: string) =>
  s
    .replace(/−/g, '-')
    .replace(/≥/g, '>=')
    .replace(/→/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '·'); // middle dot IS WinAnsi — keep

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

  const data = await getHealthData();
  const inRange = <T,>(rows: T[], at: (r: T) => Date | string) =>
    rows.filter((r) => new Date(at(r)) >= since);

  const symptoms = inRange(data.symptoms, (sy) => sy.at);
  const episodes = inRange(data.afEpisodes, (e) => e.startedAt);
  const bp = inRange(data.bpReadings, (r) => r.at);
  const cpap = inRange(data.cpapNights, (n) => n.night);
  const labs = inRange(data.labs, (l) => l.date);

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
  const cpapUsed = cpap.filter((n) => n.usageHours > 0);
  const cpapAvgH = cpapUsed.length
    ? Math.round((cpapUsed.reduce((s, n) => s + n.usageHours, 0) / cpapUsed.length) * 10) / 10
    : null;
  const cpapOver4 = cpapUsed.filter((n) => n.usageHours >= 4).length;
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
  // Adherence denominator: mornings elapsed since therapy began (clamped to
  // the range), never less than the nights actually used — a lagging prisma
  // report must not produce "7 of 6".
  const cpapFrom = firstCpapNight
    ? Math.max(new Date(firstCpapNight).getTime(), since.getTime())
    : null;
  const cpapElapsed = cpapFrom
    ? Math.max(cpapUsed.length, Math.floor((Date.now() - cpapFrom) / DAY_MS) + 1)
    : 0;
  const meds = data.meds.filter((m) => !m.stoppedOn);
  const conditions = ((data.profile.conditions as string[] | null) ?? []).filter(
    (c): c is string => typeof c === 'string',
  );
  const signedKg = (lost: number) => (lost >= 0 ? `-${Math.abs(lost)}` : `+${Math.abs(lost)}`);

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
    page.drawText(clean(t), { x, y, size, font: f, color });
  const row = (label: string, value: string, dim = false) => {
    ensure(16);
    text(label, M, 10, font, DIM);
    const v = clean(value);
    const w = bold.widthOfTextAtSize(v, 10);
    page.drawText(v, { x: A4[0] - M - w, y, size: 10, font: bold, color: dim ? DIM : INK });
    y -= 15;
  };
  const section = (title: string) => {
    ensure(34);
    y -= 8;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, thickness: 0.7, color: LINE });
    y -= 12;
    text(title.toUpperCase(), M, 8.5, bold, DIM);
    y -= 15;
  };
  const note = (t: string) => {
    ensure(14);
    text(t, M, 8.5, font, DIM);
    y -= 12;
  };
  const fmtV = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  /** One trend chart, drawn from the shared layout. Layout y runs down from
   *  the box top; pdf-lib y runs up, so every point is `top - p.y`. */
  const chart = (spec: ChartSpec) => {
    const W = A4[0] - 2 * M;
    const H = 118;
    ensure(H + 22);
    y -= 4;
    const caption = `${spec.title} · ${spec.unit}`;
    text(caption, M, 8, bold, DIM);
    if (spec.series.length > 1) {
      let lx = A4[0] - M;
      for (const s of [...spec.series].reverse()) {
        const lbl = `- ${s.label}`;
        lx -= bold.widthOfTextAtSize(lbl, 8) + 8;
        page.drawText(lbl, { x: lx, y, size: 8, font: bold, color: TONE[s.key] ?? INK });
      }
    }
    y -= 6;
    const top = y;
    const c = layoutChart(spec, W, H, { left: 30, right: 36, top: 6, bottom: 14 });
    const X = (x: number) => M + x;
    const Y = (py: number) => top - py;
    for (const t of c.yTicks) {
      page.drawLine({ start: { x: X(c.plot.left), y: Y(t.y) }, end: { x: X(c.plot.right), y: Y(t.y) }, thickness: 0.4, color: LINE });
      const w = font.widthOfTextAtSize(t.label, 7);
      page.drawText(t.label, { x: X(c.plot.left) - 4 - w, y: Y(t.y) - 2.5, size: 7, font, color: DIM });
    }
    c.xTicks.forEach((t, i) => {
      const w = font.widthOfTextAtSize(t.label, 7);
      const x = i === 0 ? X(t.x) : i === c.xTicks.length - 1 ? X(t.x) - w : X(t.x) - w / 2;
      page.drawText(t.label, { x, y: Y(c.height) + 2, size: 7, font, color: DIM });
    });
    for (const r of c.refs) {
      page.drawLine({ start: { x: X(c.plot.left), y: Y(r.y) }, end: { x: X(c.plot.right), y: Y(r.y) }, thickness: 0.7, color: DIM, dashArray: [3, 3] });
      page.drawText(clean(r.label), { x: X(c.plot.right) + 3, y: Y(r.y) - 2.5, size: 7, font, color: DIM });
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
      if (last) page.drawText(fmtV(last.v), { x: X(c.plot.right) + 3, y: Y(last.y) - 2.5, size: 7, font: bold, color });
    }
    y = top - H - 6;
  };
  const tooFew = () => note('Not enough readings in this range for a trend yet.');

  // Header
  text('AR Health - Doctor Report', M, 18, bold);
  y -= 20;
  text(`${rangeLabel} · generated ${fmt(new Date())} · self-reported data, not a medical record`, M, 9, font, DIM);
  y -= 24;

  row('Patient', 'Abdulrahman Alhamoud');
  row('Born', `1988 · ${new Date().getFullYear() - 1988} y`);
  row('Height', `${data.profile.heightCm} cm`);
  if (conditions.length) note(conditions.join(' · '));
  // Family history and investigations are not printed (owner, 2026-09-30).
  // They stay stored on the profile and in the export.
  // No at-a-glance strip: the sections carry these numbers once each
  // (owner removed it as redundant, 2026-08-30 — say each thing once).

  section('Weight');
  if (snapshot) {
    row('First clinic visit -> now', `${snapshot.startKg} -> ${snapshot.currentKg} kg`);
    row('Change', `${signedKg(snapshot.lostKg)} kg (${snapshot.pctLost}%)`);
    row('BMI', `${snapshot.startBmi} -> ${snapshot.bmi}`);
    if (pace) row('Current pace', `${pace.kgPerWeek > 0 ? '+' : ''}${pace.kgPerWeek} kg/week`);
    if (charts.weight) chart(charts.weight);
    else tooFew();
  } else {
    note('No weigh-ins logged.');
  }

  if (clock && ledger.length) {
    section('Mounjaro (tirzepatide) - since dose 1');
    row('First dose', fmt(clock.anchor));
    row('Current dose', `${clock.lastDoseMg} mg weekly · treatment week ${clock.week}`);
    if (charts.dose) chart(charts.dose);
    y -= 2;
    for (const d of ledger) {
      ensure(24);
      text(`Dose ${d.n} · ${fmt(d.at)} · ${d.doseMg} mg · ${siteLabel(d.site)}`, M, 9.5, bold);
      y -= 12;
      const sideEffects = d.symptoms.length
        ? d.symptoms.slice(0, 3).map((sy) => `${SYMPTOM_LABEL[sy.kind] ?? sy.kind} (${SEVERITY_WORD[sy.maxSeverity]}, ${sy.count}x)`).join(', ')
        : 'no side effects logged';
      text(sideEffects, M + 10, 8.5, font, DIM);
      y -= 13;
    }
  }

  section('Side effects & GI');
  if (symptomAgg.size === 0) note('Nothing logged in this range.');
  else {
    for (const [kind, v] of [...symptomAgg.entries()].sort((a, b) => b[1].max - a[1].max)) {
      row(SYMPTOM_LABEL[kind] ?? kind, `${v.n}x · worst ${SEVERITY_WORD[v.max]}`);
    }
  }

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
  if (bp.length) {
    if (charts.bp) chart(charts.bp);
    else tooFew();
  }

  section('CPAP');
  if (cpap.length) {
    if (firstCpapNight) row('Therapy since', fmt(firstCpapNight));
    row('Nights logged', String(cpap.length));
    row('Average use', `${cpapAvgH ?? '-'} h/night`);
    row('Nights >= 4 h', `${cpapOver4} of ${cpap.length}`);
    if (cpapElapsed > 0) {
      row('Nights used', `${cpapUsed.length} of ${cpapElapsed} (${Math.round((cpapUsed.length / cpapElapsed) * 100)}%)`);
    }
    if (cpapAvgAhi != null) row('Average AHI', String(cpapAvgAhi));
    if (cpapDeepMin != null) {
      row('Deep sleep (device estimate)', `${cpapDeepMin} min/night - ${cpapDeep.length} nights`);
    }
    if (charts.cpapHours) chart(charts.cpapHours);
    else tooFew();
    if (charts.cpapAhi) chart(charts.cpapAhi);
  } else {
    note('No CPAP nights logged in this range.');
  }

  section('Laboratory');
  if (!labs.length) note('No labs in this range.');
  for (const l of labs) {
    row(`${l.test.toUpperCase()} · ${fmt(l.date)}`, `${l.value} ${l.unit}${l.refHigh != null ? ` (ref <= ${l.refHigh})` : ''}`);
  }

  section('Current medications');
  if (!meds.length) note('-');
  for (const m of meds) row(m.name, `${m.doseLabel} · ${m.frequency}`);

  // Footer on every page — a printed page separated from the stack must
  // still identify itself. Drawn last, when the page count is known.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(clean(`Abdulrahman Alhamoud · prepared ${fmt(new Date())} · AR Health`), {
      x: M, y: 30, size: 7.5, font, color: DIM,
    });
    const pn = `page ${i + 1} of ${pages.length}`;
    p.drawText(pn, {
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
